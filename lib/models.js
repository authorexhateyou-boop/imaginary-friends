// Model catalogue + credit pricing.
// Costs below are fal.ai prices in US cents (from fal.ai/pricing and model pages, Oct 2026; some are estimates,
// marked "est"). Credits charged = cost x CREDIT_MARKUP (default 1.25), so 1 credit ≈ US$0.008 of AI cost
// and plans keep a margin even when users spend every credit.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
export const MARKUP = Number(process.env.CREDIT_MARKUP) > 0 ? Number(process.env.CREDIT_MARKUP) : 1.25;
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

// Talking-head engines: cheapest first.
export const TALK_ENGINES = {
  fast: { label: 'Fast', tag: 'H3 Turbo + voice, up to 10s', centsPerSec: 1.5, maxSec: 10 },
  studio: { label: 'Studio', tag: 'VEED Fabric lip-sync 480p', centsPerSec: 8, maxSec: 30, id: 'veed/fabric-1.0' },
  premium: { label: 'Premium', tag: 'OmniHuman 1.5, 720p', centsPerSec: 16, maxSec: 30, id: 'fal-ai/bytedance/omnihuman/v1.5' },
};

export const MODELS = {
  image: 'fal-ai/nano-banana-2',
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
  image: 8, llm: 0.5, removeBg: 1,
  ttsPer1000Chars: 10, // ElevenLabs v2/v3 and MiniMax HD
  sfxPerSec: 0.2,
  musicPerSec: 1, // est
  voiceClone: 100, // est
};
export const PRICE = {
  image: credits(COST.image), llm: credits(COST.llm), removeBg: credits(COST.removeBg),
  voiceClone: credits(COST.voiceClone),
};

// Voices. Keys: "el:<name>" ElevenLabs, "mm:<id>" MiniMax (best for Bahasa Melayu), "clone:<id>" user's cloned voice.
export const VOICES = {
  el: ['Aria', 'Sarah', 'Laura', 'Charlotte', 'Alice', 'Matilda', 'Jessica', 'Lily', 'Roger', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Bill'],
  mm: ['Lively_Girl', 'Friendly_Person', 'Calm_Woman', 'Sweet_Girl_2', 'Exuberant_Girl', 'Wise_Woman', 'Casual_Guy', 'Deep_Voice_Man', 'Patient_Man', 'Decent_Boy', 'Elegant_Man', 'Determined_Man'],
};
export const EMOTIONS = ['neutral', 'happy', 'surprised', 'sad', 'angry'];

export const ttsCost = (text) => credits((String(text).length / 1000) * COST.ttsPer1000Chars);
export const videoCost = (model, seconds) => {
  const m = VIDEO_MODELS[model] || VIDEO_MODELS['h3-turbo'];
  return credits(m.centsPerSec * m.dur(seconds));
};
export const talkCost = (engine, seconds) => {
  const e = TALK_ENGINES[engine] || TALK_ENGINES.fast;
  return credits(e.centsPerSec * Math.min(e.maxSec, Math.max(2, seconds)));
};
export const sfxCost = (sec) => credits(COST.sfxPerSec * Math.max(1, sec || 5));
export const musicCost = (sec) => credits(COST.musicPerSec * Math.max(3, sec || 30));
