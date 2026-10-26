// LLM prompt builders for scripts, hooks and story plans.
export const LANGS = {
  en: 'natural, casual English',
  ms: 'casual, natural Bahasa Melayu as spoken by Malaysian creators (not formal textbook Malay)',
  manglish: 'Malaysian English (Manglish) that mixes in common BM words naturally (lah, best gila, confirm, jom)',
};
const lang = (l) => LANGS[l] || LANGS.en;

export const PLATFORMS = {
  tiktok: { name: 'TikTok Shop', cta: { en: 'tap the yellow basket', ms: 'tekan beg kuning', manglish: 'tap the yellow basket lah' } },
  shopee: { name: 'Shopee', cta: { en: 'link in bio for Shopee', ms: 'link Shopee kat bio', manglish: 'link in bio, Shopee one' } },
  lazada: { name: 'Lazada', cta: { en: 'grab it on Lazada, link in bio', ms: 'link Lazada kat bio', manglish: 'Lazada link in bio ya' } },
  instagram: { name: 'Instagram Reels', cta: { en: 'DM me "LINK"', ms: 'DM "LINK" kat saya', manglish: 'DM me "LINK"' } },
};

export const ANGLES = {
  review: 'honest first-person review: what it is, what surprised you, who it is for',
  problem: 'problem → agitate → solution: open on a relatable pain point, then reveal the product as the fix',
  unboxing: 'excited unboxing: first impressions, texture/details, the "wow" moment',
  deal: 'deal urgency: price drop or sale campaign (11.11, 12.12, payday), limited stock, act now',
  beforeafter: 'before vs after transformation the product delivers',
  compare: 'compare to the expensive alternative and show why this one wins on value',
};

const productBlock = (p) => [
  `Product: ${p.name}`,
  p.price && `Price: ${p.price}`,
  p.benefits && `Key benefits / notes: ${p.benefits}`,
].filter(Boolean).join('\n');

const JSON_RULE = 'Reply with ONLY a valid JSON object, no markdown fences, no commentary.';

export function ugcPrompt({ product, lang: l, platform, angle, seconds, format, friendName, notes }) {
  const plat = PLATFORMS[platform] || PLATFORMS.tiktok;
  const words = Math.round(seconds * 2.4);
  return {
    system: `You are Malaysia's best short-form affiliate scriptwriter. You write UGC ad scripts that stop the scroll in under 2 seconds and convert on ${plat.name}. You never sound like a corporate ad. ${JSON_RULE}`,
    prompt: `${productBlock(product)}${notes ? `\nMust mention: ${notes}` : ''}
Platform: ${plat.name}
Angle: ${ANGLES[angle] || ANGLES.review}
Format: ${format === 'talking' ? 'creator talks to camera holding the product' : 'product showcase b-roll with voice-over'}
Language: ${lang(l)}
Length: about ${words} spoken words (~${seconds}s). Spoken words only, no stage directions, no emojis in "script".
End the script with a call to action like "${plat.cta[l] || plat.cta.en}".

Return JSON with keys:
"hook": the first line (max 9 words, scroll-stopping),
"script": the full voice-over text including the hook as the first sentence,
"caption": post caption (1-2 lines, can use emojis),
"hashtags": array of 6-10 hashtags relevant to Malaysia and the product,
"scene": one sentence describing the still frame: ${friendName ? `the creator (${friendName})` : 'a Malaysian creator'} ${format === 'talking' ? 'holding the product near their face, looking at the camera, selfie-style' : 'with the product'} — include setting, lighting and mood,
"motion": one sentence describing the camera/subject motion for the video clip.`,
  };
}

export function storyPrompt({ prompt, lang: l, scenes, tone }) {
  return {
    system: `You are a short-form video director and scriptwriter for Malaysian audiences (TikTok, Reels, Shorts). ${JSON_RULE}`,
    prompt: `Make a ${scenes}-scene vertical video about: ${prompt}
Tone: ${tone || 'engaging infotainment'}
Language for narration: ${lang(l)}
Scene 1 must open with a strong hook. Each scene's narration is 12-22 words. The last scene ends with a call to action (follow / save / comment).

Return JSON:
{"title": "...", "caption": "post caption with 1-2 emojis", "hashtags": ["#...", ...],
 "scenes": [{"narration": "spoken words", "visual": "detailed image prompt for this scene's still frame (subject, setting, lighting, composition, photographic or illustrated style)", "motion": "camera / subject movement"}]}`,
  };
}

export function writerPrompt({ kind, topic, product, lang: l, platform }) {
  const plat = (PLATFORMS[platform] || PLATFORMS.tiktok).name;
  const about = product ? productBlock(product) : `Topic: ${topic}`;
  const tasks = {
    hooks: `Write 10 different scroll-stopping hooks (max 10 words each) for a ${plat} video. Mix curiosity, pain point, bold claim, price shock and POV styles. Number them.`,
    script: `Write a 30-second ${plat} script with: HOOK, BODY (3 short beats), CTA. Include on-screen text suggestions in [brackets].`,
    caption: `Write 3 caption options for a ${plat} post, each with 8-12 relevant hashtags (mix Malaysian and niche tags).`,
    ideas: `Give 15 content ideas for a creator/affiliate on ${plat}, each with a one-line hook and the format (talking head, b-roll, tutorial, review, POV). Group them by week (Week 1-3).`,
    reply: `Write 8 short, friendly replies to common comments on this kind of post (price questions, "legit ke?", shipping, results), steering people to the link.`,
  };
  return {
    system: `You are a top Malaysian content strategist for creators and affiliates. Write in ${lang(l)}. Use plain text with simple numbering, no markdown tables.`,
    prompt: `${about}\n\n${tasks[kind] || tasks.hooks}`,
  };
}

export function avatarScriptPrompt({ topic, lang: l, seconds }) {
  return {
    system: `You write talking-head scripts for Malaysian creators. Output only the spoken words, no stage directions, no quotes.`,
    prompt: `Write a ~${Math.round(seconds * 2.4)}-word talking-head script in ${lang(l)} about: ${topic}. Start with a hook, end with a call to action.`,
  };
}

export function parseJSON(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The script AI returned no JSON. Try again.');
  return JSON.parse(s.slice(start, end + 1));
}
