// Brainstorm: Kravitas looks at the user's photos (friend + product + any image)
// and their prompt, then concludes what they have and what content will work.
import { run, toRemote, isMock, llmModel } from './fal.js';
import { parseJSON, LANGS } from './prompts.js';

export const BRAINSTORM_COST = 2;
export const FOLLOWUP_COST = 1;
const MODES = ['ad', 'video', 'image'];

const SETTINGS_HELP = `Allowed "settings" per mode (only use these keys/values):
- ad: format (talking|showcase), angle (review|problem|unboxing|deal|beforeafter|compare), platform (tiktok|shopee|lazada|instagram), seconds (10|15|20|30)
- video: camera (static|dolly-in|dolly-out|pan|orbit|crane|handheld|crash|fpv), style (photo|cinematic|ugc|studio|3d|anime|clay|storybook), aspect (9:16|16:9|1:1), duration (5|8|10)
- image: style (same as video), aspect (9:16|1:1|4:5|16:9)`;

/** chat: [{role:'user'|'ai', text}] follow-up conversation; previous: the last conclusion to refine. */
export async function brainstorm({ mode, prompt, friend, product, image, lang, chat = [], previous = null }) {
  const images = [friend?.photos?.[0], product?.image, image].filter(Boolean);
  chat = (Array.isArray(chat) ? chat : []).slice(-12).map((c) => ({ role: c.role === 'user' ? 'user' : 'ai', text: String(c.text || '').slice(0, 500) }));
  if (isMock()) return mockBrainstorm({ mode, prompt, friend, product, lang, chat });
  const labels = [];
  if (friend?.photos?.[0]) labels.push(`Image ${labels.length + 1}: the user's "friend" character, ${friend.name}`);
  if (product?.image) labels.push(`Image ${labels.length + 1}: the product, ${product.name}`);
  if (image) labels.push(`Image ${labels.length + 1}: an extra image the user attached`);
  const context = [
    `The user is currently in "${mode}" mode.`,
    labels.length ? labels.join('\n') : 'No images attached.',
    product && `Product details: ${product.name}${product.price ? `, ${product.price}` : ''}${product.benefits ? `. Notes: ${product.benefits}` : ''}`,
    prompt?.trim() ? `The user's prompt: "${prompt.trim()}"` : 'The user has not typed a prompt yet.',
    `Write hooks and prompts in ${LANGS[lang] || LANGS.en}.`,
  ].filter(Boolean).join('\n');
  const followUp = chat.length && chat[chat.length - 1].role === 'user' ? `

Your previous conclusion (JSON): ${JSON.stringify(previous || {}).slice(0, 3000)}

Conversation so far:
${chat.map((c) => `${c.role === 'user' ? 'User' : 'You'}: ${c.text}`).join('\n')}

The user's last message gives new direction. Update the whole conclusion to follow it (audience, selling points, hooks and ideas), keep what still fits, and set "reply" to one or two friendly sentences telling them what you changed.` : '';

  const r = await run('openrouter/router/vision', {
    model: llmModel(),
    image_urls: await Promise.all(images.map(toRemote)),
    temperature: 0.7,
    system_prompt: `You are Kravitas, a sharp creative director for Malaysian content creators and affiliate marketers (TikTok Shop, Shopee, Reels). You study the user's photos and prompt, then conclude what they actually have and what content will perform. Be concrete: refer to what you really see (colours, packaging, setting, expression, style). No generic advice. Never invent product claims that are not visible or given (especially health claims). Reply with ONLY a JSON object.`,
    prompt: `${context}

Return JSON:
{"summary": "2-3 sentences: what you see and your overall conclusion",
 "observations": ["4 short things you noticed in the images/prompt"],
 "audience": "who this content is for, one sentence",
 "sellingPoints": ["3-5 selling points or story angles"],
 "hooks": ["3 scroll-stopping first lines"],
 "ideas": [{"title": "short name", "mode": "${MODES.join('|')}", "why": "one sentence on why it fits", "prompt": "ready-to-use prompt for that mode", "settings": {}}]}
Give exactly 4 ideas, mixing at least 3 different modes, best first.${followUp ? '\nAlso include "reply": "..." in the JSON.' : ''}
${SETTINGS_HELP}${followUp}`,
  });
  return clean(parseJSON(r.output));
}

function clean(b) {
  const arr = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n) : []);
  return {
    reply: String(b.reply || ''),
    summary: String(b.summary || ''),
    observations: arr(b.observations, 6),
    audience: String(b.audience || ''),
    sellingPoints: arr(b.sellingPoints, 6),
    hooks: arr(b.hooks, 5),
    ideas: (Array.isArray(b.ideas) ? b.ideas : []).filter((i) => MODES.includes(i?.mode)).slice(0, 6).map((i) => ({
      title: String(i.title || 'Idea'), mode: i.mode, why: String(i.why || ''), prompt: String(i.prompt || ''),
      settings: i.settings && typeof i.settings === 'object' ? i.settings : {},
    })),
  };
}

/** Demo-mode stand-in (no fal key): built from the product details and prompt. */
export function mockBrainstorm({ prompt, friend, product, lang, chat = [] }) {
  const ask = chat.filter((c) => c.role === 'user').map((c) => c.text).join('; ');
  const p = product?.name || 'your product';
  const who = friend?.name || 'your creator';
  const topic = prompt?.trim() || p;
  const bm = lang === 'ms';
  return {
    reply: ask ? `Noted: “${ask.slice(-120)}”. In demo mode I can only nudge the ideas; add a fal.ai key for a full rework.` : '',
    summary: `${product ? `${p}${product.price ? ` at ${product.price}` : ''} is the hero here` : `Your idea "${topic}" is the starting point`}${friend ? `, and ${who} gives it a real face people can trust` : ''}. (Demo mode: add a fal.ai key and Kravitas will actually study your photos.)`,
    observations: [product ? `Product: ${p}` : 'No product attached', friend ? `Creator: ${who}` : 'No friend attached', prompt ? `Prompt: “${prompt.trim().slice(0, 60)}”` : 'No prompt yet', 'Vertical 9:16 suits TikTok & Reels'],
    audience: `Malaysian shoppers scrolling TikTok Shop and Shopee who buy on impulse when they see real people use a product.${ask ? ` Focus: ${ask.slice(-120)}` : ''}`,
    sellingPoints: (product?.benefits ? product.benefits.split(/[,.]/).map((s) => s.trim()).filter(Boolean) : ['Affordable', 'Easy to use', 'Looks good on camera']).slice(0, 4),
    hooks: bm ? [`Jangan beli ${p} sebelum tengok ni`, `${p} ni betul-betul berbaloi ke?`, `POV: korang jumpa ${p} separuh harga`] : [`Don't buy ${p} before watching this`, `Is ${p} actually worth it?`, `POV: you found ${p} at half price`],
    ideas: [
      { title: 'Honest review', mode: 'ad', why: 'Talking UGC converts best for a first impression.', prompt: product?.benefits || '', settings: { format: 'talking', angle: 'review' } },
      { title: 'Hero orbit shot', mode: 'video', why: 'A slow orbit makes the product look premium.', prompt: `${who} holds ${p} up to the camera in soft window light`, settings: { camera: 'orbit', style: 'cinematic' } },
      { title: 'Listing packshot', mode: 'image', why: 'Clean images lift Shopee click-through.', prompt: `${p} on a seamless pastel background, soft shadows, premium e-commerce packshot`, settings: { style: 'studio', aspect: '1:1' } },
      { title: 'Problem → fix ad', mode: 'ad', why: 'Showing the problem first keeps viewers to the end.', prompt: `3 reasons people are switching to ${p}`, settings: { format: 'showcase', angle: 'problem' } },
    ],
  };
}
