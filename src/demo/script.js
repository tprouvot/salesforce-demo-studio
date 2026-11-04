/**
 * A demo script: one Markdown file that holds a whole narrated demo. It reads like the presenter's notes:
 *
 *   ---
 *   title: Apex callouts, a guided tour
 *   voice: en_US-ryan-high          # a Piper voice (sfdemo voices lists them)
 *   pace: presenter                 # slow, presenter, normal, brisk, or a number (1 = the voice's own speed)
 *   slides: slides                  # folder of slide images: 01.png, 02.png... (the deck skill exports them)
 *   deck: https://docs.google.com/presentation/d/...
 *   windows:                        # the people (or screens) shown live, signed in off camera
 *     Admin: { org: SDO_simple, path: /lightning/setup/SetupOneHome/home }
 *     Jordan: { site: https://example.my.site.com/s/, user: jordan.lee, org: SDO_simple }
 *   say: { SOQL: sockle }           # how the voice must read a word
 *   ---
 *
 *   # Opening                       a heading starts a chapter
 *   - slide: 1                      show slide 1
 *
 *   Thank you for joining...        a paragraph is spoken by the voice
 *
 *   - window: Admin                 show the Admin window
 *   - setup: Named Credentials      a live step
 *   1. What can you help me with?   a message typed into the window's chat (Agentforce or Messaging)
 *      - expect: help               a check on its answer
 *
 * A live step is a list item (`-`, `1.`) or a line starting with a step word and a colon. A fenced ```apex block
 * runs in the Developer Console. HTML comments are ignored, so are presenter notes written as `> note: ...`.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseStep, CHECKS } from '../scenario/parse.js';
import { resolveConversation } from '../scenario/resolve.js';

/** Steps only demos have, on top of the conversation steps (message, click, wait, type-from and the checks). */
export const DEMO_STEPS = ['slide', 'window', 'open', 'setup', 'record', 'fill', 'select', 'press', 'scroll', 'wait for', 'point', 'ai', 'apex'];
const CONVERSATION_WORDS = ['click', 'wait', 'type-from', 'expect-not', 'expect-button', 'max-seconds', 'expect'];
const SETTINGS = ['type', 'title', 'org', 'deck', 'slides', 'voice', 'language', 'pace', 'pause', 'windows', 'say', 'takes', 'reply timeout', 'size', 'filler', 'retry'];
const PACES = { slow: 0.75, presenter: 0.8, normal: 1, brisk: 1.15 };
export const DEFAULT_VOICE = 'en_US-ryan-high';
const squash = s => String(s).toLowerCase().replace(/[\s_-]/g, '');
const WORD = new RegExp(`^(${[...DEMO_STEPS, ...CONVERSATION_WORDS].map(w => w.replace(/[- ]/g, '[-_ ]?')).join('|')})\\s*:\\s*([\\s\\S]*)$`, 'i');
const demoWord = w => DEMO_STEPS.find(d => squash(d) === squash(w));

/** True when `text` is a demo script rather than a conversation scenario. */
export function isDemoText(text) {
  const fm = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  let parsed;
  try { parsed = YAML.parse(fm[1]) || {}; } catch { return false; }
  const keys = Object.keys(parsed).map(squash);
  return squash(parsed.type || '') === 'demo' || ['voice', 'windows', 'slides', 'deck', 'pace'].some(k => keys.includes(k));
}

/** pace: a name or a number, as Piper's length scale (above 1 is slower). */
export function lengthScale(pace) {
  const n = typeof pace === 'number' ? pace : PACES[String(pace || 'presenter').toLowerCase()] ?? Number(pace);
  if (!(n > 0.3 && n < 3)) throw new Error(`pace: "${pace}" is not a pace (slow, presenter, normal, brisk, or a number such as 0.9)`);
  return Math.round((1 / n) * 1000) / 1000;
}

function demoStep(word, value, where) {
  const type = demoWord(word);
  const need = what => { if (!value) throw new Error(`${where}: "${type}:" needs ${what}`); };
  const pair = what => {
    const m = value.match(/^(.+?)\s*=\s*([\s\S]*)$/);
    if (!m) throw new Error(`${where}: write "${type}: ${what} = value"`);
    return { field: m[1].trim().replace(/^["“'](.*)["”']$/, '$1'), value: m[2].trim().replace(/^["“'](.*)["”']$/, '$1') };
  };
  switch (type) {
    case 'slide': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: "slide:" needs a slide number (1 is the first slide), got "${value}"`);
      return { type, slide: n, where };
    }
    case 'window': need('the name of a window from windows:'); return { type, name: value, where };
    case 'open': need('a page: a path (/lightning/o/Account/list), a URL, or an app (app: Sales)'); return { type, target: value, where };
    case 'setup': need('the name of a Setup page, as in Setup\'s Quick Find (Named Credentials)'); return { type, page: value, where };
    case 'record': {
      need('an object and a record name (Account Acme)');
      const m = value.match(/^(\S+)\s+(.+)$/);
      if (!m) throw new Error(`${where}: write "record: <object> <record name>", e.g. "record: Account Acme"`);
      return { type, object: m[1], name: m[2].replace(/^["“'](.*)["”']$/, '$1'), where };
    }
    case 'fill': case 'select': need('a field and its value'); return { type, ...pair('Field'), where };
    case 'press': need('a key (Enter, Tab, Escape...)'); return { type, key: value, where };
    case 'scroll': return { type, target: value || 'down', where };
    case 'wait for': need('the text to wait for'); return { type: 'wait-for', text: value.replace(/^["“'](.*)["”']$/, '$1'), where };
    case 'point': need('the label to point at'); return { type, label: value.replace(/^["“'](.*)["”']$/, '$1'), where };
    case 'ai': need('what to do, in plain words'); return { type, instruction: value, where };
    case 'apex': need('Apex code (or a ```apex block below the line)'); return { type, code: value, where };
    default: return null;
  }
}

/** One live step from its text: a demo step, else a conversation step (message, click, wait, checks). */
function liveStep(text, where) {
  const m = text.trim().match(WORD);
  if (m && demoWord(m[1])) return demoStep(m[1], m[2].trim().replace(/\s{2,}#.*$/, ''), where);
  return parseStep(text, where);
}

/** The front matter, checked: unknown keys are errors (typos), windows are checked like conversation settings. */
function readSettings(raw, file) {
  const out = { windows: {}, say: {} };
  for (const [k, v] of Object.entries(raw || {})) {
    const key = SETTINGS.find(s => squash(s) === squash(k));
    if (!key) throw new Error(`${file}: unknown setting "${k}" (known: ${SETTINGS.join(', ')})`);
    out[key === 'reply timeout' ? 'replyTimeout' : key] = v;
  }
  if (out.voice !== undefined && typeof out.voice !== 'string') throw new Error(`${file}: voice: is the name of a Piper voice, e.g. ${DEFAULT_VOICE}`);
  out.voice = out.voice || DEFAULT_VOICE;
  out.lengthScale = lengthScale(out.pace);
  out.pause = out.pause === undefined ? 0.7 : Number(out.pause);
  if (!(out.pause >= 0 && out.pause <= 5)) throw new Error(`${file}: pause: is the silence between two spoken paragraphs, in seconds (0 to 5)`);
  out.takes = out.takes === undefined ? 3 : Number(out.takes);
  if (!Number.isInteger(out.takes) || out.takes < 1 || out.takes > 9) throw new Error(`${file}: takes: is how many times a live chapter is tried (1 to 9)`);
  if (out.size !== undefined && !/^\d{3,4}x\d{3,4}$/.test(String(out.size))) throw new Error(`${file}: size: is the video size, e.g. 1920x1080`);
  out.size = String(out.size || '1920x1080');
  if (typeof out.windows !== 'object' || Array.isArray(out.windows)) throw new Error(`${file}: windows: is a list of names, each with its settings`);
  if (typeof out.say !== 'object' || Array.isArray(out.say)) throw new Error(`${file}: say: is a list of words and how to read them (SOQL: sockle)`);
  out.say = Object.fromEntries(Object.entries(out.say).map(([w, s]) => [String(w), String(s)]));
  return out;
}

/**
 * A window as a resolved conversation (it reuses the conversations' sign-in rules): Lightning with org (as the CLI
 * user, or Login-As with user), a site with site (a guest, Login-As, or a password with credentials), or any web
 * page with url (no sign-in). A window takes the demo's org unless it names its own.
 */
export function resolveWindow(name, raw, settings, file) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: window "${name}" needs its settings, e.g. { org: myOrg } or { site: https://... }`);
  const { label, url, ...rest } = raw;
  if (url) {
    if (Object.keys(rest).length) throw new Error(`${file}: window "${name}" has url:, a plain web page: it takes no ${Object.keys(rest).join(', ')}`);
    try { new URL(String(url)); } catch { throw new Error(`${file}: window "${name}": url: ${url} is not a URL`); }
    return { name, label: label ? String(label) : name, surface: 'web', signIn: 'none', url: String(url), identity: `web|${name}` };
  }
  const merged = { ...(settings.org ? { org: settings.org } : {}), ...rest };
  if (!merged.site && !merged.surface) merged.surface = 'lightning';
  const conv = resolveConversation({ name, file, settings: merged, steps: [{ type: 'message', text: 'Hi' }] });
  return { ...conv, label: label ? String(label) : name };
}

/**
 * Parses a demo script. Returns { file, name, settings, windows, chapters: [{ title, steps }] }; every step has a
 * `type` and a `where` (file:line).
 * @param {string} text
 * @param {string} file
 * @param {{ org?: string }} [overrides] settings given on the command line (the org alias to record in)
 */
export function parseDemo(text, file, overrides = {}) {
  let body = String(text).replace(/^﻿/, '');
  let rawSettings = {};
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) {
    try { rawSettings = YAML.parse(fm[1]) || {}; } catch (e) { throw new Error(`${file}: invalid front matter: ${e.message}`); }
    body = body.slice(fm[0].length);
  }
  const settings = readSettings(rawSettings, file);
  if (overrides.org) settings.org = overrides.org;
  const offset = fm ? fm[0].split(/\r?\n/).length - 1 : 0;
  const chapters = [];
  let chapter = null;
  const add = step => {
    if (!chapter) { chapter = { title: settings.title ? String(settings.title) : path.parse(file).name, steps: [], where: step.where }; chapters.push(chapter); }
    chapter.steps.push(step);
  };
  let paragraph = null;
  let item = null;
  let fence = null;
  const flush = () => {
    if (paragraph) { add({ type: 'say', text: paragraph.lines.join(' ').replace(/\s+/g, ' ').trim(), where: paragraph.where }); paragraph = null; }
    if (item) { add(liveStep(item.lines.join('\n'), item.where)); item = null; }
  };
  const lines = body.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, '')).split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1 + offset}`;
    if (fence) {
      if (/^\s*```\s*$/.test(line)) { add({ type: 'apex', code: fence.lines.join('\n'), where: fence.where }); fence = null; } else fence.lines.push(line);
      return;
    }
    const open = line.match(/^\s*```\s*(\w*)\s*$/);
    if (open) {
      flush();
      if (!/^apex$/i.test(open[1])) throw new Error(`${where}: a code block in a demo is Apex to run in the Developer Console: start it with \`\`\`apex`);
      fence = { lines: [], where };
      return;
    }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) { flush(); chapter = { title: heading[1], steps: [], where }; chapters.push(chapter); return; }
    if (/^\s*>/.test(line)) { flush(); return; } // presenter notes, never spoken
    const bullet = line.match(/^ {0,3}(?:\d+[.)]|[-*+])\s+(.*)$/);
    const indented = /^(\s{2,}|\t)\S/.test(line);
    if (bullet && !(indented && item)) { flush(); item = { lines: [bullet[1].replace(/\s{2,}#.*$/, m => (WORD.test(bullet[1].trim()) ? '' : m))], where }; return; }
    if (indented && item) {
      const sub = line.match(/^\s+(?:(?:\d+[.)]|[-*+])\s+)?(.*)$/);
      if (sub && WORD.test(sub[1].trim())) { flush(); add(liveStep(sub[1].replace(/\s{2,}#.*$/, ''), where)); return; }
      item.lines.push(line.replace(/^(\t| {2,4})/, ''));
      return;
    }
    if (!line.trim()) { flush(); return; }
    if (WORD.test(line.trim()) && !paragraph) { flush(); add(liveStep(line.trim().replace(/\s{2,}#.*$/, ''), where)); return; }
    if (item) flush();
    paragraph = paragraph || { lines: [], where };
    paragraph.lines.push(line.trim());
  });
  if (fence) throw new Error(`${fence.where}: the \`\`\`apex block is not closed`);
  flush();

  const windows = {};
  for (const [name, raw] of Object.entries(settings.windows)) windows[name] = resolveWindow(name, raw, settings, file);
  let current = null;
  let spoken = 0;
  const messages = new Set();
  for (const ch of chapters) {
    for (const step of ch.steps) {
      if (step.type === 'say') spoken++;
      if (step.type === 'window') {
        if (!windows[step.name]) throw new Error(`${step.where}: no window "${step.name}" in windows: (${Object.keys(windows).join(', ') || 'none yet'})`);
        current = step.name;
      } else if (step.type === 'slide') {
        current = null;
      } else if (!['say', 'wait'].includes(step.type) && !CHECKS.includes(step.type)) {
        if (!current) throw new Error(`${step.where}: "${step.type}" needs a window first: add "- window: <name>" above it`);
        if (step.type === 'message') messages.add(current);
      }
    }
  }
  for (const name of messages) windows[name].chat = true;
  if (!chapters.some(c => c.steps.length)) throw new Error(`${file}: the demo is empty: write what the voice says, slides and live steps`);
  return { file, name: path.parse(file).name, settings, windows, chapters: chapters.filter(c => c.steps.length), spoken };
}

/** Reads a demo script file. */
export function readDemo(file, overrides = {}) {
  return parseDemo(fs.readFileSync(file, 'utf8'), path.resolve(file), overrides);
}

/** A live step as a presenter's cue, for the speaker notes ("▶ Setup › Named Credentials"); null for checks. */
export function cue(step) {
  const q = s => `“${s}”`;
  switch (step.type) {
    case 'window': return `▶ Switch to ${step.name}`;
    case 'setup': return `▶ Setup › ${step.page}`;
    case 'open': return `▶ Open ${step.target}`;
    case 'record': return `▶ Open the ${step.object} ${q(step.name)}`;
    case 'click': return `▶ Click ${q(step.label)}`;
    case 'fill': return `▶ Type ${q(step.value)} in ${step.field}`;
    case 'select': return `▶ Pick ${q(step.value)} in ${step.field}`;
    case 'press': return `▶ Press ${step.key}`;
    case 'scroll': return `▶ Scroll ${/^(down|up|top|bottom)$/i.test(step.target) ? step.target : `to ${q(step.target)}`}`;
    case 'wait-for': return `▶ Wait for ${q(step.text)}`;
    case 'point': return `▶ Show ${q(step.label)}`;
    case 'ai': return `▶ ${step.instruction.charAt(0).toUpperCase()}${step.instruction.slice(1)}`;
    case 'apex': return `▶ Run in the Developer Console (Debug › Open Execute Anonymous Window):\n${step.code}`;
    case 'message': return `▶ Type in the chat: ${step.prompt ? `the ${step.label || 'one-time code'}` : q(step.text)}`;
    case 'wait': return `▶ Pause ${step.seconds} s`;
    default: return null;
  }
}

/**
 * The speaker notes of each slide: what the presenter says while it is shown, and the live part that follows it
 * (as ▶ cues, with what to say there), up to the next slide. [{ slide, notes }], by slide number.
 */
export function speakerNotes(demo) {
  const notes = new Map();
  let slide = null;
  for (const ch of demo.chapters) {
    for (const step of ch.steps) {
      if (step.type === 'slide') { slide = step.slide; if (!notes.has(slide)) notes.set(slide, []); continue; }
      if (slide === null) continue;
      const text = step.type === 'say' ? step.text : cue(step);
      if (text) notes.get(slide).push(text);
    }
  }
  return [...notes.entries()].sort((a, b) => a[0] - b[0]).map(([n, parts]) => ({ slide: n, notes: parts.join('\n\n') }));
}
