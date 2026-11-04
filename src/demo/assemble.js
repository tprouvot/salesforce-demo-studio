/**
 * Turns a recorded demo into one video: for each chapter, what was on screen (a slide image, or the video of the
 * window in front) cut to the second, the narration mixed in at the moments it was spoken, then all chapters joined
 * into <demo>.mp4 (H.264 and AAC, chapter marks) with <demo>.srt (subtitles from the same timings). Live chapters
 * use their best take; a chapter of slides and narration is timed here from the narration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ffmpegBinary, probeDuration } from '../engine/media.js';
import { isLive, bestTake, frameOf } from './recorder.js';

const SLIDE_HOLD = 1.2;
const TAIL = 1.0;
const pad = n => String(n).padStart(2, '0');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBinary(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error('ffmpeg: ' + String(stderr || err.message).trim().split('\n').slice(-2).join(' ')));
      else resolve(undefined);
    });
  });
}

/** The image of slide `n` in `dir`: 01.png, 1.png, slide01.png, Slide1.png (PowerPoint's export)... or null. */
export function slideImage(dir, n) {
  if (!dir || !fs.existsSync(dir)) return null;
  const wanted = new Set([pad(n), String(n), `slide${pad(n)}`, `slide${n}`, `slide-${pad(n)}`, `slide-${n}`, `slide_${pad(n)}`, `slide_${n}`]);
  const hit = fs.readdirSync(dir).find(f => /\.(png|jpe?g)$/i.test(f) && wanted.has(f.replace(/\.(png|jpe?g)$/i, '').toLowerCase()));
  return hit ? path.join(dir, hit) : null;
}

/** The slides a demo shows that have no image yet. */
export function missingSlides(demo, dir) {
  const used = [...new Set(demo.chapters.flatMap(c => c.steps.filter(s => s.type === 'slide').map(s => s.slide)))].sort((a, b) => a - b);
  return used.filter(n => !slideImage(dir, n));
}

/** The events of a chapter without live steps: each slide held a moment, then its narration, line after line. */
export function slideEvents(chapter, pause) {
  const events = [];
  let t = 0;
  for (const step of chapter.steps) {
    if (step.type === 'slide') { events.push({ t: round(t), kind: 'view', slide: step.slide }); t += SLIDE_HOLD; }
    else if (step.type === 'say') { events.push({ t: round(t), kind: 'say', wav: step.wav, dur: step.dur, text: step.text }); t += step.dur + pause; }
    else if (step.type === 'wait') t += step.seconds;
  }
  events.push({ t: round(t), kind: 'end' });
  return { windows: {}, events, failed: false, reason: null };
}

const round = x => Math.round(x * 1000) / 1000;

/** How long a take lasts on screen: until its last event, or the end of its last line. */
export function takeLength(take) {
  return round(Math.max(0, ...take.events.map(e => e.t + (e.kind === 'say' ? e.dur : 0))) + TAIL);
}

/**
 * The pieces of a chapter's video: [{ view, start, dur }], one per stretch with the same thing on screen. Before the
 * first view, `carry` (the last slide of the chapter before; a window's video belongs to its own take) is shown, else
 * the first view itself.
 */
export function pieces(take, carry = null) {
  const end = takeLength(take);
  const views = take.events.filter(e => e.kind === 'view').map(e => ({ ...e }));
  if (!views.length) return carry ? [{ view: carry, start: 0, dur: end }] : [];
  if (views[0].t > 0) {
    if (carry) views.unshift({ ...carry, t: 0 });
    else views[0].t = 0;
  }
  const out = [];
  views.forEach((v, i) => {
    const stop = i + 1 < views.length ? views[i + 1].t : end;
    if (stop - v.t > 0.04) out.push({ view: v, start: v.t, dur: round(stop - v.t) });
  });
  return out;
}

/** Subtitles: one cue per sentence group of at most two lines of 42 characters, timed by its share of the line. */
export function srtCues(says) {
  const cues = [];
  for (const s of says) {
    const sentences = String(s.text).match(/[^.!?]+[.!?]*\s*/g) || [s.text];
    const chunks = [];
    for (const sentence of sentences.map(x => x.trim()).filter(Boolean)) {
      const words = sentence.split(/\s+/);
      let chunk = '';
      for (const word of words) {
        if ((chunk + ' ' + word).trim().length > 84 && chunk) { chunks.push(chunk); chunk = word; } else chunk = (chunk + ' ' + word).trim();
      }
      if (chunk) chunks.push(chunk);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let t = s.start;
    for (const c of chunks) {
      const d = s.dur * (c.length / total);
      cues.push({ start: t, end: t + d, text: wrap(c) });
      t += d;
    }
  }
  return cues;
}

const wrap = text => {
  if (text.length <= 42) return text;
  const mid = text.lastIndexOf(' ', Math.ceil(text.length / 2) + 6);
  return mid > 0 ? text.slice(0, mid) + '\n' + text.slice(mid + 1) : text;
};

const stamp = s => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms % 1000).padStart(3, '0')}`;
};

export const toSrt = cues => cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');

/** Encodes one chapter: its pieces over the narration. */
async function chapterVideo(take, list, file, { size, slidesDir }) {
  const end = takeLength(take);
  const inputs = [];
  const chains = [];
  const fit = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p,setsar=1`;
  list.forEach(({ view, start, dur }, k) => {
    if (view.slide) {
      inputs.push('-loop', '1', '-framerate', '30', '-t', dur.toFixed(3), '-i', slideImage(slidesDir, view.slide));
    } else if (view.window) {
      const w = take.windows[view.window];
      if (!w || !w.video) throw new Error(`the video of window ${view.window} is missing`);
      inputs.push('-ss', Math.max(0, w.offset + start).toFixed(3), '-t', dur.toFixed(3), '-i', w.video);
    } else {
      inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', `color=c=#032d60:s=${size.width}x${size.height}:r=30`);
    }
    chains.push(`[${k}:v]${fit},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
  });
  const says = take.events.filter(e => e.kind === 'say');
  const n = list.length;
  says.forEach((e, k) => {
    inputs.push('-i', e.wav);
    const ms = Math.round(e.t * 1000);
    chains.push(`[${n + k}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}|${ms}[a${k}]`);
  });
  chains.push(`${list.map((_, k) => `[v${k}]`).join('')}concat=n=${n}:v=1:a=0[vout]`);
  if (says.length) chains.push(`${says.map((_, k) => `[a${k}]`).join('')}amix=inputs=${says.length}:normalize=0:dropout_transition=0,apad[aout]`);
  else { inputs.push('-f', 'lavfi', '-t', end.toFixed(3), '-i', 'anullsrc=r=48000:cl=mono'); chains.push(`[${n}:a]apad[aout]`); }
  await ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', end.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '1', '-movflags', '+faststart', file]);
  return end;
}

/**
 * Assembles the demo into <out>/<name>.mp4 and <out>/<name>.srt. Returns { mp4, srt, duration, chapters, missing }.
 * @param {any} demo a narrated demo
 * @param {{ out: string, slidesDir?: string, emit?: (e: any) => void }} options
 */
export async function assembleDemo(demo, { out, slidesDir, emit = () => {} }) {
  const { size } = frameOf(demo);
  const missing = missingSlides(demo, slidesDir);
  if (missing.length) throw new Error(`no image for slide(s) ${missing.join(', ')} in ${slidesDir || '(no slides folder)'}: export the deck's slides there (the demo-deck skill does it)`);
  const parts = [];
  const marks = [];
  const cues = [];
  const report = [];
  let at = 0;
  let carry = null;
  const work = path.join(out, 'assembly');
  fs.mkdirSync(work, { recursive: true });
  for (const [i, chapter] of demo.chapters.entries()) {
    const n = i + 1;
    let take = isLive(chapter) ? bestTake(out, n) : slideEvents(chapter, demo.settings.pause);
    if (!take) { report.push({ chapter: n, title: chapter.title, status: 'not recorded: skipped' }); continue; }
    const list = pieces(take, carry);
    if (!list.length) { report.push({ chapter: n, title: chapter.title, status: 'nothing to show: skipped' }); continue; }
    const file = path.join(work, `ch${pad(n)}.mp4`);
    emit({ type: 'log', message: `assembling chapter ${n}: ${chapter.title}` });
    await chapterVideo(take, list, file, { size, slidesDir });
    const duration = (await probeDuration(file)) || takeLength(take);
    marks.push({ start: at, title: chapter.title });
    for (const c of srtCues(take.events.filter(e => e.kind === 'say').map(e => ({ ...e, start: at + e.t })))) cues.push(c);
    parts.push(file);
    report.push({ chapter: n, title: chapter.title, status: take.failed ? `from a failed take: ${take.reason}` : take.take ? `take ${take.take}` : 'slides', seconds: Math.round(duration) });
    at += duration;
    const views = take.events.filter(e => e.kind === 'view');
    const last = views.at(-1);
    carry = last && last.slide ? { slide: last.slide } : null;
  }
  if (!parts.length) throw new Error('nothing to assemble yet: record the demo first');
  const meta = [';FFMETADATA1', ...marks.flatMap((m, i) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(m.start * 1000)}`, `END=${Math.round((i + 1 < marks.length ? marks[i + 1].start : at) * 1000)}`, `title=${m.title.replace(/[=;#\\\n]/g, ' ')}`])];
  const metaFile = path.join(work, 'chapters.txt');
  fs.writeFileSync(metaFile, meta.join('\n') + '\n');
  const listFile = path.join(work, 'join.txt');
  fs.writeFileSync(listFile, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const mp4 = path.join(out, `${demo.name}.mp4`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-i', metaFile, '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', mp4]);
  const srt = path.join(out, `${demo.name}.srt`);
  fs.writeFileSync(srt, toSrt(cues));
  const duration = await probeDuration(mp4);
  fs.writeFileSync(path.join(out, 'assembly.json'), JSON.stringify({ mp4, srt, duration, chapters: report, at: new Date().toISOString() }, null, 1));
  return { mp4, srt, duration, chapters: report };
}
