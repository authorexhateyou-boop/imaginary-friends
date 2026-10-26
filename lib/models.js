// Model catalogue + credit pricing. 1 credit ~= US$0.01 of fal.ai usage.
// Prices are estimates from fal's public pricing; adjust here if fal changes them.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

export const VIDEO_MODELS = {
  'h3-turbo': {
    label: 'MiniMax H3 Turbo', tag: 'Best value', perSec: 2,
    id: 'minimax/h3-max-turbo/image-to-video',
    input: (o) => ({
      prompt: o.prompt, image_url: o.image, duration: clamp(o.duration, 2, 10),
      resolution: '768P', prompt_expansion_mode: 'balanced',
    }),
    dur: (d) => clamp(d, 2, 10),
  },
  'seedance-fast': {
    label: 'Seedance 2.0 Fast', tag: 'Native audio', perSec: 12,
    id: 'bytedance/seedance-2.0/fast/image-to-video',
    input: (o) => ({
      prompt: o.prompt, image_url: o.image, duration: String(clamp(o.duration, 4, 15)),
      resolution: '720p', aspect_ratio: o.aspect || 'auto', generate_audio: !!o.audio,
    }),
    dur: (d) => clamp(d, 4, 15),
  },
  'kling-std': {
    label: 'Kling 3.0 Standard', tag: 'Smooth motion', perSec: 9,
    id: 'fal-ai/kling-video/v3/standard/image-to-video',
    input: (o) => ({
      prompt: o.prompt, start_image_url: o.image, duration: String(clamp(o.duration, 3, 15)),
      generate_audio: !!o.audio,
    }),
    dur: (d) => clamp(d, 3, 15),
  },
  'kling-pro': {
    label: 'Kling 3.0 Pro', tag: 'Top quality', perSec: 14,
    id: 'fal-ai/kling-video/v3/pro/image-to-video',
    input: (o) => ({
      prompt: o.prompt, start_image_url: o.image, duration: String(clamp(o.duration, 3, 15)),
      generate_audio: !!o.audio,
    }),
    dur: (d) => clamp(d, 3, 15),
  },
};

export const MODELS = {
  image: 'fal-ai/nano-banana-2',
  imageEdit: 'fal-ai/nano-banana-2/edit',
  tts: 'fal-ai/elevenlabs/tts/multilingual-v2',
  avatar: 'fal-ai/bytedance/omnihuman/v1.5',
  removeBg: 'fal-ai/birefnet/v2',
  llm: 'openrouter/router',
};

export const PRICE = {
  image: 8,
  llm: 1,
  removeBg: 1,
  ttsPer100Chars: 1,
  avatarPerSec: 16,
};

export const VOICES = [
  'Aria', 'Sarah', 'Laura', 'Charlotte', 'Alice', 'Matilda', 'Jessica', 'Lily',
  'Roger', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Bill',
];

export const ttsCost = (text) => Math.max(1, Math.ceil(String(text).length / 100) * PRICE.ttsPer100Chars);
export const videoCost = (model, seconds) => {
  const m = VIDEO_MODELS[model] || VIDEO_MODELS['h3-turbo'];
  return Math.ceil(m.perSec * m.dur(seconds));
};
