// Generation pipelines. Each tool is a sequence of model calls tracked as a "job"
// with visible steps, outputs and a credit cost. With no fal key, everything runs
// in demo mode with placeholder media so the whole flow can be tried offline.
import { waitUntil } from '@vercel/functions';
import { store } from './store/index.js';
import { run, toRemote, isMock, llmModel } from './fal.js';
import { download, uid } from './media.js';
import * as F from './ffmpeg.js';
import { VIDEO_MODELS, TALK_ENGINES, MODELS, PRICE, ttsCost, videoCost, talkCost, sfxCost, musicCost } from './models.js';
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

export async function image(ctx, { prompt, refs = [], aspect = '9:16' }, s) {
  if (isMock()) { await demoWait(); ctx.charge(PRICE.image); return F.mockImage(aspect); }
  const urls = await Promise.all(refs.filter(Boolean).map(toRemote));
  const input = { prompt, aspect_ratio: aspect, num_images: 1, output_format: 'png', resolution: '1K' };
  if (urls.length) input.image_urls = urls;
  const r = await run(urls.length ? MODELS.imageEdit : MODELS.image, input, s?.note);
  const img = r.images?.[0]?.url;
  if (!img) throw new Error('The image model returned no image (it may have been blocked by the safety filter). Try rewording.');
  ctx.charge(PRICE.image);
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
export async function tts(ctx, { text, voice = 'el:Sarah', speed = 1, engine, emotion, lang }, s) {
  let url;
  const [kind, name] = String(voice).includes(':') ? String(voice).split(/:(.*)/) : ['el', voice];
  if (isMock()) {
    await demoWait();
    const words = String(text).split(/\s+/).length;
    url = await F.mockAudio(Math.max(2, words / 2.6).toFixed(1));
  } else {
    let r;
    if (kind === 'mm' || kind === 'clone') {
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
  ctx.charge(ttsCost(text));
  return { url, dur: (await F.duration(url)) || String(text).split(/\s+/).length / 2.6 };
}

/** Talking head: fast (H3 Turbo driven by the voice track), studio (VEED Fabric) or premium (OmniHuman). */
export async function talk(ctx, { image: img, audio, dur, prompt, engine = 'fast' }, s) {
  const e = TALK_ENGINES[engine] ? engine : 'fast';
  const cost = talkCost(e, dur);
  if (isMock()) {
    await demoWait();
    ctx.charge(cost);
    const v = await F.mockVideo('9:16', dur, img);
    return F.muxVoice(v, audio, '9:16');
  }
  if (e === 'fast') {
    const clip = await video(ctx, { image: img, audioUrl: audio, model: 'h3-turbo', duration: Math.min(10, Math.ceil(dur)), prompt: `${prompt}. The person speaks naturally to the camera, lips moving in sync with the audio.` }, s);
    return F.hasFF() ? F.muxVoice(clip, audio, '9:16') : clip; // keep the clean voice track
  }
  const [i, a] = await Promise.all([toRemote(img), toRemote(audio)]);
  const input = e === 'studio' ? { image_url: i, audio_url: a, resolution: '480p' } : { image_url: i, audio_url: a, prompt, resolution: '720p' };
  const r = await run(TALK_ENGINES[e].id, input, s?.note);
  if (!r.video?.url) throw new Error('The talking model returned no video.');
  ctx.charge(cost);
  return download(r.video.url, 'mp4');
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

  // Affiliate / UGC ad: one shared keyframe, then 1–5 variations (different angle + hook each).
  ugc: {
    estimate: (i) => {
      const n = [1, 3, 5].includes(i.variants) ? i.variants : 1;
      const sec = i.format === 'talking' ? Math.min(i.seconds || 15, TALK_ENGINES[i.engine || 'fast']?.maxSec || 10) : i.seconds || 15;
      const per = PRICE.llm + ttsCost(wordsFor(sec)) + (i.format === 'talking' ? talkCost(i.engine || 'fast', sec) : videoCost(i.model, Math.min(10, sec)));
      return PRICE.image + n * per;
    },
    title: (i, L) => `${L.product(i.productId)?.name || 'Product'} · ${i.format === 'talking' ? 'Talking UGC' : 'Showcase'} ad${i.variants > 1 ? ` ×${i.variants}` : ''}`,
    async run(ctx, i) {
      const p = ctx.product(i.productId);
      if (!p) throw new Error('Pick a product first.');
      const f = ctx.friend(i.friendId);
      const n = [1, 3, 5].includes(i.variants) ? i.variants : 1;
      const engine = TALK_ENGINES[i.engine] ? i.engine : 'fast';
      const sec = i.format === 'talking' ? Math.min(i.seconds || 15, TALK_ENGINES[engine].maxSec) : i.seconds || 15;
      const base = ANGLE_LABEL[i.angle] ? i.angle : 'review';
      const angles = [base, ...ANGLE_ORDER.filter((a) => a !== base)].slice(0, n);

      const plans = await step(ctx, n > 1 ? `Writing ${n} hooks & scripts` : 'Writing hook & script', () => Promise.all(angles.map((angle, k) => llm(ctx,
        P.ugcPrompt({ product: p, lang: i.lang, platform: i.platform, angle, seconds: sec, format: i.format, friendName: f?.name, notes: [i.notes, n > 1 && `This is variation ${k + 1} of ${n}: use a clearly different hook style from the others.`].filter(Boolean).join(' ') }),
        () => mockUgc(p, i, angle)))));
      if (i.script?.trim() && n === 1) plans[0].script = i.script.trim();
      ctx.job.text = plans.map((pl, k) => `${n > 1 ? `── V${k + 1} · ${ANGLE_LABEL[angles[k]]} ──\n` : ''}${captionText(pl)}`).join('\n\n');
      ctx.out('text', null, 'Script & caption');

      const scenePrompt = [plans[0].scene || `A Malaysian creator holding ${p.name}`,
        i.format === 'talking' ? 'vertical selfie video frame, person facing camera, mouth closed, product clearly visible' : 'vertical frame, product is the hero, clearly visible',
        STYLES[i.style || 'ugc'], refText(f, p)].join('. ');
      const key = await step(ctx, f ? `Placing ${f.name} with the product` : 'Composing product scene', (s) =>
        image(ctx, { prompt: scenePrompt, refs: [...friendRefs(f), p.image], aspect: '9:16' }, s));
      ctx.out('image', key, 'Keyframe');

      const voices = await step(ctx, n > 1 ? `Recording ${n} voice-overs` : 'Recording voice-over', (s) =>
        Promise.all(plans.map((pl) => tts(ctx, { text: pl.script, voice: i.voice, lang: i.lang, engine: i.voiceEngine }, s))));
      voices.forEach((v, k) => ctx.out('audio', v.url, n > 1 ? `Voice V${k + 1}` : 'Voice-over'));

      const finals = await step(ctx, i.format === 'talking' ? `Lip-syncing (${TALK_ENGINES[engine].label})` : 'Animating product shots', (s) => Promise.all(plans.map(async (pl, k) => {
        let out;
        if (i.format === 'talking') {
          out = await talk(ctx, { image: key, audio: voices[k].url, dur: voices[k].dur, engine, prompt: `Enthusiastic creator talking to camera, natural hand gestures, shows the product. ${pl.motion || ''}` }, s);
        } else {
          const clip = await video(ctx, { image: key, prompt: `${pl.motion || 'slow push-in, product hero shot'}. Product stays sharp and accurate.`, model: i.model, duration: Math.min(10, Math.ceil(voices[k].dur)), aspect: '9:16' }, s);
          out = F.hasFF() ? await F.muxVoice(clip, voices[k].url, '9:16') : clip;
        }
        if (i.captions !== false && F.hasFF()) out = await F.burnCaptions(out, [{ start: 0.1, end: voices[k].dur, text: pl.script }], '9:16');
        return out;
      })));
      finals.forEach((u, k) => ctx.out('video', u, n > 1 ? `V${k + 1} · ${ANGLE_LABEL[angles[k]]}` : 'Final ad'));
    },
  },

  // Talking avatar: (write) script -> voice -> lip-synced friend.
  avatar: {
    estimate: (i) => {
      const words = String(i.script || '').trim().split(/\s+/).filter(Boolean).length;
      const sec = words ? Math.max(3, words / 2.6) : i.seconds || 15;
      return (i.script ? 0 : PRICE.llm) + ttsCost(i.script || wordsFor(sec)) + talkCost(i.engine || 'fast', sec);
    },
    title: (i, L) => `${L.friend(i.friendId)?.name || 'Avatar'} talking`,
    async run(ctx, i) {
      const f = ctx.friend(i.friendId);
      const img = i.image || f?.photos?.[0];
      if (!img) throw new Error('Pick a friend or upload a photo.');
      const engine = TALK_ENGINES[i.engine] ? i.engine : 'fast';
      let script = i.script?.trim();
      if (!script) {
        script = await step(ctx, 'Writing script', () => llm(ctx, P.avatarScriptPrompt({ topic: i.topic || 'introduce yourself', lang: i.lang, seconds: Math.min(i.seconds || 15, TALK_ENGINES[engine].maxSec) }),
          () => `Hi! This is a demo script about ${i.topic || 'me'}. Add your fal.ai key to make me really talk.`, false));
      }
      ctx.job.text = script;
      ctx.out('text', null, 'Script');
      const voice = await step(ctx, 'Recording voice', (s) => tts(ctx, { text: script, voice: i.voice, lang: i.lang, engine: i.voiceEngine }, s));
      if (voice.dur > TALK_ENGINES[engine].maxSec + 0.5) throw new Error(`That script is ${Math.round(voice.dur)}s, but the ${TALK_ENGINES[engine].label} engine handles up to ${TALK_ENGINES[engine].maxSec}s. Shorten it or pick Studio.`);
      let v = await step(ctx, `Lip-syncing (${TALK_ENGINES[engine].label})`, (s) => talk(ctx, { image: img, audio: voice.url, dur: voice.dur, engine, prompt: 'Natural, friendly talking to camera with subtle head movement and gestures' }, s));
      if (i.captions && F.hasFF()) v = await step(ctx, 'Burning captions', () => F.burnCaptions(v, [{ start: 0.1, end: voice.dur, text: script }], '9:16'));
      ctx.out('video', v, 'Talking video');
    },
  },

  // Story video. Uses the user's edited storyboard when given; reuses unchanged scenes from an earlier render.
  story: {
    estimate: (i) => {
      const scenes = i.board?.scenes;
      const n = scenes?.length || i.scenes || 4;
      const tts = scenes ? scenes.reduce((a, s) => a + ttsCost(s.narration), 0) : n * ttsCost(wordsFor(7));
      return (scenes ? 0 : PRICE.llm) + tts + n * (PRICE.image + videoCost(i.model, 6));
    },
    title: (i) => i.board?.title || i.prompt?.slice(0, 60) || 'Story video',
    async run(ctx, i) {
      const f = ctx.friend(i.friendId);
      const plan = i.board?.scenes?.length ? i.board : await step(ctx, 'Planning scenes & narration', () => planStory(ctx, i));
      const scenes = plan.scenes.slice(0, 8);
      ctx.job.title = plan.title || ctx.job.title;
      ctx.job.board = { title: plan.title || '', caption: plan.caption || '', hashtags: plan.hashtags || [], scenes };
      ctx.job.text = [plan.title, ...scenes.map((s, k) => `${k + 1}. ${s.narration}`), plan.caption, (plan.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
      ctx.out('text', null, 'Script & caption');

      const prev = ctx.prev?.sceneAssets || [];
      const find = (key, field) => prev.find((a) => a[field + 'Key'] === key)?.[field];
      const assets = scenes.map((sc) => {
        const voiceKey = hash(sc.narration, i.voice, i.lang);
        const frameKey = hash(sc.visual, i.style, i.aspect, f?.id || null);
        const clipKey = hash(frameKey, sc.motion, i.model, voiceKey);
        return { voiceKey, frameKey, clipKey, voice: find(voiceKey, 'voice'), frame: find(frameKey, 'frame'), clip: find(clipKey, 'clip') };
      });
      const reused = assets.filter((a) => a.clip).length;

      await step(ctx, `Recording voice-overs${reused ? ` (${reused} reused)` : ''}`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].voice) assets[k].voice = await tts(ctx, { text: sc.narration, voice: i.voice, lang: i.lang, engine: i.voiceEngine }, s);
      })));
      await step(ctx, `Painting ${scenes.length} scenes`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].frame) assets[k].frame = await image(ctx, { prompt: [sc.visual, f && `featuring ${f.name}`, STYLES[i.style || 'cinematic'], f && refText(f)].filter(Boolean).join('. '), refs: f ? friendRefs(f) : [], aspect: i.aspect }, s);
      })));
      assets.forEach((a, k) => ctx.out('image', a.frame, `Scene ${k + 1}`));
      await step(ctx, `Animating ${scenes.length - reused} clip${scenes.length - reused === 1 ? '' : 's'}`, (s) => Promise.all(scenes.map(async (sc, k) => {
        if (!assets[k].clip) assets[k].clip = await video(ctx, { image: assets[k].frame, prompt: `${sc.motion || 'slow cinematic push-in'}. ${sc.visual}`, model: i.model, duration: Math.ceil(assets[k].voice.dur + 0.3), aspect: i.aspect }, s);
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
