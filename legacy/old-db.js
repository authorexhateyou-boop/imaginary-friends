// Tiny JSON-file database. No native modules, so it installs cleanly on Windows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const MEDIA = path.join(DATA, 'media');
const FILE = path.join(DATA, 'db.json');

fs.mkdirSync(MEDIA, { recursive: true });

const DEFAULTS = () => ({
  config: {
    falKey: '',
    llmModel: 'google/gemini-2.5-flash',
    credits: 2000,
  },
  friends: [],
  products: [],
  jobs: [],
  ledger: [],
  remote: {}, // local media path -> fal storage url cache
});

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = DEFAULTS();
    return { ...d, ...raw, config: { ...d.config, ...(raw.config || {}) } };
  } catch {
    return DEFAULTS();
  }
}

export const db = load();
if (process.env.FAL_KEY && !db.config.falKey) db.config.falKey = process.env.FAL_KEY;

// Jobs left "running" from a previous session can never finish.
for (const j of db.jobs) {
  if (j.status === 'running' || j.status === 'queued') {
    j.status = 'error';
    j.error = 'Server restarted before this finished.';
  }
}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(saveNow, 150);
}
export function saveNow() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

export const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
export const falKey = () => db.config.falKey || process.env.FAL_KEY || '';
export const isMock = () => !falKey();
