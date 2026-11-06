/* Kravitas — Higgsfield-style studio: feed + presets + one prompt bar. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- session: hosted mode gives every visitor an anonymous guest account ----------
const CFG = { mode: 'local' };
// cheapest tier a beginner can actually use: Lite on Starter and up, Motion on Free/Basic
function startTier() { try { return ['free', 'basic'].includes(S.app?.access || 'free') ? 'motion' : 'lite'; } catch { return 'motion'; } }
let sb = null;
async function token() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
}
async function initSession() {
  try {
    const r = await fetch('/api/config');
    Object.assign(CFG, r.ok ? await r.json() : { mode: 'preview', static: true });
  } catch { CFG.mode = 'preview'; CFG.static = true; } // no backend at all (static hosting): browser-only preview
  if (CFG.static) document.querySelector('.foot')?.remove();
  if (CFG.mode === 'preview') {
    await loadScript('mock.js');
    Object.assign(CFG, { payments: true, social: true, currency: 'MYR', plans: CFG.plans || [
      { id: 'basic', name: 'Basic', credits: 600, price: 39, features: ['Motion ads & faceless stories', 'Up to 3 variations per ad', 'All voices + brainstorm'] },
      { id: 'starter', name: 'Starter', credits: 1000, price: 59, features: ['Everything in Basic', 'Lite & Fast AI video', 'Video and Talk tools'] },
      { id: 'creator', name: 'Creator', credits: 2500, price: 129, tag: 'Popular', features: ['Everything in Starter', 'Studio lip-sync + Kling', '5 variations per ad', 'Voice cloning & auto-post'] },
      { id: 'pro', name: 'Pro', credits: 6500, price: 299, tag: 'Best value', features: ['Everything in Creator', 'Premium lip-sync (OmniHuman)', 'Kling Pro video'] }], packs: CFG.packs || [
      { id: 'small', name: 'Small', credits: 300, price: 25 },
      { id: 'medium', name: 'Medium', credits: 800, price: 59, tag: 'Popular' },
      { id: 'large', name: 'Large', credits: 2000, price: 129 }] });
    return;
  }
  if (CFG.mode !== 'supabase') return;
  await loadScript('/vendor/supabase.js');
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw new Error('Could not start a guest session: ' + error.message);
  }
}

async function api(url, body, method) {
  if (CFG.mode === 'preview') return window.PreviewAPI.handle(url, body, method);
  const headers = body ? { 'content-type': 'application/json' } : {};
  const t = await token();
  if (t) headers.authorization = 'Bearer ' + t;
  const r = await fetch(url, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code, status: r.status });
  return j;
}
// In-page confirm (native confirm() is blocked in embedded previews).
function confirmBox(msg, yes = 'Delete') {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'confirm';
    d.innerHTML = `<div class="sheet"><p style="margin:0 0 14px;font-weight:600">${esc(msg)}</p><div class="acts"><button class="btn danger" data-y>${esc(yes)}</button><button class="btn" data-n>Cancel</button></div></div>`;
    document.body.append(d);
    const done = (v) => { d.remove(); resolve(v); };
    d.onclick = (e) => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]') || e.target === d) done(false); };
  });
}
let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = ''), bad ? 5000 : 2400);
}

// ---------- vocab ----------
const LANG = { ms: 'Bahasa Melayu', en: 'English', manglish: 'Manglish' };
const CAM = { static: 'Static', 'dolly-in': 'Dolly in', 'dolly-out': 'Dolly out', pan: 'Pan', orbit: 'Orbit', crane: 'Crane up', handheld: 'Handheld', crash: 'Crash zoom', fpv: 'FPV drone' };
const STYLE = { photo: 'Realistic', cinematic: 'Cinematic', ugc: 'Phone / UGC', studio: 'Studio', '3d': '3D animated', anime: 'Anime', clay: 'Clay', storybook: 'Storybook' };
const PLATFORM = { tiktok: 'TikTok Shop', shopee: 'Shopee', lazada: 'Lazada', instagram: 'Reels' };

// Home is a bento overview; Ad is the money-maker, so it comes right after.
const MODES = {
  home: { label: 'Home', page: true },
  ad: { tool: 'ugc', label: 'Ad', hot: true },
  video: { tool: 'shot', label: 'Video' },
  image: { tool: 'image', label: 'Image' },
  talk: { tool: 'avatar', label: 'Talk' },
  story: { tool: 'story', label: 'Story' },
  voice: { tool: 'voice', label: 'Voice' },
  schedule: { label: 'Schedule', page: true },
};
const TOOL_MODE = Object.fromEntries(Object.entries(MODES).filter(([, v]) => v.tool).map(([m, v]) => [v.tool, m]));
TOOL_MODE.avatarGen = 'avatars';
const TOOL_LABEL = { avatarGen: 'Avatar', write: 'Script' };

const PRESETS = {
  video: Object.entries(CAM).map(([k, t], i) => ({ id: k, t, cam: true, h: (i * 40 + 200) % 360, set: { camera: k } })),
  image: [
    { id: 'studio', e: '✨', t: 'Packshot', d: 'Clean e-commerce', set: { style: 'studio', aspect: '1:1', prompt: 'the product on a seamless pastel background, soft shadows, premium e-commerce packshot' } },
    { id: 'life', e: '🛋️', t: 'Lifestyle', d: 'Cosy home scene', set: { style: 'photo', aspect: '4:5', prompt: 'the product in a bright cosy Malaysian home, natural morning light' } },
    { id: 'flat', e: '📐', t: 'Flat lay', d: 'Top-down props', set: { style: 'studio', aspect: '1:1', prompt: 'top-down flat lay of the product with complementary props, clean and aesthetic' } },
    { id: 'hold', e: '🤳', t: 'Friend holds it', d: 'Selfie with product', set: { style: 'ugc', aspect: '9:16', prompt: 'holding the product near their face, smiling at the camera, selfie style' } },
    { id: 'thumb', e: '😱', t: 'Thumbnail', d: 'Bold cover', set: { style: 'photo', aspect: '9:16', prompt: 'excited shocked expression holding the product, bold high-contrast thumbnail' } },
    { id: 'festive', e: '🌙', t: 'Festive promo', d: 'Raya / sale mood', set: { style: 'cinematic', aspect: '4:5', prompt: 'the product in a festive sale setting with ketupat and warm pelita lights' } },
  ],
  ad: [
    { id: 'review', e: '🛒', t: 'Honest review', d: 'Talks to camera', set: { angle: 'review', format: 'talking' } },
    { id: 'deal', e: '⚡', t: 'Flash sale', d: '11.11 urgency', set: { angle: 'deal', format: 'showcase' } },
    { id: 'problem', e: '😩', t: 'Problem → fix', d: 'Relatable pain', set: { angle: 'problem', format: 'talking' } },
    { id: 'unboxing', e: '📦', t: 'Unboxing', d: 'First impressions', set: { angle: 'unboxing', format: 'showcase' } },
    { id: 'compare', e: '💸', t: 'Vs. pricey one', d: 'Payday value', set: { angle: 'compare', format: 'talking' } },
    { id: 'beforeafter', e: '🪄', t: 'Before & after', d: 'Transformation', set: { angle: 'beforeafter', format: 'showcase' } },
  ],
  talk: [
    { id: 'intro', e: '👋', t: 'Intro', d: 'Who I am', set: { textMode: 'topic', prompt: 'introduce yourself and what your page is about' } },
    { id: 'tips', e: '💡', t: '3 quick tips', d: 'Value post', set: { textMode: 'topic', prompt: '3 quick tips for my niche' } },
    { id: 'promo', e: '📣', t: 'Promo shout', d: 'Sale announcement', set: { textMode: 'topic', prompt: 'announce a 24-hour sale, link in bio' } },
    { id: 'raya', e: '🌙', t: 'Festive wish', d: 'Greeting', set: { textMode: 'topic', prompt: 'a warm festive greeting to my followers' } },
  ],
  story: [
    { id: 'facts', e: '🔥', t: 'Did you know', d: 'Viral facts', set: { prompt: '5 surprising facts about Malaysia most people don\'t know' } },
    { id: 'explain', e: '🧠', t: 'Explainer', d: 'Teach a topic', set: { prompt: 'how compound interest works, explained simply' } },
    { id: 'history', e: '📜', t: 'History', d: 'Story time', set: { prompt: 'the origin story of nasi lemak' } },
    { id: 'tips', e: '✅', t: 'Listicle', d: 'Top 5', set: { prompt: 'top 5 budget travel tips for Langkawi' } },
  ],
  voice: [
    { id: 'promo', e: '📣', t: 'Excited promo', d: 'ElevenLabs v3', set: { kind: 'tts', voice: 'el:Jessica', voiceEngine: 'v3', prompt: '[excited] Korang! Harga ni memang tak masuk akal. [laughs] Cepat, stok tinggal sikit je!' } },
    { id: 'bm', e: '🇲🇾', t: 'BM sales voice', d: 'MiniMax, Malay', set: { kind: 'tts', voice: 'mm:Lively_Girl', emotion: 'happy', lang: 'ms', prompt: 'Assalamualaikum semua! Hari ni saya nak kongsi produk yang saya guna setiap hari.' } },
    { id: 'narrator', e: '🎙️', t: 'Calm narrator', d: 'Story voice-over', set: { kind: 'tts', voice: 'el:George', voiceEngine: 'multilingual', prompt: 'Long before it became Malaysia’s favourite breakfast, nasi lemak was a farmer’s meal.' } },
    { id: 'whisper', e: '🤫', t: 'Whisper / ASMR', d: 'Audio tags', set: { kind: 'tts', voice: 'el:Aria', voiceEngine: 'v3', prompt: '[whispers] Okay… this is the secret nobody tells you. [sighs] Ready?' } },
    { id: 'sfx', e: '💥', t: 'Sound effect', d: 'Whoosh, ding, crowd', set: { kind: 'sfx', length: 3, prompt: 'cash register ding with a satisfying coin drop' } },
    { id: 'music', e: '🎵', t: 'Background music', d: 'Royalty-free track', set: { kind: 'music', length: 30, prompt: 'upbeat lo-fi beat for a TikTok product video, warm and catchy, no vocals' } },
    { id: 'clone', e: '🧬', t: 'Clone your voice', d: '30s sample', action: 'clone' },
  ],
};

const DEFAULTS = {
  video: () => ({ prompt: '', friendId: null, productId: null, startImage: null, camera: 'dolly-in', style: 'cinematic', model: 'h3-turbo', duration: 5, aspect: '9:16', audio: false }),
  image: () => ({ prompt: '', friendId: null, productId: null, style: 'photo', aspect: '9:16', count: 2 }),
  ad: () => ({ prompt: '', friendId: null, productId: null, format: 'talking', tier: startTier(), approve: true, variants: 1, angle: 'review', platform: 'tiktok', lang: 'ms', seconds: 8, voice: 'mm:Lively_Girl', captions: true }),
  talk: () => ({ prompt: '', friendId: null, image: null, textMode: 'script', tier: startTier(), lang: 'ms', voice: 'mm:Lively_Girl', captions: true, seconds: 8 }),
  story: () => ({ prompt: '', friendId: null, scenes: 4, tier: 'motion', aspect: '9:16', style: 'cinematic', lang: 'en', voice: 'el:Aria', model: 'h3-turbo', captions: true }),
  voice: () => ({ prompt: '', kind: 'tts', voice: 'el:Aria', voiceEngine: 'v3', emotion: 'neutral', speed: 1, lang: 'ms', length: 30 }),
  home: () => ({}), schedule: () => ({}),
};

const PLACEHOLDER = {
  video: 'Describe the shot… e.g. walks through a night market at dusk holding teh tarik',
  image: 'Describe the image…',
  ad: 'Anything to mention? e.g. 50% off today, halal, free shipping (optional)',
  talk: 'Type what your friend should say…',
  story: 'What is the video about? One prompt → narrated video with captions',
  voice: 'Type the voice-over… v3 understands tags like [excited] [whispers] [laughs]',
};

// ---------- state ----------
// Every visit opens on the homepage (Ad); switching tabs is per visit.
const S = { app: null, friends: [], products: [], jobs: [], voices: [], mode: 'home', forms: {}, preset: {} };
const F = () => S.forms[S.mode] || (S.forms[S.mode] = DEFAULTS[S.mode]());
const friendById = (id) => S.friends.find((f) => f.id === id);
const productById = (id) => S.products.find((p) => p.id === id);

async function load() {
  [S.app, S.friends, S.products, S.jobs, S.voices] = await Promise.all([api('/api/state'), api('/api/friends'), api('/api/products'), api('/api/jobs?limit=120'), api('/api/voices').catch(() => [])]);
  $('#credits').textContent = `✦ ${S.app.credits.toLocaleString()}`;
}

// ---------- render ----------
function renderTabs() {
  $('#tabs').innerHTML = Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${k === S.mode ? 'on' : ''}">${m.label}${m.hot ? '<span class="hot">NEW</span>' : ''}</button>`).join('');
}

const HERO = {
  video: ['Direct your <em>friends</em>', 'Same face in every shot. Pick a camera move, describe the scene.'],
  image: ['Shoot <em>anything</em>', 'Packshots, lifestyle and thumbnails with your friends and products.'],
  ad: ['Affiliate ads in <em>one click</em>', 'Product + friend → script, voice, lip-synced UGC video and captions for TikTok Shop & Shopee.'],
  talk: ['Make them <em>talk</em>', 'Your friend says anything, lip-synced, with captions.'],
  story: ['One prompt, <em>full video</em>', 'Plan it scene by scene, edit any line, and re-render only what changed.'],
  voice: ['Voice <em>studio</em>', 'ElevenLabs voice-overs, natural Bahasa Melayu voices, your own cloned voice, music and sound effects.'],
};

// ---------- step-by-step guide ----------
const isSample = (x) => String(x.id).startsWith('sample-');
const flag = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) === '1'; localStorage.setItem(k, v ? '1' : '0'); } catch { return false; } };
function guideHTML() {
  if (flag('if-guide-hidden')) return '';
  const steps = [
    { done: S.friends.some((f) => !isSample(f)), t: 'Add your friend', d: 'Upload 1–3 clear photos of the face that stars in your videos. It stays the same in every shot.', btn: '＋ Add friend', act: 'data-new="friend"' },
    { done: S.products.some((p) => !isSample(p)), t: 'Add a product', d: 'A photo of what you promote, plus its price and selling points.', btn: '＋ Add product', act: 'data-new="product"' },
    { done: flag('if-brainstormed'), t: 'Brainstorm', d: 'Kravitas studies your photos and prompt, then suggests hooks, angles and ready-made ideas.', btn: '✨ Brainstorm', act: 'data-brain' },
    { done: S.jobs.some((j) => j.status === 'done'), t: 'Generate & post', d: 'Pick an idea or preset, hit Generate, then download your video with captions.', btn: 'Make an ad', act: 'data-mode="ad"' },
  ];
  const n = steps.filter((x) => x.done).length;
  const next = steps.findIndex((x) => !x.done);
  return `<section class="guide" aria-label="Getting started">
    <div class="g-h"><div><h2>${n === 4 ? 'You’re all set ✓' : 'Your first ad in 4 steps'}</h2><p class="muted">${n} of 4 done</p></div>
      <button class="link" data-guide-hide>Hide guide</button></div>
    <div class="g-bar"><i style="width:${n * 25}%"></i></div>
    <ol class="g-steps">${steps.map((x, i) => `<li class="${x.done ? 'done' : i === next ? 'next' : ''}">
      <span class="g-n">${x.done ? '✓' : i + 1}</span><b>${x.t}</b><p>${x.d}</p>
      ${x.done ? '<span class="g-ok">Done</span>' : `<button class="btn ${i === next ? 'pri' : ''}" ${x.act}>${x.btn}</button>`}</li>`).join('')}</ol></section>`;
}

function renderPresets() {
  const [h, p] = HERO[S.mode];
  const f = F();
  const items = PRESETS[S.mode].map((x) => {
    const on = !!x.set && Object.entries(x.set).every(([k, v]) => k === 'prompt' || f[k] === v) && S.preset[S.mode] === x.id;
    const pv = x.cam
      ? `<div class="sc cam-${x.id}" style="--h:${x.h}"><div class="sun"></div><div class="mt"></div><div class="who"></div></div>`
      : `<div class="e">${x.e}</div>`;
    return `<button class="preset ${on || (x.cam && f.camera === x.id) ? 'on' : ''}" data-preset="${x.id}"><div class="pv" ${x.cam ? '' : `style="background:radial-gradient(circle at 30% 20%,hsl(${(x.id.length * 47) % 360},60%,28%),#111)"`}>${pv}</div><div class="lb">${esc(x.t)}${x.d ? `<small>${esc(x.d)}</small>` : ''}</div></button>`;
  }).join('');
  $('#presets').innerHTML = `
    <div class="hero"><h1>${h}</h1><p>${p}</p>
      ${S.app.mock && S.app.mode === 'local' ? `<div class="banner">🧪 Demo mode: placeholders, no cost. <button data-open="settings">Add fal.ai key</button></div>` : ''}</div>
    <div class="strip-h"><h2>${S.mode === 'video' ? 'Camera moves' : 'Presets'}</h2>
      <div class="rail-nav"><button class="rn" data-rail="-1" aria-label="Scroll left">‹</button><button class="rn" data-rail="1" aria-label="Scroll right">›</button></div></div>
    <div class="rail"><div class="strip" id="strip">${items}</div></div>
    ${guideHTML()}`;
  const strip = $('#strip');
  const upd = () => {
    const max = strip.scrollWidth - strip.clientWidth - 2;
    const rail = strip.parentElement;
    rail.classList.toggle('fade-l', strip.scrollLeft > 2);
    rail.classList.toggle('fade-r', strip.scrollLeft < max);
    $('[data-rail="-1"]').disabled = strip.scrollLeft <= 2;
    $('[data-rail="1"]').disabled = strip.scrollLeft >= max;
  };
  strip.addEventListener('scroll', upd, { passive: true });
  // a vertical mouse wheel scrolls the rail sideways
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
      const atEnd = (e.deltaY > 0 && strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2) || (e.deltaY < 0 && strip.scrollLeft <= 0);
      if (!atEnd) { e.preventDefault(); strip.scrollLeft += e.deltaY; }
    }
  }, { passive: false });
  requestAnimationFrame(upd);
}

// ---------- brainstorm ----------
const BRAIN_KEYS = { ad: ['format', 'angle', 'platform', 'seconds'], video: ['camera', 'style', 'aspect', 'duration'], image: ['style', 'aspect'], talk: ['textMode'], story: ['scenes', 'style', 'aspect'] };
let lastBrain = null;
async function runBrainstorm() {
  const f = F();
  const ctx = { mode: S.mode, prompt: f.prompt, friendId: f.friendId, productId: f.productId, image: f.startImage || f.image || null, lang: f.lang || 'ms' };
  if (!ctx.friendId && !ctx.productId && !ctx.image && !String(ctx.prompt || '').trim()) {
    const fr = S.friends[0], pr = S.products[0];
    if (!fr && !pr) return toast('Add a friend, a product or a prompt first', true);
    ctx.friendId = fr?.id || null; ctx.productId = pr?.id || null;
  }
  const fr = friendById(ctx.friendId), pr = productById(ctx.productId);
  const thumbs = [fr?.photos?.[0], pr?.image, ctx.image].filter(Boolean);
  const m = modal(`<div class="brain">
    <div class="b-think"><div class="b-thumbs">${thumbs.map((u) => `<img src="${u}" alt="">`).join('')}</div>
    <h2>Kravitas is thinking…</h2>
    <ul class="b-steps"><li>Looking at your photos</li><li>Reading your prompt</li><li>Connecting the dots</li></ul></div></div>`, 'wide');
  const lis = [...m.querySelectorAll('.b-steps li')];
  let k = 0;
  const t = setInterval(() => { lis.forEach((li, i) => li.classList.toggle('on', i <= k)); k = Math.min(k + 1, lis.length - 1); }, 800);
  try {
    const r = await api('/api/brainstorm', ctx);
    clearInterval(t);
    flag('if-brainstormed', true);
    lastBrain = { ...r, ctx };
    if ($('#modal').hidden) { toast('✨ Brainstorm ready'); }
    showBrain(lastBrain, thumbs);
    renderComposer();
    load().then(() => { renderPresets(); });
  } catch (e) {
    clearInterval(t);
    closeModal();
    toast(e.message, true);
    if (e.code === 'credits' || e.code === 'plan') accountModal();
  }
}

const BRAIN_SUGGEST = ['Target busy mums', 'Make it funnier', 'Raya / festive theme', 'Push the price & promo', 'Younger Gen Z vibe', 'More premium feel'];

function brainResHTML(b) {
  const ML = { ad: 'Ad', video: 'Video', image: 'Image', talk: 'Talk', story: 'Story' };
  return `<p class="b-sum">${esc(b.summary)}</p>
    ${b.observations?.length ? `<div class="chips">${b.observations.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</div>` : ''}
    <div class="b-cols">
      <div><h3>Who it’s for</h3><p>${esc(b.audience)}</p><h3>Selling points</h3><ul>${b.sellingPoints.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h3>Hooks</h3><ul class="hooks">${b.hooks.map((x, i) => `<li><span>${esc(x)}</span><button class="link" data-hook="${i}">Copy</button></li>`).join('')}</ul></div>
    </div>
    <h3>Ideas to make now</h3>
    <div class="ideas">${b.ideas.map((x, i) => `<div class="idea"><span class="mtag">${ML[x.mode]}</span><b>${esc(x.title)}</b><p>${esc(x.why)}</p><button class="btn pri" data-idea="${i}">Use this idea</button></div>`).join('')}</div>`;
}

const chatHTML = (b, typing) => (b.chat || []).map((c) => `<div class="msg ${c.role}">${esc(c.text)}</div>`).join('')
  + (typing ? '<div class="msg ai typing"><i></i><i></i><i></i></div>' : '');

function showBrain(b, thumbs) {
  b.chat ||= [];
  const m = modal(`<div class="brain">
    <div class="b-head">${thumbs?.length ? `<div class="b-thumbs">${thumbs.map((u) => `<img src="${u}" alt="">`).join('')}</div>` : ''}
      <div><span class="eyebrow">Kravitas concluded</span><h2>Here’s what we see</h2></div></div>
    <div id="b-res">${brainResHTML(b)}</div>
    <div class="b-chat">
      <h3>Tell Kravitas more</h3>
      <p class="hint" style="margin:0">Add details only you know: who buys it, the promo, the vibe you want. Each reply reworks the hooks and ideas (1 credit).</p>
      <div class="b-thread" id="b-thread">${chatHTML(b)}</div>
      <div class="b-sugg">${BRAIN_SUGGEST.map((x) => `<button class="chip" data-sugg="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <form class="b-input" id="b-form"><input id="b-msg" class="in" maxlength="500" autocomplete="off" placeholder="e.g. My buyers are mums 30–45, there’s a 20% off code this week, keep it in BM">
        <button class="btn pri" id="b-send" type="submit">Send</button></form>
    </div>
  </div>`, 'wide');
  bindBrain(m, b);
  const send = async (text) => {
    text = text.trim();
    if (!text) return;
    const btn = $('#b-send', m), input = $('#b-msg', m);
    btn.disabled = true; input.value = '';
    b.chat.push({ role: 'user', text });
    const thread = $('#b-thread', m);
    thread.innerHTML = chatHTML(b, true);
    thread.scrollTop = thread.scrollHeight;
    try {
      const r = await api('/api/brainstorm', { ...b.ctx, chat: b.chat, previous: { summary: b.summary, audience: b.audience, sellingPoints: b.sellingPoints, hooks: b.hooks, ideas: b.ideas.map(({ title, mode, prompt }) => ({ title, mode, prompt })) } });
      Object.assign(b, r, { ctx: b.ctx, chat: b.chat });
      b.chat.push({ role: 'ai', text: r.reply || 'Updated the hooks and ideas below.' });
      const res = $('#b-res', m);
      res.innerHTML = brainResHTML(b);
      res.classList.remove('flash'); void res.offsetWidth; res.classList.add('flash');
      bindBrain(m, b);
      load().then(() => { $('#credits').textContent = `✦ ${S.app.credits.toLocaleString()}`; });
    } catch (e) {
      b.chat.pop();
      input.value = text;
      toast(e.message, true);
      if (e.code === 'credits' || e.code === 'plan') accountModal();
    }
    thread.innerHTML = chatHTML(b);
    thread.scrollTop = thread.scrollHeight;
    btn.disabled = false;
    input.focus();
  };
  $('#b-form', m).onsubmit = (e) => { e.preventDefault(); send($('#b-msg', m).value); };
  m.querySelectorAll('[data-sugg]').forEach((el) => (el.onclick = () => send(el.dataset.sugg)));
  const thread = $('#b-thread', m);
  thread.scrollTop = thread.scrollHeight;
}

function bindBrain(m, b) {
  m.querySelectorAll('[data-hook]').forEach((el) => (el.onclick = () => navigator.clipboard.writeText(b.hooks[+el.dataset.hook]).then(() => toast('Hook copied'), () => toast('Select the text to copy it', true))));
  m.querySelectorAll('[data-idea]').forEach((el) => (el.onclick = () => {
    const idea = b.ideas[+el.dataset.idea];
    setMode(idea.mode);
    const f = S.forms[idea.mode] || (S.forms[idea.mode] = DEFAULTS[idea.mode]());
    for (const k of BRAIN_KEYS[idea.mode]) {
      const v = idea.settings?.[k];
      const opts = pillOptions(k);
      if (v != null && opts && String(v) in opts) f[k] = /^\d+$/.test(String(v)) ? +v : v;
    }
    if (idea.prompt) f.prompt = idea.prompt;
    if (b.ctx.friendId && 'friendId' in f) f.friendId = b.ctx.friendId;
    if (b.ctx.productId && 'productId' in f && idea.mode !== 'talk' && idea.mode !== 'story') f.productId = b.ctx.productId;
    closeModal();
    renderAll();
    $('#prompt')?.focus();
    toast('Idea loaded. Check it and hit Generate');
  }));
}

function thumbOf(j) {
  const v = [...j.outputs].reverse().find((o) => o.type === 'video');
  const i = j.outputs.find((o) => o.type === 'image');
  return v ? { type: 'video', url: v.url } : i ? { type: 'image', url: i.url } : null;
}
function cardHTML(j) {
  const t = thumbOf(j);
  const ratio = (j.input?.aspect || (['ugc', 'avatar'].includes(j.tool) ? '9:16' : j.tool === 'avatarGen' ? '4/5' : '1:1')).replace(':', '/');
  const label = MODES[TOOL_MODE[j.tool]]?.label || TOOL_LABEL[j.tool] || j.tool;
  if (j.stage === 'review' && j.status === 'done') {
    const img = j.outputs.find((o) => o.type === 'image');
    return `<div class="card review" data-job="${j.id}">${img ? `<img src="${img.url}" loading="lazy" alt="">` : ''}<span class="tag">Draft</span><div class="rv"><b>Review & approve</b><small>Scripts + keyframe ready. Tap to edit and render.</small></div></div>`;
  }
  if (j.status === 'running' || j.status === 'error' || !t) {
    const cur = j.steps.find((s) => s.status === 'running') || j.steps[j.steps.length - 1];
    const pct = j.steps.length ? Math.round((j.steps.filter((s) => s.status === 'done').length / (j.steps.length + 1)) * 100) : 5;
    const st = j.status === 'error' ? `Failed: ${j.error || ''}` : j.status === 'running' ? `${cur?.label || 'Starting'}…${cur?.note ? ' · ' + cur.note : ''}` : j.outputs.some((o) => o.type === 'audio') ? '🎧 Audio ready · tap to play' : '📝 Script ready';
    return `<div class="card ${j.status === 'running' ? 'run' : j.status === 'error' ? 'err' : ''}" data-job="${j.id}"><div class="box" style="aspect-ratio:${ratio}"><span class="tag">${label}</span><b>${esc(j.title)}</b><span class="st">${esc(st)}</span>${j.status === 'running' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div></div>`;
  }
  const media = t.type === 'video' ? `<video src="${t.url}#t=0.3" muted loop playsinline preload="metadata"></video>` : `<img src="${t.url}" loading="lazy" alt="">`;
  return `<div class="card" data-job="${j.id}">${media}<span class="tag">${label}</span>${j.mock ? '<span class="tag demo">demo</span>' : ''}<div class="ov">${esc(j.title)}</div></div>`;
}
const sigs = new Map();
function renderFeed() {
  const feed = $('#feed');
  if (!S.jobs.length) {
    feed.innerHTML = `<div class="feed-h"><h2>Your creations</h2></div><div class="empty">${S.mode === 'home' ? 'Nothing yet. Your ads and videos will appear here.' : 'Nothing yet. Type a prompt below and hit Generate.'}</div>`;
    return;
  }
  if (!$('.grid', feed)) feed.innerHTML = `<div class="feed-h"><h2>Your creations</h2><span class="muted" id="cnt"></span></div><div class="grid"></div>`;
  const grid = $('.grid', feed);
  $('#cnt').textContent = `${S.jobs.length}`;
  const ids = new Set(S.jobs.map((j) => j.id));
  [...grid.children].forEach((c) => { if (!ids.has(c.dataset.job)) { c.remove(); sigs.delete(c.dataset.job); } });
  let prev = null;
  for (const j of S.jobs) {
    const sig = JSON.stringify([j.status, j.steps, j.outputs.length, j.error]);
    let el = grid.querySelector(`[data-job="${j.id}"]`);
    if (!el || sigs.get(j.id) !== sig) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHTML(j);
      const n = tmp.firstElementChild;
      el ? el.replaceWith(n) : null;
      el = n;
      sigs.set(j.id, sig);
    }
    if (prev ? prev.nextElementSibling !== el : grid.firstElementChild !== el) prev ? prev.after(el) : grid.prepend(el);
    prev = el;
  }
}

// ---------- composer ----------
function pill(key, label, options, cur) {
  const shown = options[cur] ?? cur;
  return `<button class="pill" data-pill="${key}"><span class="k">${label}</span>${esc(shown)} ▾</button>`;
}
const toggle = (key, label, on) => `<button class="pill tg ${on ? 'on' : ''}" data-toggle="${key}">${on ? '✓ ' : ''}${label}</button>`;
function pillOptions(key) {
  const c = S.app.catalog;
  const models = Object.fromEntries(Object.entries(c.videoModels).map(([k, m]) => [k, m.label]));
  return {
    model: models, camera: CAM, style: STYLE, lang: LANG, platform: PLATFORM,
    voice: voiceOptions(),
    tier: Object.fromEntries(Object.entries(c.tiers || {}).map(([k, t]) => [k, t.label])),
    variants: { 1: '1 ad', 3: '3 variations', 5: '5 variations' },
    kind: { tts: 'Voice-over', sfx: 'Sound effect', music: 'Music' },
    voiceEngine: { v3: 'ElevenLabs v3 · expressive', multilingual: 'ElevenLabs Multilingual' },
    emotion: Object.fromEntries((c.emotions || []).map((x) => [x, x[0].toUpperCase() + x.slice(1)])),
    length: F().kind === 'sfx' ? { 2: '2s', 5: '5s', 10: '10s', 20: '20s' } : { 15: '15s', 30: '30s', 60: '1 min', 120: '2 min' },
    aspect: { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1', '4:5': '4:5' },
    duration: { 5: '5s', 8: '8s', 10: '10s' },
    seconds: { 8: '8s', 10: '10s', 15: '15s', 20: '20s', 30: '30s' },
    count: { 1: '1', 2: '2', 4: '4' },
    scenes: { 3: '3', 4: '4', 5: '5', 6: '6' },
    format: { talking: 'Talking UGC', showcase: 'Showcase b-roll' },
    angle: { review: 'Honest review', problem: 'Problem → fix', unboxing: 'Unboxing', deal: 'Flash sale', beforeafter: 'Before & after', compare: 'Vs. pricey one' },
    textMode: { script: 'Exact script', topic: 'Topic → AI writes' },
  }[key];
}
const MODEL_SUB = () => Object.fromEntries(Object.entries(S.app.catalog.videoModels).map(([k, m]) => [k, `${m.tag} · ~${m.perSec} cr/s`]));
const TIER_SUB = () => Object.fromEntries(Object.entries(S.app.catalog.tiers || {}).map(([k, t]) => [k, `${t.tag} · ${TIER_COST[k] || ''}`]));
const TIER_COST = { motion: '≈ 9 cr per ad', lite: '≈ 32 cr', fast: '≈ 49 cr', studio: '≈ 170 cr', premium: '≈ 320 cr' };
// ---------- plan access (what the current plan unlocks) ----------
const RANK = { free: 0, basic: 1, starter: 2, creator: 3, pro: 4 };
const PLAN_LABEL = { basic: 'Basic', starter: 'Starter', creator: 'Creator', pro: 'Pro' };
const access = () => S.app?.access || 'free';
const canUse = (need) => (RANK[access()] ?? 0) >= (RANK[need] ?? 0);
function needFor(key, v) {
  const c = S.app.catalog;
  if (key === 'tier') return c.tiers?.[v]?.plan;
  if (key === 'model') return c.modelPlan?.[v];
  if (key === 'variants') return v > (c.maxVariants?.[access()] || 3) ? 'creator' : null;
  return null;
}
// Voices: ElevenLabs (el:), MiniMax with a Malay accent (mm:), and the user's own clones (clone:)
function voiceOptions() {
  const v = S.app.catalog.voices || {};
  const el = Array.isArray(v) ? v : v.el || [];
  return {
    ...Object.fromEntries((S.voices || []).map((x) => [`clone:${x.id}`, `★ ${x.name} (your voice)`])),
    ...Object.fromEntries((v.mm || []).map((x) => [`mm:${x}`, `${x.replace(/_/g, ' ')} · BM`])),
    ...Object.fromEntries(el.map((x) => [String(x).includes(':') ? x : `el:${x}`, x])),
  };
}
const voiceSub = (k) => (k.startsWith('clone:') ? 'Cloned voice' : k.startsWith('mm:') ? 'MiniMax · natural Bahasa Melayu' : 'ElevenLabs');

function renderComposer(keepFocus) {
  const f = F();
  const m = S.mode;
  const refs = [];
  const fr = friendById(f.friendId), pr = productById(f.productId);
  if (f.startImage) refs.push(`<span class="ref"><img src="${f.startImage}">Start frame<button data-unref="startImage">×</button></span>`);
  if (f.image) refs.push(`<span class="ref"><img src="${f.image}">Photo<button data-unref="image">×</button></span>`);
  if (fr) refs.push(`<span class="ref"><img src="${fr.photos[0]}">${esc(fr.name)}<button data-unref="friendId">×</button></span>`);
  if (pr) refs.push(`<span class="ref"><img src="${pr.image}">${esc(pr.name)}<button data-unref="productId">×</button></span>`);
  const needs = m === 'ad' && !pr ? '<button class="add req" data-attach>＋ Product</button>' : m === 'talk' && !fr && !f.image ? '<button class="add req" data-attach>＋ Who talks</button>' : '';
  const P = (k, l) => pill(k, l, pillOptions(k), f[k]);
  const pills = {
    video: [P('model', ''), P('aspect', ''), P('duration', ''), P('camera', '🎥'), f.startImage ? '' : P('style', ''), f.model !== 'h3-turbo' ? toggle('audio', 'Sound', f.audio) : ''],
    image: [P('aspect', ''), P('count', '×'), P('style', '')],
    ad: [P('format', ''), P('tier', '◆'), P('variants', '×'), P('angle', ''), P('platform', ''), P('lang', ''), P('seconds', ''), P('voice', '🎙'), toggle('approve', 'Approve first', f.approve), toggle('captions', 'Captions', f.captions)],
    talk: [P('textMode', ''), P('tier', '◆'), P('lang', ''), P('voice', '🎙'), f.textMode === 'topic' ? P('seconds', '') : '', toggle('captions', 'Captions', f.captions)],
    story: ['<button class="pill brainbtn" data-board title="Plan and edit the video scene by scene">🧩 Storyboard</button>', P('tier', '◆'), P('scenes', 'Scenes'), P('aspect', ''), P('style', ''), P('lang', ''), P('voice', '🎙'), f.tier === 'motion' ? '' : P('model', ''), toggle('captions', 'Captions', f.captions)],
    voice: [P('kind', ''), ...(f.kind === 'tts' ? [P('voice', '🎙'), String(f.voice).startsWith('el:') ? P('voiceEngine', '') : P('emotion', ''), P('lang', '')] : [P('length', '⏱')])],
  }[m].filter(Boolean).join('');
  const prompt = m === 'talk' && f.textMode === 'topic' ? 'What should they talk about?' : m === 'voice' && f.kind === 'sfx' ? 'Describe the sound… e.g. whoosh transition with a soft pop' : m === 'voice' && f.kind === 'music' ? 'Describe the track… e.g. upbeat lo-fi for a product video, no vocals' : PLACEHOLDER[m];
  const tags = m === 'voice' && f.kind === 'tts' && f.voiceEngine === 'v3' && String(f.voice).startsWith('el:')
    ? `<div class="tagrow">${['[excited]', '[whispers]', '[laughs]', '[sighs]', '[curious]', '[sarcastic]', '[pause]'].map((t) => `<button class="tagchip" data-tag="${t}">${t}</button>`).join('')}</div>` : '';
  $('#composer').innerHTML = `
    ${m === 'voice' ? tags : `<div class="refs">${refs.join('')}${needs}<button class="add" data-attach title="Add friend, product or image">＋</button></div>`}
    <textarea class="prompt" id="prompt" rows="1" placeholder="${esc(prompt)}">${esc(f.prompt)}</textarea>
    <div class="bar2">${pills}${m === 'voice' ? '' : `<button class="pill brainbtn" data-brain title="Let Kravitas study your photos and prompt">✨ Brainstorm${lastBrain ? '' : ' <span class="k">2 cr</span>'}</button>${lastBrain ? '<button class="pill" data-brain-last title="Show last brainstorm">↺</button>' : ''}`}<button class="go" id="go">Generate <span class="c" id="est">✦ …</span></button></div>`;
  autosize();
  if (keepFocus) $('#prompt').focus();
  estimate();
}
function autosize() {
  const t = $('#prompt');
  t.style.height = 'auto';
  t.style.height = Math.min(180, t.scrollHeight) + 'px';
}
let estT;
function estimate() {
  clearTimeout(estT);
  estT = setTimeout(async () => {
    try { const { credits } = await api('/api/estimate', { tool: MODES[S.mode].tool, input: payload() }); $('#est').textContent = `✦ ${credits}`; } catch { $('#est').textContent = ''; }
  }, 200);
}

function payload() {
  const f = { ...F() };
  if (S.mode === 'ad') { f.notes = f.prompt; delete f.prompt; }
  if (S.mode === 'talk') { if (f.textMode === 'topic') { f.topic = f.prompt; f.script = ''; } else f.script = f.prompt; delete f.prompt; }
  if (S.mode === 'voice') { f.text = f.prompt; delete f.prompt; }
  if (S.mode === 'ad') { f.draft = !!f.approve; delete f.approve; }
  return f;
}
function validate() {
  const f = F();
  if (S.mode === 'ad' && !f.productId) return 'Add a product first (＋ button)';
  if (S.mode === 'talk' && !f.friendId && !f.image) return 'Add a friend or a photo (＋ button)';
  if (S.mode !== 'ad' && !f.prompt.trim()) return S.mode === 'talk' ? 'Type what they should say' : S.mode === 'voice' ? (f.kind === 'tts' ? 'Type the voice-over text' : 'Describe the sound first') : 'Type a prompt first';
  return null;
}

async function generate() {
  const bad = validate();
  if (bad) return toast(bad, true);
  const btn = $('#go');
  btn.disabled = true;
  try {
    const job = await api('/api/jobs', { tool: MODES[S.mode].tool, input: payload() });
    S.jobs.unshift(job);
    renderFeed();
    $('#feed').scrollIntoView({ behavior: 'smooth' });
    poll();
    load().then(() => renderFeed());
  } catch (e) {
    toast(e.message, true);
    if (e.code === 'credits' || e.code === 'plan') accountModal();
  }
  btn.disabled = false;
}

// ---------- popovers ----------
function openPop(anchor, html, onPick) {
  const pop = $('#pop');
  pop.innerHTML = html;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
  pop.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
  pop.onclick = (e) => { const it = e.target.closest('[data-v]'); if (it) { onPick(it.dataset.v, e); } };
}
const closePop = () => { $('#pop').hidden = true; };

function pillMenu(anchor, key) {
  const opts = pillOptions(key);
  const sub = key === 'model' ? MODEL_SUB() : key === 'tier' ? TIER_SUB() : key === 'voice' ? Object.fromEntries(Object.keys(opts).map((k) => [k, voiceSub(k)])) : {};
  const cur = String(F()[key]);
  openPop(anchor, Object.entries(opts).map(([v, l]) => {
    const need = needFor(key, /^\d+$/.test(v) ? +v : v);
    const locked = need && !canUse(need);
    return `<button class="it ${v === cur ? 'on' : ''} ${locked ? 'locked' : ''}" data-v="${esc(v)}"><span>${esc(l)}${locked ? ` <em class="lock">🔒 ${PLAN_LABEL[need]}</em>` : ''}${sub[v] ? `<small>${sub[v]}</small>` : ''}</span></button>`;
  }).join(''), (v) => {
    const need = needFor(key, /^\d+$/.test(v) ? +v : v);
    if (need && !canUse(need)) { closePop(); toast(`${opts[v]} is on the ${PLAN_LABEL[need]} plan`); return accountModal(); }
    F()[key] = /^\d+$/.test(v) ? +v : v;
    closePop();
    renderComposer();
    renderPresets();
  });
}

function attachMenu(anchor) {
  const m = S.mode;
  const showProducts = m !== 'talk' && m !== 'story';
  const showUpload = m === 'video' || m === 'talk';
  const html = `
    <div class="h">Friends & avatars</div>
    <button class="it" data-v="new:avatars">🎭 Avatar library · pick an AI creator</button>
    <button class="it" data-v="new:create-avatar">✨ Create your own AI avatar</button>
    ${S.friends.map((f) => `<button class="it" data-v="f:${f.id}"><img src="${f.photos[0]}"><span>${esc(f.name)}</span><span class="x" data-del="f:${f.id}" title="Delete">🗑</span></button>`).join('')}
    <button class="it" data-v="new:friend">＋ New friend</button>
    ${showProducts ? `<hr><div class="h">Products</div>
    ${S.products.map((p) => `<button class="it" data-v="p:${p.id}"><img src="${p.image}"><span>${esc(p.name)}<small>${esc(p.price)}</small></span><span class="x" data-del="p:${p.id}" title="Delete">🗑</span></button>`).join('')}
    <button class="it" data-v="new:product">＋ New product</button>` : ''}
    ${showUpload ? `<hr><button class="it" data-v="upload">⬆ Upload ${m === 'talk' ? 'a photo' : 'a start frame'}</button>` : ''}`;
  openPop(anchor, html, async (v, e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const [t, id] = del.dataset.del.split(':');
      closePop();
      if (!(await confirmBox(`Delete this ${t === 'f' ? 'friend' : 'product'}?`))) return;
      await api(`/api/${t === 'f' ? 'friends' : 'products'}/${id}`, null, 'DELETE');
      await load();
      for (const fm of Object.values(S.forms)) { if (fm.friendId === id) fm.friendId = null; if (fm.productId === id) fm.productId = null; }
      closePop(); renderAll(); return;
    }
    closePop();
    const f = F();
    if (v.startsWith('f:')) { f.friendId = v.slice(2); f.image = null; }
    else if (v.startsWith('p:')) f.productId = v.slice(2);
    else if (v === 'new:friend') return friendModal();
    else if (v === 'new:avatars') return avatarLibraryModal();
    else if (v === 'new:create-avatar') return avatarBuilderModal();
    else if (v === 'new:product') return productModal();
    else if (v === 'upload') return pickFile(async (file) => {
      const { url } = await api('/api/upload', { dataUrl: await fileToDataUrl(file) });
      if (m === 'talk') { f.image = url; f.friendId = null; } else f.startImage = url;
      renderComposer();
    });
    renderComposer();
  });
}

function pickFile(cb, multiple) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = 'image/*'; i.multiple = !!multiple;
  i.onchange = () => i.files.length && cb(multiple ? [...i.files] : i.files[0]);
  i.click();
}
async function fileToDataUrl(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // WebP keeps transparency (product cut-outs) and stays small enough for serverless upload limits (~4 MB)
    return file.type === 'image/png' ? c.toDataURL('image/webp', 0.9) : c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- modals ----------
function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${cls}"><button class="close" data-close>✕</button>${html}</div>`;
  m.hidden = false;
  m.querySelectorAll('video').forEach((v) => v.play().catch(() => {}));
  return m;
}
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };

function friendModal() {
  let photos = [];
  const m = modal(`<h2>New friend</h2><p class="muted" style="margin:0">1–3 clear photos of the same face. They stay consistent in everything you make.</p>
    <label class="l">Name</label><input class="in" id="fn" placeholder="Aisyah">
    <label class="l">Photos</label><label class="drop" id="fdrop">⬆ Choose photos</label><div class="pvs" id="fpv"></div>
    <label class="check" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:13px"><input type="checkbox" id="fok" style="margin-top:3px"> <span>These are photos of me, or I have this person's permission to use their face. No minors. <a href="/terms" target="_blank">Terms</a></span></label>
    <div class="acts" style="margin-top:14px"><button class="btn pri" id="fsave">Save friend</button></div>`);
  $('#fdrop', m).onclick = () => pickFile(async (files) => {
    photos = await Promise.all(files.slice(0, 3).map((x) => fileToDataUrl(x, 1024)));
    $('#fpv', m).innerHTML = photos.map((p) => `<img src="${p}">`).join('');
  }, true);
  $('#fsave', m).onclick = async (e) => {
    try {
      e.target.disabled = true;
      if (!$('#fok', m).checked) { toast('Please confirm you have permission to use these photos', true); e.target.disabled = false; return; }
      const fr = await api('/api/friends', { name: $('#fn', m).value, photos, consent: true });
      await load();
      F().friendId = fr.id;
      closeModal(); renderAll(); toast(`${fr.name} added`);
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function productModal() {
  let image = null;
  const m = modal(`<h2>New product</h2>
    <label class="l">Photo</label><label class="drop" id="pdrop">⬆ Product photo</label><div class="pvs" id="ppv"></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px"><input type="checkbox" id="cut"> Remove background (1 cr)</label>
    <label class="l">Name</label><input class="in" id="pn" placeholder="Glow Serum 30ml">
    <label class="l">Price</label><input class="in" id="pp" placeholder="RM39">
    <label class="l">Selling points</label><textarea class="in" id="pb" placeholder="Brightens in 7 days, halal, free shipping"></textarea>
    <div class="acts" style="margin-top:14px"><button class="btn pri" id="psave">Save product</button></div>`);
  $('#pdrop', m).onclick = () => pickFile(async (file) => { image = await fileToDataUrl(file); $('#ppv', m).innerHTML = `<img src="${image}">`; });
  $('#psave', m).onclick = async (e) => {
    try {
      e.target.disabled = true;
      e.target.textContent = 'Saving…';
      const p = await api('/api/products', { name: $('#pn', m).value, price: $('#pp', m).value, benefits: $('#pb', m).value, image, cutout: $('#cut', m).checked });
      await load();
      F().productId = p.id;
      closeModal(); renderAll(); toast(`${p.name} added`);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Save product'; }
  };
}

const dl = (u) => (u.includes('/storage/v1/object/public/') ? u + '?download=' : u);
function jobModal(id) {
  const j = S.jobs.find((x) => x.id === id);
  if (!j) return;
  const media = j.outputs.filter((o) => o.url && o.type !== 'audio').reverse();
  const audios = j.outputs.filter((o) => o.url && o.type === 'audio');
  if (!media.length && audios.length) media.push(...audios);
  const show = (o) => (o.type === 'video' ? `<video src="${o.url}" controls autoplay loop playsinline></video>` : o.type === 'audio' ? `<div class="aud"><div class="wave">${'<i></i>'.repeat(32)}</div><audio src="${o.url}" controls autoplay></audio></div>` : `<img src="${o.url}" alt="">`);
  const first = media[0];
  const review = j.stage === 'review' && j.status === 'done' && j.draftData?.plans?.length;
  const m = modal(`
    <div class="view" id="jv">${first ? show(first) : '<div class="muted">No media yet</div>'}</div>
    <div class="info">
      <h3>${esc(j.title)}</h3>
      <div class="muted" style="font-size:12px">${MODES[TOOL_MODE[j.tool]]?.label || j.tool} · ${new Date(j.createdAt).toLocaleString()} ${j.cost ? `· ✦ ${j.cost}` : ''} ${j.mock ? '· demo' : ''}</div>
      ${media.length > 1 ? `<div class="thumbs">${media.map((o, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}" title="${esc(o.label || '')}">${o.type === 'video' ? `<video src="${o.url}#t=0.3" muted preload="metadata"></video>` : o.type === 'audio' ? '<span class="ai">♪</span>' : `<img src="${o.url}">`}${o.label ? `<em>${esc(o.label)}</em>` : ''}</button>`).join('')}</div>` : ''}
      ${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}
      ${j.status !== 'done' ? `<ul class="steps">${j.steps.map((s) => `<li class="${s.status}">${esc(s.label)}</li>`).join('')}</ul>` : ''}
      ${review ? `<div class="review-box"><b>Review before rendering</b><small>Edit any script, then approve. Nothing is rendered until you do.</small>${j.draftData.plans.map((pl, k) => `<label>${j.draftData.plans.length > 1 ? `V${k + 1} · ${esc(j.draftData.angles?.[k] || '')}` : 'Script'}<textarea data-sc="${k}" rows="4">${esc(pl.script || '')}</textarea></label>`).join('')}<button class="btn pri" id="approve">Approve & render <span id="apc"></span></button></div>` : j.text ? `<div class="txt" id="jt">${esc(j.text)}</div>` : ''}
      <div class="acts">
        ${first ? `<a class="btn pri" id="dl" href="${dl(first.url)}" download>⬇ Download</a>` : ''}
        ${j.text ? '<button class="btn" id="cp">Copy text</button>' : ''}
        ${first?.type === 'image' && j.tool !== 'avatarGen' ? '<button class="btn" id="anim">🎬 Animate</button>' : ''}
        ${j.tool === 'avatarGen' && !j.input?.preset && j.status === 'done' ? '<button class="btn pri" id="saveav">＋ Save as friend</button>' : ''}
        ${media.some((o) => o.type === 'video') && j.status === 'done' ? '<button class="btn" id="post">📤 Post / schedule</button>' : ''}
        ${j.tool === 'story' && j.status === 'done' && j.board ? '<button class="btn" id="board">🧩 Edit storyboard</button>' : ''}
        <button class="btn" id="reuse">↺ Reuse settings</button>
        <button class="btn danger" id="del">🗑 Delete</button>
      </div>
    </div>`, 'big');
  let cur = first;
  if (review) {
    const body = () => ({ tool: 'ugc', input: { ...j.input, draft: false, fromDraft: j.id, scripts: [...m.querySelectorAll('[data-sc]')].map((t) => t.value) } });
    api('/api/estimate', body()).then(({ credits }) => { $('#apc', m).textContent = `✦ ${credits}`; }, () => {});
    $('#approve', m).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const job = await api('/api/jobs', body());
        S.jobs.unshift(job); closeModal(); renderFeed(); poll(); load().then(() => renderFeed());
        toast('Approved. Rendering your ad…');
      } catch (err) {
        toast(err.message, true); e.target.disabled = false;
        if (err.code === 'credits' || err.code === 'plan') accountModal();
      }
    };
  }
  m.querySelector('.thumbs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    cur = media[+b.dataset.i];
    $('#jv', m).innerHTML = show(cur);
    $('#dl', m).href = dl(cur.url);
    m.querySelectorAll('.thumbs button').forEach((x) => x.classList.toggle('on', x === b));
    const a = $('#anim', m); if (a) a.style.display = cur.type === 'image' ? '' : 'none';
  });
  $('#saveav', m) && ($('#saveav', m).onclick = () => saveAvatarFromJob(j, cur));
  $('#post', m) && ($('#post', m).onclick = () => postModal(j, cur?.type === 'video' ? cur : media.find((o) => o.type === 'video')));
  $('#board', m) && ($('#board', m).onclick = () => storyboardModal({ board: j.board, reuseFrom: j.id, input: j.input }));
  $('#cp', m) && ($('#cp', m).onclick = () => navigator.clipboard.writeText(j.text).then(() => toast('Copied'), () => toast('Select the text to copy it', true)));
  $('#anim', m) && ($('#anim', m).onclick = () => { setMode('video'); F().startImage = cur.url; closeModal(); renderComposer(true); });
  $('#reuse', m).onclick = () => {
    const mode = TOOL_MODE[j.tool];
    if (!MODES[mode]?.tool) { toast('Nothing to reuse for this one'); return; }
    setMode(mode);
    const i = { ...j.input };
    if (mode === 'ad') i.prompt = i.notes || '';
    if (mode === 'talk') { i.prompt = i.script || i.topic || ''; i.textMode = i.script ? 'script' : 'topic'; }
    if (mode === 'voice') i.prompt = i.text || '';
    S.forms[mode] = { ...DEFAULTS[mode](), ...i };
    closeModal(); renderAll();
  };
  $('#del', m).onclick = async () => {
    if (!(await confirmBox('Delete this creation and its files?'))) return;
    await api('/api/jobs/' + j.id, null, 'DELETE');
    S.jobs = S.jobs.filter((x) => x.id !== j.id);
    closeModal(); renderFeed();
  };
}

const ledgerTable = (ledger) => `<table>${ledger.slice(0, 12).map((l) => `<tr><td>${new Date(l.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(l.what)}</td><td class="n" style="color:${l.credits > 0 ? 'var(--ok)' : 'inherit'}">${l.credits > 0 ? '+' : ''}${l.credits}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet</td></tr>'}</table>`;

async function accountModal() {
  await load();
  const a = S.app;
  const ledger = await api('/api/ledger');
  if (a.mode === 'local') return localSettings(a, ledger);
  return creditsModal(a, ledger);
  const packs = CFG.packs || [];
  const m = modal(`<h2>Credits</h2>
    <p style="font-size:38px;font-weight:800;letter-spacing:-.04em;margin:6px 0 2px">✦ ${a.credits.toLocaleString()}</p>
    <p class="muted" style="margin:0">A 15s talking ad is about 250 credits, an image about 8, a 5s video about 18.</p>
    ${CFG.payments ? `<label class="l" style="margin-top:20px">Top up</label>
    <div class="packs">${packs.map((p) => `<button class="pack" data-pack="${esc(p.id)}">${p.tag ? `<span class="ptag">${esc(p.tag)}</span>` : ''}<b>${p.credits.toLocaleString()}</b><small>credits</small><span class="price">${CFG.currency === "MYR" ? "RM" : esc(CFG.currency) + " "}${p.price}</span></button>`).join('')}</div>
    <p class="hint">Secure checkout by Stripe: card, FPX online banking, GrabPay.</p>` : '<p class="hint" style="margin-top:14px">Top-ups are coming soon.</p>'}
    ${a.mode === 'preview' ? '<p class="hint">Preview: buttons show the real checkout layout, but payments are switched off. <a href="#" id="reset">Reset preview data</a></p>' : ''}
    <p class="hint">You're using a guest account on this browser. Clearing your browser data loses it. Account ID: <code style="user-select:all">${esc(a.userId)}</code></p>
    <label class="l" style="margin-top:18px">Activity</label>${ledgerTable(ledger)}
    <p class="hint" style="margin-top:14px"><a href="/terms" target="_blank">Terms</a> · <a href="/privacy" target="_blank">Privacy</a></p>`);
  $('#reset', m) && ($('#reset', m).onclick = (e) => { e.preventDefault(); confirmBox('Clear all preview friends, products and creations?', 'Clear').then((ok) => ok && window.PreviewAPI.reset()); });
  m.querySelectorAll('[data-pack]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const { url } = await api('/api/checkout', { pack: b.dataset.pack }); location.href = url; } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

function localSettings(a, ledger) {
  const m = modal(`<h2>Settings</h2>
    <p class="muted" style="margin:0 0 6px">${a.mock ? '🧪 Demo mode: no fal.ai key yet.' : '✅ fal.ai connected'}</p>
    <label class="l">fal.ai API key</label><input class="in" id="key" type="password" placeholder="${a.mock ? 'paste key' : 'paste a new key to replace'}" autocomplete="off">
    <p class="hint">Get it at <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener">fal.ai/dashboard/keys</a>. Stored only on this computer.</p>
    <label class="l">Script AI model</label><input class="in" id="llm" value="${esc(a.llmModel)}">
    <div class="acts" style="margin-top:12px"><button class="btn pri" id="sv">Save</button>${a.mock ? '' : '<button class="btn danger" id="dc">Disconnect</button>'}</div>
    <label class="l" style="margin-top:22px">Credits · ✦ ${a.credits.toLocaleString()}</label>
    <p class="hint" style="margin-top:0">Local mode: a budget tracker. 1 credit ≈ US$0.01 of fal.ai usage.</p>
    <div class="acts"><button class="btn" data-add="500">+500</button><button class="btn" data-add="2000">+2,000</button></div>
    <label class="l" style="margin-top:22px">Activity</label>${ledgerTable(ledger)}`);
  $('#sv', m).onclick = async () => {
    const body = { llmModel: $('#llm', m).value };
    if ($('#key', m).value.trim()) body.falKey = $('#key', m).value.trim();
    await api('/api/settings', body);
    toast('Saved'); closeModal(); await load(); renderAll();
  };
  $('#dc', m) && ($('#dc', m).onclick = async () => { await api('/api/settings', { falKey: '' }); toast('Back to demo mode'); closeModal(); await load(); renderAll(); });
  m.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => { await api('/api/settings', { addCredits: +b.dataset.add }); toast(`+${b.dataset.add} credits`); accountModal(); }));
}

// ---------- polling ----------
let pollT = null;
function poll() {
  if (pollT) return;
  pollT = setInterval(async () => {
    const running = S.jobs.filter((j) => j.status === 'running');
    if (!running.length) { clearInterval(pollT); pollT = null; return; }
    for (const r of running) {
      try {
        const j = await api('/api/jobs/' + r.id);
        const k = S.jobs.findIndex((x) => x.id === j.id);
        if (k >= 0) S.jobs[k] = j;
        if (j.status !== 'running') {
          toast(j.status === 'done' ? `✓ ${j.title}` : `Failed: ${j.error}`, j.status !== 'done');
          load().then(renderFeed);
        }
      } catch { /* server busy */ }
    }
    renderFeed();
    if (S.mode === 'home' && typeof homeTick === 'function') homeTick();
  }, 2000);
}

// ---------- events ----------
function setMode(m) {
  S.mode = m;
}
function renderAll() {
  renderTabs();
  const page = MODES[S.mode]?.page;
  document.body.dataset.view = S.mode;
  $('.composer-wrap').hidden = !!page;
  if (S.mode === 'home') renderHome();
  else if (S.mode === 'schedule') renderSchedule();
  else { renderPresets(); renderComposer(); }
  $('#feed').hidden = S.mode === 'schedule';
  renderFeed();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!$('#pop').hidden && !t.closest('#pop') && !t.closest('[data-pill],[data-attach]')) closePop();
  const mode = t.closest('[data-mode]');
  if (mode) { e.preventDefault(); setMode(mode.dataset.mode); renderAll(); return; }
  if (t.closest('[data-open="settings"]')) return accountModal();
  const nw = t.closest('[data-new]');
  if (nw) return nw.dataset.new === 'friend' ? friendModal() : productModal();
  if (t.closest('[data-close]') || t.id === 'modal') return closeModal();
  const pl = t.closest('[data-pill]');
  if (pl) return pillMenu(pl, pl.dataset.pill);
  const tg = t.closest('[data-toggle]');
  if (tg) { F()[tg.dataset.toggle] = !F()[tg.dataset.toggle]; return renderComposer(); }
  const at = t.closest('[data-attach]');
  if (at) return attachMenu(at);
  const un = t.closest('[data-unref]');
  if (un) { F()[un.dataset.unref] = null; return renderComposer(); }
  if (t.closest('#go')) return generate();
  if (t.closest('[data-board]')) return storyboardModal({ input: F() });
  const tc = t.closest('[data-tag]');
  if (tc) { const ta = $('#prompt'); const at = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, at) + tc.dataset.tag + ' ' + ta.value.slice(at); F().prompt = ta.value; ta.focus(); estimate(); return; }
  const go = t.closest('[data-go]');
  if (go) { e.preventDefault(); closeModal(); setMode(go.dataset.go); renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const act = t.closest('[data-act]');
  if (act) { e.preventDefault(); closeModal(); return ACTIONS[act.dataset.act]?.(); }
  if (t.closest('[data-brain]')) return runBrainstorm();
  if (t.closest('[data-brain-last]') && lastBrain) return showBrain(lastBrain, [friendById(lastBrain.ctx.friendId)?.photos?.[0], productById(lastBrain.ctx.productId)?.image].filter(Boolean));
  if (t.closest('[data-guide-hide]')) { flag('if-guide-hidden', true); return S.mode === 'home' ? renderHome() : renderPresets(); }
  if (t.closest('[data-guide-show]')) { flag('if-guide-hidden', false); if (MODES[S.mode].page && S.mode !== 'home') setMode('home'); renderAll(); return $('#presets').scrollIntoView({ behavior: 'smooth' }); }
  const rl = t.closest('[data-rail]');
  if (rl) { const st = $('#strip'); return st.scrollBy({ left: +rl.dataset.rail * st.clientWidth * 0.8, behavior: 'smooth' }); }
  const pr = t.closest('[data-preset]');
  if (pr) {
    const p = PRESETS[S.mode].find((x) => x.id === pr.dataset.preset);
    if (p.action === 'clone') return voiceCloneModal();
    const f = F();
    Object.assign(f, p.set);
    if (S.mode === 'image' && (p.id === 'hold' || p.id === 'thumb') && !f.friendId) f.friendId = S.friends[0]?.id || null;
    if (S.mode === 'image' && !f.productId && ['studio', 'life', 'flat', 'festive'].includes(p.id)) f.productId = S.products[0]?.id || null;
    S.preset[S.mode] = p.id;
    renderPresets(); renderComposer(true);
    return;
  }
  const card = t.closest('[data-job]');
  if (card) return jobModal(card.dataset.job);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'prompt') { F().prompt = e.target.value; autosize(); estimate(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePop(); closeModal(); }
  if (e.target.id === 'prompt' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
});
document.addEventListener('mouseover', (e) => { const v = e.target.closest('.card video'); if (v) v.play().catch(() => {}); });
document.addEventListener('mouseout', (e) => { const v = e.target.closest('.card video'); if (v) v.pause(); });

(async () => {
  try {
    await initSession();
    await load();
    const q = new URLSearchParams(location.search);
    if (q.get('paid') || q.get('cancelled')) {
      history.replaceState(null, '', '/');
      if (q.get('paid')) {
        try {
          const r = await api('/api/checkout/verify', { sessionId: q.get('paid') });
          if (r.paid) { await load(); toast(`✓ Payment received, ${Number(r.credits).toLocaleString()} credits added`); } else toast('Payment is processing. Credits appear once it clears.');
        } catch (e) { toast(e.message, true); }
      } else toast('Checkout cancelled');
    }
    renderAll();
    if (S.jobs.some((j) => j.status === 'running')) poll();
  } catch (e) {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    $('#main').innerHTML = `<div class="empty" style="margin-top:60px">😵 ${esc(e.message)}${local ? '<br><br>Is the server running? Start it with <b>start.bat</b>.' : ''}</div>`;
  }
})();
