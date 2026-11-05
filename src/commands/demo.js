/**
 * The demo commands: `sfdemo demo` (voice-over, recording and video in one go), `sfdemo narrate` (the voice-over
 * alone, to check its length), `sfdemo voices` (choose a voice), `sfdemo notes` (the speaker notes of each slide).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from './args.js';
import { loadProject, homeDir } from '../config.js';
import { readDemo, speakerNotes, demoDefaults, DEFAULT_VOICE } from '../demo/script.js';
import { narrate, catalogue, installedVoices, downloadVoice, synthesize, findPiper, findVoice, sampleUrl, languageOf } from '../demo/voice.js';
import { recordDemo, isLive } from '../demo/recorder.js';
import { assembleDemo, missingSlides } from '../demo/assemble.js';
import { InputBroker, promptOnTerminal } from '../engine/input.js';
import { minutes } from '../engine/report.js';
import { EDITORS, findEditor, openProfileForUser } from '../demo/editor.js';
import { ptyRunner } from '../demo/terminal.js';

const out = s => process.stdout.write(s + '\n');
const err = s => process.stderr.write(s + '\n');

/** Where a demo's files go: its recordings folder, its slides, its narration cache, its ai: answers. */
export function demoPaths(project, demo) {
  const dir = path.dirname(demo.file);
  return {
    out: path.join(project.recordingsDir, demo.name),
    slidesDir: path.resolve(dir, String(demo.settings.slides || 'slides')),
    cacheDir: path.join(project.stateDir, 'narration'),
    stateDir: project.stateDir,
    aiCache: path.join(dir, `${demo.name}.ai-steps.json`),
  };
}

const printer = () => e => {
  if (e.type === 'log') out(e.conversation ? `[${e.conversation}] ${e.message}` : e.message);
  else if (e.type === 'warning') err(`warning: ${e.message}`);
};

/** The plan of a demo, in a few lines: chapters, live or slides, speech time. */
export function describeDemo(demo) {
  const lines = [`${demo.name}: ${demo.chapters.length} chapter(s), voice ${demo.settings.voice}`];
  demo.chapters.forEach((c, i) => {
    const speech = c.steps.filter(s => s.type === 'say').reduce((n, s) => n + (s.dur || 0), 0);
    const live = isLive(c) ? `live in ${[...new Set(c.steps.filter(s => s.type === 'window').map(s => s.name))].join(', ')}` : 'slides';
    lines.push(`  ${String(i + 1).padStart(2)}. ${c.title}: ${live}${speech ? `, ${minutes(speech * 1000)} of voice-over` : ''}`);
  });
  return lines;
}

async function narrateCommand(argv) {
  const args = parseArgs(argv, { org: 'string', config: 'string' });
  if (!args._[0]) throw new Error('usage: sfdemo narrate <demo.md>');
  const project = loadProject({ file: args.config });
  const demo = readDemo(args._[0], { org: args.org, defaults: demoDefaults(project) });
  const paths = demoPaths(project, demo);
  const r = await narrate(demo, { cacheDir: paths.cacheDir, onLine: e => out(`  ${e.n}/${e.total} ${e.seconds.toFixed(1)} s  ${e.text.slice(0, 80)}`) });
  describeDemo(demo).forEach(out);
  out(`${r.lines} spoken paragraph(s), ${minutes(r.seconds * 1000)} of voice-over in total (live waits come on top)`);
  const missing = missingSlides(demo, paths.slidesDir);
  if (missing.length) out(`slide image(s) still to export: ${missing.join(', ')} (into ${paths.slidesDir})`);
  return 0;
}

async function demoCommand(argv) {
  const args = parseArgs(argv, { org: 'string', only: 'list', retake: 'boolean', headed: 'boolean', 'no-video': 'boolean', 'video-only': 'boolean', config: 'string' });
  if (!args._[0]) throw new Error('usage: sfdemo demo <demo.md> [--org <alias>] [--only 2,3] [--retake] [--video-only]');
  const project = loadProject({ file: args.config });
  const demo = readDemo(args._[0], { org: args.org, defaults: demoDefaults(project) });
  const paths = demoPaths(project, demo);
  fs.mkdirSync(paths.out, { recursive: true });
  out(`voice-over (${demo.settings.voice})...`);
  const narration = await narrate(demo, { cacheDir: paths.cacheDir });
  describeDemo(demo).forEach(out);
  const missing = missingSlides(demo, paths.slidesDir);
  if (missing.length) throw new Error(`no image for slide(s) ${missing.join(', ')} in ${paths.slidesDir}: export the deck's slides there first (the demo-deck skill does it)`);
  let failed = 0;
  if (!args['video-only']) {
    const broker = new InputBroker();
    const stopPrompt = promptOnTerminal(broker);
    try {
      const only = (args.only || []).map(Number).filter(Boolean);
      const summary = await recordDemo(demo, { out: paths.out, stock: narration.stock, stateDir: paths.stateDir, only, retake: args.retake, headed: args.headed, emit: printer(), broker, aiCacheFile: paths.aiCache });
      for (const s of summary) out(`  ${String(s.chapter).padStart(2)}. ${s.title}: ${s.status}${s.take ? ` (take ${s.take})` : ''}${s.reason ? `: ${s.reason}` : ''}`);
      failed = summary.filter(s => s.status === 'failed').length;
    } finally { stopPrompt(); }
  }
  if (args['no-video']) return failed ? 1 : 0;
  const video = await assembleDemo(demo, { out: paths.out, slidesDir: paths.slidesDir, emit: printer() });
  out(`\nVideo: ${video.mp4} (${minutes(video.duration * 1000)})\nSubtitles: ${video.srt}`);
  if (failed) out(`${failed} chapter(s) kept from a failed take: sfdemo demo ${args._[0]} --only <chapter> records them again`);
  return failed ? 1 : 0;
}

async function voicesCommand(argv) {
  const args = parseArgs(argv, { language: 'string', installed: 'boolean', download: 'string', try: 'string', text: 'string', play: 'boolean', json: 'boolean', config: 'string' });
  if (args.download) {
    out(`downloading ${args.download}...`);
    const v = await downloadVoice(args.download, { onProgress: p => out(`  ${p.file}: ${(p.bytes / 1e6).toFixed(1)} MB`) });
    out(`installed: ${v.model}`);
    return 0;
  }
  if (args.try) {
    const project = loadProject({ file: args.config });
    const text = args.text || 'Hello, this is how I sound when I present your demo.';
    const r = await synthesize({ text, voice: args.try, lengthScale: 1.25, cacheDir: path.join(project.stateDir, 'narration') });
    out(`${r.wav} (${r.duration.toFixed(1)} s)`);
    if (args.play) playWav(r.wav);
    return 0;
  }
  const installed = new Set(installedVoices().map(v => v.key));
  if (args.installed) {
    for (const v of installedVoices()) out(`${v.key.padEnd(28)} ${v.language}  ${v.model}`);
    if (!installed.size) out('no voice installed yet: sfdemo voices --language en, then sfdemo voices --download <voice>');
    return 0;
  }
  const want = String(args.language || '').toLowerCase();
  const list = (await catalogue()).filter(v => !want || v.language.toLowerCase().startsWith(want) || v.languageName.toLowerCase().startsWith(want));
  if (args.json) { out(JSON.stringify(list.map(v => ({ ...v, installed: installed.has(v.key), sample: sampleUrl(v) })), null, 1)); return 0; }
  for (const v of list) out(`${installed.has(v.key) ? '✓' : ' '} ${v.key.padEnd(30)} ${`${v.languageName} (${v.country})`.padEnd(30)} ${v.quality.padEnd(7)} ${v.sizeBytes ? Math.round(v.sizeBytes / 1e6) + ' MB' : ''}`);
  out(`${list.length} voice(s). Hear one: sfdemo voices --try <voice> --play (it downloads the voice first)`);
  return 0;
}

/** Plays a WAV with the system's player, when there is one (afplay on macOS, aplay on Linux). */
function playWav(file) {
  /** @type {[string, string[]]} */
  const [cmd, args] = process.platform === 'darwin' ? ['afplay', [file]] : process.platform === 'win32' ? ['powershell', ['-c', `(New-Object Media.SoundPlayer '${file}').PlaySync()`]] : ['aplay', [file]];
  spawn(cmd, args, { stdio: 'ignore' }).on('error', () => out(`(no audio player: open ${file})`));
}

async function notesCommand(argv) {
  const args = parseArgs(argv, { json: 'boolean', config: 'string' });
  if (!args._[0]) throw new Error('usage: sfdemo notes <demo.md> [--json]');
  const notes = speakerNotes(readDemo(args._[0], { defaults: demoDefaults(loadProject({ file: args.config })) }));
  if (args.json) { out(JSON.stringify(notes, null, 1)); return 0; }
  for (const n of notes) out(`--- slide ${n.slide}\n${n.notes || '(no narration on this slide)'}\n`);
  return 0;
}

/**
 * Asks which voice the demos use: a language, then one of its voices (`ask` is a readline question). Returns a
 * voice key; `current` when the catalogue cannot be read or the answer matches nothing.
 * @param {{ ask: (q: string) => Promise<string>, current?: string }} options
 */
export async function chooseVoice({ ask, current = DEFAULT_VOICE }) {
  let list;
  try { list = await catalogue(); } catch (e) { out(`(the list of voices cannot be read: ${e.message}; the demos use ${current})`); return current; }
  out('\nThe voice that reads your demos (change it any time: sfdemo ui, or voice: in a script).');
  const langs = [...new Set(list.map(v => v.language))];
  const common = ['en_US', 'en_GB', 'fr_FR', 'de_DE', 'es_ES', 'it_IT', 'pt_BR', 'nl_NL'].filter(l => langs.includes(l));
  const said = (await ask(`  Language (${common.join(', ')}, or another of the ${langs.length}; Enter: ${languageOf(current)}): `)).trim().toLowerCase();
  const lang = langs.find(l => l.toLowerCase() === (said || languageOf(current).toLowerCase())) || (said ? langs.find(l => l.toLowerCase().startsWith(said)) : null);
  if (!lang) { out(`  no voice in "${said}": the demos use ${current}`); return current; }
  const voices = list.filter(v => v.language === lang);
  const installed = new Set(installedVoices().map(v => v.key));
  const mine = voices.findIndex(v => v.key === current);
  const fallback = mine >= 0 ? mine : Math.max(0, voices.findIndex(v => !/low/.test(v.quality)));
  voices.forEach((v, i) => out(`  ${String(i + 1).padStart(2)}. ${v.name} (${v.quality}${v.speakers > 1 ? `, ${v.speakers} speakers` : ''})${installed.has(v.key) ? ' ✓ installed' : v.sizeBytes ? `, ${Math.round(v.sizeBytes / 1e6)} MB` : ''}`));
  const n = Number((await ask(`  Voice number (hear one first: sfdemo voices --try ${voices[fallback].key} --play; Enter: ${voices[fallback].name}): `)).trim());
  return (voices[n - 1] || voices[fallback]).key;
}

/** Downloads `voice` when it is not on this machine yet; says so, and never fails the command for it. */
export async function ensureVoice(voice) {
  if (findVoice(voice)) return true;
  try {
    out(`downloading the voice ${voice}...`);
    await downloadVoice(voice, { onProgress: p => out(`  ${p.file}: ${(p.bytes / 1e6).toFixed(1)} MB`) });
    return true;
  } catch (e) { out(`  not downloaded now (${e.message}): sfdemo setup --voice does it later`); return false; }
}

/**
 * The voice part of `sfdemo setup`: Piper and the project's voice. With `install`, Piper goes into its own Python
 * environment (~/.sfdemo/piper) and the voice is downloaded.
 * @param {{ install: boolean, line: (good: boolean, name: string, detail: string) => void, voice?: string }} options
 */
export async function setupVoice({ install, line, voice = DEFAULT_VOICE }) {
  let piper = findPiper();
  if (!piper && install) {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const venv = path.join(homeDir(), 'piper');
    out(`installing Piper (the voice engine) into ${venv}...`);
    const run = (cmd, a) => new Promise(resolve => spawn(cmd, a, { stdio: 'inherit' }).on('exit', c => resolve(c === 0)).on('error', () => resolve(false)));
    const pip = process.platform === 'win32' ? path.join(venv, 'Scripts', 'pip.exe') : path.join(venv, 'bin', 'pip');
    if (await run(python, ['-m', 'venv', venv]) && await run(pip, ['install', '--quiet', 'piper-tts'])) piper = findPiper();
  }
  line(!!piper, 'Piper voice engine', piper || `missing: sfdemo setup --voice installs it (it needs Python 3: ${process.platform === 'darwin' ? 'brew install python' : 'python.org'})`);
  if (piper && install) await ensureVoice(voice);
  const voices = installedVoices();
  line(!!findVoice(voice), 'voice', findVoice(voice) ? `${voice}${voices.length > 1 ? ` (also installed: ${voices.filter(v => v.key !== voice).map(v => v.key).join(', ')})` : ''}`
    : `${voice} not installed yet: sfdemo setup --voice${voices.length ? ` (installed: ${voices.map(v => v.key).join(', ')})` : ''}`);
}

/**
 * sfdemo editor <vscode|cursor> [folder]: opens the editor with the profile demos are filmed in, for the user to
 * set it up by hand, once: log in (Cursor needs it), install an extension, look at it. Nothing is filmed.
 */
async function editorCommand(argv) {
  const args = parseArgs(argv, {});
  const kind = String(args._[0] || '').toLowerCase().replace(/^code$/, 'vscode');
  if (!EDITORS[kind]) throw new Error('usage: sfdemo editor <vscode|cursor> [folder]');
  const profile = openProfileForUser(kind, args._[1]);
  out(`${EDITORS[kind].name} opens with its demo profile (${profile.root}).`);
  out(kind === 'cursor'
    ? 'Log in there once, yourself: demos filmed in Cursor need it, and sfdemo never logs in for you. Close the window when done.'
    : 'Install the extensions you want, or look around; close the window when done. A demo lists its extensions in its window (extensions: [...]).');
  out('Settings changed there do not stay: each recording writes the profile\'s settings, plus those of the demo\'s window (settings: {...}).');
  return 0;
}

/** The editors and terminal part of `sfdemo setup`: information only (a demo without them needs none). */
export function setupEditors({ line }) {
  line(!!ptyRunner() || process.platform === 'win32', 'terminal windows', ptyRunner() ? `commands run in a real terminal (${ptyRunner()})` : process.platform === 'win32' ? 'commands run with pipes (no pseudo-terminal on Windows)' : 'Python 3 missing: commands run with pipes, without colours or spinners');
  for (const kind of Object.keys(EDITORS)) {
    const found = findEditor(kind);
    const name = EDITORS[kind].name;
    const hint = kind === 'cursor' ? ' (it needs a login once, by you: sfdemo editor cursor)' : '';
    line(!!found, `${name} windows`, found ? `${found.app}${hint}` : `not installed (only for demos with a ${kind}: window; or set ${EDITORS[kind].env})`);
  }
}

export const DEMO_COMMANDS = { demo: demoCommand, narrate: narrateCommand, voices: voicesCommand, notes: notesCommand, editor: editorCommand };
