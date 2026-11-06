// ffmpeg helpers (bundled binary via ffmpeg-static): stitching, voice-over muxing,
// burned-in captions, and placeholder media for demo mode. Works on temp files and
// stores results in our media storage.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { tmpFile, storeTmp, localize, cleanup } from './media.js';

export const hasFF = () => !!ffmpegPath && fs.existsSync(ffmpegPath);

export const DIMS = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [960, 960], '4:5': [864, 1080] };
export const dims = (aspect) => DIMS[aspect] || DIMS['9:16'];

export function ff(args, cwd) {
  return new Promise((resolve, reject) => {
    if (!hasFF()) return reject(new Error('ffmpeg is not available'));
    const p = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error('ffmpeg failed: ' + err.slice(-600)))));
  });
}

function probe(file) {
  return new Promise((resolve) => {
    const c = spawn(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true });
    let e = '';
    c.stderr.on('data', (d) => (e += d));
    c.on('close', () => resolve(e));
    c.on('error', () => resolve(''));
  });
}

/** Media duration in seconds (parsed from ffmpeg's banner, so no ffprobe needed). */
export async function duration(url) {
  if (!hasFF()) return 0;
  const temps = [];
  try {
    const out = await probe(await localize(url, temps));
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  } catch { return 0; } finally { cleanup(temps); }
}

const VENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const fit = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,setsar=1`;

/** Lay a voice track over a video. Video loops if shorter; ends ~0.3s after the voice. */
export async function muxVoice(videoUrl, audioUrl, aspect) {
  const [w, h] = dims(aspect);
  const temps = [];
  const out = tmpFile('mp4');
  try {
    const v = await localize(videoUrl, temps);
    const a = await localize(audioUrl, temps);
    await ff(['-stream_loop', '-1', '-i', v, '-i', a, '-map', '0:v', '-map', '1:a', '-vf', fit(w, h),
      '-af', 'apad=pad_dur=0.3', '-shortest', ...VENC, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', out]);
    return await storeTmp(out);
  } finally { cleanup(temps); }
}

/** Join clips (already normalised by muxVoice) into one video. */
export async function concat(urls) {
  if (urls.length === 1) return urls[0];
  const temps = [];
  const list = tmpFile('txt');
  const out = tmpFile('mp4');
  try {
    const files = [];
    for (const u of urls) files.push(await localize(u, temps));
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    return await storeTmp(out);
  } finally { cleanup([...temps, list]); }
}

const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** Split each segment's text into short punchy chunks, TikTok-style. */
export function toSrt(segments, wordsPerChunk = 4) {
  const cues = [];
  for (const seg of segments) {
    const words = String(seg.text || '').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const chunks = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
    const len = (seg.end - seg.start) / chunks.length;
    chunks.forEach((c, i) => cues.push([seg.start + i * len, seg.start + (i + 1) * len, c]));
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c[0])} --> ${ts(c[1])}\n${c[2]}\n`).join('\n');
}

/** Burn captions into a video. Returns the original url if burning fails (e.g. no fonts). */
export async function burnCaptions(videoUrl, segments, aspect) {
  const temps = [];
  const srt = tmpFile('srt');
  const out = tmpFile('mp4');
  const portrait = aspect === '9:16' || aspect === '4:5';
  const style = `FontName=Arial,Fontsize=${portrait ? 13 : 18},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${portrait ? 70 : 30}`;
  try {
    const v = await localize(videoUrl, temps);
    fs.writeFileSync(srt, toSrt(segments));
    // run inside the temp dir so the subtitles filter gets a plain relative filename (no Windows path escaping)
    await ff(['-i', v, '-vf', `subtitles=${path.basename(srt)}:force_style='${style}'`, ...VENC, '-c:a', 'copy', out], path.dirname(srt));
    return await storeTmp(out);
  } catch (e) {
    console.warn('[captions] burn-in skipped:', e.message.slice(-200));
    fs.rmSync(out, { force: true });
    return videoUrl;
  } finally { cleanup([...temps, srt]); }
}

// ---------- demo-mode placeholders ----------
const COLORS = ['0x7c3aed', '0xdb2777', '0x0891b2', '0xea580c', '0x16a34a', '0x4f46e5'];
const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export async function mockImage(aspect) {
  const [w, h] = dims(aspect);
  if (!hasFF()) {
    const p = tmpFile('svg');
    fs.writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#7c3aed"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${w / 14}" text-anchor="middle">DEMO</text></svg>`);
    return storeTmp(p);
  }
  const out = tmpFile('png');
  await ff(['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${pick()}:c1=${pick()}:x0=0:y0=0:x1=${w}:y1=${h}`, '-frames:v', '1', out]);
  return storeTmp(out);
}

export async function mockVideo(aspect, seconds, fromImage) {
  const [w, h] = dims(aspect);
  const d = Math.max(2, Math.min(15, seconds || 5));
  const out = tmpFile('mp4');
  const temps = [];
  try {
    const src = fromImage && !fromImage.endsWith('.svg') ? await localize(fromImage, temps).catch(() => null) : null;
    if (src) {
      await ff(['-loop', '1', '-i', src, '-t', String(d), '-vf',
        `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},zoompan=z='min(zoom+0.0012,1.2)':d=${Math.ceil(d * 24)}:s=${w}x${h}:fps=24`, ...VENC, out]);
    } else {
      await ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:d=${d}:r=24`, ...VENC, out]);
    }
    return await storeTmp(out);
  } finally { cleanup(temps); }
}

export async function mockAudio(seconds) {
  const out = tmpFile('mp3');
  await ff(['-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`, '-af', 'volume=0.15', '-c:a', 'libmp3lame', out]);
  return storeTmp(out);
}

/** Motion clip from a still image (no AI video): Ken Burns zoom/pan or a subtle "talking" bob. */
const MOTION = {
  in: "z='min(zoom+0.0010,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
  out: "z='if(eq(on,0),1.18,max(zoom-0.0010,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
  pan: "z='1.15':x='(iw-iw/zoom)*on/{N}':y='ih/2-(ih/zoom/2)'",
  up: "z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/{N})'",
  talk: "z='1.06+0.012*sin(on/7)':x='iw/2-(iw/zoom/2)+4*sin(on/11)':y='ih/2-(ih/zoom/2)+3*sin(on/5)'",
};
export const MOTION_MOVES = Object.keys(MOTION);
export async function motionClip(imageUrl, seconds, aspect, move = 'in') {
  const [w, h] = dims(aspect);
  const d = Math.max(2, Math.min(60, seconds || 6));
  const n = Math.ceil(d * 30);
  const temps = [];
  const out = tmpFile('mp4');
  try {
    const src = await localize(imageUrl, temps);
    const expr = (MOTION[move] || MOTION.in).replaceAll('{N}', String(n));
    // upscale first so the zoom stays smooth, then zoompan down to the output size
    await ff(['-loop', '1', '-i', src, '-t', String(d), '-vf',
      `scale=${Math.round(w * 1.5)}:${Math.round(h * 1.5)}:force_original_aspect_ratio=increase,crop=${Math.round(w * 1.5)}:${Math.round(h * 1.5)},zoompan=${expr}:d=${n}:s=${w}x${h}:fps=30,setsar=1`,
      ...VENC, out]);
    return await storeTmp(out);
  } finally { cleanup(temps); }
}

// ---------- editor: prepare clips, mix voice/music, all with consistent streams so concat can copy ----------
const AENC = ['-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2'];
export async function hasAudio(url) {
  const temps = [];
  try { return /Audio:/.test(await probe(await localize(url, temps))); } catch { return false; } finally { cleanup(temps); }
}
/** Turn an image (animated) or a video into a normalised clip that always has an audio track. */
export async function prepClip(url, kind, aspect, seconds, move = 'in', keepSound = true) {
  const [w, h] = dims(aspect);
  const src = kind === 'image' ? await motionClip(url, seconds, aspect, move) : url;
  const audio = kind !== 'image' && keepSound && (await hasAudio(src));
  const temps = [];
  const out = tmpFile('mp4');
  try {
    const v = await localize(src, temps);
    await ff(['-i', v, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', audio ? '0:a' : '1:a',
      '-vf', fit(w, h), '-shortest', ...VENC, ...AENC, out]);
    return await storeTmp(out);
  } finally { cleanup(temps); }
}
/** Lay an audio track over a video. kind 'voice' keeps the video at least as long as the voice (looping it),
    kind 'music' loops the music under the whole video. The video's own sound is kept at `origVol`. */
export async function mixTrack(videoUrl, audioUrl, { kind = 'voice', vol = 1, origVol = 1 } = {}) {
  const temps = [];
  const out = tmpFile('mp4');
  try {
    const v = await localize(videoUrl, temps);
    const a = await localize(audioUrl, temps);
    const vd = await duration(videoUrl), ad = await duration(audioUrl);
    const total = kind === 'voice' ? Math.max(vd, ad + 0.4) : vd;
    const loopV = total > vd + 0.05;
    await ff([...(loopV ? ['-stream_loop', '-1'] : []), '-i', v, ...(kind === 'music' ? ['-stream_loop', '-1'] : []), '-i', a,
      '-filter_complex', `[0:a]volume=${origVol}[a0];[1:a]volume=${vol},apad[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      '-map', '0:v', '-map', '[a]', '-t', total.toFixed(2), ...(loopV ? VENC : ['-c:v', 'copy']), ...AENC, out]);
    return await storeTmp(out);
  } finally { cleanup(temps); }
}
