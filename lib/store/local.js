// Single-machine store: JSON file + files in data/media. Used when Supabase isn't configured.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../config.js';

const DATA = path.join(ROOT, 'data');
export const MEDIA = path.join(DATA, 'media');
const FILE = path.join(DATA, 'db.json');
fs.mkdirSync(MEDIA, { recursive: true });

function load() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  d.settings ||= {};
  d.profiles ||= {};
  for (const k of ['friends', 'products', 'jobs', 'ledger']) d[k] ||= [];
  d.payments ||= {};
  // migrate the earlier single-user format
  if (d.config) {
    d.settings.falKey ||= d.config.falKey || '';
    d.settings.llmModel ||= d.config.llmModel;
    if (!d.profiles.local) d.profiles.local = { id: 'local', credits: d.config.credits ?? config.localStartCredits, createdAt: Date.now() };
    delete d.config;
    delete d.remote;
  }
  for (const k of ['friends', 'products', 'jobs', 'ledger']) for (const r of d[k]) r.user_id ||= 'local';
  return d;
}
const db = load();

let timer;
const save = () => { clearTimeout(timer); timer = setTimeout(() => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE); }, 150); };

export const settings = db.settings;
export const saveSettings = save;

export const store = {
  kind: 'local',

  async ensureProfile(uid) {
    if (!db.profiles[uid]) {
      db.profiles[uid] = { id: uid, credits: 0, createdAt: Date.now() };
      await this.adjust(uid, config.localStartCredits, 'Starting credits', null, true);
    }
    return db.profiles[uid];
  },
  async getProfile(uid) { return db.profiles[uid] || null; },

  async adjust(uid, delta, what, job, allowNegative = false) {
    const p = db.profiles[uid];
    if (!p) throw new Error('Unknown user');
    if (!allowNegative && p.credits + delta < 0) throw new Error('INSUFFICIENT_CREDITS');
    p.credits += delta;
    db.ledger.unshift({ user_id: uid, at: Date.now(), what, credits: delta, job });
    save();
    return p.credits;
  },
  async ledger(uid, limit = 50) { return db.ledger.filter((l) => l.user_id === uid).slice(0, limit); },

  async list(table, uid) { return db[table].filter((r) => r.user_id === uid); },
  async get(table, uid, id) { return db[table].find((r) => r.user_id === uid && r.id === id) || null; },
  async insert(table, uid, row) {
    const r = { ...row, user_id: uid, createdAt: Date.now() };
    db[table].unshift(r);
    save();
    return r;
  },
  async remove(table, uid, id) {
    const before = db[table].length;
    db[table] = db[table].filter((r) => !(r.user_id === uid && r.id === id));
    save();
    return db[table].length !== before;
  },

  async listJobs(uid, limit = 100) { return db.jobs.filter((j) => j.user_id === uid).slice(0, limit); },
  async getJob(uid, id) { return db.jobs.find((j) => j.user_id === uid && j.id === id) || null; },
  async saveJob(job) {
    const i = db.jobs.findIndex((j) => j.id === job.id);
    const copy = JSON.parse(JSON.stringify(job));
    if (i >= 0) db.jobs[i] = copy; else db.jobs.unshift(copy);
    save();
  },
  async deleteJob(uid, id) { db.jobs = db.jobs.filter((j) => !(j.user_id === uid && j.id === id)); save(); },
  async staleJobs() { return db.jobs.filter((j) => j.status === 'running'); },

  async recordPayment(p) {
    if (db.payments[p.session_id]) return false;
    db.payments[p.session_id] = { ...p, at: Date.now() };
    save();
    return true;
  },

  async putFile(buf, ext) {
    const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(MEDIA, name), buf);
    return `/media/${name}`;
  },
  async deleteFiles(urls) {
    for (const u of urls) {
      const p = this.localPath(u);
      if (p) fs.rmSync(p, { force: true });
    }
  },
  localPath(url) {
    if (!url || !url.startsWith('/media/')) return null;
    const p = path.join(MEDIA, path.basename(url));
    return fs.existsSync(p) ? p : null;
  },
  isOwnUrl(url) { return typeof url === 'string' && url.startsWith('/media/') && !url.includes('..'); },

  async users(limit = 100) {
    return Object.values(db.profiles).slice(0, limit);
  },
};
