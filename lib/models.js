// Model catalogue + credit pricing.
// Costs below are fal.ai prices in US cents (from fal.ai/pricing and model pages, Oct 2026; some are estimates,
// marked "est"). Credits charged = cost x CREDIT_MARKUP (default 1.9), so 1 credit ≈ US$0.0053 of AI cost.
// With the RM59 / 1,000-credit Starter plan that keeps ~60% gross margin even if every credit is spent.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
export const MARKUP = Number(process.env.CREDIT_MARKUP) > 0 ? Number(process.env.CREDIT_MARKUP) : 1.9;
export const credits = (cents) => Math.max(1, Math.ceil(cents * MARKUP));

export const VIDEO_MODELS = {
  'h3-turbo': {
    label: 'MiniMax H3 Turbo', tag: 'Best value', centsPerSec: 1.5,
    id: 'minimax/h3-max-turbo/image-to-video',
    input: (o) => ({
      prompt: o.prompt, image_url: o.image, duration: clamp(o.duration, 2, 10),
      resolution: '768P', prompt_expansion_mode: 'balanced',
      ...(o.audioUrl ? { target_audio_url: o.audioUrl } : {}),
    }),
    dur: (d) => clamp(d, 2, 10),
  },
  'seedance-fast': {
    label: 'Seedance 2.0 Fast', tag: 'Native audio', centsPerSec: 10, // est
    id: 'bytedance/seedance-2.0/fast/image-to-video',
    input: (o) => ({
      prompt: o.prompt, image_url: o.image, duration: String(clamp(o.duration, 4, 15)),
      resolution: '720p', aspect_ratio: o.aspect || 'auto', generate_audio: !!o.audio,
    }),
    dur: (d) => clamp(d, 4, 15),
  },
  'kling-std': {
    label: 'Kling 3.0 Standard', tag: 'Smooth motion', centsPerSec: 8, // est
    id: 'fal-ai/kling-video/v3/standard/image-to-video',
    input: (o) => ({ prompt: o.prompt, start_image_url: o.image, duration: String(clamp(o.duration, 3, 15)), generate_audio: !!o.audio }),
    dur: (d) => clamp(d, 3, 15),
  },
  'kling-pro': {
    label: 'Kling 3.0 Pro', tag: 'Top quality', centsPerSec: 14,
    id: 'fal-ai/kling-video/v3/pro/image-to-video',
    input: (o) => ({ prompt: o.prompt, start_image_url: o.image, duration: String(clamp(o.duration, 3, 15)), generate_audio: !!o.audio }),
    dur: (d) => clamp(d, 3, 15),
  },
};
// back-compat for the UI: credits per second after markup
for (const m of Object.values(VIDEO_MODELS)) m.perSec = Math.ceil(m.centsPerSec * MARKUP * 10) / 10;

// Quality tiers for ads and talking videos, cheapest first.
//   image: 'lite' = Seedream edit / FLUX Schnell keyframe (~3¢), 'full' = Nano Banana 2 (8¢)
//   voice: 'turbo' = ElevenLabs Turbo v2.5 / MiniMax 2.8 Turbo (≈5–6¢ per 1k chars), 'hd' = 10¢
//   talk / show: what makes the moving picture for talking and showcase ads
export const TIERS = {
  motion: { label: 'Motion', tag: 'Animated still + voice, no AI video', image: 'lite', voice: 'turbo', maxSec: 30, talk: { kind: 'motion', centsPerSec: 0 }, show: { kind: 'motion', centsPerSec: 0 }, plan: 'free' },
  lite: { label: 'Lite', tag: 'Cheap AI video, up to 8s', image: 'lite', voice: 'turbo', maxSec: 8, talk: { kind: 'h3', centsPerSec: 1.5 }, show: { kind: 'video', model: 'h3-turbo', centsPerSec: 1.5 }, plan: 'starter' },
  fast: { label: 'Fast', tag: 'Sharper image, up to 10s', image: 'full', voice: 'hd', maxSec: 10, talk: { kind: 'h3', centsPerSec: 1.5 }, show: { kind: 'video', model: 'h3-turbo', centsPerSec: 1.5 }, plan: 'starter' },
  studio: { label: 'Studio', tag: 'Real lip-sync (VEED) · Kling', image: 'full', voice: 'hd', maxSec: 30, talk: { kind: 'lipsync', id: 'veed/fabric-1.0', centsPerSec: 8 }, show: { kind: 'video', model: 'kling-std', centsPerSec: 8 }, plan: 'creator' },
  premium: { label: 'Premium', tag: 'OmniHuman 720p · Kling Pro', image: 'full', voice: 'hd', maxSec: 30, talk: { kind: 'lipsync', id: 'fal-ai/bytedance/omnihuman/v1.5', centsPerSec: 16 }, show: { kind: 'video', model: 'kling-pro', centsPerSec: 14 }, plan: 'pro' },
};
export const tierOf = (k) => TIERS[k] || TIERS.lite;
export const TALK_ENGINES = TIERS; // back-compat name

// What each plan unlocks. 'free' = guests without a subscription (Motion only, like Basic); local (PC) mode counts as 'pro'.
export const PLAN_RANK = { free: 0, basic: 1, starter: 2, creator: 3, pro: 4 };
export const MODEL_PLAN = { 'h3-turbo': 'starter', 'seedance-fast': 'creator', 'kling-std': 'creator', 'kling-pro': 'pro' };
export const MAX_VARIANTS = { free: 3, basic: 3, starter: 3, creator: 5, pro: 5 };
export const allowed = (plan, need) => (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[need] ?? 0);

export const MODELS = {
  image: 'fal-ai/nano-banana-2',
  imageLite: 'fal-ai/flux/schnell',
  imageLiteEdit: 'fal-ai/bytedance/seedream/v4/edit',
  ttsTurbo: 'fal-ai/elevenlabs/tts/turbo-v2.5',
  ttsMinimaxTurbo: 'fal-ai/minimax/speech-2.8-turbo',
  imageEdit: 'fal-ai/nano-banana-2/edit',
  ttsMultilingual: 'fal-ai/elevenlabs/tts/multilingual-v2',
  ttsV3: 'fal-ai/elevenlabs/tts/eleven-v3',
  ttsMinimax: 'fal-ai/minimax/speech-02-hd',
  voiceClone: 'fal-ai/minimax/voice-clone',
  sfx: 'fal-ai/elevenlabs/sound-effects/v2',
  music: 'fal-ai/elevenlabs/music',
  removeBg: 'fal-ai/birefnet/v2',
  llm: 'openrouter/router',
};

export const COST = { // US cents
  image: 8, imageLite: 3, imageSchnell: 0.5, llm: 0.5, removeBg: 1,
  ttsPer1000Chars: 10, // ElevenLabs v2/v3 and MiniMax HD
  ttsTurboPer1000Chars: 6, // ElevenLabs Turbo v2.5 (5¢) / MiniMax 2.8 Turbo (6¢)
  sfxPerSec: 0.2,
  musicPerSec: 1, // est
  voiceClone: 100, // est
};
export const PRICE = {
  image: credits(COST.image), imageLite: credits(COST.imageLite), imageSchnell: credits(COST.imageSchnell), llm: credits(COST.llm), removeBg: credits(COST.removeBg),
  voiceClone: credits(COST.voiceClone),
};

// Voices. Keys: "el:<name>" ElevenLabs, "mm:<id>" MiniMax (best for Bahasa Melayu), "clone:<id>" user's cloned voice.
export const VOICES = {
  el: ['Aria', 'Sarah', 'Laura', 'Charlotte', 'Alice', 'Matilda', 'Jessica', 'Lily', 'Roger', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Bill'],
  mm: ['Lively_Girl', 'Friendly_Person', 'Calm_Woman', 'Sweet_Girl_2', 'Exuberant_Girl', 'Wise_Woman', 'Casual_Guy', 'Deep_Voice_Man', 'Patient_Man', 'Decent_Boy', 'Elegant_Man', 'Determined_Man'],
};
export const EMOTIONS = ['neutral', 'happy', 'surprised', 'sad', 'angry'];

export const ttsCost = (text, quality = 'hd') => credits((String(text).length / 1000) * (quality === 'turbo' ? COST.ttsTurboPer1000Chars : COST.ttsPer1000Chars));
export const videoCost = (model, seconds) => {
  const m = VIDEO_MODELS[model] || VIDEO_MODELS['h3-turbo'];
  return credits(m.centsPerSec * m.dur(seconds));
};
export const tierSeconds = (tier, sec) => Math.min(tierOf(tier).maxSec, Math.max(2, sec || 8));
export const talkCost = (tier, seconds) => { const t = tierOf(tier); return t.talk.centsPerSec ? credits(t.talk.centsPerSec * tierSeconds(tier, seconds)) : 0; };
export const showCost = (tier, seconds) => { const t = tierOf(tier); return t.show.centsPerSec ? credits(t.show.centsPerSec * Math.min(10, tierSeconds(tier, seconds))) : 0; };
export const imageCost = (quality, hasRefs = true) => (quality === 'lite' ? (hasRefs ? PRICE.imageLite : PRICE.imageSchnell) : PRICE.image);
export const sfxCost = (sec) => credits(COST.sfxPerSec * Math.max(1, sec || 5));
export const musicCost = (sec) => credits(COST.musicPerSec * Math.max(3, sec || 30));
