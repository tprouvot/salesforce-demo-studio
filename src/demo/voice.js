/**
 * The narrator: Piper (https://github.com/OHF-Voice/piper1-gpl), a local text-to-speech engine. Nothing leaves the
 * machine. Piper is a separate program (GPL), found on the PATH, in ~/.local/bin, or where SFDEMO_PIPER points;
 * `sfdemo setup --voice` installs it. Voices are .onnx files, from Piper's catalogue on Hugging Face, downloaded on
 * first use into ~/.sfdemo/voices (voices already in ~/.local/share/piper-voices or SFDEMO_VOICES are used too).
 *
 * Each spoken paragraph becomes one WAV, cached by its text, voice and pace: changing one line re-synthesizes only
 * that line, and its exact duration drives the recording's timing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { homeDir } from '../config.js';

export const CATALOGUE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const SENTENCE_SILENCE = 0.4;

/** Words a voice reads badly, as it should say them (English voices); a demo's `say:` adds to them and wins. */
export const ENGLISH_SAYINGS = {
  AI: 'A I', API: 'A P I', APIs: 'A P Is', URL: 'U R L', UAT: 'U A T', SSN: 'S S N', CRM: 'C R M', LWC: 'L W C',
  SOQL: 'sockle', Apex: 'Ay-pex', JSON: 'Jason', OAuth: 'Oh auth', SDK: 'S D K', CLI: 'C L I', UI: 'U I',
  Agentforce: 'Agent force', GitHub: 'Git Hub', MuleSoft: 'Mule Soft', 'Omni-Channel': 'Omni Channel', 'Data 360': 'Data three sixty',
};

const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

/** The Piper program, or null when it is not installed. */
export function findPiper() {
  if (process.env.SFDEMO_PIPER) return process.env.SFDEMO_PIPER;
  const names = process.platform === 'win32' ? ['piper.exe', 'piper.cmd', 'piper'] : ['piper'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) if (exists(path.join(dir, n))) return path.join(dir, n);
  }
  for (const f of [path.join(os.homedir(), '.local', 'bin', 'piper'), path.join(homeDir(), 'piper', 'bin', 'piper'), path.join(homeDir(), 'piper', 'Scripts', 'piper.exe')]) if (exists(f)) return f;
  return null;
}

/** Folders holding voices, in search order; downloads go to the first one. */
export function voiceDirs() {
  return [process.env.SFDEMO_VOICES, path.join(homeDir(), 'voices'), path.join(os.homedir(), '.local', 'share', 'piper-voices')].filter(Boolean);
}

/** The installed voice `key` ({ key, model, config }), or null. */
export function findVoice(key) {
  for (const dir of voiceDirs()) {
    const model = path.join(dir, `${key}.onnx`);
    if (exists(model) && exists(model + '.json')) return { key, model, config: model + '.json' };
  }
  return null;
}

/** Every installed voice: [{ key, model, config, language }]. */
export function installedVoices() {
  const seen = new Map();
  for (const dir of voiceDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const key = f.replace(/\.onnx$/, '');
      if (!f.endsWith('.onnx') || seen.has(key) || !exists(path.join(dir, f + '.json'))) continue;
      seen.set(key, { key, model: path.join(dir, f), config: path.join(dir, f + '.json'), language: languageOf(key) });
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The language code of a voice key: en_US-ryan-high -> en_US. */
export const languageOf = key => String(key).split('-')[0];

/**
 * Piper's catalogue of voices (cached a week in ~/.sfdemo/voices/voices.json): [{ key, language, languageName,
 * country, name, quality, speakers, sizeBytes, files }], sorted by language then name.
 */
export async function catalogue({ refresh = false, baseUrl = CATALOGUE_URL } = {}) {
  const cache = path.join(voiceDirs()[0], 'voices.json');
  let raw = null;
  if (!refresh && exists(cache) && Date.now() - fs.statSync(cache).mtimeMs < 7 * 864e5) raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
  if (!raw) {
    const res = await fetch(new URL('voices.json', baseUrl));
    if (!res.ok) throw new Error(`Piper's voice catalogue: HTTP ${res.status} (${new URL('voices.json', baseUrl).href})`);
    raw = await res.json();
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(raw));
  }
  return Object.values(raw).map(v => {
    const onnx = Object.entries(v.files || {}).find(([f]) => f.endsWith('.onnx'));
    return {
      key: v.key, language: v.language.code, languageName: v.language.name_english, country: v.language.country_english,
      name: v.name, quality: v.quality, speakers: v.num_speakers || 1, sizeBytes: onnx ? onnx[1].size_bytes : null, files: v.files || {},
    };
  }).sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name) || a.quality.localeCompare(b.quality));
}

/** The URL of a voice's sample on Hugging Face (an MP3 recorded by Piper's authors), for a preview. */
export function sampleUrl(voice, baseUrl = CATALOGUE_URL) {
  const onnx = Object.keys(voice.files).find(f => f.endsWith('.onnx'));
  return onnx ? new URL(`${path.posix.dirname(onnx)}/samples/speaker_0.mp3`, baseUrl).href : null;
}

/** Downloads voice `key` from the catalogue (checking each file's MD5); returns the installed voice. */
/**
 * @param {string} key
 * @param {{ baseUrl?: string, onProgress?: (p: { file: string, bytes: number }) => void }} [options]
 */
export async function downloadVoice(key, { baseUrl = CATALOGUE_URL, onProgress = () => {} } = {}) {
  const installed = findVoice(key);
  if (installed) return installed;
  const voice = (await catalogue({ baseUrl })).find(v => v.key === key);
  if (!voice) throw new Error(`no voice "${key}" in Piper's catalogue: sfdemo voices lists them`);
  const dir = voiceDirs()[0];
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, meta] of Object.entries(voice.files).filter(([f]) => /\.onnx(\.json)?$/.test(f))) {
    const target = path.join(dir, path.posix.basename(file));
    const res = await fetch(new URL(file.split('/').map(encodeURIComponent).join('/'), baseUrl));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (meta.md5_digest && crypto.createHash('md5').update(body).digest('hex') !== meta.md5_digest) throw new Error(`${file}: the download is damaged (MD5 mismatch); try again`);
    fs.writeFileSync(target + '.part', body);
    fs.renameSync(target + '.part', target);
    onProgress({ file: path.posix.basename(file), bytes: body.length });
  }
  return findVoice(key);
}

/** What the voice reads for `text`: each word of `sayings` (whole words, case-sensitive) replaced by how to say it. */
export function spokenForm(text, sayings = {}) {
  let out = String(text);
  const entries = Object.entries(sayings).sort((a, b) => b[0].length - a[0].length);
  for (const [word, said] of entries) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu'), (m, before) => before + said);
  }
  return out.replace(/\*\*|__|`/g, '');
}

/** The sayings for a voice: the English list for English voices, then the demo's own. */
export const sayingsFor = (voice, own = {}) => ({ ...(languageOf(voice).startsWith('en') ? ENGLISH_SAYINGS : {}), ...own });

/** The duration in seconds of a PCM WAV file, from its header. */
export function wavDuration(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let byteRate = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(o + 16);
    if (id === 'data') return byteRate ? Math.round((Math.min(size, b.length - o - 8) / byteRate) * 1000) / 1000 : 0;
    o += 8 + size + (size % 2);
  }
  throw new Error(`${file} has no audio data`);
}

/** Runs Piper once: `text` read by `voice` into `out`. */
function runPiper(piper, voice, text, out, lengthScale) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(piper); // a wrapper script, as pip installs on Windows
    const child = spawn(piper, ['-m', voice.model, '-c', voice.config, '-f', out, '--length-scale', String(lengthScale), '--sentence-silence', String(SENTENCE_SILENCE)], { stdio: ['pipe', 'ignore', 'pipe'], shell });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => reject(new Error(`Piper did not start (${e.message}): run sfdemo setup --voice`)));
    child.on('close', code => (code === 0 && exists(out) ? resolve(undefined) : reject(new Error(`Piper failed (exit ${code}): ${err.trim().split('\n').slice(-1)[0] || 'no output'}`))));
    child.stdin.end(text);
  });
}

/**
 * The WAV of one spoken paragraph, synthesized once and cached in `cacheDir`. Returns { wav, duration, spoken }.
 * @param {{ text: string, voice: string, lengthScale?: number, sayings?: object, cacheDir: string }} options
 */
export async function synthesize({ text, voice, lengthScale = 1.25, sayings = {}, cacheDir }) {
  const spoken = spokenForm(text, sayingsFor(voice, sayings));
  const digest = crypto.createHash('sha1').update(`${voice}|${lengthScale}|${SENTENCE_SILENCE}|${spoken}`).digest('hex').slice(0, 12);
  fs.mkdirSync(cacheDir, { recursive: true });
  const wav = path.join(cacheDir, `${digest}.wav`);
  if (!exists(wav)) {
    const piper = findPiper();
    if (!piper) throw new Error('Piper, the voice engine, is not installed: run sfdemo setup --voice');
    const v = findVoice(voice) || await downloadVoice(voice);
    await runPiper(piper, v, spoken, wav + '.part.wav', lengthScale);
    fs.renameSync(wav + '.part.wav', wav);
  }
  return { wav, duration: wavDuration(wav), spoken };
}

/** The lines the recorder says on its own: while an answer is slow, and before a take is tried again. */
export const STOCK_LINES = {
  filler: 'It is taking a moment: the agent is working on the answer.',
  retry: 'This is taking longer than it should, so let me run that part again.',
};

/**
 * Synthesizes every spoken paragraph of a demo (and the stock lines), in place: each `say` step gets `wav` and
 * `dur`. Returns { seconds, lines, stock }.
 * @param {any} demo from parseDemo
 * @param {{ cacheDir: string, onLine?: (e: any) => void }} options
 */
export async function narrate(demo, { cacheDir, onLine = () => {} }) {
  const { voice, lengthScale, say } = demo.settings;
  let seconds = 0;
  let lines = 0;
  const total = demo.chapters.reduce((n, c) => n + c.steps.filter(s => s.type === 'say').length, 0);
  for (const ch of demo.chapters) {
    for (const step of ch.steps.filter(s => s.type === 'say')) {
      const r = await synthesize({ text: step.text, voice, lengthScale, sayings: say, cacheDir });
      Object.assign(step, { wav: r.wav, dur: r.duration });
      seconds += r.duration;
      onLine({ n: ++lines, total, chapter: ch.title, text: step.text, seconds: r.duration });
    }
  }
  const stock = {};
  for (const [name, fallback] of Object.entries(STOCK_LINES)) {
    const text = demo.settings[name] || fallback; // a demo in another language gives its own filler: and retry: lines
    const r = await synthesize({ text, voice, lengthScale, sayings: say, cacheDir });
    stock[name] = { text, wav: r.wav, dur: r.duration };
  }
  return { seconds: Math.round(seconds * 10) / 10, lines, stock };
}

