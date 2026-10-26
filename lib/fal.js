// fal.ai queue wrapper: submit -> poll -> result, plus storage uploads for local files.
import fs from 'node:fs';
import path from 'node:path';
import { fal } from '@fal-ai/client';
import { config, MODE } from './config.js';
import { store } from './store/index.js';
import { MIME } from './media.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = 25 * 60 * 1000;

// Local mode may set the key from the UI; hosted mode only uses the FAL_KEY env var.
let localSettings = null;
if (MODE === 'local') localSettings = (await import('./store/local.js')).settings;

export const falKey = () => config.falKey || localSettings?.falKey || '';
export const isMock = () => !falKey();
export const llmModel = () => localSettings?.llmModel || config.llmModel;

const configure = () => fal.config({ credentials: falKey() });

export function falError(e) {
  const d = e?.body?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ');
  if (typeof d === 'string') return d;
  if (e?.status === 401 || e?.status === 403) return 'fal.ai rejected the API key.';
  return e?.message || String(e);
}

const remoteCache = new Map();
/** Make one of our media URLs reachable by fal. Public cloud URLs pass straight through. */
export async function toRemote(url) {
  if (!url) return url;
  if (/^https?:\/\//.test(url) || isMock()) return url;
  const p = store.localPath(url);
  if (!p) throw new Error(`Missing media file ${url}`);
  if (remoteCache.has(url)) return remoteCache.get(url);
  configure();
  const ext = path.extname(p).slice(1).toLowerCase();
  const remote = await fal.storage.upload(new Blob([fs.readFileSync(p)], { type: MIME[ext] || 'application/octet-stream' }));
  remoteCache.set(url, remote);
  return remote;
}

/** Run a model through fal's queue. onStatus gets queue/progress updates. */
export async function run(model, input, onStatus) {
  configure();
  try {
    const { request_id } = await fal.queue.submit(model, { input });
    const start = Date.now();
    while (true) {
      await sleep(2500);
      const s = await fal.queue.status(model, { requestId: request_id, logs: false });
      onStatus?.(s.status === 'IN_QUEUE' ? `queued #${(s.queue_position ?? 0) + 1}` : 'rendering');
      if (s.status === 'COMPLETED') break;
      if (Date.now() - start > TIMEOUT) throw new Error('timed out');
    }
    return (await fal.queue.result(model, { requestId: request_id })).data;
  } catch (e) {
    throw new Error(`${model}: ${falError(e)}`);
  }
}
