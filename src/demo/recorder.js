/**
 * Records a demo, chapter by chapter, in real time. For a chapter with live steps, its windows are signed in and
 * opened off camera, then every step plays with the narration's real durations: a slide is shown, the voice speaks,
 * a window comes to the front, a message is typed and its answer awaited (the narration after a message plays while
 * the agent thinks; a filler line covers a slow answer), Setup pages, records and Apex run live. Each window's page
 * is filmed; takes/chNN/takeK/events.json says what was on screen and when, for the assembly. A failure (no answer,
 * an error, a failed check, an element not found) ends the take, and the chapter is tried again, up to `takes:`.
 * A chapter with only slides and narration needs no browser: the assembly times it from the narration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from '../engine/auth.js';
import { orgInfo } from '../engine/salesforce.js';
import { createSurface } from '../engine/surfaces.js';
import { sendText, awaitReply, waitStable } from '../engine/reply.js';
import { runCheck, describeFailure } from '../engine/checks.js';
import { effectivePack } from '../selectors/packs.js';
import { CHECKS } from '../scenario/parse.js';
import { installOverlay } from './overlay.js';
import * as actions from './actions.js';
import { resolveAi } from './ai.js';
import { openTerminal, demoEnv, runOffCamera } from './terminal.js';
import { openEditor } from './editor.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILLER_AFTER = 20000;
const SLIDE_HOLD = 900;
const pad = n => String(n).padStart(2, '0');
const readingTime = text => Math.min(Math.max(2500 + String(text || '').length * 20, 3000), 10000);

/** True when a chapter has something to film (a window and what happens in it). */
export const isLive = chapter => chapter.steps.some(s => s.type === 'window');

/** The video size and the browser it is filmed in: 1440 CSS pixels wide, at the scale that gives the video size. */
export function frameOf(demo) {
  const [width, height] = demo.settings.size.split('x').map(Number);
  const scale = width / 1440;
  return { size: { width, height }, viewport: { width: 1440, height: Math.round(height / scale) }, scale };
}

export const takeDir = (out, chapterNo, take) => path.join(out, 'takes', `ch${pad(chapterNo)}`, `take${take}`);

const isLocal = url => { try { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname); } catch { return false; } };

/** Signs a window in and opens it, off camera; the page is filmed from its creation (its offset in the video). */
async function openWindow(browser, demo, name, dir, { log, stateDir }) {
  const conv = demo.windows[name];
  const { viewport, scale } = frameOf(demo);
  const env = demoEnv(stateDir);
  if (conv.surface === 'terminal') {
    const w = await openTerminal(browser, conv, { viewport, scale, videoDir: path.join(dir, 'video'), env, log: m => log(`${name}: ${m}`) });
    log(`${name}: ready (a terminal in ${w.who})`);
    return w;
  }
  if (conv.surface === 'editor') return openEditor(conv, { viewport, dir, env, log });
  let storageState;
  let base = null;
  let who = 'not signed in';
  if (conv.surface !== 'web') {
    log(`${name}: signing in (${conv.signIn})`);
    const auth = await signIn(browser, conv, { viewport, deviceScaleFactor: scale }, path.join(dir, `${name}-sign-in.png`));
    ({ storageState, who } = auth);
    base = auth.baseUrl.replace(/\/$/, '');
  }
  // filmed at the page's own size (Playwright pads a larger frame instead of scaling); the assembly scales it up
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, storageState, recordVideo: { dir: path.join(dir, 'video'), size: viewport } });
  await context.addInitScript(installOverlay, { label: conv.label });
  const page = await context.newPage();
  const w = { name, conv, context, page, base, who, created: Date.now(), surface: null };
  if (conv.org) w.classicBase = await orgInfo(conv.org).then(o => o.instanceUrl, () => null);
  if (conv.surface === 'web') {
    w.base = new URL(conv.url).origin;
    if (conv.from) w.pending = { from: conv.from }; // the link a terminal prints, once it printed it
    else {
      try { await page.goto(conv.url, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch (e) {
        if (!isLocal(conv.url)) throw e;
        w.pending = {}; // a local app the demo starts itself: opened when it is shown
        log(`${name}: ${conv.url} does not answer yet: it opens when the window is shown`);
      }
    }
  } else if (conv.chat) {
    const pack = JSON.parse(JSON.stringify(effectivePack(conv.surface, w.classicBase ? (await orgInfo(conv.org)).apiVersion : null, stateDir)));
    w.surface = createSurface(page, conv, pack, { log: m => log(`${name}: ${m}`) });
    await w.surface.open(base);
    if (conv.fresh && conv.signIn !== 'guest' && await w.surface.reset().catch(() => false)) log(`${name}: ended the chat a previous visit left open`);
    if (conv.surface === 'messaging' && conv.warmup !== false) { // the first message only opens a Messaging conversation
      const before = await w.surface.read();
      await sendText(w.surface, conv.warmup || 'Hi', 0);
      await awaitReply(w.surface, before, { timeout: 90000, settle: 3000, sentText: conv.warmup || 'Hi' }).catch(e => log(`${name}: warm-up: ${e.message}`));
    }
    await w.surface.scroll({ bottom: true });
    w.chatClick = async label => ((await w.surface.hasButton(label, 1500)) ? w.surface.click(label) : actions.click(w, label));
  } else {
    const start = conv.surface === 'lightning' ? base + (conv.path || (conv.app ? `/lightning/app/${conv.app}` : '/lightning/page/home')) : conv.site;
    await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }
  await actions.settle(page, 2500);
  log(`${name}: ready (${who})`);
  return w;
}

/**
 * The page of a web window that could not open off camera: its link, as printed by a terminal window (from:), or a
 * local app that answers now. Waits for it up to a minute, while the previous view stays on screen.
 */
async function openPending(w, windows) {
  const { conv, page } = w;
  const deadline = Date.now() + 60000;
  let url = w.pending.from ? null : conv.url;
  let lastError = null;
  while (Date.now() < deadline) {
    if (w.pending.from) {
      const t = windows[w.pending.from];
      if (!t) throw new Error(`${w.name} opens the link ${w.pending.from} prints, and ${w.pending.from} is not in this chapter`);
      url = t.links().find(l => l.startsWith(conv.url)) || null;
    }
    if (url) {
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); w.pending = null; await actions.settle(page, 1500); return; } catch (e) { lastError = e; }
    }
    await sleep(500);
  }
  throw new Error(w.pending.from ? `${w.pending.from} printed no link starting with ${conv.url} in a minute` : `${conv.url} did not answer in a minute${lastError ? ` (${lastError.message.split('\n')[0]})` : ''}`);
}

/**
 * Records one take of chapter `chapterNo` (1-based). Returns the take's report (also written to events.json).
 * @param {any} browser a Playwright Browser
 * @param {any} demo a narrated demo (parseDemo, then narrate)
 * @param {number} chapterNo
 * @param {number} take
 * @param {{ out: string, stock: any, stateDir: string, emit?: (e: any) => void, broker?: any, aiCache: string, ask?: any }} ctx
 */
export async function recordChapter(browser, demo, chapterNo, take, ctx) {
  const chapter = demo.chapters[chapterNo - 1];
  const dir = takeDir(ctx.out, chapterNo, take);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'video'), { recursive: true });
  const emit = ctx.emit || (() => {});
  const log = message => emit({ type: 'log', conversation: `${chapterNo}. ${chapter.title}`, message });
  const events = [];
  let t0 = 0;
  const now = () => (Date.now() - t0) / 1000;
  const mark = (kind, data = {}) => events.push({ t: Math.round(now() * 1000) / 1000, kind, ...data });
  const result = { chapter: chapterNo, take, title: chapter.title, windows: {}, events, exchanges: [], failed: false, reason: null };
  const windows = {};
  const pause = demo.settings.pause * 1000;
  const replyTimeout = (Number(demo.settings.replyTimeout) || 90) * 1000;
  try {
    for (const step of chapter.steps.filter(s => s.type === 'prepare')) {
      log(`prepare: ${step.command}`);
      const r = await runOffCamera(step.command, { cwd: path.dirname(demo.file), env: demoEnv(ctx.stateDir) });
      if (r.code !== 0) throw new Error(`${step.where}: prepare: "${step.command}" ended with exit code ${r.code}${r.tail ? `: ${r.tail}` : ''}`);
    }
    const names = [...new Set(chapter.steps.filter(s => s.type === 'window').map(s => s.name))];
    for (const name of names) windows[name] = await openWindow(browser, demo, name, dir, { log, stateDir: ctx.stateDir });
    t0 = Date.now();
    for (const [name, w] of Object.entries(windows)) result.windows[name] = { offset: (t0 - w.created) / 1000 };
    log(`take ${take}: on camera`);
    let current = null;
    let pending = null;
    let lastExchange = null;
    const fail = reason => { throw Object.assign(new Error(reason), { take: true }); };
    /** The answer to the last message, once the narration said after it is over. */
    const settleReply = async () => {
      if (!pending) return;
      const p = pending;
      pending = null;
      let fillerEnd = 0;
      const filler = setTimeout(() => {
        mark('say', { wav: ctx.stock.filler.wav, dur: ctx.stock.filler.dur, text: ctx.stock.filler.text, filler: true });
        fillerEnd = Date.now() + ctx.stock.filler.dur * 1000;
      }, Math.max(FILLER_AFTER - (Date.now() - p.sentAt), 0));
      let reply;
      try {
        reply = await awaitReply(p.w.surface, p.before, { timeout: Math.max(replyTimeout - (Date.now() - p.sentAt), 5000), settle: 2500, sentText: p.text });
      } catch (e) { fail(`${p.where}: no answer: ${e.message}`); } finally { clearTimeout(filler); }
      if (fillerEnd) await sleep(Math.max(fillerEnd - Date.now(), 0) + pause);
      await p.w.surface.scroll({ bottom: true });
      lastExchange = { n: result.exchanges.length + 1, text: p.shown, reply: reply.text, seconds: Math.max(0, Math.round((reply.first - p.sentAt) / 1000)), checks: [], handoff: !!reply.handoff };
      result.exchanges.push(lastExchange);
      mark('reply', { text: String(reply.text || '').slice(0, 800), seconds: lastExchange.seconds });
      log(`   answered in ${lastExchange.seconds} s`);
      if (/something went wrong/i.test(reply.text || '')) fail(`${p.where}: the agent answered with an error ("${String(reply.text).slice(0, 100)}")`);
      for (const step of p.checks) {
        const check = await runCheck(step, lastExchange, p.w.surface);
        lastExchange.checks.push(check);
        if (!check.ok) fail(`${step.where}: ${describeFailure(check)}`);
      }
      await sleep(readingTime(reply.text));
    };
    for (const step of chapter.steps) {
      if (step.type === 'say') { mark('say', { wav: step.wav, dur: step.dur, text: step.text }); await sleep(step.dur * 1000 + pause); continue; }
      if (CHECKS.includes(step.type) && pending) { pending.checks.push(step); continue; } // checked once the answer is in
      await settleReply();
      if (CHECKS.includes(step.type)) {
        const check = await runCheck(step, lastExchange, current && current.surface);
        if (lastExchange) lastExchange.checks.push(check);
        if (!check.ok) fail(`${step.where}: ${describeFailure(check)}`);
        continue;
      }
      switch (step.type) {
        case 'slide': mark('view', { slide: step.slide }); await sleep(SLIDE_HOLD); break;
        case 'window':
          current = windows[step.name];
          if (current.pending) { log(`${current.name}: opening ${current.conv.url}`); try { await openPending(current, windows); } catch (e) { fail(`${step.where}: ${e.message}`); } }
          mark('view', { window: step.name });
          await sleep(SLIDE_HOLD);
          break;
        case 'prepare': break; // done before the chapter was filmed
        case 'wait': await sleep(step.seconds * 1000); break;
        case 'message': {
          if (!current.surface) fail(`${step.where}: ${current.name} has no chat to type in`);
          let text = step.text;
          if (step.prompt) {
            text = ctx.broker ? await ctx.broker.request({ conversation: chapter.title, n: result.exchanges.length + 1, label: step.label || 'one-time code', file: step.fromFile, timeout: 600000 }) : null;
            if (text === null) fail(`${step.where}: no ${step.label || 'one-time code'} was given`);
          }
          await waitStable(current.surface, 8000);
          const before = await current.surface.read();
          mark('type', { window: current.name, text: step.prompt ? '•'.repeat(text.length) : text });
          log(`${current.name}: ${step.prompt ? `typing ${text.length} characters` : text.slice(0, 70)}`);
          await sendText(current.surface, text, 45);
          pending = { w: current, before, text, shown: step.prompt ? '•'.repeat(text.length) : text, sentAt: Date.now(), where: step.where, checks: [] };
          break;
        }
        case 'ai': {
          const steps = await resolveAi(current, step, { cacheFile: ctx.aiCache, ask: ctx.ask, log });
          mark('do', { action: `ai: ${step.instruction}` });
          for (const s of steps) await actions.runAction(current, s);
          break;
        }
        default:
          mark('do', { action: step.type, where: step.where });
          log(`${current.name}: ${step.type} ${step.label || step.page || step.target || step.field || step.text || step.key || step.command || step.name || (step.code ? step.code.split('\n')[0] : '')}`.trim());
          try { await actions.runAction(current, step); } catch (e) { fail(`${step.where}: ${step.type}: ${e.message.split('\n')[0]}`); }
      }
    }
    await settleReply();
    mark('end');
    await sleep(1200);
  } catch (e) {
    result.failed = true;
    result.reason = e.message.split('\n')[0];
    log(`take ${take} FAILED: ${result.reason}`);
    if (t0) mark('fail', { reason: result.reason });
    for (const [name, w] of Object.entries(windows)) await w.page.screenshot({ path: path.join(dir, `${name}-failed.png`) }).catch(() => {});
  } finally {
    for (const [name, w] of Object.entries(windows)) {
      let video = null;
      if (w.finish) video = await w.finish().catch(() => null); // terminals and editors end what they started
      else {
        const v = w.page.video();
        await w.context.close().catch(() => {});
        video = v ? await v.path().catch(() => null) : null;
      }
      if (video && result.windows[name]) result.windows[name].video = video;
    }
    fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(result, null, 1));
  }
  return result;
}

/** The take to use for each live chapter: the last complete one, else the last one tried; null when none. */
export function bestTake(out, chapterNo) {
  const root = path.join(out, 'takes', `ch${pad(chapterNo)}`);
  if (!fs.existsSync(root)) return null;
  const takes = fs.readdirSync(root).filter(d => /^take\d+$/.test(d) && fs.existsSync(path.join(root, d, 'events.json')))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map(d => JSON.parse(fs.readFileSync(path.join(root, d, 'events.json'), 'utf8')));
  const done = takes.filter(t => !t.failed);
  return (done.length ? done : takes).at(-1) || null;
}

/** The next take number of a chapter (takes are kept: a good one is never overwritten by a retry). */
export function nextTake(out, chapterNo) {
  const root = path.join(out, 'takes', `ch${pad(chapterNo)}`);
  const n = fs.existsSync(root) ? fs.readdirSync(root).filter(d => /^take\d+$/.test(d)).map(d => Number(d.slice(4))) : [];
  return (n.length ? Math.max(...n) : 0) + 1;
}

/**
 * Records the live chapters of a narrated demo (all of them, or `only`), each until a take completes or `takes:`
 * are used. Returns [{ chapter, title, status, take, reason }].
 * @param {any} demo
 * @param {{ out: string, stock: any, stateDir: string, only?: number[], headed?: boolean, emit?: (e: any) => void, broker?: any, ask?: any, retake?: boolean, aiCacheFile?: string }} ctx
 */
export async function recordDemo(demo, ctx) {
  const emit = ctx.emit || (() => {});
  let browser = null;
  const launch = async () => { if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: !ctx.headed }); } return browser; };
  const summary = [];
  try {
    for (const [i, chapter] of demo.chapters.entries()) {
      const n = i + 1;
      if (ctx.only && ctx.only.length && !ctx.only.includes(n)) continue;
      if (!isLive(chapter)) { summary.push({ chapter: n, title: chapter.title, status: 'slides only' }); continue; }
      const kept = bestTake(ctx.out, n);
      if (kept && !kept.failed && !ctx.retake && !(ctx.only && ctx.only.includes(n))) { summary.push({ chapter: n, title: chapter.title, status: 'recorded earlier', take: kept.take }); continue; }
      let r = null;
      for (let k = 0; k < demo.settings.takes; k++) {
        const take = nextTake(ctx.out, n);
        emit({ type: 'chapter-start', chapter: n, title: chapter.title, take });
        r = await recordChapter(await launch(), demo, n, take, { ...ctx, aiCache: ctx.aiCacheFile || path.join(ctx.stateDir, 'ai-steps.json') });
        emit({ type: 'chapter-end', chapter: n, title: chapter.title, take, failed: r.failed, reason: r.reason });
        if (!r.failed) break;
      }
      summary.push({ chapter: n, title: chapter.title, status: r.failed ? 'failed' : 'recorded', take: r.take, reason: r.reason });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return summary;
}
