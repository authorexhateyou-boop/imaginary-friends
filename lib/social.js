// Auto-posting via Post for Me (https://www.postforme.dev): one API for TikTok, Instagram,
// Facebook, YouTube and Threads. They handle each platform's OAuth; we tag every connected
// account with the user's id (external_id) so users only ever see their own accounts.
import { config } from './config.js';

const BASE = 'https://api.postforme.dev/v1';
export const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube', 'threads'];
export const socialEnabled = () => !!config.postForMeKey;

async function pfm(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) [].concat(v).forEach((x) => url.searchParams.append(k, x));
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${config.postForMeKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Posting service: ${j.message || j.error || r.statusText}`);
  return j;
}

export async function connectUrl(uid, platform) {
  if (!PLATFORMS.includes(platform)) throw new Error('Unsupported platform');
  const r = await pfm('/social-accounts/auth-url', { method: 'POST', body: { platform, external_id: uid } });
  return r.url;
}

export async function listAccounts(uid) {
  const r = await pfm('/social-accounts', { query: { external_id: uid, status: 'connected', limit: 50 } });
  return (r.data || []).map((a) => ({ id: a.id, platform: a.platform, username: a.username, photo: a.profile_photo_url }));
}

export async function disconnect(uid, id) {
  const acc = (await listAccounts(uid)).find((a) => a.id === id);
  if (!acc) throw new Error('Account not found');
  await pfm(`/social-accounts/${id}/disconnect`, { method: 'POST' });
}

/** Create (or schedule) a post. mediaUrl must be publicly reachable. */
export async function createPost(uid, { caption, accountIds, mediaUrl, scheduledAt, aiLabel = true, title }) {
  const mine = await listAccounts(uid);
  const ids = accountIds.filter((id) => mine.some((a) => a.id === id));
  if (!ids.length) throw new Error('Pick at least one connected account');
  const body = {
    caption,
    social_accounts: ids,
    media: [{ url: mediaUrl }],
    external_id: uid,
    platform_configurations: {
      tiktok: { is_ai_generated: !!aiLabel, privacy_status: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true },
      youtube: { title: (title || caption).slice(0, 95), contains_synthetic_media: !!aiLabel, privacy_status: 'public' },
      instagram: { placement: 'reels' },
    },
  };
  if (scheduledAt) body.scheduled_at = new Date(scheduledAt).toISOString();
  const r = await pfm('/social-posts', { method: 'POST', body });
  return { id: r.id, status: r.status, scheduled_at: r.scheduled_at || null, platforms: mine.filter((a) => ids.includes(a.id)).map((a) => a.platform) };
}

/** Current status + per-platform results (links) for one of our posts. */
export async function postStatus(id) {
  const [p, res] = await Promise.all([pfm(`/social-posts/${id}`), pfm('/social-post-results', { query: { post_id: id } })]);
  return {
    status: p.status,
    results: (res.data || []).map((x) => ({ account: x.social_account_id, success: x.success, url: x.platform_data?.url || null, error: x.error ? String(x.error?.message || x.error) : null })),
  };
}
