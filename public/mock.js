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

  // ---------- catalog (mirrors the server) ----------
  const VIDEO_MODELS = {
    'h3-turbo': { label: 'MiniMax H3 Turbo', tag: 'Best value', perSec: 2 },
    'seedance-fast': { label: 'Seedance 2.0 Fast', tag: 'Native audio', perSec: 12 },
    'kling-std': { label: 'Kling 3.0 Standard', tag: 'Smooth motion', perSec: 9 },
    'kling-pro': { label: 'Kling 3.0 Pro', tag: 'Top quality', perSec: 14 },
  };
  const PRICE = { image: 8, llm: 1, removeBg: 1, ttsPer100Chars: 1, avatarPerSec: 16 };
  const VOICES = ['Aria', 'Sarah', 'Laura', 'Charlotte', 'Alice', 'Matilda', 'Jessica', 'Lily', 'Roger', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Bill'];
  const vsec = (m, d) => Math.ceil((VIDEO_MODELS[m] || VIDEO_MODELS['h3-turbo']).perSec * Math.min(10, Math.max(2, d)));
  const ESTIMATE = {
    image: (i) => PRICE.image * (i.count || 1),
    shot: (i) => (i.startImage ? 0 : PRICE.image) + vsec(i.model, i.duration || 5),
    ugc: (i) => PRICE.llm + PRICE.image + 3 + (i.format === 'talking' ? PRICE.avatarPerSec * (i.seconds || 15) : vsec(i.model, i.seconds || 15)),
    avatar: (i) => 3 + PRICE.avatarPerSec * Math.max(3, i.script ? i.script.split(/\s+/).length / 2.6 : i.seconds || 15),
    story: (i) => PRICE.llm + (i.scenes || 4) * (PRICE.image + vsec(i.model, 6) + 2),
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
    ctx.fillStyle = '#d4ff3f'; ctx.textAlign = 'left'; ctx.fillText(text, W - w - 3, 12 + W / 40 + 4);
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
    x.fillStyle = '#d4ff3f'; x.fillRect(0, 440, 512, 72); x.fillStyle = '#111'; x.font = '700 30px Inter, sans-serif'; x.textAlign = 'center'; x.fillText('sample friend', 256, 488);
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

  function startJob(tool, input) {
    const fr = st.friends.find((f) => f.id === input.friendId) || null;
    const pr = st.products.find((p) => p.id === input.productId) || null;
    const est = Math.ceil(ESTIMATE[tool](input));
    if (st.credits < est) throw err('Not enough credits. Top up to continue.', 'credits');
    if ([...live.values()].length >= 3) throw err('You already have 3 generations running. Wait for one to finish.');
    const titles = {
      image: input.prompt?.slice(0, 60) || 'Image', shot: input.prompt?.slice(0, 60) || 'Shot',
      ugc: `${pr?.name || 'Product'} · ${input.format === 'talking' ? 'Talking UGC' : 'Showcase'} ad`,
      avatar: `${fr?.name || 'Avatar'} talking`, story: input.prompt?.slice(0, 60) || 'Story video',
    };
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
          await step('Writing hook & script', 1200);
          const script = (SCRIPTS[lang] || SCRIPTS.en)(name);
          job.text = `HOOK: ${script.split(/[!?.]/)[0]}!\n\nSCRIPT: ${script}${input.notes ? `\n\nMUST MENTION: ${input.notes}` : ''}\n\nCAPTION: ${name} yang viral tu 😍 Worth it ke? Tengok sampai habis!\n\n#fyp #tiktokshopmy #racunshopee #malaysia #review #affiliate`;
          job.outputs.push({ type: 'text', url: null, label: 'Script & caption' });
          await step(fr ? `Placing ${fr.name} with the product` : 'Composing product scene', 1400);
          const c = await compose({ prompt: name + input.angle, friend: fr, product: pr, aspect: '9:16', style: 'ugc' });
          await out('image', await toBlob(c), 'Keyframe');
          await step('Recording voice-over', 900);
          job.steps.push({ label: input.format === 'talking' ? 'Lip-syncing the creator' : 'Animating product shot', status: 'running' });
          const v = await record({ frames: [c], seconds: 6, move: input.format === 'talking' ? 'talk' : 'dolly-in', captions: input.captions !== false ? script : '' });
          job.steps[job.steps.length - 1].status = 'done';
          if (v) await out('video', v, 'Final ad');
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
          const n = Math.min(6, input.scenes || 4);
          await step('Planning scenes & narration', 1200);
          const lines = Array.from({ length: n }, (_, k) => (k === 0 ? `Did you know this about ${input.prompt}? Stay till the end.` : k === n - 1 ? 'Follow for more stories like this!' : `Part ${k + 1}: here is something most people never notice.`));
          job.title = input.prompt.slice(0, 60);
          job.text = lines.map((l, k) => `${k + 1}. ${l}`).join('\n\n') + '\n\n#fyp #malaysia #faktamenarik';
          job.outputs.push({ type: 'text', url: null, label: 'Script & caption' });
          await step(`Recording ${n} voice-overs`, 900);
          await step(`Painting ${n} scenes`, 1200);
          const frames = [];
          for (let k = 0; k < n; k++) { const c = await compose({ prompt: input.prompt + ' scene ' + k, friend: fr, aspect: input.aspect, style: input.style }); frames.push(c); await out('image', await toBlob(c), `Scene ${k + 1}`); }
          job.steps.push({ label: `Animating ${n} clips & editing`, status: 'running' });
          const v = await record({ frames, aspect: input.aspect, seconds: Math.min(12, n * 2.4), move: 'dolly-in', captions: input.captions !== false ? lines.join(' ') : '' });
          job.steps[job.steps.length - 1].status = 'done';
          if (v) await out('video', v, 'Final video');
        }
        job.status = 'done';
        job.cost = Math.max(1, Math.round(job.estimate * 0.85));
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

  // ---------- the fake API ----------
  async function handle(url, body, method = body ? 'POST' : 'GET') {
    await sleep(120);
    const u = new URL(url, location.origin);
    const p = u.pathname;
    if (p === '/api/state') {
      return {
        userId: 'preview', mode: 'preview', mock: true, ffmpeg: true, credits: st.credits, llmModel: 'google/gemini-2.5-flash', payments: true,
        catalog: { videoModels: VIDEO_MODELS, voices: VOICES, price: PRICE, styles: [], cameras: [], platforms: { tiktok: 'TikTok Shop', shopee: 'Shopee', lazada: 'Lazada', instagram: 'Instagram Reels' }, angles: [], langs: ['ms', 'en', 'manglish'] },
      };
    }
    if (p === '/api/ledger') return st.ledger.slice(0, 100);
    if (p === '/api/upload') return { url: body.dataUrl };
    if (p === '/api/estimate') return { credits: Math.ceil((ESTIMATE[body.tool] || (() => 0))(body.input || {})) };
    if (p === '/api/checkout') throw err('Payments are switched off in this preview.');
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
    throw err('Not available in preview');
  }

  window.PreviewAPI = { handle, reset() { localStorage.removeItem(LS); indexedDB.deleteDatabase('if-preview'); location.reload(); } };
})();
