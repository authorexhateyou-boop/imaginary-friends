// Imaginary Friends — platform server.
// Hosted mode (Supabase configured): every visitor gets an anonymous guest account with its own credits.
// Local mode: one user on this computer, data in ./data.
import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { config, MODE, PACKS, ROOT } from './lib/config.js';
import { store } from './lib/store/index.js';
import { saveDataUrl, uid as newId } from './lib/media.js';
import { isMock, falKey, llmModel } from './lib/fal.js';
import { TOOLS, STYLES, CAMERAS, createJob, recoverStaleJobs, removeBg, live } from './lib/pipelines.js';
import { VIDEO_MODELS, VOICES, PRICE } from './lib/models.js';
import { PLATFORMS, ANGLES, LANGS } from './lib/prompts.js';
import { hasFF } from './lib/ffmpeg.js';
import { securityHeaders, limit } from './lib/security.js';

const stripe = config.stripeSecret ? new Stripe(config.stripeSecret) : null;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
// Terms & Privacy pages, filled in from COMPANY_NAME / SUPPORT_EMAIL.
const legal = (name, title) => (req, res) => {
  const fs2 = (f) => readFileSync(path.join(ROOT, 'legal', f), 'utf8');
  const email = process.env.SUPPORT_EMAIL;
  const fill = (t) => t.replaceAll('{{COMPANY}}', esc(process.env.COMPANY_NAME || 'Treelion Enterprise'))
    .replaceAll('{{DATE}}', '27 October 2026')
    .replaceAll('{{CONTACT}}', email ? `Email <a href="mailto:${esc(email)}">${esc(email)}</a>` : 'Contact us through the support channel listed on our website.');
  res.type('html').send(fill(fs2('_layout.html').replace('{{TITLE}}', title).replace('{{BODY}}', fs2(name))));
};
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/terms', legal('terms.md.html', 'Terms of Service'));
app.get('/privacy', legal('privacy.md.html', 'Privacy Notice'));
app.get('/api/health', (req, res) => res.json({ ok: true, mode: MODE }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (e.message === 'INSUFFICIENT_CREDITS') return res.status(402).json({ error: 'Not enough credits. Top up to continue.', code: 'credits' });
  console.error(e);
  res.status(e.status || 400).json({ error: e.message || String(e) });
});
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Stripe webhook (needs the raw body, so it goes before express.json) ----------
async function grant(session) {
  if (session.payment_status !== 'paid') return false;
  const userId = session.metadata?.user_id || session.client_reference_id;
  const credits = parseInt(session.metadata?.credits, 10);
  if (!userId || !credits) return false;
  const isNew = await store.recordPayment({
    session_id: session.id, user_id: userId, credits, amount: session.amount_total || 0, currency: session.currency || config.currency,
  });
  if (isNew) await store.adjust(userId, credits, `Purchased ${credits} credits`, null, true);
  return isNew;
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), wrap(async (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) throw fail('Stripe webhook not configured', 501);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret);
  } catch (e) { throw fail(`Webhook signature failed: ${e.message}`); }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await grant(event.data.object);
  }
  res.json({ received: true });
}));

app.use(express.json({ limit: '25mb' }));
if (MODE === 'local') app.use('/media', express.static(path.join(ROOT, 'data', 'media'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/vendor/supabase.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js')));

// ---------- public config (no auth) ----------
app.get('/api/config', (req, res) => res.json({
  mode: MODE,
  supabaseUrl: MODE === 'supabase' ? config.supabaseUrl : null,
  supabaseAnonKey: MODE === 'supabase' ? config.supabaseAnonKey : null,
  payments: !!stripe,
  currency: config.currency.toUpperCase(),
  packs: PACKS,
}));

// ---------- auth: guest accounts ----------
const known = new Set();
async function auth(req, res, next) {
  try {
    let uid = 'local';
    if (MODE === 'supabase') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      uid = token && (await store.userFromToken(token));
      if (!uid) return res.status(401).json({ error: 'Session expired, please reload the page.' });
    }
    if (!known.has(uid)) { await store.ensureProfile(uid); known.add(uid); }
    req.uid = uid;
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
}
const adminOnly = (req, res, next) => (config.adminToken && req.headers['x-admin-token'] === config.adminToken ? next() : res.status(403).json({ error: 'Forbidden' }));

// admin routes use their own token, not a guest session
app.get('/api/admin/users', adminOnly, wrap(async (req, res) => res.json(await store.users(200))));
app.post('/api/admin/credits', adminOnly, wrap(async (req, res) => {
  const { userId, credits, note } = req.body;
  const n = parseInt(credits, 10);
  if (!userId || !n) throw fail('userId and credits are required');
  res.json({ credits: await store.adjust(userId, n, note || 'Granted by admin', null, true) });
}));

app.use('/api', auth);

// ---------- state ----------
app.get('/api/state', wrap(async (req, res) => {
  const profile = await store.getProfile(req.uid);
  res.json({
    userId: req.uid, mode: MODE, mock: isMock(), ffmpeg: hasFF(), credits: profile?.credits ?? 0,
    llmModel: llmModel(), keySet: !!falKey(), payments: !!stripe,
    catalog: {
      videoModels: Object.fromEntries(Object.entries(VIDEO_MODELS).map(([k, m]) => [k, { label: m.label, tag: m.tag, perSec: m.perSec }])),
      voices: VOICES, styles: Object.keys(STYLES), cameras: Object.keys(CAMERAS), price: PRICE,
      platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => [k, p.name])),
      angles: Object.keys(ANGLES), langs: Object.keys(LANGS),
    },
  });
}));

app.get('/api/ledger', wrap(async (req, res) => res.json(await store.ledger(req.uid, 100))));

// Local-mode only: the owner sets their own fal key and adds budget credits.
app.post('/api/settings', wrap(async (req, res) => {
  if (MODE !== 'local') throw fail('Settings are managed by the platform', 403);
  const { settings, saveSettings } = await import('./lib/store/local.js');
  const { falKey: k, llmModel: m, addCredits } = req.body;
  if (typeof k === 'string') settings.falKey = k.trim();
  if (m) settings.llmModel = m.trim();
  saveSettings();
  if (addCredits) await store.adjust(req.uid, Math.round(+addCredits), 'Top-up', null, true);
  res.json({ ok: true });
}));

// ---------- payments ----------
app.post('/api/checkout', limit('checkout', 15, 10), wrap(async (req, res) => {
  if (!stripe) throw fail('Payments are not set up yet', 501);
  const pack = PACKS.find((p) => p.id === req.body.pack);
  if (!pack) throw fail('Unknown pack');
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: config.currency,
        unit_amount: Math.round(pack.price * 100),
        product_data: { name: `Imaginary Friends · ${pack.credits.toLocaleString()} credits`, description: `${pack.name} pack` },
      },
    }],
    client_reference_id: req.uid,
    metadata: { user_id: req.uid, credits: String(pack.credits), pack: pack.id },
    success_url: `${base}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?cancelled=1`,
  });
  res.json({ url: session.url });
}));

// Called when Stripe redirects back, so credits appear even before (or without) the webhook.
app.post('/api/checkout/verify', wrap(async (req, res) => {
  if (!stripe) throw fail('Payments are not set up', 501);
  const s = await stripe.checkout.sessions.retrieve(String(req.body.sessionId || ''));
  if ((s.metadata?.user_id || s.client_reference_id) !== req.uid) throw fail('This payment belongs to another account', 403);
  const added = await grant(s);
  res.json({ paid: s.payment_status === 'paid', added, credits: s.metadata?.credits });
}));

// ---------- uploads ----------
app.post('/api/upload', limit('upload', 40, 60), wrap(async (req, res) => res.json({ url: await saveDataUrl(req.body.dataUrl) })));

// ---------- friends ----------
app.get('/api/friends', wrap(async (req, res) => res.json(await store.list('friends', req.uid))));
app.post('/api/friends', limit('create', 30, 60), wrap(async (req, res) => {
  const { name, photos, note, consent } = req.body;
  if (consent !== true) throw fail('Please confirm you have permission to use these photos');
  if (!name?.trim()) throw fail('Give your friend a name');
  if (!photos?.length) throw fail('Add at least one photo, it is the face reference');
  const urls = [];
  for (const p of photos.slice(0, 3)) urls.push(await saveDataUrl(p));
  res.json(await store.insert('friends', req.uid, { id: newId(), name: name.trim().slice(0, 40), note: String(note || '').slice(0, 200), photos: urls }));
}));
app.delete('/api/friends/:id', wrap(async (req, res) => {
  const f = await store.get('friends', req.uid, req.params.id);
  if (f) { await store.remove('friends', req.uid, f.id); }
  res.json({ ok: true });
}));

// ---------- products ----------
app.get('/api/products', wrap(async (req, res) => res.json(await store.list('products', req.uid))));
app.post('/api/products', limit('create', 30, 60), wrap(async (req, res) => {
  const { name, image, price, link, benefits, cutout } = req.body;
  if (!name?.trim()) throw fail('Product name is required');
  if (!image) throw fail('Add a product photo');
  let img = await saveDataUrl(image);
  if (cutout) {
    await store.adjust(req.uid, -PRICE.removeBg, 'Remove background', null);
    img = await removeBg({ charge() {} }, img).catch(async (e) => {
      await store.adjust(req.uid, PRICE.removeBg, 'Refund (remove background failed)', null, true);
      throw e;
    });
  }
  const safeLink = /^https?:\/\//i.test(link || '') ? link : '';
  res.json(await store.insert('products', req.uid, {
    id: newId(), name: name.trim().slice(0, 80), image: img, price: String(price || '').slice(0, 30), link: safeLink, benefits: String(benefits || '').slice(0, 600),
  }));
}));
app.delete('/api/products/:id', wrap(async (req, res) => {
  await store.remove('products', req.uid, req.params.id);
  res.json({ ok: true });
}));

// ---------- jobs ----------
async function lookups(uid) {
  const [friends, products] = await Promise.all([store.list('friends', uid), store.list('products', uid)]);
  return { friends, products, friend: (id) => friends.find((f) => f.id === id), product: (id) => products.find((p) => p.id === id) };
}
function cleanInput(input) {
  const i = { ...input };
  for (const k of ['startImage', 'image']) if (i[k] && !store.isOwnUrl(i[k])) delete i[k];
  delete i.refs;
  for (const k of ['prompt', 'script', 'notes', 'topic', 'tone']) if (typeof i[k] === 'string') i[k] = i[k].slice(0, 2000);
  return i;
}

app.post('/api/estimate', wrap(async (req, res) => {
  const t = TOOLS[req.body.tool];
  if (!t) throw fail('Unknown tool');
  res.json({ credits: Math.ceil(t.estimate(cleanInput(req.body.input || {}))) });
}));

app.post('/api/jobs', limit('jobs', 60, 60), wrap(async (req, res) => {
  const t = TOOLS[req.body.tool];
  if (!t) throw fail('Unknown tool');
  const running = [...live.values()].filter((j) => j.user_id === req.uid).length;
  if (running >= config.maxRunningJobs) throw fail(`You already have ${running} generations running. Wait for one to finish.`, 429);
  const input = cleanInput(req.body.input || {});
  const L = await lookups(req.uid);
  if (input.friendId && !L.friend(input.friendId)) input.friendId = null;
  if (input.productId && !L.product(input.productId)) input.productId = null;
  const job = await createJob({
    uid: req.uid, tool: req.body.tool, title: t.title(input, L), input,
    estimate: Math.ceil(t.estimate(input)), lookups: L, run: (ctx) => t.run(ctx, input),
  });
  res.json(job);
}));

app.get('/api/jobs', wrap(async (req, res) => {
  const jobs = await store.listJobs(req.uid, Math.min(200, +req.query.limit || 100));
  res.json(jobs.map((j) => live.get(j.id) || j));
}));
app.get('/api/jobs/:id', wrap(async (req, res) => {
  const l = live.get(req.params.id);
  if (l && l.user_id === req.uid) return res.json(l);
  const j = await store.getJob(req.uid, req.params.id);
  if (!j) throw fail('Not found', 404);
  res.json(j);
}));
app.delete('/api/jobs/:id', wrap(async (req, res) => {
  const j = await store.getJob(req.uid, req.params.id);
  if (j && j.status !== 'running') {
    const L = await lookups(req.uid);
    const inUse = new Set([...L.friends.flatMap((f) => f.photos), ...L.products.map((p) => p.image)]);
    await store.deleteFiles(j.outputs.map((o) => o.url).filter((u) => u && !inUse.has(u)));
    await store.deleteJob(req.uid, j.id);
  }
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

await recoverStaleJobs().catch((e) => console.error('[recover]', e.message));
app.listen(config.port, () => {
  console.log(`\n  imaginary friends  →  http://localhost:${config.port}   (${MODE} mode)`);
  console.log(isMock() ? '  DEMO: no fal.ai key, generations use placeholders.' : '  fal.ai connected.');
  console.log(stripe ? '  Stripe payments on.' : '  Stripe not configured (no payments).');
  if (!hasFF()) console.warn('  ffmpeg missing: stitching and captions disabled.');
  console.log('');
});
