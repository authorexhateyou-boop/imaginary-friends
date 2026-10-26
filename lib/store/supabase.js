// Hosted multi-user store on Supabase: Postgres tables (see supabase/schema.sql) + a public Storage bucket.
// The server uses the service-role key; Row Level Security blocks direct browser access to the tables.
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const supabase = sb;

const PUBLIC_BASE = `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${config.bucket}/`;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav' };

function check({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const COLUMNS = {
  friends: ['id', 'name', 'note', 'photos'],
  products: ['id', 'name', 'image', 'price', 'link', 'benefits'],
};
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));

export const store = {
  kind: 'supabase',

  async ensureProfile(uid) {
    const credits = check(await sb.rpc('ensure_profile', { p_user: uid, p_free: config.freeCredits }), 'ensure_profile');
    return { id: uid, credits };
  },
  async getProfile(uid) {
    return check(await sb.from('profiles').select('id, credits, created_at').eq('id', uid).maybeSingle(), 'profile');
  },

  async adjust(uid, delta, what, job, allowNegative = false) {
    const { data, error } = await sb.rpc('adjust_credits', { p_user: uid, p_delta: delta, p_what: what, p_job: job, p_allow_negative: allowNegative });
    if (error) throw new Error(/INSUFFICIENT_CREDITS/.test(error.message) ? 'INSUFFICIENT_CREDITS' : `credits: ${error.message}`);
    return data;
  },
  async ledger(uid, limit = 50) {
    const rows = check(await sb.from('ledger').select('at, what, credits, job').eq('user_id', uid).order('at', { ascending: false }).limit(limit), 'ledger');
    return rows.map((r) => ({ ...r, at: Date.parse(r.at) }));
  },

  async list(table, uid) {
    return check(await sb.from(table).select('*').eq('user_id', uid).order('created_at', { ascending: false }), table);
  },
  async get(table, uid, id) {
    return check(await sb.from(table).select('*').eq('user_id', uid).eq('id', id).maybeSingle(), table);
  },
  async insert(table, uid, row) {
    return check(await sb.from(table).insert({ ...pick(row, COLUMNS[table]), user_id: uid }).select().single(), table);
  },
  async remove(table, uid, id) {
    check(await sb.from(table).delete().eq('user_id', uid).eq('id', id), table);
    return true;
  },

  async listJobs(uid, limit = 100) {
    const rows = check(await sb.from('jobs').select('data').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit), 'jobs');
    return rows.map((r) => r.data);
  },
  async getJob(uid, id) {
    const r = check(await sb.from('jobs').select('data').eq('user_id', uid).eq('id', id).maybeSingle(), 'job');
    return r?.data || null;
  },
  async saveJob(job) {
    check(await sb.from('jobs').upsert({
      id: job.id, user_id: job.user_id, tool: job.tool, status: job.status, data: job,
      created_at: new Date(job.createdAt).toISOString(),
    }), 'save job');
  },
  async deleteJob(uid, id) { check(await sb.from('jobs').delete().eq('user_id', uid).eq('id', id), 'delete job'); },
  async staleJobs() {
    const rows = check(await sb.from('jobs').select('data').eq('status', 'running'), 'stale jobs');
    return rows.map((r) => r.data);
  },

  async recordPayment(p) {
    const { error } = await sb.from('payments').insert(p);
    if (error) {
      if (error.code === '23505') return false; // already granted
      throw new Error(`payment: ${error.message}`);
    }
    return true;
  },

  async putFile(buf, ext) {
    const d = new Date();
    const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.${ext}`;
    check(await sb.storage.from(config.bucket).upload(key, buf, { contentType: MIME[ext] || 'application/octet-stream', upsert: false }), 'upload');
    return PUBLIC_BASE + key;
  },
  async deleteFiles(urls) {
    const keys = urls.filter((u) => this.isOwnUrl(u)).map((u) => u.slice(PUBLIC_BASE.length));
    if (keys.length) await sb.storage.from(config.bucket).remove(keys);
  },
  localPath() { return null; },
  isOwnUrl(url) { return typeof url === 'string' && url.startsWith(PUBLIC_BASE) && !url.includes('..'); },

  async users(limit = 100) {
    return check(await sb.from('profiles').select('id, credits, created_at').order('created_at', { ascending: false }).limit(limit), 'users');
  },

  /** Verify a browser access token and return the user id (cached briefly). */
  async userFromToken(token) {
    const hit = tokenCache.get(token);
    if (hit && hit.exp > Date.now()) return hit.uid;
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    tokenCache.set(token, { uid: data.user.id, exp: Date.now() + 60_000 });
    if (tokenCache.size > 5000) tokenCache.clear();
    return data.user.id;
  },
};
const tokenCache = new Map();
