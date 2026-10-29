/* Kravitas: home bento, avatars, voice cloning, storyboard editor, auto-posting and plans.
   Loaded after app.js and uses its helpers ($, esc, api, toast, modal, S, F, …). */

const RM = (n) => `${CFG.currency === 'MYR' || !CFG.currency ? 'RM' : CFG.currency + ' '}${n}`;
const PLATFORM_META = {
  tiktok: { name: 'TikTok', icon: '♪' }, instagram: { name: 'Instagram', icon: '◎' }, facebook: { name: 'Facebook', icon: 'f' },
  youtube: { name: 'YouTube', icon: '▶' }, threads: { name: 'Threads', icon: '@' },
};
const ACTIONS = {
  avatars: () => avatarLibraryModal(),
  createAvatar: () => avatarBuilderModal(),
  clone: () => voiceCloneModal(),
  storyboard: () => { setMode('story'); renderAll(); storyboardModal({ input: F() }); },
  brainstorm: () => { setMode('ad'); renderAll(); runBrainstorm(); },
  batch: () => { setMode('ad'); S.forms.ad = { ...(S.forms.ad || DEFAULTS.ad()), variants: 5 }; renderAll(); toast('5 variations set. Add a product and hit Generate'); },
  plans: () => accountModal(),
  newFriend: () => friendModal(),
  newProduct: () => productModal(),
};

// ---------- illustrated portraits (preview thumbnails for avatar presets / builder) ----------
const SKIN = { fair: '#f3d2bd', 'light tan': '#e7b897', 'warm tan': '#d9a07a', 'medium brown': '#b97c55', 'deep brown': '#7f5136' };
const HUE = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function drawPortrait(look = {}, size = 400) {
  const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * 1.25);
  const x = c.getContext('2d'); const W = c.width, H = c.height, u = W / 100;
  const h = HUE(look.bg || look.outfit || 'x');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `hsl(${h},28%,82%)`); g.addColorStop(1, `hsl(${(h + 40) % 360},22%,58%)`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const skin = SKIN[look.skin] || SKIN['warm tan'];
  const hair = String(look.hair || '').toLowerCase();
  const hijab = hair.includes('hijab') || hair.includes('tudung');
  const hijabCol = hair.includes('pastel') ? `hsl(${(h + 180) % 360},45%,80%)` : hair.includes('navy') ? '#22304d' : hair.includes('black') ? '#1b1b1f' : `hsl(${(h + 200) % 360},30%,55%)`;
  const outfit = `hsl(${(HUE(look.outfit || 'o') + 20) % 360},${look.outfit?.includes('black') ? 0 : 35}%,${look.outfit?.includes('black') ? 14 : 45}%)`;
  const cx = W / 2, fy = H * 0.42;
  // shoulders
  x.fillStyle = outfit; x.beginPath(); x.ellipse(cx, H * 1.02, 46 * u, 34 * u, 0, Math.PI, 0); x.fill();
  // neck
  x.fillStyle = skin; x.fillRect(cx - 8 * u, fy + 18 * u, 16 * u, 18 * u);
  if (hijab) { // hijab drape behind face and over shoulders
    x.fillStyle = hijabCol; x.beginPath(); x.ellipse(cx, fy + 2 * u, 27 * u, 31 * u, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(cx - 27 * u, fy + 6 * u); x.quadraticCurveTo(cx, fy + 60 * u, cx + 27 * u, fy + 6 * u); x.lineTo(cx + 34 * u, H * 0.85); x.lineTo(cx - 34 * u, H * 0.85); x.fill();
  } else if (hair.includes('long') || hair.includes('wavy')) {
    x.fillStyle = '#1d1512'; x.beginPath(); x.ellipse(cx, fy + 10 * u, 25 * u, 38 * u, 0, 0, Math.PI * 2); x.fill();
  }
  // face
  x.fillStyle = skin; x.beginPath(); x.ellipse(cx, fy, 19 * u, 23 * u, 0, 0, Math.PI * 2); x.fill();
  if (!hijab) { // hair cap
    x.fillStyle = '#1d1512'; x.beginPath();
    if (hair.includes('bob')) { x.ellipse(cx, fy - 8 * u, 22 * u, 20 * u, 0, Math.PI, 0); x.fill(); x.fillRect(cx - 22 * u, fy - 8 * u, 6 * u, 22 * u); x.fillRect(cx + 16 * u, fy - 8 * u, 6 * u, 22 * u); }
    else { x.ellipse(cx, fy - 12 * u, 20 * u, 14 * u, 0, Math.PI, 0); x.fill(); }
  }
  // eyes, brows, smile
  x.fillStyle = '#1b1b1f'; [-7, 7].forEach((d) => { x.beginPath(); x.ellipse(cx + d * u, fy - 1 * u, 1.7 * u, 2.2 * u, 0, 0, Math.PI * 2); x.fill(); });
  x.strokeStyle = '#3a2a22'; x.lineWidth = 1.2 * u; x.lineCap = 'round';
  [-7, 7].forEach((d) => { x.beginPath(); x.moveTo(cx + d * u - 3 * u, fy - 6 * u); x.lineTo(cx + d * u + 3 * u, fy - 6.5 * u); x.stroke(); });
  x.strokeStyle = '#a24a3a'; x.lineWidth = 1.6 * u; x.beginPath(); x.arc(cx, fy + 7 * u, 6 * u, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  if (hair.includes('beard')) { x.fillStyle = 'rgba(29,21,18,.55)'; x.beginPath(); x.ellipse(cx, fy + 14 * u, 15 * u, 9 * u, 0, 0, Math.PI); x.fill(); }
  return c.toDataURL('image/jpeg', 0.86);
}
const portraitCache = new Map();
const portrait = (look, key) => { const k = key || JSON.stringify(look); if (!portraitCache.has(k)) portraitCache.set(k, drawPortrait(look)); return portraitCache.get(k); };

// ---------- home (bento) ----------
function renderHome() {
  const a = S.app;
  const presets = a.catalog.avatars || [];
  const nextPost = (S.posts || []).filter((p) => p.status === 'scheduled' && p.scheduledAt > Date.now()).sort((x, y) => x.scheduledAt - y.scheduledAt)[0];
  const plan = (CFG.plans || []).find((p) => p.id === a.plan);
  const creator = (CFG.plans || []).find((p) => p.id === 'creator') || { credits: 1600, price: 79 };
  $('#presets').innerHTML = `
    <section class="bento">
      <a class="bx b-hero" href="#" data-go="ad">
        <span class="eyebrow">For affiliates · TikTok Shop & Shopee</span>
        <h1>Your product.<br>Your face.<br>Ad in one click.</h1>
        <p>Hook, script, Malay voice-over, lip-synced creator video and captions. Make 5 variations at once and test which one sells.</p>
        <span class="cta">Make an ad →</span>
        <span class="stat">≈ 32 credits per 10s talking ad</span>
      </a>
      <a class="bx" href="#" data-act="brainstorm"><span class="ic">✨</span><h3>Brainstorm</h3><p>Kravitas studies your photos and suggests hooks, angles and ready-made ideas.</p></a>
      <a class="bx b-av" href="#" data-act="avatars"><div class="faces">${presets.slice(0, 4).map((p) => `<img src="${portrait(p.look, p.id)}" alt="">`).join('')}</div><h3>AI avatars</h3><p>Pick a ready-made creator or design your own.</p></a>
      <a class="bx b-wide" href="#" data-act="storyboard"><span class="ic">🧩</span><h3>Storyboard</h3><p>Plan scene by scene, change one line, and re-render only that scene. You don't pay for the rest again.</p>
        <div class="frames">${[1, 2, 3, 4].map((n) => `<span><b>${n}</b></span>`).join('')}</div></a>
      <a class="bx" href="#" data-go="voice"><span class="ic">🎙️</span><h3>Voice studio</h3><p>ElevenLabs voices, natural BM voices, clone your own voice, music & SFX.</p><div class="wave sm">${'<i></i>'.repeat(18)}</div></a>
      <a class="bx" href="#" data-go="schedule"><span class="ic">📤</span><h3>Auto-post</h3><p>${nextPost ? `Next: ${new Date(nextPost.scheduledAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${nextPost.platforms.map((p) => PLATFORM_META[p]?.name).join(', ')}` : 'Schedule to TikTok, Instagram, Facebook, YouTube and Threads.'}</p>
        <div class="plats">${Object.values(PLATFORM_META).map((p) => `<span>${p.icon}</span>`).join('')}</div></a>
      <a class="bx" href="#" data-act="batch"><span class="ic">×5</span><h3>Batch variations</h3><p>One product, 5 hooks, 5 ads. Find the winner faster.</p></a>
      <a class="bx b-plan" href="#" data-act="plans"><span class="eyebrow">${plan ? `${esc(plan.name)} plan` : 'Plans'}</span><h3>✦ ${a.credits.toLocaleString()} credits</h3>
        <p>${plan ? `${plan.credits.toLocaleString()} credits every month` : `Creator: ${creator.credits.toLocaleString()} credits / month for ${RM(creator.price)}`}</p><span class="cta sm">${plan ? 'Manage' : 'See plans'} →</span></a>
      <div class="bx b-quick"><h3>Create</h3><div class="qk">
        <button data-go="video">🎬<b>Video</b><small>Camera moves</small></button>
        <button data-go="image">🖼<b>Image</b><small>Packshots</small></button>
        <button data-go="talk">🗣<b>Talk</b><small>Lip-sync</small></button>
        <button data-go="story">📽<b>Story</b><small>Narrated</small></button></div></div>
    </section>
    ${guideHTML()}`;
  if (!S.posts) loadPosts().then(() => S.mode === 'home' && renderHome());
}

// ---------- avatars ----------
function avatarLibraryModal() {
  const list = S.app.catalog.avatars || [];
  const m = modal(`<h2>Avatar library</h2>
    <p class="muted" style="margin:0">Ready-made AI creators (not real people). Pick one and they're added to your friends with a consistent face.${S.app.mode === 'preview' ? '' : ` Uses ${S.app.catalog.price.image} credits to render their photo.`}</p>
    <div class="avgrid">${list.map((p) => `<button class="avc" data-av="${p.id}"><img src="${portrait(p.look, p.id)}" alt=""><b>${esc(p.name)}</b><small>${esc(p.tagline)}</small></button>`).join('')}
      <button class="avc new" data-act="createAvatar"><span>＋</span><b>Create your own</b><small>Design a look</small></button></div>`, 'wide');
  m.querySelectorAll('[data-av]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      const job = await api('/api/jobs', { tool: 'avatarGen', input: { preset: b.dataset.av } });
      S.jobs.unshift(job); poll(); closeModal(); renderAll();
      toast(`Creating ${list.find((x) => x.id === b.dataset.av)?.name}… they'll appear in your friends`);
    } catch (e) { toast(e.message, true); b.disabled = false; if (e.code === 'credits') accountModal(); }
  }));
}

const LOOK_FIELDS = {
  gender: ['woman', 'man'],
  age: ['early 20s', '20s', '30s', '40s', '50s'],
  skin: Object.keys(SKIN),
  hair: ['pastel hijab', 'black hijab', 'navy hijab', 'long wavy black hair', 'shoulder-length black bob', 'short black hair', 'short fade', 'short black hair, light beard'],
  style: ['friendly smile', 'energetic, excited', 'calm, trustworthy', 'stylish, confident', 'playful, Gen Z energy'],
};
function avatarBuilderModal() {
  const look = { gender: 'woman', age: '20s', skin: 'warm tan', hair: 'pastel hijab', style: 'friendly smile', outfit: 'cream blouse', bg: 'bright bedroom' };
  const sel = (k) => `<label class="l">${k === 'skin' ? 'Skin tone' : k[0].toUpperCase() + k.slice(1)}</label><select class="in" data-look="${k}">${LOOK_FIELDS[k].map((v) => `<option ${v === look[k] ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const n = S.app.mode === 'preview' ? 4 : 4;
  const m = modal(`<h2>Create your AI avatar</h2>
    <p class="muted" style="margin:0">Design a fictional creator. You get ${n} options to pick from; the one you save keeps the same face in every video.</p>
    <div class="builder">
      <div class="bprev"><img id="avprev" alt=""><small>Rough preview</small></div>
      <div class="bform">
        <label class="l">Name</label><input class="in" id="avname" value="Zara" maxlength="40">
        <div class="row2">${sel('gender')}${sel('age')}</div>
        <div class="row2">${sel('skin')}${sel('hair')}</div>
        ${sel('style')}
        <label class="l">Outfit</label><input class="in" data-look="outfit" value="${esc(look.outfit)}">
        <label class="l">Background</label><input class="in" data-look="bg" value="${esc(look.bg)}">
      </div>
    </div>
    <div class="acts" style="margin-top:16px"><button class="btn pri" id="avgo">Generate ${n} options · ✦ ${S.app.catalog.price.image * n}</button></div>`, 'wide');
  const upd = () => { $('#avprev', m).src = drawPortrait(look); };
  m.querySelectorAll('[data-look]').forEach((el) => (el.oninput = el.onchange = () => { look[el.dataset.look] = el.value; upd(); }));
  upd();
  $('#avgo', m).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const job = await api('/api/jobs', { tool: 'avatarGen', input: { look, count: n, name: $('#avname', m).value.trim() || 'My avatar' } });
      S.jobs.unshift(job); poll(); closeModal(); renderAll();
      toast('Creating your avatar options. Open the card when it’s done and save your favourite');
    } catch (err) { toast(err.message, true); e.target.disabled = false; if (err.code === 'credits') accountModal(); }
  };
}

async function saveAvatarFromJob(j, cur) {
  const img = cur?.type === 'image' ? cur.url : j.outputs.find((o) => o.type === 'image')?.url;
  if (!img) return;
  try {
    const f = await api('/api/friends', { name: j.input?.name || 'My avatar', photos: [img], consent: true, note: 'AI avatar' });
    await load(); closeModal(); renderAll();
    toast(`${f.name} saved to your friends`);
  } catch (e) { toast(e.message, true); }
}

// ---------- voice cloning ----------
function voiceCloneModal() {
  let audio = null, rec = null, chunks = [];
  const m = modal(`<h2>Clone your voice</h2>
    <p class="muted" style="margin:0">Record or upload 30–60 seconds of clear speech. Your voice then reads every script, in BM or English.</p>
    <label class="l">Name</label><input class="in" id="vcname" value="My voice" maxlength="40">
    <label class="l">Sample</label>
    <div class="acts"><button class="btn" id="vcrec">● Record</button><label class="btn" style="cursor:pointer">⬆ Upload audio<input type="file" id="vcfile" accept="audio/*" hidden></label></div>
    <div id="vcstate" class="hint">Tip: read a product description out loud, naturally, in a quiet room.</div>
    <label class="check" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:13px"><input type="checkbox" id="vcok" style="margin-top:3px"> <span>This is my own voice, or I have the speaker’s permission to clone it.</span></label>
    <div class="acts" style="margin-top:14px"><button class="btn pri" id="vcgo">Clone voice · ✦ ${S.app.catalog.price.voiceClone || 125}</button></div>
    ${(S.voices || []).length ? `<label class="l" style="margin-top:22px">Your voices</label><div class="vlist">${S.voices.map((v) => `<div class="vrow"><b>★ ${esc(v.name)}</b>${v.preview_url ? `<audio src="${v.preview_url}" controls preload="none"></audio>` : ''}<button class="link" data-delv="${v.id}">Delete</button></div>`).join('')}</div>` : ''}`);
  const setAudio = (dataUrl, label) => { audio = dataUrl; $('#vcstate', m).innerHTML = `✓ ${esc(label)} <audio src="${dataUrl}" controls></audio>`; };
  const toData = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  $('#vcfile', m).onchange = async (e) => { const f = e.target.files[0]; if (f) setAudio(await toData(f), f.name); };
  $('#vcrec', m).onclick = async (e) => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = [];
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); e.target.textContent = '● Record again'; rec = null; setAudio(await toData(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })), 'Recording'); };
      rec.start(); e.target.textContent = '■ Stop'; $('#vcstate', m).textContent = 'Recording… read naturally for 30–60 seconds.';
    } catch { toast('Microphone is blocked here. Upload a recording instead', true); }
  };
  m.querySelectorAll('[data-delv]').forEach((b) => (b.onclick = async () => { await api('/api/voices/' + b.dataset.delv, null, 'DELETE'); await load(); voiceCloneModal(); }));
  $('#vcgo', m).onclick = async (e) => {
    if (!audio) return toast('Record or upload a sample first', true);
    if (!$('#vcok', m).checked) return toast('Please confirm you have permission to clone this voice', true);
    e.target.disabled = true; e.target.textContent = 'Cloning…';
    try {
      const v = await api('/api/voices', { name: $('#vcname', m).value, audio, consent: true });
      await load();
      S.forms.voice = { ...(S.forms.voice || DEFAULTS.voice()), voice: `clone:${v.id}`, kind: 'tts' };
      closeModal(); setMode('voice'); renderAll();
      toast(`★ ${v.name} is ready. It's now in every voice picker`);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Clone voice'; if (err.code === 'credits') accountModal(); }
  };
}

// ---------- storyboard ----------
const MOTIONS = ['slow cinematic push-in', 'slow pull back revealing the scene', 'smooth pan left to right', 'orbit around the subject', 'crane up', 'handheld, natural shake', 'static, subtle movement'];
async function storyboardModal({ board, reuseFrom, input }) {
  const base = { ...DEFAULTS.story(), ...(input || {}) };
  let b = board ? JSON.parse(JSON.stringify(board)) : null;
  const m = modal(`<div class="sb"><div class="sb-h"><div><span class="eyebrow">${reuseFrom ? 'Edit & re-render' : 'Storyboard'}</span><h2>${reuseFrom ? 'Change what you want' : 'Plan your video'}</h2></div></div>
    <div id="sbbody"></div></div>`, 'wide');
  const body = $('#sbbody', m);
  const draw = () => {
    if (!b) {
      body.innerHTML = `<p class="muted">Describe the video and Kravitas writes a scene-by-scene plan you can edit before anything is generated (✦ ${S.app.catalog.price.llm}).</p>
        <textarea class="in" id="sbp" rows="3" placeholder="e.g. 5 surprising facts about Malaysia most people don't know">${esc(base.prompt || '')}</textarea>
        <div class="acts" style="margin-top:10px"><select class="in" id="sbn" style="width:auto">${[3, 4, 5, 6].map((n) => `<option ${n === (base.scenes || 4) ? 'selected' : ''} value="${n}">${n} scenes</option>`).join('')}</select>
        <button class="btn pri" id="sbplan">Plan scenes</button><button class="btn" id="sbblank">Start blank</button></div>`;
      $('#sbplan', m).onclick = async (e) => {
        const prompt = $('#sbp', m).value.trim();
        if (!prompt) return toast('Describe the video first', true);
        e.target.disabled = true; e.target.textContent = 'Planning…';
        try {
          b = await api('/api/storyboard/plan', { prompt, scenes: +$('#sbn', m).value, lang: base.lang, tone: base.tone });
          base.prompt = prompt; draw(); load().then(() => { $('#credits').textContent = `✦ ${S.app.credits.toLocaleString()}`; });
        } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Plan scenes'; }
      };
      $('#sbblank', m).onclick = () => { b = { title: '', caption: '', hashtags: [], scenes: [{ narration: '', visual: '', motion: MOTIONS[0] }] }; draw(); };
      return;
    }
    const orig = board?.scenes || [];
    body.innerHTML = `<label class="l">Title</label><input class="in" id="sbt" value="${esc(b.title || '')}">
      <div class="scenes">${b.scenes.map((s, k) => {
        const changed = reuseFrom && JSON.stringify(orig[k]) !== JSON.stringify(s);
        return `<div class="scene ${changed ? 'chg' : ''}" data-k="${k}">
          <div class="sc-h"><b>Scene ${k + 1}</b>${reuseFrom ? `<span class="tagx">${changed ? 'will re-render' : 'kept'}</span>` : ''}<span class="sp"></span>
            <button class="link" data-mv="-1" ${k ? '' : 'disabled'}>↑</button><button class="link" data-mv="1" ${k < b.scenes.length - 1 ? '' : 'disabled'}>↓</button><button class="link" data-rm ${b.scenes.length > 1 ? '' : 'disabled'}>Remove</button></div>
          <label class="l">Narration (what the voice says)</label><textarea class="in" data-f="narration" rows="2">${esc(s.narration)}</textarea>
          <label class="l">Visual (what we see)</label><textarea class="in" data-f="visual" rows="2">${esc(s.visual)}</textarea>
          <label class="l">Camera</label><select class="in" data-f="motion">${[...new Set([s.motion, ...MOTIONS])].filter(Boolean).map((x) => `<option ${x === s.motion ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>`;
      }).join('')}</div>
      <div class="acts"><button class="btn" id="sbadd" ${b.scenes.length >= 8 ? 'disabled' : ''}>＋ Add scene</button></div>
      <label class="l">Caption & hashtags</label><textarea class="in" id="sbc" rows="2">${esc([b.caption, (b.hashtags || []).join(' ')].filter(Boolean).join('\n'))}</textarea>
      <div class="sb-f"><span class="muted" id="sbest">✦ …</span><button class="btn pri" id="sbgo">${reuseFrom ? 'Re-render changes' : 'Generate video'}</button></div>`;
    const est = async () => { try { const r = await api('/api/estimate', { tool: 'story', input: { ...base, board: b } }); $('#sbest', m).textContent = reuseFrom ? `✦ up to ${r.credits} · unchanged scenes are reused free` : `✦ ${r.credits} credits`; } catch {} };
    body.oninput = (e) => {
      const card = e.target.closest('.scene');
      if (card && e.target.dataset.f) b.scenes[+card.dataset.k][e.target.dataset.f] = e.target.value;
      if (e.target.id === 'sbt') b.title = e.target.value;
      if (e.target.id === 'sbc') { const lines = e.target.value.split('\n'); const tags = lines.join(' ').match(/#[\wÀ-ɏ]+/g) || []; b.hashtags = tags; b.caption = lines.filter((l) => !/^\s*#/.test(l)).join(' ').replace(/#[\wÀ-ɏ]+/g, '').trim(); }
      if (card && reuseFrom) { const k = +card.dataset.k; const ch = JSON.stringify(orig[k]) !== JSON.stringify(b.scenes[k]); card.classList.toggle('chg', ch); const t = card.querySelector('.tagx'); if (t) t.textContent = ch ? 'will re-render' : 'kept'; }
      clearTimeout(body._t); body._t = setTimeout(est, 300);
    };
    body.onchange = body.oninput;
    body.onclick = (e) => {
      const card = e.target.closest('.scene'); const k = card ? +card.dataset.k : -1;
      if (e.target.closest('[data-mv]')) { const d = +e.target.closest('[data-mv]').dataset.mv; [b.scenes[k], b.scenes[k + d]] = [b.scenes[k + d], b.scenes[k]]; draw(); }
      if (e.target.closest('[data-rm]')) { b.scenes.splice(k, 1); draw(); }
    };
    $('#sbadd', m).onclick = () => { b.scenes.push({ narration: '', visual: '', motion: MOTIONS[0] }); draw(); };
    $('#sbgo', m).onclick = async (e) => {
      if (!b.scenes.some((s) => s.narration.trim())) return toast('Write the narration for at least one scene', true);
      e.target.disabled = true;
      try {
        const job = await api('/api/jobs', { tool: 'story', input: { ...base, prompt: base.prompt || b.title, board: b, reuseFrom: reuseFrom || undefined } });
        S.jobs.unshift(job); setMode('story'); closeModal(); renderAll(); poll();
        $('#feed').scrollIntoView({ behavior: 'smooth' });
      } catch (err) { toast(err.message, true); e.target.disabled = false; if (err.code === 'credits') accountModal(); }
    };
    est();
  };
  draw();
}

// ---------- auto-posting ----------
async function loadPosts() {
  try { [S.posts, S.accounts] = await Promise.all([api('/api/social/posts'), S.app.social ? api('/api/social/accounts') : Promise.resolve([])]); }
  catch { S.posts = S.posts || []; S.accounts = S.accounts || []; }
}

async function renderSchedule() {
  const el = $('#presets');
  el.innerHTML = '<div class="empty" style="margin-top:30px">Loading…</div>';
  await loadPosts();
  const on = S.app.social;
  const posts = S.posts || [];
  const upcoming = posts.filter((p) => p.status === 'scheduled' || p.status === 'processing' || p.status === 'draft');
  const done = posts.filter((p) => !upcoming.includes(p));
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k); return d; });
  const dayPosts = (d) => upcoming.filter((p) => p.scheduledAt && new Date(p.scheduledAt).toDateString() === d.toDateString());
  const row = (p) => {
    const job = S.jobs.find((j) => j.id === p.jobId);
    const thumb = job?.outputs.find((o) => o.type === 'image')?.url;
    const st = p.status === 'processed' ? (p.results?.some((r) => r.success === false) ? 'partly failed' : 'posted') : p.status;
    return `<div class="prow">${thumb ? `<img src="${thumb}" alt="">` : '<span class="pt">▶</span>'}<div class="pi"><b>${esc((p.caption || job?.title || 'Post').slice(0, 80))}</b>
      <small>${p.platforms.map((x) => PLATFORM_META[x]?.name || x).join(' · ')} · ${p.scheduledAt ? new Date(p.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Posted now'}${p.aiLabel ? ' · AI label on' : ''}</small>
      ${(p.results || []).filter((r) => r.url || r.error).map((r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">View post ↗</a>` : `<span class="perr">${esc(r.error)}</span>`)).join(' ')}</div>
      <span class="pst ${st.replace(' ', '-')}">${st}</span></div>`;
  };
  el.innerHTML = `
    <div class="hero" style="text-align:left;padding-top:10px"><h1 style="font-size:clamp(28px,4vw,44px)">Auto-post</h1>
      <p style="margin-left:0">Connect your accounts once, then post or schedule any creation from its card. TikTok and YouTube posts are labelled as AI-generated.</p>
      ${on ? '' : S.app.mode === 'preview' ? '' : '<div class="banner">Auto-posting switches on when POSTFORME_API_KEY is added on the server.</div>'}</div>
    <div class="accts">${Object.entries(PLATFORM_META).map(([k, p]) => {
      const acc = (S.accounts || []).find((a) => a.platform === k);
      return `<div class="acct ${acc ? 'on' : ''}"><span class="pic">${p.icon}</span><b>${p.name}</b><small>${acc ? esc(acc.username || 'Connected') : 'Not connected'}</small>
        ${acc ? `<button class="link" data-disc="${acc.id}">Disconnect</button>` : `<button class="btn ${on ? 'pri' : ''}" data-conn="${k}" ${on ? '' : 'disabled'}>Connect</button>`}</div>`;
    }).join('')}</div>
    <div class="strip-h"><h2>Next 7 days</h2><button class="btn pri" data-newpost>＋ Schedule a post</button></div>
    <div class="week">${days.map((d) => `<div class="day ${dayPosts(d).length ? 'has' : ''}"><small>${d.toLocaleDateString([], { weekday: 'short' })}</small><b>${d.getDate()}</b><span>${dayPosts(d).length ? `${dayPosts(d).length} post${dayPosts(d).length > 1 ? 's' : ''}` : '—'}</span></div>`).join('')}</div>
    <div class="strip-h"><h2>Queue</h2></div>
    <div class="plist">${upcoming.map(row).join('') || '<div class="empty">Nothing scheduled. Open any video in your creations and tap “Post / schedule”.</div>'}</div>
    ${done.length ? `<div class="strip-h"><h2>Posted</h2></div><div class="plist">${done.map(row).join('')}</div>` : ''}`;
  el.querySelectorAll('[data-conn]').forEach((b) => (b.onclick = async () => {
    try {
      const r = await api('/api/social/connect', { platform: b.dataset.conn });
      if (r.url) { window.open(r.url, '_blank', 'noopener'); toast('Finish connecting in the new tab, then come back'); setTimeout(renderSchedule, 4000); } else renderSchedule();
    } catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll('[data-disc]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Disconnect this account?', 'Disconnect'))) return; await api('/api/social/accounts/' + b.dataset.disc, null, 'DELETE'); renderSchedule(); }));
  el.querySelector('[data-newpost]').onclick = () => pickVideoForPost();
}

function pickVideoForPost() {
  const vids = S.jobs.filter((j) => j.status === 'done' && j.outputs.some((o) => o.type === 'video'));
  if (!vids.length) return toast('Make a video first, then schedule it here', true);
  const m = modal(`<h2>Pick a video</h2><div class="pick">${vids.slice(0, 24).map((j) => { const t = j.outputs.find((o) => o.type === 'image')?.url; return `<button data-pj="${j.id}">${t ? `<img src="${t}" alt="">` : '<span>▶</span>'}<small>${esc(j.title.slice(0, 40))}</small></button>`; }).join('')}</div>`, 'wide');
  m.querySelectorAll('[data-pj]').forEach((b) => (b.onclick = () => { const j = S.jobs.find((x) => x.id === b.dataset.pj); postModal(j, [...j.outputs].reverse().find((o) => o.type === 'video')); }));
}

function captionFrom(j) {
  const t = j.text || '';
  const cap = /CAPTION:\s*(.+)/.exec(t)?.[1] || j.board?.caption || j.title || '';
  const tags = [...new Set(t.match(/#[\wÀ-ɏ]+/g) || j.board?.hashtags || [])].slice(0, 10).join(' ');
  return [cap, tags].filter(Boolean).join('\n\n');
}

async function postModal(j, video) {
  if (!video) return toast('This creation has no video to post', true);
  await loadPosts();
  const accts = S.accounts || [];
  const inHour = new Date(Date.now() + 3600e3); inHour.setMinutes(0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const m = modal(`<h2>Post or schedule</h2>
    <div class="pm"><video src="${video.url}" muted loop autoplay playsinline></video><div>
      <label class="l">Caption</label><textarea class="in" id="pmc" rows="5" maxlength="2200">${esc(captionFrom(j))}</textarea>
      <label class="l">Post to</label>
      ${accts.length ? `<div class="pacc">${accts.map((a) => `<label><input type="checkbox" value="${a.id}" checked> ${PLATFORM_META[a.platform]?.icon || ''} ${esc(PLATFORM_META[a.platform]?.name || a.platform)} <small>${esc(a.username || '')}</small></label>`).join('')}</div>`
        : `<p class="hint">No accounts connected yet. <a href="#" data-go="schedule">Connect them on the Schedule page</a>.</p>`}
      <label class="l">When</label>
      <div class="acts"><label class="radio"><input type="radio" name="when" value="now"> Now</label><label class="radio"><input type="radio" name="when" value="later" checked> Schedule</label>
        <input class="in" type="datetime-local" id="pmt" value="${local(inHour)}" style="width:auto"></div>
      <label class="check" style="display:flex;gap:8px;margin-top:12px;font-size:13px"><input type="checkbox" id="pmai" checked> Label as AI-generated (recommended; TikTok requires it)</label>
      <div class="acts" style="margin-top:16px"><button class="btn pri" id="pmgo" ${accts.length ? '' : 'disabled'}>Schedule</button></div>
    </div></div>`, 'wide');
  m.querySelectorAll('[name=when]').forEach((r) => (r.onchange = () => { const later = m.querySelector('[name=when]:checked').value === 'later'; $('#pmt', m).disabled = !later; $('#pmgo', m).textContent = later ? 'Schedule' : 'Post now'; }));
  $('#pmgo', m).onclick = async (e) => {
    const later = m.querySelector('[name=when]:checked').value === 'later';
    const ids = [...m.querySelectorAll('.pacc input:checked')].map((x) => x.value);
    if (!ids.length) return toast('Pick at least one account', true);
    e.target.disabled = true;
    try {
      await api('/api/social/posts', { jobId: j.id, mediaUrl: video.url, caption: $('#pmc', m).value, accountIds: ids, scheduledAt: later ? new Date($('#pmt', m).value).toISOString() : null, aiLabel: $('#pmai', m).checked, title: j.title });
      closeModal(); toast(later ? '✓ Scheduled' : '✓ Posting now'); S.posts = null;
      if (S.mode === 'schedule' || S.mode === 'home') renderAll();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

// ---------- plans & credits ----------
function creditsModal(a, ledger) {
  const plans = CFG.plans || [], packs = CFG.packs || [];
  const perAd = 32;
  const m = modal(`<h2>Plans & credits</h2>
    <p style="font-size:38px;font-weight:800;letter-spacing:-.04em;margin:6px 0 2px">✦ ${a.credits.toLocaleString()}</p>
    <p class="muted" style="margin:0">A 10s talking ad ≈ ${perAd} credits · an image 10 · a 5s video 10 · a voice-over 1–3.</p>
    ${CFG.payments ? `<label class="l" style="margin-top:20px">Monthly plans</label>
    <div class="plans">${plans.map((p) => `<div class="plan ${a.plan === p.id ? 'cur' : ''}">${p.tag ? `<span class="ptag">${esc(p.tag)}</span>` : ''}<b>${esc(p.name)}</b>
      <div class="pp">${RM(p.price)}<small>/month</small></div><div class="pc">${p.credits.toLocaleString()} credits / month</div>
      <small class="muted">≈ ${Math.floor(p.credits / perAd)} talking ads</small>
      ${a.plan === p.id ? '<span class="btn">Current plan</span>' : `<button class="btn pri" data-plan="${esc(p.id)}">Subscribe</button>`}</div>`).join('')}</div>
    ${a.plan ? '<p class="hint"><a href="#" id="portal">Manage or cancel your plan</a></p>' : '<p class="hint">Cancel anytime. Unused credits stay on your account.</p>'}
    <label class="l" style="margin-top:18px">One-off top-ups</label>
    <div class="packs">${packs.map((p) => `<button class="pack" data-pack="${esc(p.id)}">${p.tag ? `<span class="ptag">${esc(p.tag)}</span>` : ''}<b>${p.credits.toLocaleString()}</b><small>credits</small><span class="price">${RM(p.price)}</span></button>`).join('')}</div>
    <p class="hint">Secure checkout by Stripe: card, FPX online banking, GrabPay.</p>` : '<p class="hint" style="margin-top:14px">Plans are coming soon.</p>'}
    ${a.mode === 'preview' ? '<p class="hint">Preview: these show the real checkout, but payments are switched off. <a href="#" id="reset">Reset preview data</a></p>' : ''}
    <p class="hint">Guest account on this browser. Account ID: <code style="user-select:all">${esc(a.userId)}</code></p>
    <label class="l" style="margin-top:18px">Activity</label>${ledgerTable(ledger)}
    <p class="hint" style="margin-top:14px"><a href="terms" target="_blank">Terms</a> · <a href="privacy" target="_blank">Privacy</a></p>`, 'wide');
  $('#reset', m) && ($('#reset', m).onclick = (e) => { e.preventDefault(); confirmBox('Clear all preview friends, products and creations?', 'Clear').then((ok) => ok && window.PreviewAPI.reset()); });
  $('#portal', m) && ($('#portal', m).onclick = async (e) => { e.preventDefault(); try { location.href = (await api('/api/billing/portal', {})).url; } catch (err) { toast(err.message, true); } });
  const go = (body) => async (e) => { e.target.disabled = true; try { location.href = (await api('/api/checkout', body)).url; } catch (err) { toast(err.message, true); e.target.disabled = false; } };
  m.querySelectorAll('[data-plan]').forEach((b) => (b.onclick = go({ plan: b.dataset.plan })));
  m.querySelectorAll('[data-pack]').forEach((b) => (b.onclick = go({ pack: b.dataset.pack })));
}
