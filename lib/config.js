// Runtime configuration from environment variables (and an optional .env file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (works on any Node version; real env vars win).
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env */ }

const env = process.env;
const int = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? Math.round(+v) : d);

export const config = {
  port: int(env.PORT, 3365),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),

  // Supabase = hosted multi-user platform. Without it the app runs in single-user local mode.
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  bucket: env.SUPABASE_BUCKET || 'media',

  falKey: env.FAL_KEY || '',
  llmModel: env.LLM_MODEL || 'google/gemini-2.5-flash',

  stripeSecret: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  currency: (env.CURRENCY || 'myr').toLowerCase(),

  freeCredits: int(env.FREE_CREDITS, 30),
  localStartCredits: int(env.LOCAL_START_CREDITS, 2000),
  maxRunningJobs: int(env.MAX_RUNNING_JOBS, 3),
  adminToken: env.ADMIN_TOKEN || '',
};

export const MODE = config.supabaseUrl && config.supabaseServiceKey ? 'supabase' : 'local';

// Credit packs sold through Stripe. 1 credit ≈ US$0.01 of AI cost, so set prices with your margin in mind.
// Override with PACKS='[{"id":"starter","credits":400,"price":25}, ...]' (price in whole currency units).
const DEFAULT_PACKS = [
  { id: 'starter', name: 'Starter', credits: 400, price: 25 },
  { id: 'creator', name: 'Creator', credits: 1000, price: 59, tag: 'Popular' },
  { id: 'pro', name: 'Pro', credits: 2800, price: 149, tag: 'Best value' },
];
let packs = DEFAULT_PACKS;
try { if (env.PACKS) packs = JSON.parse(env.PACKS); } catch { console.warn('PACKS env is not valid JSON, using defaults'); }
export const PACKS = packs;
