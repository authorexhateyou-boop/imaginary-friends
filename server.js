// Runs the app as a long-lived server (local PC or Railway).
import app from './app.js';
import { config, MODE } from './lib/config.js';
import { recoverStaleJobs } from './lib/pipelines.js';
import { isMock } from './lib/fal.js';
import { hasFF } from './lib/ffmpeg.js';

await recoverStaleJobs().catch((e) => console.error('[recover]', e.message));
app.listen(config.port, () => {
  console.log(`\n  kravitas  →  http://localhost:${config.port}   (${MODE} mode)`);
  console.log(isMock() ? '  DEMO: no fal.ai key, generations use placeholders.' : '  fal.ai connected.');
  console.log(config.stripeSecret ? '  Stripe payments on.' : '  Stripe not configured (no payments).');
  if (!hasFF()) console.warn('  ffmpeg missing: stitching and captions disabled.');
  console.log('');
});
