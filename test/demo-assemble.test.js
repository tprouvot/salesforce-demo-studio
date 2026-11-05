/** The demo video: slide images, the cut of each chapter, subtitles, and a whole assembly from generated media. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slideImage, missingSlides, slideEvents, pieces, takeLength, srtCues, toSrt, assembleDemo } from '../src/demo/assemble.js';
import { bestTake, nextTake, takeDir, isLive, frameOf } from '../src/demo/recorder.js';
import { parseDemo } from '../src/demo/script.js';
import { narrate } from '../src/demo/voice.js';
import { ffmpegBinary } from '../src/engine/media.js';
import { installFakePiper } from './helpers/fake-piper.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-assemble-'));
const ffmpeg = args => execFileSync(ffmpegBinary(), ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
let piper;
before(() => { piper = installFakePiper(); });
after(() => piper.restore());

test('slide images: 01.png, 1.png, slide-01.png or PowerPoint\'s Slide1.PNG; the missing ones are listed', () => {
  const dir = path.join(tmp, 'names');
  fs.mkdirSync(dir);
  for (const f of ['01.png', 'slide-02.png', 'Slide3.PNG', '4.jpg', 'notes.txt', '10.png']) fs.writeFileSync(path.join(dir, f), '');
  assert.deepEqual([1, 2, 3, 4, 10, 5].map(n => slideImage(dir, n) && path.basename(slideImage(dir, n))), ['01.png', 'slide-02.png', 'Slide3.PNG', '4.jpg', '10.png', null]);
  assert.equal(slideImage(path.join(tmp, 'nowhere'), 1), null);
  const demo = parseDemo('---\ntitle: x\n---\n- slide: 1\nA.\n- slide: 5\nB.\n- slide: 6\n- slide: 5\n', '/d/x.md');
  assert.deepEqual(missingSlides(demo, dir), [5, 6]);
});

test('a chapter of slides is timed from its narration: each slide held a moment, then its lines, then the pause', () => {
  const chapter = { steps: [{ type: 'slide', slide: 1 }, { type: 'say', text: 'A', wav: 'a.wav', dur: 2 }, { type: 'wait', seconds: 1 }, { type: 'slide', slide: 2 }, { type: 'say', text: 'B', wav: 'b.wav', dur: 3 }] };
  const take = slideEvents(chapter, 0.5);
  assert.deepEqual(take.events.map(e => [e.t, e.kind, e.slide || e.text || null]), [[0, 'view', 1], [1.2, 'say', 'A'], [4.7, 'view', 2], [5.9, 'say', 'B'], [9.4, 'end', null]]);
  assert.equal(takeLength(take), 10.4);
});

test('the cut: one piece per stretch on screen; what comes before the first view is the last slide before, else the first view', () => {
  const take = { windows: {}, events: [{ t: 0, kind: 'say', dur: 2 }, { t: 1.5, kind: 'view', window: 'Admin' }, { t: 6, kind: 'view', slide: 3 }, { t: 6.02, kind: 'view', slide: 4 }, { t: 9, kind: 'end' }] };
  assert.deepEqual(pieces(take).map(p => [p.view.window || p.view.slide, p.start, p.dur]), [['Admin', 0, 6], [4, 6.02, 3.98]], 'a view shown for an instant is dropped');
  assert.deepEqual(pieces(take, { slide: 2 }).map(p => [p.view.window || p.view.slide, p.start, p.dur]), [[2, 0, 1.5], ['Admin', 1.5, 4.5], [4, 6.02, 3.98]]);
  assert.deepEqual(pieces({ windows: {}, events: [{ t: 0, kind: 'say', dur: 4 }] }, { slide: 7 }).map(p => [p.view.slide, p.dur]), [[7, 5]], 'narration alone stays on the last slide');
  assert.deepEqual(pieces({ windows: {}, events: [{ t: 0, kind: 'say', dur: 4 }] }), []);
});

test('subtitles: one cue per sentence group, two lines at most, timed by their share of the line', () => {
  const cues = srtCues([{ start: 10, dur: 6, text: 'Hello. This is a much longer sentence that has to be split over two lines of subtitles at most, and then some more words to go past it.' }]);
  assert.ok(cues.length >= 3, JSON.stringify(cues));
  assert.equal(cues[0].text, 'Hello.');
  assert.ok(cues.every(c => c.text.split('\n').length <= 2 && c.text.split('\n').every(l => l.length <= 50)), JSON.stringify(cues));
  assert.ok(Math.abs(cues.at(-1).end - 16) < 1e-9);
  assert.equal(toSrt([{ start: 3661.5, end: 3662.25, text: 'One\ntwo' }]), '1\n01:01:01,500 --> 01:01:02,250\nOne\ntwo\n');
});

test('takes: the last complete one is used, else the last one tried; retakes never overwrite', () => {
  const out = path.join(tmp, 'takes');
  assert.equal(bestTake(out, 1), null);
  assert.equal(nextTake(out, 1), 1);
  for (const [n, failed] of [[1, false], [2, true]]) {
    fs.mkdirSync(takeDir(out, 1, n), { recursive: true });
    fs.writeFileSync(path.join(takeDir(out, 1, n), 'events.json'), JSON.stringify({ take: n, failed, events: [] }));
  }
  assert.equal(bestTake(out, 1).take, 1, 'a later failure does not replace a good take');
  assert.equal(nextTake(out, 1), 3);
  fs.mkdirSync(takeDir(out, 2, 1), { recursive: true });
  fs.writeFileSync(path.join(takeDir(out, 2, 1), 'events.json'), JSON.stringify({ take: 1, failed: true, events: [] }));
  assert.equal(bestTake(out, 2).take, 1, 'a failed take is still better than nothing');
  assert.equal(isLive({ steps: [{ type: 'slide' }, { type: 'say' }] }), false);
  assert.deepEqual(frameOf({ settings: { size: '1920x1080' } }), { size: { width: 1920, height: 1080 }, viewport: { width: 1440, height: 810 }, scale: 4 / 3 });
});

test('a whole demo: slides and a live window over the voice-over, one MP4 at 1920x1080 with chapters, and its subtitles', async () => {
  const dir = path.join(tmp, 'demo');
  const slides = path.join(dir, 'slides');
  fs.mkdirSync(slides, { recursive: true });
  for (const n of [1, 2]) ffmpeg(['-f', 'lavfi', '-i', `color=c=${n === 1 ? 'blue' : 'green'}:s=1600x900`, '-frames:v', '1', path.join(slides, `0${n}.png`)]);
  const script = '---\ntitle: Assembly\nwindows:\n  Web: { url: https://example.com }\n---\n# Slides\n- slide: 1\n\nThe first slide.\n\n- slide: 2\n\nThe second one.\n\n# Live\n- window: Web\n\nOn the live page.\n';
  const demo = parseDemo(script, path.join(dir, 'assembly.md'));
  await narrate(demo, { cacheDir: path.join(dir, 'narration') });
  const out = path.join(dir, 'out');
  // a take as the recorder writes it: a window video (a test pattern here) and the events of what was on screen
  const take = takeDir(out, 2, 1);
  fs.mkdirSync(take, { recursive: true });
  const video = path.join(take, 'web.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=8', '-pix_fmt', 'yuv420p', video]);
  const say = demo.chapters[1].steps.find(s => s.type === 'say');
  fs.writeFileSync(path.join(take, 'events.json'), JSON.stringify({ take: 1, failed: false, windows: { Web: { offset: 1, video } },
    events: [{ t: 0, kind: 'view', window: 'Web' }, { t: 0.5, kind: 'say', wav: say.wav, dur: say.dur, text: say.text }, { t: 4, kind: 'end' }] }));
  const r = await assembleDemo(demo, { out, slidesDir: slides });
  assert.equal(path.basename(r.mp4), 'assembly.mp4');
  assert.deepEqual(r.chapters.map(c => [c.title, c.status]), [['Slides', 'slides'], ['Live', 'take 1']]);
  const info = (() => { try { execFileSync(ffmpegBinary(), ['-hide_banner', '-i', r.mp4], { encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr); } })();
  assert.match(info, /Video: h264.*1920x1080/);
  assert.match(info, /Audio: aac/);
  assert.equal((info.match(/Chapter #/g) || []).length, 2);
  assert.match(info, /title\s+: Live/);
  const expected = takeLength(slideEvents(demo.chapters[0], 0.7)) + 5;
  assert.ok(Math.abs(r.duration - expected) < 0.6, `${r.duration} s, expected about ${expected} s`);
  const srt = fs.readFileSync(r.srt, 'utf8');
  assert.match(srt, /^1\n00:00:01,200 --> 00:00:\d\d,\d{3}\nThe first slide\.\n/);
  assert.match(srt, /On the live page\./);
  await assert.rejects(assembleDemo(parseDemo('---\ntitle: x\n---\n- slide: 9\nNine.', path.join(dir, 'x.md')), { out, slidesDir: slides }), /no image for slide\(s\) 9/);
  // a new voice after recording: the live chapter still speaks with the old one, and the video says so
  const renarrated = parseDemo(script.replace('title: Assembly', 'title: Assembly\nvoice: fr_FR-siwis-low'), path.join(dir, 'assembly.md'));
  await narrate(renarrated, { cacheDir: path.join(dir, 'narration') });
  const told = [];
  const mixed = await assembleDemo(renarrated, { out, slidesDir: slides, emit: e => { if (e.type === 'warning') told.push(e.message); } });
  assert.deepEqual(mixed.chapters.map(c => c.status), ['slides', 'take 1, with an earlier voice-over']);
  assert.match(told[0], /chapter 2 \(Live\) was recorded with another voice-over .*\(--only 2 --retake\)/);
  // a take whose window video is gone: that chapter is left out, the others make the video
  fs.rmSync(video);
  const warnings = [];
  const partial = await assembleDemo(demo, { out, slidesDir: slides, emit: e => { if (e.type === 'warning') warnings.push(e.message); } });
  assert.deepEqual(partial.chapters.map(c => [c.title, c.status]), [['Slides', 'slides'], ['Live', 'skipped: the video of window Web is missing']]);
  assert.match(warnings[0], /chapter 2 \(Live\) left out of the video/);
  assert.ok(Math.abs(partial.duration - takeLength(slideEvents(demo.chapters[0], 0.7))) < 0.6);
});
