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

  postForMeKey: env.POSTFORME_API_KEY || '',

  freeCredits: int(env.FREE_CREDITS, 40),
  localStartCredits: int(env.LOCAL_START_CREDITS, 2000),
  maxRunningJobs: int(env.MAX_RUNNING_JOBS, 3),
  adminToken: env.ADMIN_TOKEN || '',
};

export const MODE = config.supabaseUrl && config.supabaseServiceKey ? 'supabase' : 'local';

// Credit packs sold through Stripe. 1 credit ≈ US$0.01 of AI cost, so set prices with your margin in mind.
// Override with PACKS='[{"id":"starter","credits":400,"price":25}, ...]' (price in whole currency units).
// One-off top-ups cost more per credit than plans (plans are the better deal on purpose).
const DEFAULT_PACKS = [
  { id: 'small', name: 'Small', credits: 300, price: 25 },
  { id: 'medium', name: 'Medium', credits: 800, price: 59, tag: 'Popular' },
  { id: 'large', name: 'Large', credits: 2000, price: 129 },
];
let packs = DEFAULT_PACKS;
try { if (env.PACKS) packs = JSON.parse(env.PACKS); } catch { console.warn('PACKS env is not valid JSON, using defaults'); }
export const PACKS = packs;

// Monthly plans (Stripe subscriptions). Credits are added every month on renewal.
// 1 credit ≈ US$0.0053 of AI cost (markup 1.9), so at ~RM4.3/USD a fully used plan keeps roughly
// Starter 60% · Creator 55% · Pro 48% gross margin after Stripe fees. Unused credits push it higher.
const DEFAULT_PLANS = [
  { id: 'starter', name: 'Starter', credits: 1000, price: 59, features: ['Motion, Lite & Fast quality', 'Up to 3 variations per ad', 'All voices + brainstorm'] },
  { id: 'creator', name: 'Creator', credits: 2500, price: 129, tag: 'Popular', features: ['Everything in Starter', 'Studio lip-sync + Kling', '5 variations per ad', 'Voice cloning & auto-post'] },
  { id: 'pro', name: 'Pro', credits: 6500, price: 299, tag: 'Best value', features: ['Everything in Creator', 'Premium lip-sync (OmniHuman)', 'Kling Pro video'] },
];
let plans = DEFAULT_PLANS;
try { if (env.PLANS) plans = JSON.parse(env.PLANS); } catch { console.warn('PLANS env is not valid JSON, using defaults'); }
export const PLANS = plans;
