// Generation pipelines. Each tool is a sequence of model calls tracked as a "job"
// with visible steps, outputs and a credit cost. With no fal key, everything runs
// in demo mode with placeholder media so the whole flow can be tried offline.
import { waitUntil } from '@vercel/functions';
import { store } from './store/index.js';
import { run, toRemote, isMock, llmModel } from './fal.js';
import { download, uid } from './media.js';
import * as F from './ffmpeg.js';
import { VIDEO_MODELS, TIERS, tierOf, tierSeconds, MODELS, PRICE, ttsCost, videoCost, talkCost, showCost, imageCost, sfxCost, musicCost } from './models.js';
import { AVATAR_PRESETS, avatarPrompt } from './avatars.js';
import crypto from 'node:crypto';
import * as P from './prompts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const demoWait = () => sleep(600 + Math.random() * 900);

// ---------- style + camera vocab ----------
export const STYLES = {
  ugc: 'authentic UGC smartphone photo, natural light, slightly imperfect framing, real skin texture',
  photo: 'photorealistic, true to the reference photo',
  cinematic: 'cinematic film still, anamorphic lens, shallow depth of field, rich color grade',
  studio: 'clean commercial studio product photography, softbox lighting, seamless background',
  '3d': '3D animated family-film style, soft global illumination, expressive',
  anime: 'anime key visual, bold clean lines, vibrant color',
  clay: 'claymation, handmade stop-motion look, tactile textures',
  storybook: 'storybook watercolor illustration, soft paper texture',
};
export const CAMERAS = {
  static: 'static camera, subtle natural movement',
  'dolly-in': 'slow dolly in toward the subject',
  'dolly-out': 'slow dolly out revealing the scene',
  pan: 'smooth pan from left to right',
  orbit: 'camera orbits around the subject',
  crane: 'crane up rising above the subject',
  handheld: 'handheld selfie-style camera with natural shake',
  crash: 'fast crash zoom onto the subject',
  fpv: 'FPV drone flying through the scene',
};

// ---------- job runner ----------
// Running jobs live in memory (fast polling) and are persisted to the store as they change.
// Credits: the estimate is reserved up front, the unused part is refunded at the end.
export const live = new Map();

export async function createJob({ uid: owner, tool, title, input, estimate, lookups, run: runTool }) {
  const job = {
    id: uid(), user_id: owner, tool, title, input, status: 'running', steps: [], outputs: [], text: null,
    cost: 0, estimate, createdAt: Date.now(), mock: isMock(),
  };
  await store.adjust(owner, -estimate, title.slice(0, 80), job.id); // throws INSUFFICIENT_CREDITS
  live.set(job.id, job);
  let saveT;
  const persist = (now) => {
    clearTimeout(saveT);
    const go = () => store.saveJob(job).catch((e) => console.error('[save job]', e.message));
    return now ? go() : (saveT = setTimeout(go, 800));
  };
  await persist(true);
  const ctx = {
    job, uid: owner,
    friend: (id) => lookups.friends.find((f) => f.id === id) || null,
    product: (id) => lookups.products.find((p) => p.id === id) || null,
    voice: (id) => (lookups.voices || []).find((v) => v.id === id) || null,
    prev: lookups.prev || null,
    step(label) {
      const s = { label, status: 'running', note: '' };
      job.steps.push(s);
      persist();
      return {
        note: (n) => { s.note = n; },
        done: () => { s.status = 'done'; s.note = ''; persist(); },
      };
    },
    out(type, url, label) { job.outputs.push({ type, url, label }); persist(); },
    charge(n) { job.cost += n; },
  };
  const work = (async () => {
    try {
      await runTool(ctx);
      for (const s of job.steps) if (s.status === 'running') s.status = 'done';
      job.status = 'done';
    } catch (e) {
      console.error(`[job ${job.id}]`, e.message);
      job.status = 'error';
      job.error = e.message || String(e);
      for (const s of job.steps) if (s.status === 'running') s.status = 'error';
    }
    job.finishedAt = Date.now();
    const refund = job.estimate - job.cost;
    try {
      if (refund > 0) await store.adjust(owner, refund, job.status === 'error' ? 'Refund (failed steps)' : 'Refund (unused estimate)', job.id, true);
      if (refund < 0) await store.adjust(owner, refund, 'Extra usage', job.id, true);
    } catch (e) { console.error('[refund]', e.message); }
    await persist(true);
    live.delete(job.id);
  })();
  // On Vercel, keep the function alive until the job finishes (up to maxDuration).
  if (process.env.VERCEL) waitUntil(work);
  return job;
}

// A job still "running" in the database but not in this process's memory after this long
// was killed (crash, redeploy, or a serverless timeout). Fail it and refund unused credits.
export const STALE_MS = (process.env.VERCEL ? 8 : 30) * 60 * 1000;

export async function expireStale(j) {
  if (!j || j.status !== 'running' || live.has(j.id) || Date.now() - j.createdAt < STALE_MS) return j;
  j.status = 'error';
  j.error = 'This generation was interrupted (it ran too long or the server restarted). Unused credits were refunded.';
  j.steps.forEach((s) => { if (s.status === 'running') s.status = 'error'; });
  const refund = (j.estimate || 0) - (j.cost || 0);
  try {
    if (refund > 0) await store.adjust(j.user_id, refund, 'Refund (interrupted)', j.id, true);
    await store.saveJob(j);
  } catch (e) { console.error('[expire]', e.message); }
  return j;
}

/** On boot: expire old jobs left running by a crash/redeploy. */
export async function recoverStaleJobs() {
  for (const j of await store.staleJobs()) await expireStale(j);
}


// ---------- primitives (each charges credits after success and handles demo mode) ----------
async function step(ctx, label, fn) {
  const s = ctx.step(label);
  const r = await fn(s);
  s.done();
  return r;
}
const hash = (...parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

export async function llm(ctx, { system, prompt }, mock, json = true) {
  let out;
  if (isMock()) { await demoWait(); out = mock(); } else {
    const r = await run(MODELS.llm, { model: llmModel(), system_prompt: system, prompt, temperature: 0.9 });
    if (r.error) throw new Error('Script AI: ' + r.error);
    out = json ? P.parseJSON(r.output) : String(r.output || '').trim();
  }
  ctx.charge(PRICE.llm);
  return out;
}

const LITE_SIZE = { '9:16': 'portrait_16_9', '16:9': 'landscape_16_9', '1:1': 'square_hd', '4:5': 'portrait_4_3' };
/** quality 'full' = Nano Banana 2 (best identity/product accuracy); 'lite' = Seedream edit with refs, FLUX Schnell without. */
export async function image(ctx, { prompt, refs = [], aspect = '9:16', quality = 'full' }, s) {
  refs = refs.filter(Boolean);
  const cost = imageCost(quality, refs.length > 0);
  if (isMock()) { await demoWait(); ctx.charge(cost); return F.mockImage(aspect); }
  const urls = await Promise.all(refs.map(toRemote));
  let model, input;
  if (quality === 'lite') {
    model = urls.length ? MODELS.imageLiteEdit : MODELS.imageLite;
    input = { prompt, image_size: LITE_SIZE[aspect] || 'portrait_16_9', num_images: 1, ...(urls.length ? { image_urls: urls, enhance_prompt_mode: 'fast' } : {}) };
  } else {
    model = urls.length ? MODELS.imageEdit : MODELS.image;
    input = { prompt, aspect_ratio: aspect, num_images: 1, output_format: 'png', resolution: '1K', ...(urls.length ? { image_urls: urls } : {}) };
  }
  const r = await run(model, input, s?.note);
  const img = r.images?.[0]?.url;
  if (!img) throw new Error('The image model returned no image (it may have been blocked by the safety filter). Try rewording.');
  ctx.charge(cost);
  return download(img, 'png');
}

export async function video(ctx, { image: img, prompt, model = 'h3-turbo', duration = 5, aspect = '9:16', audio = false, audioUrl }, s) {
  const m = VIDEO_MODELS[model] || VIDEO_MODELS['h3-turbo'];
  if (isMock()) { await demoWait(); ctx.charge(videoCost(model, duration)); return F.mockVideo(aspect, m.dur(duration), img); }
  const remote = await toRemote(img);
  const r = await run(m.id, m.input({ prompt, image: remote, duration, aspect, audio, audioUrl: audioUrl && (await toRemote(audioUrl)) }), s?.note);
  if (!r.video?.url) throw new Error(`${m.label} returned no video.`);
  ctx.charge(videoCost(model, duration));
  return download(r.video.url, 'mp4');
}

/** Voice key: "el:Aria" (ElevenLabs), "mm:Lively_Girl" (MiniMax, best for BM), "clone:<id>" (user's voice), or a bare ElevenLabs name. */
export async function tts(ctx, { text, voice = 'el:Sarah', speed = 1, engine, emotion, lang, quality = 'hd' }, s) {
  let url;
  const [kind, name] = String(voice).includes(':') ? String(voice).split(/:(.*)/) : ['el', voice];
  if (isMock()) {
    await demoWait();
    const words = String(text).split(/\s+/).length;
    url = await F.mockAudio(Math.max(2, words / 2.6).toFixed(1));
  } else {
    let r;
    const boost = lang === 'ms' ? 'Malay' : lang === 'en' || lang === 'manglish' ? 'English' : 'auto';
    if (kind === 'mm' && quality === 'turbo') {
      r = await run(MODELS.ttsMinimaxTurbo, { prompt: text, output_format: 'url', language_boost: boost, voice_setting: { voice_id: name, speed, ...(emotion && emotion !== 'neutral' ? { emotion } : {}) } }, s?.note);
    } else if (kind === 'el' && quality === 'turbo' && engine !== 'v3') {
      r = await run(MODELS.ttsTurbo, { text: text.replace(/\[[a-z ]+\]\s*/gi, ''), voice: name, speed, stability: 0.45, similarity_boost: 0.8 }, s?.note);
    } else if (kind === 'mm' || kind === 'clone') {
      const voiceId = kind === 'clone' ? ctx.voice(name)?.voice_id : name;
      if (!voiceId) throw new Error('That cloned voice was not found. Pick another voice.');
      r = await run(MODELS.ttsMinimax, {
        text, output_format: 'url',
        language_boost: lang === 'ms' ? 'Malay' : lang === 'en' || lang === 'manglish' ? 'English' : 'auto',
        voice_setting: { voice_id: voiceId, speed, ...(emotion && emotion !== 'neutral' ? { emotion } : {}) },
      }, s?.note);
    } else if (engine === 'v3') {
      r = await run(MODELS.ttsV3, { text, voice: name, stability: 0.5 }, s?.note);
    } else {
      r = await run(MODELS.ttsMultilingual, { text: text.replace(/\[[a-z ]+\]\s*/gi, ''), voice: name, speed, stability: 0.45, similarity_boost: 0.8, style: 0.35 }, s?.note);
    }
    if (!r.audio?.url) throw new Error('Voice generation returned no audio.');
    url = await download(r.audio.url, 'mp3');
  }
  ctx.charge(ttsCost(text, kind === 'clone' || engine === 'v3' ? 'hd' : quality));
  return { url, dur: (await F.duration(url)) || String(text).split(/\s+/).length / 2.6 };
}

/** Talking head by quality tier: motion (animated still, no AI video), lite/fast (H3 Turbo driven by the
    voice track), studio (VEED Fabric lip-sync) or premium (OmniHuman). */
export async function talk(ctx, { image: img, audio, dur, prompt, tier = 'lite' }, s) {
  const t = tierOf(tier);
  if (t.talk.kind === 'motion') {
    const clip = await F.motionClip(img, dur + 0.3, '9:16', 'talk');
    return F.muxVoice(clip, audio, '9:16');
  }
  const cost = talkCost(tier, dur);
  if (isMock()) {
    await demoWait();
    ctx.charge(cost);
    const v = await F.mockVideo('9:16', dur, img);
    return F.muxVoice(v, audio, '9:16');
  }
  if (t.talk.kind === 'h3') {
    const clip = await video(ctx, { image: img, audioUrl: audio, model: 'h3-turbo', duration: Math.min(t.maxSec, Math.ceil(dur)), prompt: `${prompt}. The person speaks naturally to the camera, lips moving in sync with the audio.` }, s);
    return F.hasFF() ? F.muxVoice(clip, audio, '9:16') : clip; // keep the clean voice track
  }
  const [i, a] = await Promise.all([toRemote(img), toRemote(audio)]);
  const input = tier === 'studio' ? { image_url: i, audio_url: a, resolution: '480p' } : { image_url: i, audio_url: a, prompt, resolution: '720p' };
  const r = await run(t.talk.id, input, s?.note);
  if (!r.video?.url) throw new Error('The talking model returned no video.');
  ctx.charge(cost);
  return download(r.video.url, 'mp4');
}

/** Showcase b-roll by tier: motion (Ken Burns on the keyframe) or an AI video model. */
async function showcase(ctx, { image: img, prompt, dur, tier, k = 0 }, s) {
  const t = tierOf(tier);
  if (t.show.kind === 'motion') return F.motionClip(img, dur + 0.3, '9:16', ['in', 'out', 'pan', 'up', 'in'][k % 5]);
  return video(ctx, { image: img, prompt, model: t.show.model, duration: Math.min(10, Math.ceil(dur)), aspect: '9:16' }, s);
}

export async function removeBg(ctx, url) {
  if (isMock()) { await demoWait(); return url; }
  const r = await run(MODELS.removeBg, { image_url: await toRemote(url), output_format: 'png' });
  if (!r.image?.url) throw new Error('Background removal failed.');
  ctx.charge(PRICE.removeBg);
  return download(r.image.url, 'png');
}

// ---------- helpers ----------
const friendRefs = (f) => (f?.photos || []).slice(0, 3);

function refText(f, p) {
  const t = [];
  if (f) t.push(`The person must be exactly the person in the reference photo${f.photos.length > 1 ? 's' : ''} — same face, hair, skin tone and identity.`);
  if (p) t.push(`The product must match the product reference image exactly — same packaging, shape, colors and label.`);
  return t.join(' ');
}

const mockUgc = (p, i, angle) => ({
  hook: i.lang === 'ms' ? `Serius, ${p.name} ni game changer!` : `Okay, ${p.name} actually shocked me.`,
  script: i.lang === 'ms'
    ? `${angle === 'deal' ? `Harga ${p.name} turun hari ni je!` : `Serius, ${p.name} ni game changer!`} Saya dah cuba seminggu dan memang berbaloi. ${p.benefits || 'Kualiti dia memang padu.'} Nak cuba? Tekan beg kuning sekarang!`
    : `${angle === 'deal' ? `${p.name} is on sale today only!` : `Okay, ${p.name} actually shocked me.`} I've used it for a week and it's worth every ringgit. ${p.benefits || 'The quality is solid.'} Want one? Tap the yellow basket now!`,
  caption: `Demo caption for ${p.name} ✨ (add your fal.ai key for real scripts)`,
  hashtags: ['#fyp', '#tiktokshopmy', '#racunshopee', '#malaysia', '#review', '#affiliate'],
  scene: `A creator holding ${p.name} in a bright bedroom, natural window light`,
  motion: 'handheld selfie camera, slight push-in',
});

export const mockStory = (i) => ({
  title: `Demo: ${String(i.prompt).slice(0, 40)}`,
  caption: 'Demo story caption ✨ (add your fal.ai key for real scripts)',
  hashtags: ['#fyp', '#malaysia', '#explainer'],
  scenes: Array.from({ length: i.scenes }, (_, k) => ({
    narration: k === 0 ? `Did you know this about ${String(i.prompt).slice(0, 40)}? Stay till the end.` : `This is demo scene ${k + 1}. Add your fal.ai key to generate the real thing.`,
    visual: `${i.prompt}, scene ${k + 1}`,
    motion: 'slow dolly in',
  })),
});

const captionText = (o) => [o.hook && `HOOK: ${o.hook}`, o.script && `SCRIPT: ${o.script}`, o.caption && `CAPTION: ${o.caption}`, o.hashtags?.length && o.hashtags.join(' ')].filter(Boolean).join('\n\n');
const ANGLE_ORDER = ['review', 'problem', 'deal', 'unboxing', 'compare', 'beforeafter'];
const ANGLE_LABEL = { review: 'Honest review', problem: 'Problem → fix', deal: 'Flash sale', unboxing: 'Unboxing', compare: 'Vs. pricey one', beforeafter: 'Before & after' };
const wordsFor = (sec) => 'x'.repeat(Math.round(sec * 14));

/** Plan a storyboard (title, caption, scenes) with the script AI. */
export async function planStory(ctx, i) {
  const n = Math.min(8, Math.max(2, i.scenes || 4));
  const plan = await llm(ctx, P.storyPrompt({ prompt: i.prompt, lang: i.lang, scenes: n, tone: i.tone }), () => mockStory({ ...i, scenes: n }));
  plan.scenes = (plan.scenes || []).slice(0, n).map((s) => ({ narration: String(s.narration || ''), visual: String(s.visual || ''), motion: String(s.motion || 'slow cinematic push-in') }));
  if (!plan.scenes.length) throw new Error('The planner returned no scenes. Try again.');
  return plan;
}

// ---------- tools ----------
export const TOOLS = {
  // Image studio: text-to-image or edit with friend/product references.
  image: {
    estimate: (i) => PRICE.image * (i.count || 1),
    title: (i) => i.prompt?.slice(0, 60) || 'Image',
    async run(ctx, i) {
      const f = ctx.friend(i.friendId), p = ctx.product(i.productId);
      const refs = [...friendRefs(f), p?.image].filter(Boolean);
      const prompt = [i.prompt, STYLES[i.style], refText(f, p)].filter(Boolean).join('. ');
      const n = Math.min(4, Math.max(1, i.count || 1));
      await step(ctx, `Generating ${n} image${n > 1 ? 's' : ''}`, async (s) => {
        const urls = await Promise.all(Array.from({ length: n }, () => image(ctx, { prompt, refs, aspect: i.aspect }, s)));
        urls.forEach((u) => ctx.out('image', u));
      });
    },
  },

  // AI avatar: a preset persona (auto-saved as a friend) or a custom look (4 options to choose from).
  avatarGen: {
    estimate: (i) => PRICE.image * (i.preset ? 1 : Math.min(4, i.count || 4)),
    title: (i) => (i.preset ? `Avatar · ${AVATAR_PRESETS.find((a) => a.id === i.preset)?.name || 'preset'}` : `Avatar · ${i.name || 'custom'}`),
    async run(ctx, i) {
      const preset = AVATAR_PRESETS.find((a) => a.id === i.preset);
      const look = preset ? preset.look : i.look || {};
      const n = preset ? 1 : Math.min(4, Math.max(1, i.count || 4));
      const urls = await step(ctx, n > 1 ? `Creating ${n} avatar options` : `Creating ${preset?.name || 'your avatar'}`, (s) =>
        Promise.all(Array.from({ length: n }, (_, k) => image(ctx, { prompt: `${avatarPrompt(look)}${k ? `, variation ${k + 1}` : ''}`, aspect: '4:5' }, s))));
      urls.forEach((u, k) => ctx.out('image', u, n > 1 ? `Option ${k + 1}` : preset?.name));
      if (preset) {
        const f = await store.insert('friends', ctx.uid, { id: uid(), name: preset.name, note: `AI avatar · ${preset.tagline}`, photos: [urls[0]] });
        ctx.job.text = `${preset.name} was added to your friends. Pick them with ＋ in any mode.`;
        ctx.job.friendId = f.id;
      } else {
        ctx.job.text = 'Pick the option you like and save it as a friend.';
      }
    },
  },

  // Direct the shot: keyframe (keeps the friend's face) -> camera-directed video.
  shot: {
    estimate: (i) => (i.startImage ? 0 : PRICE.image) + videoCost(i.model, i.duration || 5),
    title: (i) => i.prompt?.slice(0, 60) || 'Shot',
    async run(ctx, i) {
      const f = ctx.friend(i.friendId), p = ctx.product(i.productId);
      let key = i.startImage;
      if (!key) {
        key = await step(ctx, 'Composing keyframe', (s) => image(ctx, {
          prompt: [`${f ? f.name : 'The subject'} ${i.prompt}`, STYLES[i.style], refText(f, p), 'Single cinematic frame, sharp focus'].filter(Boolean).join('. '),
          refs: [...friendRefs(f), p?.image], aspect: i.aspect,
        }, s));
        ctx.out('image', key, 'Keyframe');
      }
      const v = await step(ctx, `Animating with ${VIDEO_MODELS[i.model]?.label || 'video model'}`, (s) => video(ctx, {
        image: key, prompt: `${i.prompt}. Camera: ${CAMERAS[i.camera] || CAMERAS.static}. Keep the subject's face consistent.`,
        model: i.model, duration: i.duration, aspect: i.aspect, audio: i.audio,
      }, s));
      ctx.out('video', v, 'Shot');
    },
  },

  // Affiliate / UGC ad. Quality tier picks the models; 1–5 variations share one keyframe.
  // Approve-first: a "draft" run makes only the scripts + keyframe (cheap); "fromDraft" reuses them to render.
  ugc: {
    estimate: (i) => {
      const n = [1, 3, 5].includes(i.variants) ? i.variants : 1;
      const t = tierOf(i.tier);
      const sec = tierSeconds(i.tier, i.seconds || 8);
      const prep = PRICE.llm * n + imageCost(t.image, true);
      const render = n * (ttsCost(wordsFor(sec), t.voice) + (i.format === 'talking' ? talkCost(i.tier, sec) : showCost(i.tier, sec)));
      if (i.draft) return prep;
      if (i.fromDraft) return render;
      return prep + render;
    },
    title: (i, L) => `${L.product(i.productId)?.name || 'Product'} · ${i.format === 'talking' ? 'Talking' : 'Showcase'} ad${i.variants > 1 ? ` ×${i.variants}` : ''}${i.draft ? ' · draft' : ''}`,
    async run(ctx, i) {
      const p = ctx.product(i.productId);
      if (!p) throw new Error('Pick a product first.');
      const f = ctx.friend(i.friendId);
      const t = tierOf(i.tier);
      const sec = tierSeconds(i.tier, i.seconds || 8);
      const prev = i.fromDraft ? ctx.prev : null;
      if (i.fromDraft && !(prev?.draftData && prev.stage === 'review')) throw new Error('That draft is no longer available. Make a new one.');

      let plans, angles, key;
      if (prev) {
        ({ plans, angles, keyframe: key } = prev.draftData);
        if (Array.isArray(i.scripts)) i.scripts.forEach((sc, k) => { if (plans[k] && String(sc || '').trim()) plans[k].script = String(sc).trim().slice(0, 1200); });
      } else {
        const n = [1, 3, 5].includes(i.variants) ? i.variants : 1;
        const base = ANGLE_LABEL[i.angle] ? i.angle : 'review';
        angles = [base, ...ANGLE_ORDER.filter((a) => a !== base)].slice(0, n);
        plans = await step(ctx, n > 1 ? `Writing ${n} hooks & scripts` : 'Writing hook & script', () => Promise.all(angles.map((angle, k) => llm(ctx,
          P.ugcPrompt({ product: p, lang: i.lang, platform: i.platform, angle, seconds: sec, format: i.format, friendName: f?.name, notes: [i.notes, n > 1 && `This is variation ${k + 1} of ${n}: use a clearly different hook style from the others.`].filter(Boolean).join(' ') }),
          () => mockUgc(p, i, angle)))));
        if (i.script?.trim() && n === 1) plans[0].script = i.script.trim();
        const scenePrompt = [plans[0].scene || `A Malaysian creator holding ${p.name}`,
          i.format === 'talking' ? 'vertical selfie video frame, person facing camera, mouth closed, product clearly visible' : 'vertical frame, product is the hero, clearly visible',
          STYLES[i.style || 'ugc'], refText(f, p)].join('. ');
        key = await step(ctx, f ? `Placing ${f.name} with the product` : 'Composing product scene', (s) =>
          image(ctx, { prompt: scenePrompt, refs: [...friendRefs(f), p.image], aspect: '9:16', quality: t.image }, s));
      }
      const n = plans.length;
      ctx.job.text = plans.map((pl, k) => `${n > 1 ? `── V${k + 1} · ${ANGLE_LABEL[angles[k]]} ──\n` : ''}${captionText(pl)}`).join('\n\n');
      ctx.out('text', null, 'Script & caption');
      ctx.out('image', key, 'Keyframe');

      if (i.draft) { // stop here: the user reviews/edits, then approves to render
        ctx.job.stage = 'review';
        ctx.job.draftData = { plans, angles, keyframe: key };
        return;
      }
      if (prev) ctx.job.fromDraft = prev.id;

      const voices = await step(ctx, n > 1 ? `Recording ${n} voice-overs` : 'Recording voice-over', (s) =>
        Promise.all(plans.map((pl) => tts(ctx, { text: pl.script, voice: i.voice, lang: i.lang, engine: i.voiceEngine, quality: t.voice }, s))));
      voices.forEach((v, k) => ctx.out('audio', v.url, n > 1 ? `Voice V${k + 1}` : 'Voice-over'));
      const over = voices.find((v) => v.dur > t.maxSec + 1.5);
      if (over && i.format === 'talking' && t.talk.kind !== 'motion') throw new Error(`A script runs ${Math.round(over.dur)}s, but ${t.label} handles up to ${t.maxSec}s. Shorten it or pick a higher quality.`);

      const label = i.format === 'talking' ? (t.talk.kind === 'motion' ? 'Animating (Motion)' : `Lip-syncing (${t.label})`) : `Animating product shots (${t.label})`;
      const finals = await step(ctx, label, (s) => Promise.all(plans.map(async (pl, k) => {
        let out;
        if (i.format === 'talking') {
          out = await talk(ctx, { image: key, audio: voices[k].url, dur: voices[k].dur, tier: i.tier, prompt: `Enthusiastic creator talking to camera, natural hand gestures, shows the product. ${pl.motion || ''}` }, s);
        } else {
          const clip = await showcase(ctx, { image: key, prompt: `${pl.motion || 'slow push-in, product hero shot'}. Product stays sharp and accurate.`, dur: voices[k].dur, tier: i.tier, k }, s);
          out = F.hasFF() ? await F.muxVoice(clip, voices[k].url, '9:16') : clip;
        }
        if (i.captions !== false && F.hasFF()) out = await F.burnCaptions(out, [{ start: 0.1, end: voices[k].dur, text: pl.script }], '9:16');
        return out;
      })));
      finals.forEach((u, k) => ctx.out('video', u, n > 1 ? `V${k + 1} · ${ANGLE_LABEL[angles[k]]}` : 'Final ad'));
    },
  },

  // Talking avatar: (write) script -> voice -> talking friend, by quality tier.
  avatar: {
    estimate: (i) => {
      const t = tierOf(i.tier);
      const words = String(i.script || '').trim().split(/\s+/).filter(Boolean).length;
      const sec = words ? Math.max(3, words / 2.6) : tierSeconds(i.tier, i.seconds || 8);
      return (i.script ? 0 : PRICE.llm) + ttsCost(i.script || wordsFor(sec), t.voice) + talkCost(i.tier, sec);
    },
    title: (i, L) => `${L.friend(i.friendId)?.name || 'Avatar'} talking`,
    async run(ctx, i) {
      const f = ctx.friend(i.friendId);
      const img = i.image || f?.photos?.[0];
      if (!img) throw new Error('Pick a friend or upload a photo.');
      const t = tierOf(i.tier);
      let script = i.script?.trim();
      if (!script) {
        script = await step(ctx, 'Writing script', () => llm(ctx, P.avatarScriptPrompt({ topic: i.topic || 'introduce yourself', lang: i.lang, seconds: tierSeconds(i.tier, i.seconds || 8) }),
          () => `Hi! This is a demo script about ${i.topic || 'me'}. Add your fal.ai key to make me really talk.`, false));
      }
      ctx.job.text = script;
      ctx.out('text', null, 'Script');
      const voice = await step(ctx, 'Recording voice', (s) => tts(ctx, { text: script, voice: i.voice, lang: i.lang, engine: i.voiceEngine, quality: t.voice }, s));
      if (t.talk.kind !== 'motion' && voice.dur > t.maxSec + 1.5) throw new Error(`That script is ${Math.round(voice.dur)}s, but ${t.label} handles up to ${t.maxSec}s. Shorten it or pick a higher quality.`);
      let v = await step(ctx, t.talk.kind === 'motion' ? 'Animating (Motion)' : `Lip-syncing (${t.label})`, (s) => talk(ctx, { image: img, audio: voice.url, dur: voice.dur, tier: i.tier, prompt: 'Natural, friendly talking to camera with subtle head movement and gestures' }, s));
      if (i.captions && F.hasFF()) v = await step(ctx, 'Burning captions', () => F.burnCaptions(v, [{ start: 0.1, end: voice.dur, text: script }], '9:16'));
      ctx.out('video', v, 'Talking video');
    },
  },

  // Story video. Uses the user's edited storyboard when given; reuses unchanged scenes from an earlier render.
  story: {
    estimate: (i) => {
      const scenes = i.board?.scenes;
      const n = scenes?.length || i.scenes || 4;
      const t = tierOf(i.tier || 'motion');
      const tts = scenes ? scenes.reduce((a, s) => a + ttsCost(s.narration, t.voice), 0) : n * ttsCost(wordsFor(7), t.voice);
      const clip = t.show.kind === 'motion' ? 0 : videoCost(i.model || 'h3-turbo', 6);
      return (scenes ? 0 : PRICE.llm) + tts + n * (imageCost(t.image, false) + clip);
    },
    title: (i) => i.board?.title || i.prompt?.slice(0, 60) || 'Story video',
    async run(ctx, i) {
      const f = ctx.friend(i.friendId);
      const t = tierOf(i.tier || 'motion');
      const plan = i.board?.scenes?.length ? i.board : await step(ctx, 'Planning scenes & narration', () => planStory(ctx, i));
      const scenes = plan.scenes.slice(0, 8);
      ctx.job.title = plan.title || ctx.job.title;
      ctx.job.board = { title: plan.title || '', caption: plan.caption || '', hashtags: plan.hashtags || [], scenes };
      ctx.job.text = [plan.title, ...scenes.map((s, k) => `${k + 1}. ${s.narration}`), plan.caption, (plan.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
      ctx.out('text', null, 'Script & caption');

      const prev = ctx.prev?.sceneAssets || [];
      const find = (key, field) => prev.find((a) => a[field + 'Key'] === key)?.[field];
      const assets = scenes.map((sc) => {
        const voiceKey = hash(sc.narration, i.voice, i.lang, t.voice);
        const frameKey = hash(sc.visual, i.style, i.aspect, f?.id || null, t.image);
        const clipKey = hash(frameKey, sc.motion, t.show.kind === 'motion' ? 'motion' : i.model, voiceKey);
        return { voiceKey, frameKey, clipKey, voice: find(voiceKey, 'voice'), frame: find(frameKey, 'frame'), clip: find(clipKey, 'clip') };
      });
      const reused = assets.filter((a) => a.clip).length;

      await step(ctx, `Recording voice-overs${reused ? ` (${reused} reused)` : ''}`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].voice) assets[k].voice = await tts(ctx, { text: sc.narration, voice: i.voice, lang: i.lang, engine: i.voiceEngine, quality: t.voice }, s);
      })));
      await step(ctx, `Painting ${scenes.length} scenes`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].frame) assets[k].frame = await image(ctx, { prompt: [sc.visual, f && `featuring ${f.name}`, STYLES[i.style || 'cinematic'], f && refText(f)].filter(Boolean).join('. '), refs: f ? friendRefs(f) : [], aspect: i.aspect, quality: t.image }, s);
      })));
      assets.forEach((a, k) => ctx.out('image', a.frame, `Scene ${k + 1}`));
      await step(ctx, `Animating ${scenes.length - reused} clip${scenes.length - reused === 1 ? '' : 's'}`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].clip) {
          assets[k].clip = t.show.kind === 'motion'
            ? await F.motionClip(assets[k].frame, assets[k].voice.dur + 0.4, i.aspect, /pull|out/i.test(sc.motion) ? 'out' : /pan/i.test(sc.motion) ? 'pan' : /crane|up/i.test(sc.motion) ? 'up' : 'in')
            : await video(ctx, { image: assets[k].frame, prompt: `${sc.motion || 'slow cinematic push-in'}. ${sc.visual}`, model: i.model, duration: Math.ceil(assets[k].voice.dur + 0.3), aspect: i.aspect }, s);
        }
      })));
      ctx.job.sceneAssets = assets;
      if (!F.hasFF()) { assets.forEach((a, k) => ctx.out('video', a.clip, `Clip ${k + 1}`)); return; }
      let final = await step(ctx, 'Editing it together', async () => {
        const parts = [];
        for (const a of assets) parts.push(await F.muxVoice(a.clip, a.voice.url, i.aspect));
        return F.concat(parts);
      });
      if (i.captions !== false) {
        final = await step(ctx, 'Burning captions', async () => {
          let t = 0;
          const segs = scenes.map((sc, k) => { const seg = { start: t + 0.05, end: t + assets[k].voice.dur, text: sc.narration }; t += assets[k].voice.dur + 0.3; return seg; });
          return F.burnCaptions(final, segs, i.aspect);
        });
      }
      ctx.out('video', final, 'Final video');
    },
  },

  // Voice studio: voice-over, sound effect or music.
  voice: {
    estimate: (i) => (i.kind === 'sfx' ? sfxCost(i.length || 5) : i.kind === 'music' ? musicCost(i.length || 30) : ttsCost(i.text || 'x')),
    title: (i) => `${i.kind === 'sfx' ? 'Sound effect' : i.kind === 'music' ? 'Music' : 'Voice-over'} · ${String(i.text || '').slice(0, 50)}`,
    async run(ctx, i) {
      const text = String(i.text || '').trim();
      if (!text) throw new Error('Type the text or describe the sound first.');
      if (i.kind === 'sfx' || i.kind === 'music') {
        const len = i.kind === 'sfx' ? Math.min(22, Math.max(1, i.length || 5)) : Math.min(180, Math.max(5, i.length || 30));
        const url = await step(ctx, i.kind === 'sfx' ? 'Designing the sound' : 'Composing the track', async (s) => {
          if (isMock()) { await demoWait(); return F.mockAudio(len); }
          const r = i.kind === 'sfx'
            ? await run(MODELS.sfx, { text, duration_seconds: len }, s.note)
            : await run(MODELS.music, { prompt: text, music_length_ms: len * 1000, force_instrumental: i.instrumental !== false }, s.note);
          if (!r.audio?.url) throw new Error('No audio came back. Try rewording.');
          return download(r.audio.url, 'mp3');
        });
        ctx.charge(i.kind === 'sfx' ? sfxCost(len) : musicCost(len));
        ctx.out('audio', url, i.kind === 'sfx' ? 'Sound effect' : 'Music');
        ctx.job.text = text;
        return;
      }
      const v = await step(ctx, 'Recording', (s) => tts(ctx, { text, voice: i.voice, speed: i.speed || 1, engine: i.voiceEngine, emotion: i.emotion, lang: i.lang }, s));
      ctx.job.text = text;
      ctx.out('audio', v.url, 'Voice-over');
    },
  },
};
