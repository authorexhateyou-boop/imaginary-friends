// Security headers + simple in-memory rate limits (enough for a single Railway instance).
import { config, MODE } from './config.js';

export function securityHeaders(req, res, next) {
  const supa = MODE === 'supabase' ? config.supabaseUrl.replace(/\/$/, '') : '';
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src 'self' data: blob: ${supa}`,
      `media-src 'self' blob: ${supa}`,
      `connect-src 'self' ${supa}`,
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();

/** limit('upload', 40, 60) → max 40 calls per 60 minutes per user (or IP before login). */
export const limit = (name, max, minutes) => (req, res, next) => {
  const key = `${name}:${req.uid || req.ip}`;
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + minutes * 60_000 }; hits.set(key, h); }
  if (++h.n > max) {
    res.set('Retry-After', Math.ceil((h.reset - now) / 1000));
    return res.status(429).json({ error: `Slow down a little: try again in ${Math.ceil((h.reset - now) / 60000)} min.` });
  }
  next();
};
