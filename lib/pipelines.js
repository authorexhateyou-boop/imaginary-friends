// Generation pipelines. Each tool is a sequence of model calls tracked as a "job"
// with visible steps, outputs and a credit cost. With no fal key, everything runs
// in demo mode with placeholder media so the whole flow can be tried offline.
import { waitUntil } from '@vercel/functions';
import { store } from './store/index.js';
import { run, toRemote, isMock, llmModel } from './fal.js';
import { download, uid } from './media.js';
import * as F from './ffmpeg.js';
import { VIDEO_MODELS, MODELS, PRICE, ttsCost, videoCost } from './models.js';
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

// ---------- primitives (each charges credits and handles demo mode) ----------
async function step(ctx, label, fn) {
  const s = ctx.step(label);
  const r = await fn(s);
  s.done();
  return r;
}

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

export async function video(ctx, { image: img, prompt, model = 'h3-turbo', duration = 5, aspect = '9:16', audio = false }, s) {
  const m = VIDEO_MODELS[model] || VIDEO_MODELS['h3-turbo'];
  if (isMock()) { await demoWait(); ctx.charge(videoCost(model, duration)); return F.mockVideo(aspect, m.dur(duration), img); }
  const remote = await toRemote(img);
  const r = await run(m.id, m.input({ prompt, image: remote, duration, aspect, audio }), s?.note);
  if (!r.video?.url) throw new Error(`${m.label} returned no video.`);
  ctx.charge(videoCost(model, duration));
  return download(r.video.url, 'mp4');
}

export async function tts(ctx, { text, voice = 'Aria', speed = 1 }, s) {
  let url;
  if (isMock()) {
    await demoWait();
    const words = String(text).split(/\s+/).length;
    url = await F.mockAudio(Math.max(2, words / 2.6).toFixed(1));
  } else {
    const r = await run(MODELS.tts, { text, voice, speed, stability: 0.45, similarity_boost: 0.8, style: 0.35 }, s?.note);
    if (!r.audio?.url) throw new Error('Voice generation returned no audio.');
    url = await download(r.audio.url, 'mp3');
  }
  ctx.charge(ttsCost(text));
  return { url, dur: (await F.duration(url)) || String(text).split(/\s+/).length / 2.6 };
}

export async function avatar(ctx, { image: img, audio, dur, prompt }, s) {
  const cost = Math.ceil(PRICE.avatarPerSec * Math.max(1, dur));
  if (isMock()) {
    ctx.charge(cost);
    await demoWait();
    const v = await F.mockVideo('9:16', dur, img);
    return F.muxVoice(v, audio, '9:16');
  }
  const [i, a] = await Promise.all([toRemote(img), toRemote(audio)]);
  const r = await run(MODELS.avatar, { image_url: i, audio_url: a, prompt, resolution: '720p' }, s?.note);
  if (!r.video?.url) throw new Error('Avatar model returned no video.');
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

const mockUgc = (p, i) => ({
  hook: i.lang === 'ms' ? `Serius, ${p.name} ni game changer!` : `Okay, ${p.name} actually shocked me.`,
  script: i.lang === 'ms'
    ? `Serius, ${p.name} ni game changer! Saya dah cuba seminggu dan memang berbaloi. ${p.benefits || 'Kualiti dia memang padu.'} Harga pun mampu milik. Nak cuba? Tekan beg kuning sekarang!`
    : `Okay, ${p.name} actually shocked me. I've used it for a week and it's worth every ringgit. ${p.benefits || 'The quality is solid.'} And the price? So affordable. Want one? Tap the yellow basket now!`,
  caption: `Demo caption for ${p.name} ✨ (add your fal.ai key for real scripts)`,
  hashtags: ['#fyp', '#tiktokshopmy', '#racunshopee', '#malaysia', '#review', '#affiliate'],
  scene: `A creator holding ${p.name} in a bright bedroom, natural window light`,
  motion: 'handheld selfie camera, slight push-in',
});

const mockStory = (i) => ({
  title: `Demo: ${i.prompt.slice(0, 40)}`,
  caption: 'Demo story caption ✨ (add your fal.ai key for real scripts)',
  hashtags: ['#fyp', '#malaysia', '#explainer'],
  scenes: Array.from({ length: i.scenes }, (_, k) => ({
    narration: k === 0 ? `Did you know this about ${i.prompt.slice(0, 40)}? Stay till the end.` : `This is demo scene ${k + 1}. Add your fal.ai key in Settings to generate the real thing.`,
    visual: `${i.prompt}, scene ${k + 1}`,
    motion: 'slow dolly in',
  })),
});

const captionText = (o) => [o.hook && `HOOK: ${o.hook}`, o.script && `SCRIPT: ${o.script}`, o.caption && `CAPTION: ${o.caption}`, o.hashtags?.length && o.hashtags.join(' ')].filter(Boolean).join('\n\n');

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

  // Affiliate / UGC ad: script -> creator-with-product frame -> talking or showcase video -> captions.
  ugc: {
    estimate: (i) => {
      const sec = i.seconds || 15;
      const base = PRICE.llm + PRICE.image + ttsCost('x'.repeat(sec * 14));
      return base + (i.format === 'talking' ? PRICE.avatarPerSec * sec : videoCost(i.model, Math.min(10, sec)));
    },
    title: (i, L) => `${L.product(i.productId)?.name || 'Product'} · ${i.format === 'talking' ? 'Talking UGC' : 'Showcase'} ad`,
    async run(ctx, i) {
      const p = ctx.product(i.productId);
      if (!p) throw new Error('Pick a product first.');
      const f = ctx.friend(i.friendId);
      const sec = i.seconds || 15;
      const plan = await step(ctx, 'Writing hook & script', () => llm(ctx,
        P.ugcPrompt({ product: p, lang: i.lang, platform: i.platform, angle: i.angle, seconds: sec, format: i.format, friendName: f?.name, notes: i.notes }),
        () => mockUgc(p, i)));
      if (i.script?.trim()) plan.script = i.script.trim();
      ctx.job.text = captionText(plan);
      ctx.out('text', null, 'Script & caption');

      const scenePrompt = [plan.scene || `A Malaysian creator holding ${p.name}`,
        i.format === 'talking' ? 'vertical selfie video frame, person facing camera, mouth closed, product clearly visible' : 'vertical frame, product is the hero, clearly visible',
        STYLES[i.style || 'ugc'], refText(f, p)].join('. ');
      const key = await step(ctx, f ? `Placing ${f.name} with the product` : 'Composing product scene', (s) =>
        image(ctx, { prompt: scenePrompt, refs: [...friendRefs(f), p.image], aspect: '9:16' }, s));
      ctx.out('image', key, 'Keyframe');

      const voice = await step(ctx, 'Recording voice-over', (s) => tts(ctx, { text: plan.script, voice: i.voice }, s));
      ctx.out('audio', voice.url, 'Voice-over');

      let final;
      if (i.format === 'talking') {
        final = await step(ctx, 'Lip-syncing the creator', (s) => avatar(ctx, {
          image: key, audio: voice.url, dur: voice.dur,
          prompt: `Enthusiastic creator talking to camera, natural hand gestures, shows the product. ${plan.motion || ''}`,
        }, s));
      } else {
        const clip = await step(ctx, 'Animating product shot', (s) => video(ctx, {
          image: key, prompt: `${plan.motion || 'slow push-in, product hero shot'}. Product stays sharp and accurate.`,
          model: i.model, duration: Math.min(10, Math.ceil(voice.dur)), aspect: '9:16',
        }, s));
        final = await step(ctx, 'Mixing voice-over', () => F.muxVoice(clip, voice.url, '9:16'));
      }
      if (i.captions !== false && F.hasFF()) {
        final = await step(ctx, 'Burning captions', () => F.burnCaptions(final, [{ start: 0.1, end: voice.dur, text: plan.script }], '9:16'));
      }
      ctx.out('video', final, 'Final ad');
    },
  },

  // Talking avatar: (write) script -> voice -> lip-synced friend.
  avatar: {
    estimate: (i) => {
      const words = String(i.script || '').trim().split(/\s+/).filter(Boolean).length;
      const sec = words ? Math.max(3, words / 2.6) : i.seconds || 15;
      return (i.script ? 0 : PRICE.llm) + ttsCost(i.script || 'x'.repeat(sec * 14)) + Math.ceil(PRICE.avatarPerSec * sec);
    },
    title: (i, L) => `${L.friend(i.friendId)?.name || 'Avatar'} talking`,
    async run(ctx, i) {
      const f = ctx.friend(i.friendId);
      const img = i.image || f?.photos?.[0];
      if (!img) throw new Error('Pick a friend or upload a photo.');
      let script = i.script?.trim();
      if (!script) {
        script = await step(ctx, 'Writing script', () => llm(ctx, P.avatarScriptPrompt({ topic: i.topic || 'introduce yourself', lang: i.lang, seconds: i.seconds || 15 }),
          () => `Hi! This is a demo script about ${i.topic || 'me'}. Add your fal.ai key in Settings to make me really talk.`, false));
      }
      ctx.job.text = script;
      ctx.out('text', null, 'Script');
      const voice = await step(ctx, 'Recording voice', (s) => tts(ctx, { text: script, voice: i.voice }, s));
      let v = await step(ctx, 'Lip-syncing', (s) => avatar(ctx, { image: img, audio: voice.url, dur: voice.dur, prompt: 'Natural, friendly talking to camera with subtle head movement and gestures' }, s));
      if (i.captions && F.hasFF()) v = await step(ctx, 'Burning captions', () => F.burnCaptions(v, [{ start: 0.1, end: voice.dur, text: script }], '9:16'));
      ctx.out('video', v, 'Talking video');
    },
  },

  // Story video (prompt -> full narrated video, RekaLab-style).
  story: {
    estimate: (i) => {
      const n = i.scenes || 4;
      return PRICE.llm + n * (PRICE.image + videoCost(i.model, 6) + ttsCost('x'.repeat(110)));
    },
    title: (i) => i.prompt?.slice(0, 60) || 'Story video',
    async run(ctx, i) {
      const n = Math.min(8, Math.max(2, i.scenes || 4));
      const f = ctx.friend(i.friendId);
      const plan = await step(ctx, 'Planning scenes & narration', () => llm(ctx,
        P.storyPrompt({ prompt: i.prompt, lang: i.lang, scenes: n, tone: i.tone }), () => mockStory({ ...i, scenes: n })));
      const scenes = (plan.scenes || []).slice(0, n);
      if (!scenes.length) throw new Error('The planner returned no scenes. Try again.');
      ctx.job.title = plan.title || ctx.job.title;
      ctx.job.text = [plan.title, ...scenes.map((s, k) => `${k + 1}. ${s.narration}`), plan.caption, (plan.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
      ctx.out('text', null, 'Script & caption');

      const voices = await step(ctx, `Recording ${scenes.length} voice-overs`, (s) =>
        Promise.all(scenes.map((sc) => tts(ctx, { text: sc.narration, voice: i.voice }, s))));
      const frames = await step(ctx, `Painting ${scenes.length} scenes`, (s) =>
        Promise.all(scenes.map((sc) => image(ctx, {
          prompt: [sc.visual, f && `featuring ${f.name}`, STYLES[i.style || 'cinematic'], f && refText(f)].filter(Boolean).join('. '),
          refs: f ? friendRefs(f) : [], aspect: i.aspect,
        }, s))));
      frames.forEach((u, k) => ctx.out('image', u, `Scene ${k + 1}`));
      const clips = await step(ctx, `Animating ${scenes.length} clips`, (s) =>
        Promise.all(scenes.map((sc, k) => video(ctx, {
          image: frames[k], prompt: `${sc.motion || 'slow cinematic push-in'}. ${sc.visual}`,
          model: i.model, duration: Math.ceil(voices[k].dur + 0.3), aspect: i.aspect,
        }, s))));
      if (!F.hasFF()) { clips.forEach((c, k) => ctx.out('video', c, `Clip ${k + 1}`)); return; }
      let final = await step(ctx, 'Editing it together', async () => {
        const parts = [];
        for (let k = 0; k < clips.length; k++) parts.push(await F.muxVoice(clips[k], voices[k].url, i.aspect));
        return F.concat(parts);
      });
      if (i.captions !== false) {
        final = await step(ctx, 'Burning captions', async () => {
          let t = 0;
          const segs = scenes.map((sc, k) => { const seg = { start: t + 0.05, end: t + voices[k].dur, text: sc.narration }; t += voices[k].dur + 0.3; return seg; });
          return F.burnCaptions(final, segs, i.aspect);
        });
      }
      ctx.out('video', final, 'Final video');
    },
  },

  // Script writer: hooks, scripts, captions, content calendars.
  write: {
    estimate: () => PRICE.llm,
    title: (i, L) => `${i.kind || 'hooks'}: ${L.product(i.productId)?.name || i.topic || ''}`.slice(0, 60),
    async run(ctx, i) {
      const p = ctx.product(i.productId);
      const text = await step(ctx, 'Writing', () => llm(ctx, P.writerPrompt({ ...i, product: p }),
        () => `DEMO OUTPUT (add your fal.ai key in Settings for real writing)\n\n1. POV: you found ${p?.name || i.topic} at half price\n2. Stop scrolling if you ${i.topic ? 'care about ' + i.topic : 'need this'}\n3. Nobody talks about this…`, false));
      ctx.job.text = text;
      ctx.out('text', null, 'Result');
    },
  },
};
