/* Preview mode: a fake backend that runs entirely in the browser, so the site can be
   clicked through with no servers, keys or payments. Friends, products and creations are
   kept in this browser only (localStorage + IndexedDB). Images are drawn on a canvas and
   videos are recorded from a canvas animation of your own photos. */
(() => {
  const LS = 'if-preview-v1';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const err = (msg, code) => Object.assign(new Error(msg), { code });

  // ---------- catalog (mirrors the server; credits = cost in US cents x 1.9) ----------
  const MARKUP = 1.9;
  const credits = (c) => Math.max(1, Math.ceil(c * MARKUP));
  const VIDEO_MODELS = {
    'h3-turbo': { label: 'MiniMax H3 Turbo', tag: 'Best value', cps: 1.5 },
    'seedance-fast': { label: 'Seedance 2.0 Fast', tag: 'Native audio', cps: 10 },
    'kling-std': { label: 'Kling 3.0 Standard', tag: 'Smooth motion', cps: 8 },
    'kling-pro': { label: 'Kling 3.0 Pro', tag: 'Top quality', cps: 14 },
  };
  for (const m of Object.values(VIDEO_MODELS)) m.perSec = Math.ceil(m.cps * MARKUP * 10) / 10;
  const TIERS = {
    motion: { label: 'Motion', tag: 'Animated still + voice, no AI video', image: 'lite', voice: 'turbo', maxSec: 30, talk: 0, show: 0, plan: 'free' },
    lite: { label: 'Lite', tag: 'Cheap AI video, up to 8s', image: 'lite', voice: 'turbo', maxSec: 8, talk: 1.5, show: 1.5, plan: 'starter' },
    fast: { label: 'Fast', tag: 'Sharper image, up to 10s', image: 'full', voice: 'hd', maxSec: 10, talk: 1.5, show: 1.5, plan: 'starter' },
    studio: { label: 'Studio', tag: 'Real lip-sync (VEED) · Kling', image: 'full', voice: 'hd', maxSec: 30, talk: 8, show: 8, plan: 'creator' },
    premium: { label: 'Premium', tag: 'OmniHuman 720p · Kling Pro', image: 'full', voice: 'hd', maxSec: 30, talk: 16, show: 14, plan: 'pro' },
  };
  const tierOf = (k) => TIERS[k] || TIERS.lite;
  const RANK = { free: 0, basic: 1, starter: 2, creator: 3, pro: 4 };
  const MODEL_PLAN = { 'h3-turbo': 'starter', 'seedance-fast': 'creator', 'kling-std': 'creator', 'kling-pro': 'pro' };
  const MAX_VARIANTS = { free: 3, basic: 3, starter: 3, creator: 5, pro: 5 };
  const PLAN_NAME = { basic: 'Basic', starter: 'Starter', creator: 'Creator', pro: 'Pro' };
  const PLAN_CREDITS = { basic: 600, starter: 1000, creator: 2500, pro: 6500 };
  const PRICE = { image: credits(8), imageLite: credits(3), imageSchnell: credits(0.5), llm: credits(0.5), removeBg: credits(1), voiceClone: credits(100) };
  const VOICES = {
    el: ['Aria', 'Sarah', 'Laura', 'Charlotte', 'Alice', 'Matilda', 'Jessica', 'Lily', 'Roger', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Bill'],
    mm: ['Lively_Girl', 'Friendly_Person', 'Calm_Woman', 'Sweet_Girl_2', 'Exuberant_Girl', 'Wise_Woman', 'Casual_Guy', 'Deep_Voice_Man', 'Patient_Man', 'Decent_Boy', 'Elegant_Man', 'Determined_Man'],
  };
  const EMOTIONS = ['neutral', 'happy', 'surprised', 'sad', 'angry'];
  const AVATARS = [
    { id: 'aisyah', name: 'Aisyah', tagline: 'Beauty & skincare', look: { gender: 'woman', age: '20s', skin: 'warm tan', hair: 'pastel hijab', style: 'soft glam, friendly smile', outfit: 'cream blouse', bg: 'bright bedroom vanity' } },
    { id: 'mei', name: 'Mei', tagline: 'Tech & gadgets', look: { gender: 'woman', age: '20s', skin: 'fair', hair: 'shoulder-length black bob', style: 'clean, confident', outfit: 'black tee', bg: 'minimal desk setup with soft LED light' } },
    { id: 'hafiz', name: 'Hafiz', tagline: 'Food & kopitiam', look: { gender: 'man', age: '30s', skin: 'medium brown', hair: 'short black hair, light beard', style: 'cheerful, energetic', outfit: 'casual polo', bg: 'busy Malaysian night market' } },
    { id: 'priya', name: 'Priya', tagline: 'Fashion & lifestyle', look: { gender: 'woman', age: '20s', skin: 'deep brown', hair: 'long wavy black hair', style: 'stylish, expressive', outfit: 'pastel kurta-inspired top', bg: 'sunny cafe' } },
    { id: 'rosnah', name: 'Puan Rosnah', tagline: 'Mum & home', look: { gender: 'woman', age: '40s', skin: 'warm tan', hair: 'navy hijab', style: 'warm, trustworthy, motherly', outfit: 'floral baju kurung', bg: 'cosy kitchen' } },
    { id: 'jason', name: 'Jason', tagline: 'Fitness & health', look: { gender: 'man', age: '20s', skin: 'fair', hair: 'short fade', style: 'sporty, motivating', outfit: 'gym tank top', bg: 'bright gym' } },
    { id: 'arif', name: 'Arif', tagline: 'Auto & men’s gear', look: { gender: 'man', age: '30s', skin: 'medium brown', hair: 'short black hair', style: 'calm, credible', outfit: 'denim jacket', bg: 'garage with a car' } },
    { id: 'nurul', name: 'Nurul', tagline: 'Gen Z trends', look: { gender: 'woman', age: 'early 20s', skin: 'light tan', hair: 'black hijab', style: 'playful, Gen Z energy', outfit: 'oversized hoodie', bg: 'colourful room with fairy lights' } },
  ];
  const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
  const vsec = (m, d) => credits((VIDEO_MODELS[m] || VIDEO_MODELS['h3-turbo']).cps * clampN(d, 2, 10));
  const tts$ = (text, q = 'hd') => credits((String(text || '').length / 1000) * (q === 'turbo' ? 6 : 10));
  const tsec = (k, sec) => Math.min(tierOf(k).maxSec, Math.max(2, sec || 8));
  const talk$ = (k, sec) => { const t = tierOf(k); return t.talk ? credits(t.talk * tsec(k, sec)) : 0; };
  const show$ = (k, sec) => { const t = tierOf(k); return t.show ? credits(t.show * Math.min(10, tsec(k, sec))) : 0; };
  const img$ = (q, refs = true) => (q === 'lite' ? (refs ? PRICE.imageLite : PRICE.imageSchnell) : PRICE.image);
  const words = (sec) => 'x'.repeat(Math.round(sec * 14));
  const ESTIMATE = {
    image: (i) => PRICE.image * (i.count || 1),
    shot: (i) => (i.startImage ? 0 : PRICE.image) + vsec(i.model, i.duration || 5),
    ugc: (i) => {
      const t = tierOf(i.tier), n = [1, 3, 5].includes(i.variants) ? i.variants : 1;
      const sec = i.format === 'talking' ? tsec(i.tier, i.seconds) : i.seconds || 15;
      const prep = n * PRICE.llm + img$(t.image, true);
      const render = n * (tts$(words(sec), t.voice) + (i.format === 'talking' ? talk$(i.tier, sec) : show$(i.tier, sec)));
      return i.draft ? prep : i.fromDraft ? render : prep + render;
    },
    avatar: (i) => { const t = tierOf(i.tier); const w = String(i.script || '').trim().split(/\s+/).filter(Boolean).length; const sec = w ? Math.max(3, w / 2.6) : i.seconds || 8; return (i.script ? 0 : PRICE.llm) + tts$(i.script || words(sec), t.voice) + talk$(i.tier, sec); },
    story: (i) => { const t = tierOf(i.tier || 'motion'); const sc = i.board?.scenes; const n = sc?.length || i.scenes || 4; return (sc ? 0 : PRICE.llm) + (sc ? sc.reduce((a, x) => a + tts$(x.narration, t.voice), 0) : n * tts$(words(7), t.voice)) + n * (img$(t.image, false) + (i.tier === 'motion' || !i.tier ? 0 : vsec(i.model, 6))); },
    voice: (i) => (i.kind === 'sfx' ? credits(0.2 * (i.length || 5)) : i.kind === 'music' ? credits(1 * (i.length || 30)) : tts$(i.text || 'x')),
    avatarGen: (i) => PRICE.image * (i.preset ? 1 : Math.min(4, i.count || 4)),
  };

  // ---------- persistence ----------
  let st;
  try { st = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { st = null; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch { /* storage full: keep in memory */ } };

  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('if-preview', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('media');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const memBlobs = new Map();
  async function putBlob(blob) {
    const key = id();
    memBlobs.set(key, blob);
    try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('media', 'readwrite'); t.objectStore('media').put(blob, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch { /* memory only */ }
    return 'idb:' + key;
  }
  async function getBlob(key) {
    if (memBlobs.has(key)) return memBlobs.get(key);
    try {
      const db = await idb();
      const b = await new Promise((res) => { const q = db.transaction('media').objectStore('media').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (b) memBlobs.set(key, b);
      return b;
    } catch { return null; }
  }
  async function delBlob(key) {
    memBlobs.delete(key);
    try { const db = await idb(); db.transaction('media', 'readwrite').objectStore('media').delete(key); } catch {}
  }
  const urlCache = new Map();
  async function resolveUrl(u) {
    if (!u || !u.startsWith('idb:')) return u;
    const k = u.slice(4);
    if (urlCache.has(k)) return urlCache.get(k);
    const b = await getBlob(k);
    const url = b ? URL.createObjectURL(b) : '';
    urlCache.set(k, url);
    return url;
  }
  async function viewJob(j) {
    const outputs = await Promise.all(j.outputs.map(async (o) => ({ ...o, url: await resolveUrl(o.url) })));
    return { ...j, outputs: outputs.filter((o) => o.url !== '' || o.type === 'text') };
  }

  // ---------- drawing ----------
  const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const SIZE = { '9:16': [540, 960], '16:9': [960, 540], '1:1': [720, 720], '4:5': [576, 720] };
  const STYLE_TINT = { studio: [40, 12, 92], ugc: [30, 35, 70], photo: [210, 40, 55], cinematic: [200, 55, 35], '3d': [270, 70, 60], anime: [320, 80, 60], clay: [25, 55, 60], storybook: [45, 60, 80] };

  function cover(ctx, img, x, y, w, h, zoom = 1, dx = 0, dy = 0) {
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2 + dx, y + (h - ih) / 2 + dy, iw, ih);
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  function drawScene(ctx, W, H, seed, style) {
    const [th, ts, tl] = STYLE_TINT[style] || STYLE_TINT.photo;
    const h = (hash(seed) + th) % 360;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (style === 'studio') { g.addColorStop(0, `hsl(${h},30%,92%)`); g.addColorStop(1, `hsl(${h},25%,80%)`); }
    else { g.addColorStop(0, `hsl(${h},${ts}%,${Math.min(75, tl + 15)}%)`); g.addColorStop(1, `hsl(${(h + 50) % 360},${ts}%,${Math.max(8, tl - 35)}%)`); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (style !== 'studio') {
      ctx.fillStyle = `hsla(${(h + 30) % 360},100%,88%,.9)`; ctx.beginPath(); ctx.arc(W * 0.72, H * 0.28, Math.min(W, H) * 0.08, 0, 7); ctx.fill();
      ctx.fillStyle = `hsl(${(h + 40) % 360},35%,12%)`; ctx.beginPath(); ctx.moveTo(0, H);
      [[0, .62], [.2, .5], [.4, .6], [.6, .46], [.8, .6], [1, .52], [1, 1]].forEach(([x, y]) => ctx.lineTo(W * x, H * y)); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.ellipse(W / 2, H * 0.82, W * 0.3, H * 0.03, 0, 0, 7); ctx.fill();
    }
  }

  async function compose({ prompt, friend, product, aspect = '9:16', style = 'photo', label }) {
    const [W, H] = SIZE[aspect] || SIZE['9:16'];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    drawScene(ctx, W, H, prompt, style);
    const [fi, pi] = await Promise.all([loadImg(friend?.photos?.[0]), loadImg(product?.image)]);
    if (fi) {
      const fw = W * (pi ? 0.62 : 0.7), fh = Math.min(H * 0.72, fw * 1.35);
      const fx = (W - fw) / 2 - (pi ? W * 0.08 : 0), fy = H - fh - H * 0.06;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40;
      rr(ctx, fx, fy, fw, fh, 28); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
      ctx.save(); rr(ctx, fx, fy, fw, fh, 28); ctx.clip(); cover(ctx, fi, fx, fy, fw, fh); ctx.restore();
    }
    if (pi) {
      const pw = W * (fi ? 0.34 : 0.55), ph = pw * (pi.height / pi.width);
      const px = fi ? W - pw - W * 0.07 : (W - pw) / 2, py = fi ? H - ph - H * 0.1 : H * 0.8 - ph;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
      ctx.drawImage(pi, px, py, pw, ph); ctx.restore();
    }
    if (!fi && !pi) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = `600 ${Math.round(W / 22)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
      wrap(ctx, prompt || 'Your scene', W / 2, H * 0.5, W * 0.8, W / 16).forEach(([t, y]) => { ctx.fillStyle = '#fff'; ctx.fillText(t, W / 2, y); });
    }
    tag(ctx, W, label || 'PREVIEW');
    return c;
  }
  function tag(ctx, W, text) {
    ctx.font = `700 ${Math.round(W / 40)}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(ctx, W - w - 12, 12, w, W / 40 + 14, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(text, W - w - 3, 12 + W / 40 + 4);
  }
  function wrap(ctx, text, x, y, maxW, lh) {
    const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines.slice(0, 4).map((l, i) => [l, y + (i - (lines.length - 1) / 2) * lh]);
  }
  const toBlob = (c, type = 'image/jpeg') => new Promise((res) => c.toBlob(res, type, 0.9));

  const MOVES = {
    static: (t) => ({ z: 1.04 + 0.01 * Math.sin(t * 6), dx: 0, dy: 0, r: 0 }),
    'dolly-in': (t) => ({ z: 1 + 0.25 * t, dx: 0, dy: 0, r: 0 }),
    'dolly-out': (t) => ({ z: 1.25 - 0.25 * t, dx: 0, dy: 0, r: 0 }),
    pan: (t) => ({ z: 1.2, dx: (t - 0.5) * -0.16, dy: 0, r: 0 }),
    orbit: (t) => ({ z: 1.18, dx: Math.sin(t * Math.PI * 2) * 0.06, dy: 0, r: Math.sin(t * Math.PI * 2) * 0.03 }),
    crane: (t) => ({ z: 1.2, dx: 0, dy: (t - 0.5) * 0.14, r: 0 }),
    handheld: (t) => ({ z: 1.1, dx: Math.sin(t * 23) * 0.008, dy: Math.cos(t * 17) * 0.008, r: Math.sin(t * 11) * 0.006 }),
    crash: (t) => ({ z: 1 + 0.9 * Math.pow(t, 3), dx: 0, dy: 0, r: 0 }),
    fpv: (t) => ({ z: 1 + 0.5 * t, dx: Math.sin(t * 5) * 0.03, dy: -0.05 * t, r: Math.sin(t * 4) * 0.05 }),
    talk: (t) => ({ z: 1.06 + 0.012 * Math.sin(t * 30), dx: 0, dy: 0.004 * Math.sin(t * 40), r: 0.006 * Math.sin(t * 9) }),
  };

  /** Record a short video from canvas frames: ken-burns camera move + TikTok-style captions. */
  async function record({ frames, aspect = '9:16', seconds = 4, move = 'dolly-in', captions = '' }) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    const [W, H] = (SIZE[aspect] || SIZE['9:16']).map((v) => Math.round(v * 0.75 / 2) * 2);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return null;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const words = String(captions).split(/\s+/).filter(Boolean);
    const chunksOf = []; for (let i = 0; i < words.length; i += 4) chunksOf.push(words.slice(i, i + 4).join(' '));
    const per = seconds / frames.length;
    const done = new Promise((res) => (rec.onstop = res));
    rec.start(200);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const el = (performance.now() - t0) / 1000;
        if (el >= seconds) return resolve();
        const fi = Math.min(frames.length - 1, Math.floor(el / per));
        const lt = (el - fi * per) / per;
        const m = (MOVES[move] || MOVES['dolly-in'])(lt);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(m.r); ctx.translate(-W / 2, -H / 2);
        cover(ctx, frames[fi], 0, 0, W, H, m.z, m.dx * W, m.dy * H); ctx.restore();
        if (frames.length > 1 && lt < 0.12) { ctx.fillStyle = `rgba(0,0,0,${1 - lt / 0.12})`; ctx.fillRect(0, 0, W, H); }
        if (chunksOf.length) {
          const text = chunksOf[Math.min(chunksOf.length - 1, Math.floor((el / seconds) * chunksOf.length))];
          ctx.font = `800 ${Math.round(W / 15)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = Math.max(4, W / 70); ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.fillStyle = '#fff';
          wrap(ctx, text, W / 2, H * 0.74, W * 0.86, W / 13).forEach(([t, y]) => { ctx.strokeText(t, W / 2, y); ctx.fillText(t, W / 2, y); });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: type.split(';')[0] });
  }

  // ---------- sample data on first visit ----------
  function drawAvatar() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#f6c9a8'); g.addColorStop(1, '#e8a07a'); x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    x.fillStyle = '#2b1d16'; x.beginPath(); x.ellipse(256, 230, 170, 190, 0, Math.PI, 0); x.fill(); x.fillRect(86, 230, 60, 200); x.fillRect(366, 230, 60, 200);
    x.fillStyle = '#f1b892'; x.beginPath(); x.ellipse(256, 270, 130, 160, 0, 0, 7); x.fill();
    x.fillStyle = '#2b1d16'; [196, 316].forEach((cx) => { x.beginPath(); x.ellipse(cx, 260, 14, 18, 0, 0, 7); x.fill(); });
    x.strokeStyle = '#b5523b'; x.lineWidth = 9; x.lineCap = 'round'; x.beginPath(); x.arc(256, 320, 46, 0.2, Math.PI - 0.2); x.stroke();
    x.fillStyle = '#fff'; x.fillRect(0, 440, 512, 72); x.fillStyle = '#111'; x.font = '700 30px Inter, sans-serif'; x.textAlign = 'center'; x.fillText('sample friend', 256, 488);
    return c.toDataURL('image/jpeg', 0.85);
  }
  function drawBottle() {
    const c = document.createElement('canvas'); c.width = 360; c.height = 560; const x = c.getContext('2d');
    x.fillStyle = '#d8d0c4'; rr(x, 140, 20, 80, 70, 10); x.fill();
    const g = x.createLinearGradient(60, 0, 300, 0); g.addColorStop(0, '#f7e3ec'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, '#efc8d8');
    x.fillStyle = g; rr(x, 60, 80, 240, 460, 46); x.fill();
    x.fillStyle = '#c2185b'; x.font = '800 40px Inter, sans-serif'; x.textAlign = 'center'; x.fillText('GLOW', 180, 300); x.font = '600 22px Inter, sans-serif'; x.fillText('SERUM 30ml', 180, 336);
    return c.toDataURL('image/png');
  }
  if (!st) {
    st = { credits: 2000, friends: [], products: [], jobs: [], ledger: [{ at: Date.now(), what: 'Preview credits', credits: 2000 }] };
    st.friends.push({ id: 'sample-friend', name: 'Aisyah', note: 'sample', photos: [drawAvatar()] });
    st.products.push({ id: 'sample-product', name: 'Glow Serum', price: 'RM39', benefits: 'Brightens in 7 days, niacinamide 10%, halal', image: drawBottle(), link: '' });
    save();
  }

  // ---------- simulated generation ----------
  const live = new Map();
  const SCRIPTS = {
    ms: (p) => `Serius, ${p} ni game changer! Saya dah cuba seminggu dan memang berbaloi. Harga pun mampu milik. Nak cuba? Tekan beg kuning sekarang!`,
    en: (p) => `Okay, ${p} actually shocked me. I've used it for a week and it's worth every ringgit. Want one? Tap the yellow basket now!`,
    manglish: (p) => `Wah, ${p} this one confirm best lah! One week only already can see the difference. Cheap some more. Tap the yellow basket, go!`,
  };

  // Preview audio: a short synthesized clip (a real voice needs the live server).
  function synthAudio(kind, seconds, text) {
    const sr = 22050, n = Math.floor(sr * Math.min(60, Math.max(1, seconds)));
    const d = new Float32Array(n);
    const h = hash(text || kind);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (kind === 'music') {
        const chord = [[220, 277, 330], [196, 247, 294], [174, 220, 262], [196, 247, 330]][Math.floor(t / 2) % 4];
        const beat = Math.exp(-((t % 0.5) * 18));
        d[i] = chord.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t), 0) * 0.08 + Math.sin(2 * Math.PI * 55 * t) * beat * 0.4 + (Math.random() * 2 - 1) * Math.exp(-(((t + 0.25) % 0.5) * 40)) * 0.08;
      } else if (kind === 'sfx') {
        const e = Math.exp(-t * 4);
        d[i] = (Math.sin(2 * Math.PI * (880 + 440 * Math.sin(t * 3)) * t) * 0.5 + (Math.random() * 2 - 1) * 0.3) * e;
      } else {
        const syl = Math.abs(Math.sin(Math.PI * t * 3.2)); // syllable rhythm
        const f0 = 160 + (h % 60) + 25 * Math.sin(t * 2.1);
        d[i] = (Math.sin(2 * Math.PI * f0 * t) * 0.5 + Math.sin(2 * Math.PI * f0 * 2 * t) * 0.25 + Math.sin(2 * Math.PI * f0 * 3.1 * t) * 0.12) * syl * 0.5;
      }
    }
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  function planBoard(prompt, n) {
    n = Math.min(8, Math.max(2, n || 4));
    const topic = String(prompt || 'your topic');
    const MOV = ['slow cinematic push-in', 'smooth pan left to right', 'orbit around the subject', 'crane up', 'slow pull back revealing the scene'];
    return {
      title: topic.slice(0, 60), caption: `${topic.slice(0, 50)} 🤯 Save this for later!`, hashtags: ['#fyp', '#malaysia', '#faktamenarik'],
      scenes: Array.from({ length: n }, (_, k) => ({
        narration: k === 0 ? `Did you know this about ${topic}? Stay till the end.` : k === n - 1 ? 'Follow for more stories like this!' : `Fact ${k}: here is something about ${topic} most people never notice.`,
        visual: k === 0 ? `Bold opening shot that introduces ${topic}` : `Scene illustrating fact ${k} about ${topic}`,
        motion: MOV[k % MOV.length],
      })),
    };
  }

  function startJob(tool, input) {
    const fr = st.friends.find((f) => f.id === input.friendId) || null;
    const pr = st.products.find((p) => p.id === input.productId) || null;
    const plan = st.plan || 'free', T = tierOf(input.tier);
    const lock = (need, what) => { if ((RANK[plan] ?? 0) < (RANK[need] ?? 0)) throw err(`${what} is on the ${PLAN_NAME[need]} plan. Upgrade to use it.`, 'plan'); };
    if (['ugc', 'avatar', 'story'].includes(tool)) { const TT = TIERS[input.tier] || TIERS[tool === 'story' ? 'motion' : 'lite']; lock(TT.plan, `${TT.label} quality`); }
    if (input.model && !(tool === 'story' && (input.tier || 'motion') === 'motion')) lock(MODEL_PLAN[input.model] || 'free', VIDEO_MODELS[input.model]?.label || 'That model');
    if (tool === 'ugc' && (input.variants || 1) > MAX_VARIANTS[plan]) lock('creator', `${input.variants} variations`);
    const prevDraft = input.fromDraft ? st.jobs.find((x) => x.id === input.fromDraft) : null;
    if (input.fromDraft && !(prevDraft?.stage === 'review' && prevDraft.draftData)) throw err('That draft is no longer available. Make a new one.');
    if (input.fromDraft) input.draft = false;
    const est = Math.ceil(ESTIMATE[tool](input));
    if (st.credits < est) throw err('Not enough credits. Top up to continue.', 'credits');
    if ([...live.values()].length >= 3) throw err('You already have 3 generations running. Wait for one to finish.');
    const titles = {
      image: input.prompt?.slice(0, 60) || 'Image', shot: input.prompt?.slice(0, 60) || 'Shot',
      ugc: `${pr?.name || 'Product'} · ${input.format === 'talking' ? 'Talking UGC' : 'Showcase'} ad`,
      avatar: `${fr?.name || 'Avatar'} talking`, story: input.board?.title || input.prompt?.slice(0, 60) || 'Story video',
      voice: `${input.kind === 'sfx' ? 'Sound effect' : input.kind === 'music' ? 'Music' : 'Voice-over'} · ${String(input.text || '').slice(0, 50)}`,
      avatarGen: input.preset ? `Avatar · ${AVATARS.find((a) => a.id === input.preset)?.name}` : `Avatar · ${input.name || 'custom'}`,
    };
    if (tool === 'ugc') { const n = [1, 3, 5].includes(input.variants) ? input.variants : 1; if (n > 1) titles.ugc += ` ×${n}`; }
    const job = { id: id(), tool, title: titles[tool], input, status: 'running', steps: [], outputs: [], text: null, cost: 0, estimate: est, createdAt: Date.now(), mock: true };
    st.credits -= est;
    st.ledger.unshift({ at: Date.now(), what: job.title, credits: -est, job: job.id });
    st.jobs.unshift(job); live.set(job.id, job); save();

    const step = async (label, ms) => { const s = { label, status: 'running' }; job.steps.push(s); await sleep(ms); s.status = 'done'; };
    const out = async (type, blob, label) => job.outputs.push({ type, url: blob ? await putBlob(blob) : null, label });
    const lang = input.lang || 'ms';

    (async () => {
      try {
        if (tool === 'image') {
          await step(`Generating ${input.count || 1} image${(input.count || 1) > 1 ? 's' : ''}`, 1800);
          for (let k = 0; k < (input.count || 1); k++) await out('image', await toBlob(await compose({ prompt: input.prompt + k, friend: fr, product: pr, aspect: input.aspect, style: input.style })));
        }
        if (tool === 'shot') {
          let frame;
          if (input.startImage) frame = await loadImg(input.startImage);
          else {
            await step('Composing keyframe', 1400);
            const c = await compose({ prompt: input.prompt, friend: fr, product: pr, aspect: input.aspect, style: input.style });
            await out('image', await toBlob(c), 'Keyframe'); frame = c;
          }
          job.steps.push({ label: `Animating with ${VIDEO_MODELS[input.model]?.label || 'video model'}`, status: 'running' });
          const v = await record({ frames: [frame], aspect: input.aspect, seconds: Math.min(6, input.duration || 5), move: input.camera });
          job.steps[job.steps.length - 1].status = 'done';
          if (v) await out('video', v, 'Shot');
        }
        if (tool === 'ugc') {
          const name = pr?.name || 'this product';
          const n = [1, 3, 5].includes(input.variants) ? input.variants : 1;
          const ANG = ['review', 'problem', 'deal', 'unboxing', 'compare', 'beforeafter'];
          const LBL = { review: 'Honest review', problem: 'Problem → fix', deal: 'Flash sale', unboxing: 'Unboxing', compare: 'Vs. pricey one', beforeafter: 'Before & after' };
          const base = LBL[input.angle] ? input.angle : 'review';
          const angles = [base, ...ANG.filter((a) => a !== base)].slice(0, n);
          const OPEN = {
            ms: { review: `Serius, ${name} ni game changer!`, problem: `Penat dengan masalah yang sama setiap hari?`, deal: `${name} turun harga hari ni je!`, unboxing: `Jom unbox ${name} sama-sama!`, compare: `Kenapa bayar mahal kalau ${name} lagi best?`, beforeafter: `Tengok beza sebelum dan selepas guna ${name}!` },
            en: { review: `Okay, ${name} actually shocked me.`, problem: `Tired of the same problem every single day?`, deal: `${name} is on sale today only!`, unboxing: `Let's unbox ${name} together!`, compare: `Why pay more when ${name} does it better?`, beforeafter: `Look at the before and after with ${name}!` },
          };
          let scripts = angles.map((a) => `${(OPEN[lang] || OPEN.en)[a]} ${(SCRIPTS[lang] || SCRIPTS.en)(name).split(/(?<=[!?.])\s/).slice(1).join(' ')}`);
          if (prevDraft) scripts = prevDraft.draftData.plans.map((pl, k) => String(input.scripts?.[k] || '').trim() || pl.script);
          else await step(n > 1 ? `Writing ${n} hooks & scripts` : 'Writing hook & script', 1200);
          job.text = scripts.map((sc, k) => `${n > 1 ? `── V${k + 1} · ${LBL[angles[k]]} ──\n` : ''}HOOK: ${sc.split(/(?<=[!?.])\s/)[0]}\n\nSCRIPT: ${sc}${input.notes ? `\n\nMUST MENTION: ${input.notes}` : ''}\n\nCAPTION: ${name} yang viral tu 😍 Worth it ke? Tengok sampai habis!\n\n#fyp #tiktokshopmy #racunshopee #malaysia #review #affiliate`).join('\n\n');
          job.outputs.push({ type: 'text', url: null, label: 'Script & caption' });
          let c;
          if (prevDraft) { const im = await loadImg(await resolveUrl(prevDraft.outputs.find((o) => o.type === 'image')?.url)); if (im) { c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); } job.fromDraft = prevDraft.id; }
          if (!c) {
            await step(fr ? `Placing ${fr.name} with the product` : 'Composing product scene', 1400);
            c = await compose({ prompt: name + input.angle, friend: fr, product: pr, aspect: '9:16', style: 'ugc' });
          }
          await out('image', await toBlob(c), 'Keyframe');
          if (input.draft) {
            job.stage = 'review';
            job.draftData = { plans: scripts.map((script) => ({ script })), angles: angles.map((a) => LBL[a]) };
          } else {
          await step(n > 1 ? `Recording ${n} voice-overs` : 'Recording voice-over', 900);
          const eng = T.label;
          job.steps.push({ label: input.format === 'talking' ? (T.talk ? `Animating (${eng})` : 'Animating (Motion)') : 'Animating product shots', status: 'running' });
          for (let k = 0; k < n; k++) {
            const v = await record({ frames: [c], seconds: n > 1 ? 4 : 6, move: input.format === 'talking' ? 'talk' : ['dolly-in', 'orbit', 'crash', 'pan', 'crane'][k % 5], captions: input.captions !== false ? scripts[k] : '' });
            if (v) await out('video', v, n > 1 ? `V${k + 1} · ${LBL[angles[k]]}` : 'Final ad');
          }
          job.steps[job.steps.length - 1].status = 'done';
          }
        }
        if (tool === 'voice') {
          const kind = input.kind || 'tts';
          await step(kind === 'sfx' ? 'Designing the sound' : kind === 'music' ? 'Composing the track' : 'Recording', 1200);
          const secs = kind === 'tts' ? Math.max(2, String(input.text).split(/\s+/).length / 2.6) : Math.min(kind === 'sfx' ? 22 : 60, input.length || (kind === 'sfx' ? 5 : 30));
          job.text = input.text;
          await out('audio', synthAudio(kind, secs, input.text), kind === 'sfx' ? 'Sound effect' : kind === 'music' ? 'Music' : 'Voice-over');
        }
        if (tool === 'avatarGen') {
          const preset = AVATARS.find((a) => a.id === input.preset);
          const n = preset ? 1 : Math.min(4, input.count || 4);
          await step(n > 1 ? `Creating ${n} avatar options` : `Creating ${preset.name}`, 1600);
          const look = preset ? preset.look : input.look || {};
          const variants = ['', 'golden hour park', 'studio grey backdrop', 'cosy cafe'];
          for (let k = 0; k < n; k++) {
            const url = window.drawPortrait ? drawPortrait({ ...look, bg: k ? variants[k] : look.bg }, 480) : null;
            if (url) await out('image', await (await fetch(url)).blob(), n > 1 ? `Option ${k + 1}` : preset.name);
          }
          if (preset) {
            const photo = drawPortrait(look, 480);
            st.friends.unshift({ id: id(), name: preset.name, note: `AI avatar · ${preset.tagline}`, photos: [photo] });
            job.text = `${preset.name} was added to your friends. Pick them with ＋ in any mode.`;
          } else job.text = 'Pick the option you like and save it as a friend.';
        }
        if (tool === 'avatar') {
          const script = input.script?.trim() || `Hai semua! Hari ni saya nak share pasal ${input.topic || 'sesuatu yang best'}. Jangan lupa follow untuk lagi tips!`;
          if (!input.script?.trim()) await step('Writing script', 1000);
          job.text = script; job.outputs.push({ type: 'text', url: null, label: 'Script' });
          await step('Recording voice', 900);
          const photo = input.image || fr?.photos?.[0];
          const img = await loadImg(photo);
          const c = await compose({ prompt: script, friend: img ? { photos: [photo] } : fr, aspect: '9:16', style: 'ugc' });
          job.steps.push({ label: 'Lip-syncing', status: 'running' });
          const v = await record({ frames: [c], seconds: 6, move: 'talk', captions: input.captions ? script : '' });
          job.steps[job.steps.length - 1].status = 'done';
          if (v) await out('video', v, 'Talking video');
        }
        if (tool === 'story') {
          let board = input.board;
          if (!board?.scenes?.length) { await step('Planning scenes & narration', 1200); board = planBoard(input.prompt, input.scenes || 4); }
          const scenes = board.scenes.slice(0, 8), n = scenes.length;
          const lines = scenes.map((s) => s.narration);
          const prev = input.reuseFrom ? st.jobs.find((x) => x.id === input.reuseFrom)?.board?.scenes || [] : [];
          const reused = scenes.filter((s, k) => prev[k] && JSON.stringify(prev[k]) === JSON.stringify(s)).length;
          job.title = (board.title || input.prompt || 'Story video').slice(0, 60);
          job.board = { title: board.title || job.title, caption: board.caption || '', hashtags: board.hashtags || [], scenes };
          job.text = [job.title, ...lines.map((l, k) => `${k + 1}. ${l}`), board.caption, (board.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
          job.outputs.push({ type: 'text', url: null, label: 'Script & caption' });
          await step(`Recording voice-overs${reused ? ` (${reused} reused)` : ''}`, 900);
          await step(`Painting ${n} scenes`, 1200);
          const frames = [];
          for (let k = 0; k < n; k++) { const c = await compose({ prompt: (scenes[k].visual || input.prompt) + k, friend: fr, aspect: input.aspect, style: input.style }); frames.push(c); await out('image', await toBlob(c), `Scene ${k + 1}`); }
          job.steps.push({ label: `Animating ${n - reused} clip${n - reused === 1 ? '' : 's'} & editing`, status: 'running' });
          if (reused) job.reusedScenes = reused;
          const v = await record({ frames, aspect: input.aspect, seconds: Math.min(12, n * 2.4), move: 'dolly-in', captions: input.captions !== false ? lines.join(' ') : '' });
          job.steps[job.steps.length - 1].status = 'done';
          if (v) await out('video', v, 'Final video');
        }
        job.status = 'done';
        job.cost = Math.max(1, Math.round(job.estimate * (job.reusedScenes ? Math.max(0.15, 1 - job.reusedScenes / (job.board?.scenes.length || 1)) : 0.85)));
      } catch (e) {
        job.status = 'error'; job.error = e.message;
        job.steps.forEach((s) => { if (s.status === 'running') s.status = 'error'; });
      }
      const refund = job.estimate - job.cost;
      if (refund > 0) { st.credits += refund; st.ledger.unshift({ at: Date.now(), what: job.status === 'error' ? 'Refund (failed steps)' : 'Refund (unused estimate)', credits: refund, job: job.id }); }
      live.delete(job.id); save();
    })();
    return job;
  }
  // jobs interrupted by closing the tab
  for (const j of st.jobs) if (j.status === 'running') { j.status = 'error'; j.error = 'Interrupted: the page was closed while generating.'; }


  // ---------- brainstorm (preview): reads colours and shapes from the photos ----------
  async function readImage(src) {
    const img = await loadImg(src);
    if (!img) return null;
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, n = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 40) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255; light = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
    let hue = 0;
    if (max !== min) { const R = r / 255, G = g / 255, B = b / 255, dd = max - min; hue = max === R ? ((G - B) / dd) % 6 : max === G ? (B - R) / dd + 2 : (R - G) / dd + 4; hue = (hue * 60 + 360) % 360; }
    const name = sat < 0.15 ? (light > 0.75 ? 'white / neutral' : light < 0.25 ? 'black' : 'grey') : hue < 15 || hue >= 345 ? 'red' : hue < 40 ? 'orange / peach' : hue < 65 ? 'yellow / gold' : hue < 160 ? 'green' : hue < 200 ? 'teal' : hue < 255 ? 'blue' : hue < 290 ? 'purple' : 'pink';
    const ratio = img.width / img.height;
    return { name, light, sat, shape: ratio < 0.8 ? 'tall' : ratio > 1.25 ? 'wide' : 'square' };
  }
  async function baseBrainstorm(b) {
    const fr = st.friends.find((f) => f.id === b.friendId), pr = st.products.find((p) => p.id === b.productId);
    const prompt = String(b.prompt || '').trim();
    if (!fr && !pr && !b.image && !prompt) throw err('Add a photo, a product or a prompt first so there is something to think about');
    const cost = b.chat?.length ? 1 : 2;
    if (st.credits < cost) throw err('Not enough credits. Top up to continue.', 'credits');
    await sleep(b.chat?.length ? 1500 : 2600);
    const [fi, pi, xi] = await Promise.all([readImage(fr?.photos?.[0]), readImage(pr?.image), readImage(b.image)]);
    st.credits -= cost; st.ledger.unshift({ at: Date.now(), what: cost === 1 ? 'Brainstorm follow-up' : 'Brainstorm', credits: -cost }); save();
    const name = pr?.name || 'your product', who = fr?.name || 'your creator';
    const vibe = (i) => (!i ? '' : i.sat > 0.45 ? 'bold, saturated' : i.light > 0.7 ? 'soft, clean' : i.light < 0.3 ? 'dark, moody' : 'natural');
    const pack = pi ? `${vibe(pi)} ${pi.name} ${pi.shape === 'tall' ? 'tall pack (bottle or tube)' : pi.shape === 'wide' ? 'wide pack' : 'compact pack'}` : '';
    const feminine = pi && ['pink', 'purple', 'white / neutral', 'orange / peach'].includes(pi.name);
    const niche = /serum|skin|cream|glow|toner|mask|lip|beauty/i.test(name + (pr?.benefits || '') + prompt) ? 'skincare & beauty'
      : /food|snack|kopi|coffee|tea|sambal|cook/i.test(name + prompt) ? 'food & drink'
      : /phone|gadget|charger|earbud|tech/i.test(name + prompt) ? 'gadgets' : feminine ? 'beauty & lifestyle' : 'lifestyle';
    const ms = b.lang === 'ms', mg = b.lang === 'manglish';
    const points = (pr?.benefits || '').split(/[,.;]/).map((x) => x.trim()).filter(Boolean);
    const style = pi && pi.light > 0.65 ? 'studio' : 'cinematic';
    return {
      summary: `${pr ? `${name}${pr.price ? ` (${pr.price})` : ''} has a ${pack} look that reads as ${niche}.` : prompt ? `Your prompt points to ${niche} content.` : 'Here is what we can build from what you gave us.'} ${fr ? `${who}'s photo is ${fi && fi.light > 0.55 ? 'bright and friendly' : 'warm and personal'}, so talking-to-camera content will feel trustworthy.` : 'Add a friend so the ads have a real face.'} ${pr?.price ? `At ${pr.price} it sits in impulse-buy territory, so lead with value and a fast call to action.` : ''}`.trim(),
      observations: [
        pi && `Packaging: ${pi.name}, ${vibe(pi)}`, pi && `Shape: ${pi.shape === 'tall' ? 'tall, hero-shot friendly' : pi.shape}`,
        fi && `Friend photo: ${fi.light > 0.55 ? 'bright lighting' : 'warm, lower light'}`, prompt && `Prompt mentions “${prompt.slice(0, 50)}”`,
        `Best fit: ${niche}`, xi && `Extra image: ${xi.name} tones`,
      ].filter(Boolean).slice(0, 5),
      audience: niche === 'skincare & beauty' ? 'Malaysian women 18–35 on TikTok Shop and Shopee who buy skincare after seeing real results on real faces.'
        : niche === 'food & drink' ? 'Hungry scrollers and gift buyers who decide in the first 2 seconds of a video.'
          : 'Value-hunting Malaysian shoppers who trust creators more than brand ads.',
      sellingPoints: (points.length ? points : [pr?.price ? `Affordable at ${pr.price}` : 'Good value', 'Looks great on camera', 'Easy to start using today']).slice(0, 5),
      hooks: ms ? [`Jangan beli ${name} sebelum tengok video ni`, `Saya tak percaya sampai saya cuba ${name}`, `${pr?.price || 'Harga ni'} untuk ni? Serius?`]
        : mg ? [`Wah, ${name} this one really can ah?`, `Don't buy ${name} until you watch this lah`, `${pr?.price || 'This price'} only? Confirm worth it`]
          : [`I didn't believe it until I tried ${name}`, `Don't buy ${name} before watching this`, `${pr?.price || 'This price'} for this? Seriously?`],
      ideas: [
        { title: `${who} reviews it`, mode: 'ad', why: 'A real face talking to camera is the highest-converting format for a first launch.', prompt: points.slice(0, 2).join(', '), settings: { format: 'talking', angle: niche === 'skincare & beauty' ? 'beforeafter' : 'review' } },
        { title: 'Premium orbit shot', mode: 'video', why: `The ${pi ? pi.name : 'product'} packaging pops in a slow orbit with soft light.`, prompt: `${who} holds ${name} up to the camera, soft window light, product label clearly visible`, settings: { camera: 'orbit', style } },
        { title: 'Shopee listing set', mode: 'image', why: 'Clean packshots lift listing click-through.', prompt: `${name} on a ${pi && pi.light > 0.6 ? 'soft pastel' : 'dark glossy'} background, soft shadows, premium e-commerce packshot`, settings: { style: 'studio', aspect: '1:1' } },
        { title: '3 reasons story', mode: 'story', why: 'Infotainment keeps viewers watching and builds trust before the link.', prompt: `3 reasons people are switching to ${name}${prompt ? ` (${prompt.slice(0, 40)})` : ''}`, settings: { scenes: 4, style } },
      ],
    };
  }

  // Follow-up chat: read what the user asked for and rework the conclusion around it.
  const TWEAKS = [
    { re: /\bmums?\b|\bmoms?\b|\bibu\b|\bmak\b|mother|parent/i, aud: 'Busy Malaysian mums 28–45 who shop between school runs and trust other mums’ honest reviews.', tag: 'for busy mums', hooks: { en: ['Mums, this saved my morning routine', 'Busy mum hack I wish I knew sooner'], ms: ['Mak-mak, ni penyelamat pagi saya', 'Tip ibu sibuk yang saya baru tahu'] } },
    { re: /student|gen ?z|young|remaja|budak|\buni/i, aud: 'Gen Z and students 17–24 who want trendy, affordable picks they can show off.', tag: 'Gen Z style', hooks: { en: ['POV: you found the cheat code', 'Not me gatekeeping this for months'], ms: ['POV: korang jumpa cheat code', 'Dah lama saya simpan rahsia ni'] } },
    { re: /men|lelaki|guy|abang|husband/i, aud: 'Malaysian men 25–40 who want no-fuss products that just work.', tag: 'for men', hooks: { en: ['Bro, stop overthinking this', 'The one thing my wife stole from me'], ms: ['Bro, tak payah fikir panjang', 'Benda ni isteri saya curi'] } },
    { re: /funn|lawak|humou?r|comed|kelakar|joke/i, tone: 'funny', tag: 'funnier', hooks: { en: ['My wallet: no. Me: yes 😭', 'I bought this for a joke. It’s not a joke.'], ms: ['Dompet: jangan. Saya: beli 😭', 'Saya beli sebab main-main. Rupanya serius'] } },
    { re: /premium|luxur|mewah|classy|elegan/i, tone: 'premium', tag: 'more premium', hooks: { en: ['Looks like RM300. Costs a fraction.', 'The quiet-luxury pick nobody talks about'], ms: ['Nampak macam RM300. Harga jauh lebih murah.', 'Pilihan mewah yang orang tak cerita'] } },
    { re: /raya|eid|festive|hari raya|ramadan|puasa/i, theme: 'Hari Raya', tag: 'Raya theme', hooks: { en: ['Raya-ready in 3 days? Watch this', 'Balik kampung glow-up starts here'], ms: ['Nak raya-ready dalam 3 hari? Tengok ni', 'Glow-up balik kampung bermula sini'] } },
    { re: /cny|chinese new year|tahun baru cina/i, theme: 'Chinese New Year', tag: 'CNY theme', hooks: { en: ['Huat ah! Start the year with this', 'CNY visiting? Bring this'], ms: ['Huat ah! Mula tahun dengan ni', 'Nak ziarah CNY? Bawa ni'] } },
    { re: /11\.?11|12\.?12|sale|promo|discount|diskaun|off|voucher|code|price|harga|murah/i, angle: 'deal', tag: 'promo push', hooks: { en: ['This price ends at midnight', 'Use my code before it’s gone'], ms: ['Harga ni tamat malam ni', 'Guna kod saya sebelum habis'] } },
  ];
  async function brainstorm(b) {
    const r = await baseBrainstorm(b);
    const asks = (b.chat || []).filter((c) => c.role === 'user').map((c) => c.text);
    if (!asks.length) return r;
    const all = asks.join(' ');
    const last = asks[asks.length - 1];
    const hitLast = TWEAKS.filter((t) => t.re.test(last));
    const hit = [...hitLast, ...TWEAKS.filter((t) => !hitLast.includes(t) && t.re.test(all))];
    const lang = /\bbm\b|melayu|malay/i.test(all) ? 'ms' : /english|\ben\b/i.test(all) ? 'en' : b.lang === 'ms' ? 'ms' : 'en';
    const name = st.products.find((p) => p.id === b.productId)?.name || 'it';
    const theme = hit.find((t) => t.theme)?.theme, tone = hit.find((t) => t.tone)?.tone, deal = hit.some((t) => t.angle);
    const code = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])([A-Z0-9]{4,12})\b/.exec(all)?.[1];
    const pct = /(\d{1,2})\s?%/.exec(all)?.[1];
    const lastPct = /(\d{1,2})\s?%/.test(last), lastCode = code && last.includes(code);
    for (const t of hit) if (t.aud) r.audience = t.aud;
    const newHooks = hit.flatMap((t) => t.hooks[lang] || t.hooks.en);
    if (pct) newHooks.unshift(lang === 'ms' ? `${pct}% off ${name} minggu ni je!` : `${pct}% off ${name}, this week only!`);
    r.hooks = [...newHooks, ...r.hooks].slice(0, 4);
    const extra = [theme && `${theme} setting`, tone === 'funny' && 'playful, comedic delivery', tone === 'premium' && 'elegant, premium styling', pct && `${pct}% off`, code && `code ${code}`].filter(Boolean).join(', ');
    r.ideas = r.ideas.map((i) => ({ ...i, prompt: extra ? `${i.prompt}${i.prompt ? ', ' : ''}${extra}` : i.prompt, settings: deal && i.mode === 'ad' ? { ...i.settings, angle: 'deal' } : i.settings }));
    if (deal) r.ideas[0] = { ...r.ideas[0], title: `${r.ideas[0].title} · promo`, why: 'You have a promo, so lead with the price and a deadline.' };
    if (pct || code) r.sellingPoints = [[pct && `${pct}% off`, code && `code ${code}`].filter(Boolean).join(' with '), ...r.sellingPoints].slice(0, 5);
    r.summary += ` Based on what you told us${hit.length ? ` (${hit.map((t) => t.tag).join(', ')})` : ''}, we reworked the hooks and ideas.`;
    const now = [...hitLast.map((t) => t.tag), lastPct && `around the ${pct}% deal`, lastCode && `with code ${code}`].filter(Boolean);
    r.reply = now.length
      ? `Got it, ${now.join(', ')}.${asks.length > 1 && hit.length > hitLast.length ? ` I kept your earlier direction (${hit.filter((t) => !hitLast.includes(t)).map((t) => t.tag).join(', ')}) too.` : ''} Check the new hooks and ideas above.`
      : `Noted. I've added that to the ideas. Try telling me who buys it, the promo, or the vibe (funny, premium, festive) for sharper results.`;
    return r;
  }

  // ---------- the fake API ----------
  async function handle(url, body, method = body ? 'POST' : 'GET') {
    await sleep(120);
    const u = new URL(url, location.origin);
    const p = u.pathname;
    if (p === '/api/state') {
      return {
        userId: 'preview', mode: 'preview', mock: true, ffmpeg: true, credits: st.credits, llmModel: 'google/gemini-2.5-flash', payments: true, plan: st.plan || null, social: true,
        access: st.plan || 'free',
        catalog: { videoModels: VIDEO_MODELS, tiers: TIERS, modelPlan: MODEL_PLAN, maxVariants: MAX_VARIANTS, voices: VOICES, emotions: EMOTIONS, markup: MARKUP, avatars: AVATARS, price: PRICE, styles: [], cameras: [], platforms: { tiktok: 'TikTok Shop', shopee: 'Shopee', lazada: 'Lazada', instagram: 'Instagram Reels' }, angles: [], langs: ['ms', 'en', 'manglish'] },
      };
    }
    if (p === '/api/ledger') return st.ledger.slice(0, 100);
    if (p === '/api/upload') return { url: body.dataUrl };
    if (p === '/api/estimate') return { credits: Math.ceil((ESTIMATE[body.tool] || (() => 0))(body.input || {})) };
    if (p === '/api/checkout') {
      // Preview: simulate a successful subscription so plan limits can be tested. Packs stay off.
      if (!body.plan || !PLAN_CREDITS[body.plan]) throw err('Top-ups are switched off in this preview. Try a plan to unlock its features.');
      st.plan = body.plan; st.credits += PLAN_CREDITS[body.plan];
      st.ledger.unshift({ at: Date.now(), what: `${PLAN_NAME[body.plan]} plan (preview)`, credits: PLAN_CREDITS[body.plan] }); save();
      return { url: location.pathname + location.search };
    }
    if (p === '/api/billing/portal') { st.plan = null; save(); return { url: location.pathname + location.search }; }
    if (p === '/api/settings') throw err('Settings are not available in the preview.');
    if (p === '/api/friends' && method === 'GET') return st.friends;
    if (p === '/api/friends' && method === 'POST') {
      if (!body.name?.trim()) throw err('Give your friend a name');
      if (!body.photos?.length) throw err('Add at least one photo, it is the face reference');
      const f = { id: id(), name: body.name.trim(), note: body.note || '', photos: body.photos.slice(0, 3) };
      st.friends.unshift(f); save(); return f;
    }
    if (p === '/api/products' && method === 'GET') return st.products;
    if (p === '/api/products' && method === 'POST') {
      if (!body.name?.trim()) throw err('Product name is required');
      if (!body.image) throw err('Add a product photo');
      const pr = { id: id(), name: body.name.trim(), image: body.image, price: body.price || '', benefits: body.benefits || '', link: '' };
      st.products.unshift(pr); save(); return pr;
    }
    let m = /^\/api\/(friends|products)\/(.+)$/.exec(p);
    if (m && method === 'DELETE') { st[m[1]] = st[m[1]].filter((x) => x.id !== m[2]); save(); return { ok: true }; }
    if (p === '/api/jobs' && method === 'POST') return viewJob(startJob(body.tool, body.input || {}));
    if (p === '/api/jobs') return Promise.all(st.jobs.slice(0, +(u.searchParams.get('limit') || 100)).map(viewJob));
    m = /^\/api\/jobs\/(.+)$/.exec(p);
    if (m && method === 'DELETE') {
      const j = st.jobs.find((x) => x.id === m[1]);
      if (j) { j.outputs.forEach((o) => o.url?.startsWith('idb:') && delBlob(o.url.slice(4))); st.jobs = st.jobs.filter((x) => x !== j); save(); }
      return { ok: true };
    }
    if (m) { const j = st.jobs.find((x) => x.id === m[1]); if (!j) throw err('Not found'); return viewJob(j); }
    if (p === '/api/brainstorm') return brainstorm(body);
    if (p === '/api/storyboard/plan') {
      if (st.credits < PRICE.llm) throw err('Not enough credits. Top up to continue.', 'credits');
      await sleep(1400); st.credits -= PRICE.llm; st.ledger.unshift({ at: Date.now(), what: 'Storyboard plan', credits: -PRICE.llm }); save();
      return planBoard(body.prompt, body.scenes);
    }
    if (p === '/api/voices' && method === 'GET') return Promise.all((st.voices || []).map(async (v) => ({ ...v, preview_url: await resolveUrl(v.preview_url) })));
    if (p === '/api/voices' && method === 'POST') {
      if (body.consent !== true) throw err('Please confirm this is your voice or you have permission to clone it');
      if (st.credits < PRICE.voiceClone) throw err('Not enough credits. Top up to continue.', 'credits');
      await sleep(2000);
      const v = { id: id(), name: String(body.name || 'My voice').slice(0, 40), voice_id: 'demo', preview_url: await putBlob(synthAudio('tts', 3, body.name)) };
      (st.voices ||= []).unshift(v); st.credits -= PRICE.voiceClone; st.ledger.unshift({ at: Date.now(), what: 'Voice clone', credits: -PRICE.voiceClone }); save();
      return v;
    }
    m = /^\/api\/voices\/(.+)$/.exec(p);
    if (m && method === 'DELETE') { st.voices = (st.voices || []).filter((v) => v.id !== m[1]); save(); return { ok: true }; }
    if (p === '/api/social/accounts' && method === 'GET') return st.accounts || [];
    if (p === '/api/social/connect') {
      await sleep(700);
      const handle = { tiktok: '@kravitas.demo', instagram: '@kravitas.demo', facebook: 'Kravitas Demo Page', youtube: 'Kravitas Demo', threads: '@kravitas.demo' }[body.platform];
      (st.accounts ||= []).push({ id: id(), platform: body.platform, username: handle }); save();
      return { url: null };
    }
    m = /^\/api\/social\/accounts\/(.+)$/.exec(p);
    if (m && method === 'DELETE') { st.accounts = (st.accounts || []).filter((a) => a.id !== m[1]); save(); return { ok: true }; }
    if (p === '/api/social/posts' && method === 'GET') {
      for (const x of st.posts || []) if (x.status === 'scheduled' && (!x.scheduledAt || x.scheduledAt <= Date.now())) { x.status = 'processed'; x.results = x.platforms.map((pl) => ({ account: pl, success: true, url: null })); }
      save();
      return [...(st.posts || [])].sort((a, b) => (b.scheduledAt || b.createdAt) - (a.scheduledAt || a.createdAt));
    }
    if (p === '/api/social/posts' && method === 'POST') {
      const accs = (st.accounts || []).filter((a) => (body.accountIds || []).includes(a.id));
      if (!accs.length) throw err('Pick at least one connected account');
      const when = body.scheduledAt ? new Date(body.scheduledAt).getTime() : null;
      if (when && when < Date.now() - 60000) throw err('Pick a time in the future');
      const post = { id: id(), status: 'scheduled', platforms: accs.map((a) => a.platform), jobId: body.jobId, caption: body.caption, scheduledAt: when, aiLabel: !!body.aiLabel, createdAt: Date.now() };
      (st.posts ||= []).unshift(post); save();
      return post;
    }
    if (p === '/api/billing/portal') throw err('Payments are switched off in this preview.');
    throw err('Not available in preview');
  }

  window.PreviewAPI = { handle, reset() { localStorage.removeItem(LS); indexedDB.deleteDatabase('if-preview'); location.reload(); } };
})();
