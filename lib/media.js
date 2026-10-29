// Media helpers: everything generated is re-hosted in our own storage (local folder or Supabase),
// because fal's CDN links expire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { store } from './store/index.js';

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
};
export const MIME = { ...Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])), svg: 'image/svg+xml', m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' };
const ALLOWED_UPLOAD = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

const TMP = path.join(os.tmpdir(), 'imaginary-friends');
fs.mkdirSync(TMP, { recursive: true });
export const tmpFile = (ext) => path.join(TMP, `${uid()}.${ext}`);

/** Save a user upload (base64 data URL). Images only. */
export async function saveDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m || !ALLOWED_UPLOAD.has(m[1])) throw new Error('Please upload a PNG, JPG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 15 * 1024 * 1024) throw new Error('Image is too large (max 15 MB)');
  return store.putFile(buf, EXT[m[1]]);
}

const AUDIO = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'video/webm': 'webm' };
/** Save a user voice sample (for cloning). */
export async function saveAudioDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+)(?:;[^,]*)?;base64,(.+)$/s.exec(dataUrl || '');
  if (!m || !AUDIO[m[1]]) throw new Error('Please upload an MP3, WAV, M4A or WebM recording');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 10 * 1024 * 1024) throw new Error('Recording is too large (max 10 MB, about 1 minute)');
  return store.putFile(buf, AUDIO[m[1]]);
}

/** Download a model output and keep our own copy. */
export async function download(remoteUrl, fallbackExt = 'bin') {
  if (remoteUrl.startsWith('data:')) {
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(remoteUrl);
    return store.putFile(Buffer.from(m[2], 'base64'), EXT[m[1]] || fallbackExt);
  }
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  let ext = EXT[type];
  if (!ext) {
    const m = /\.(\w{2,4})(?:\?|$)/.exec(remoteUrl);
    ext = m ? m[1].toLowerCase() : fallbackExt;
  }
  return store.putFile(Buffer.from(await res.arrayBuffer()), ext);
}

/** Store a finished temp file and remove it. */
export async function storeTmp(p) {
  try {
    return await store.putFile(fs.readFileSync(p), path.extname(p).slice(1));
  } finally {
    fs.rmSync(p, { force: true });
  }
}

/** Get a local file path for one of our media URLs (downloads cloud files to temp). */
export async function localize(url, temps) {
  const local = store.localPath(url);
  if (local) return local;
  if (!store.isOwnUrl(url)) throw new Error('Unknown media file');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch media (${res.status})`);
  const p = tmpFile(path.extname(new URL(url).pathname).slice(1) || 'bin');
  fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  temps?.push(p);
  return p;
}
export const cleanup = (temps) => temps.forEach((p) => fs.rmSync(p, { force: true }));
