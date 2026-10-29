// AI avatar presets and the "create your own avatar" prompt builder.
// Presets are fictional AI personas (no real people). In live mode the portrait is generated
// the first time someone uses a preset; in preview mode the browser draws an illustration.
export const AVATAR_PRESETS = [
  { id: 'aisyah', name: 'Aisyah', tagline: 'Beauty & skincare', look: { gender: 'woman', age: '20s', skin: 'warm tan', hair: 'pastel hijab', style: 'soft glam, friendly smile', outfit: 'cream blouse', bg: 'bright bedroom vanity' } },
  { id: 'mei', name: 'Mei', tagline: 'Tech & gadgets', look: { gender: 'woman', age: '20s', skin: 'fair', hair: 'shoulder-length black bob', style: 'clean, confident', outfit: 'black tee', bg: 'minimal desk setup with soft LED light' } },
  { id: 'hafiz', name: 'Hafiz', tagline: 'Food & kopitiam', look: { gender: 'man', age: '30s', skin: 'medium brown', hair: 'short black hair, light beard', style: 'cheerful, energetic', outfit: 'casual polo', bg: 'busy Malaysian night market' } },
  { id: 'priya', name: 'Priya', tagline: 'Fashion & lifestyle', look: { gender: 'woman', age: '20s', skin: 'deep brown', hair: 'long wavy black hair', style: 'stylish, expressive', outfit: 'pastel kurta-inspired top', bg: 'sunny cafe' } },
  { id: 'rosnah', name: 'Puan Rosnah', tagline: 'Mum & home', look: { gender: 'woman', age: '40s', skin: 'warm tan', hair: 'navy hijab', style: 'warm, trustworthy, motherly', outfit: 'floral baju kurung', bg: 'cosy kitchen' } },
  { id: 'jason', name: 'Jason', tagline: 'Fitness & health', look: { gender: 'man', age: '20s', skin: 'fair', hair: 'short fade', style: 'sporty, motivating', outfit: 'gym tank top', bg: 'bright gym' } },
  { id: 'arif', name: 'Arif', tagline: 'Auto & men’s gear', look: { gender: 'man', age: '30s', skin: 'medium brown', hair: 'neat side part', style: 'calm, credible', outfit: 'denim jacket', bg: 'garage with a car' } },
  { id: 'nurul', name: 'Nurul', tagline: 'Gen Z trends', look: { gender: 'woman', age: 'early 20s', skin: 'light tan', hair: 'black hijab, trendy style', style: 'playful, Gen Z energy', outfit: 'oversized hoodie', bg: 'colourful room with fairy lights' } },
];

export function avatarPrompt(look = {}) {
  const l = look;
  return [
    `Photorealistic vertical portrait of a fictional Malaysian ${l.gender || 'person'} in their ${l.age || '20s'}`,
    l.skin && `${l.skin} skin`, l.hair && `${l.hair}`, l.outfit && `wearing ${l.outfit}`,
    l.style && `${l.style} expression`, l.bg && `background: ${l.bg}`,
    'looking straight at the camera, head and shoulders, natural window light, sharp focus, smartphone UGC look, no text, no logos',
  ].filter(Boolean).join(', ');
}
