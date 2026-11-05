/**
 * The terminal windows of a demo: a terminal drawn in a page of the recording browser (so it is filmed like the
 * other windows), whose commands run for real on this machine, in the window's folder. A command is typed at the
 * prompt one key at a time, then runs in a pseudo-terminal (Python's pty, on macOS and Linux: colours, spinners and
 * progress bars show as in a real terminal; plain pipes on Windows), and what it prints is drawn as it comes.
 *
 *   run: npm test          types the command, runs it, waits for its end (an error ends the take)
 *   start: sfdemo ui       the same without waiting: the next steps happen while it runs (wait for: its output)
 *   type: yes              types into the command that runs (it asked a question)
 *   press: Control+C       a key for the command that runs: Control+C stops it, Enter, Tab, arrows...
 *   ```sh ... ```          each line is a run:
 *
 * `cd <folder>` and `clear` are understood by the window itself, as a shell would. Each other command runs on its
 * own (`sh -c`, or the user's zsh/bash), so a variable set by one is not seen by the next.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Screen } from './screen.js';
import { installOverlay } from './overlay.js';
import { quietPages } from './actions.js';
import { PACKAGE_ROOT } from '../config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pty-helper.py');
const TYPE_DELAY = 42;
const RUN_TIMEOUT = 10 * 60 * 1000;
const BAR = 38;

let ptyPython;
/** The Python that can run the pseudo-terminal helper, or null (Windows, no Python 3). */
export function ptyRunner() {
  if (process.platform === 'win32' || process.env.SFDEMO_TERMINAL_PIPES) return null;
  if (ptyPython !== undefined) return ptyPython;
  ptyPython = null;
  for (const py of ['python3', 'python']) {
    const r = spawnSync(py, ['-c', 'import pty, termios, sys; sys.exit(0 if sys.version_info[0] == 3 else 1)'], { stdio: 'ignore' });
    if (r.status === 0) { ptyPython = py; break; }
  }
  return ptyPython;
}

/** The environment of what a demo runs: the user's, without what would tie it to the editor sfdemo runs in. */
export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|VSCODE_(IPC_HOOK|IPC_HOOK_CLI|PID|CWD|NLS_CONFIG|HANDLES_|ESM_|CODE_CACHE|CRASH_|PROCESS_TITLE|L10N_|INJECTION|GIT_)|CURSOR_SPAWN|CURSOR_EXTENSION_HOST)/.test(k)));
  return { ...env, ...extra };
}

/**
 * The environment of the commands a demo runs (in its terminals, its editors, its prepare: steps): `sfdemo` (and
 * `afrec`) in them is the sfdemo that records, whether or not it is installed for the whole machine.
 */
export function demoEnv(stateDir) {
  const bin = path.join(stateDir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const entry = path.join(PACKAGE_ROOT, 'bin', 'sfdemo.js');
  for (const name of ['sfdemo', 'afrec']) {
    if (process.platform === 'win32') fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "${entry}" %*\r\n`);
    else { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${entry}" "$@"\n`); fs.chmodSync(path.join(bin, name), 0o755); }
  }
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  return { [key]: [bin, process.env[key] || ''].join(path.delimiter) };
}

/**
 * Runs a command off camera (a prepare: step), in the shell, in `cwd`. Resolves { code, tail } (tail: the last
 * lines it printed, for the error message).
 */
export function runOffCamera(command, { cwd, env = {}, timeout = RUN_TIMEOUT }) {
  return new Promise(resolve => {
    const shell = shellOf();
    const child = shell ? spawn(shell, ['-c', command], { cwd, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(command, { cwd, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    let out = '';
    const keep = d => { out = (out + d).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const tail = () => out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().split(/\r?\n/).slice(-3).join(' / ').slice(0, 300);
    child.on('error', e => { clearTimeout(timer); resolve({ code: 127, tail: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, tail: tail() }); });
  });
}

/** The shell a command runs in: the user's zsh or bash, else sh. */
export function shellOf() {
  if (process.platform === 'win32') return null;
  const s = process.env.SHELL || '';
  return /\/(zsh|bash)$/.test(s) && fs.existsSync(s) ? s : '/bin/sh';
}

/** A folder shown as a terminal shows it: ~ for the home folder. */
const tilde = dir => (dir === os.homedir() ? '~' : dir.startsWith(os.homedir() + path.sep) ? `~${dir.slice(os.homedir().length)}` : dir);

/** The page of a terminal window: a window with a title bar on a plain backdrop, the screen in it. */
export function terminalPage({ title, theme = 'dark' }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const dark = theme !== 'light';
  const palette = dark
    ? ['#1d1f24', '#ff6b6b', '#5fd068', '#f2c94c', '#5aa9ff', '#d38cff', '#4fd1c5', '#d7dae0', '#6b7280', '#ff8f8f', '#86e39a', '#ffe08a', '#8cc4ff', '#e3b3ff', '#7ee8dc', '#ffffff']
    : ['#1d1f24', '#c62828', '#1b7f3a', '#8a6d00', '#1a5fb4', '#8e2fb5', '#0b7a75', '#55595f', '#7a7f87', '#e53935', '#2e9d50', '#a68400', '#2a74d0', '#a347c9', '#14918b', '#1d1f24'];
  const fg = dark ? '#e6e8eb' : '#1d1f24';
  const bg = dark ? '#16181d' : '#fbfbfc';
  const colors = palette.map((c, i) => `.f${i}{color:${c}}.b${i}{background:${c}}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden}
body{background:${dark ? 'linear-gradient(135deg,#0b2447 0%,#123b6d 55%,#1b5aa0 100%)' : 'linear-gradient(135deg,#dfe7f1,#c7d6ea)'}}
.win{position:absolute;inset:22px 30px 26px;border-radius:12px;background:${bg};overflow:hidden;
  box-shadow:0 18px 50px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,${dark ? '.06' : '.5'})}
.bar{height:${BAR}px;display:flex;align-items:center;justify-content:center;position:relative;
  background:${dark ? '#24272e' : '#e9ebef'};color:${dark ? '#a3abb6' : '#59606b'};font:500 13.5px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.dots{position:absolute;left:16px;top:13px;display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;display:block}
.dots i:nth-child(1){background:#ff5f57}.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
#screen{position:absolute;top:${BAR}px;left:0;right:0;bottom:0;padding:14px 20px;overflow:hidden;color:${fg};
  font:17px/1.45 "SF Mono",Menlo,Monaco,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;white-space:pre}
.l{min-height:1.45em}
.fd{color:${fg}}.bk{background:${bg}}.bo{font-weight:700}.di{opacity:.62}.it{font-style:italic}.un{text-decoration:underline}
.ln{color:${dark ? '#7cc0ff' : '#1a5fb4'}}.cur{background:${fg};color:${bg}}
${colors}
#measure{position:absolute;visibility:hidden;white-space:pre;font:inherit}
</style></head><body><div class="win"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span id="title">${esc(title)}</span></div>
<div id="screen"></div></div></body></html>`;
}

/** Key names of `press:` as the bytes a terminal sends. */
const KEYS = { enter: '\r', return: '\r', tab: '\t', escape: '\x1b', esc: '\x1b', backspace: '\x7f', space: ' ', arrowup: '\x1b[A', arrowdown: '\x1b[B', arrowright: '\x1b[C', arrowleft: '\x1b[D', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~' };
export function keyBytes(key) {
  const k = String(key).trim();
  const ctrl = k.match(/^(?:control|ctrl|ctl)\s*\+\s*([a-z\[\\\]])$/i) || k.match(/^\^([a-z])$/i);
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) - 64);
  const named = KEYS[k.toLowerCase().replace(/\s+/g, '')];
  if (named) return named;
  if ([...k].length === 1) return k;
  throw new Error(`press: "${key}" is not a key a terminal knows (Enter, Tab, Escape, Backspace, arrows, Control+C...)`);
}

/**
 * Opens a terminal window off camera: its page is filmed from its creation, its prompt shown in its folder.
 * @param {any} browser a Playwright Browser
 * @param {any} conv the resolved window ({ name, label, folder, title?, prompt?, theme? })
 * @param {{ viewport: any, scale: number, videoDir: string, env?: Record<string, string>, log?: (m: string) => void }} options
 */
export async function openTerminal(browser, conv, { viewport, scale, videoDir, env = {}, log = () => {} }) {
  fs.mkdirSync(conv.folder, { recursive: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, recordVideo: { dir: videoDir, size: viewport } });
  const page = await context.newPage();
  quietPages.add(page);
  const created = Date.now();
  await page.setContent(terminalPage({ title: conv.title || `${path.basename(conv.folder)} — ${path.basename(shellOf() || 'cmd')}`, theme: conv.theme }));
  await page.evaluate(installOverlay, { label: conv.label });
  const size = await page.evaluate(() => {
    const s = /** @type {HTMLElement} */ (document.getElementById('screen'));
    const m = document.createElement('span');
    m.id = 'measure';
    m.textContent = 'M'.repeat(100);
    s.appendChild(m);
    const w = m.getBoundingClientRect().width / 100;
    const h = parseFloat(getComputedStyle(s).lineHeight);
    m.remove();
    const cs = getComputedStyle(s);
    return { cols: Math.floor((s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / w), rows: Math.floor((s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / h) };
  });
  const screen = new Screen(size);
  const python = ptyRunner();
  const shell = shellOf();
  let cwd = conv.folder;
  let failed = false;
  /** @type {null | { child: any, command: string, done: Promise<number>, code: number | null, where?: string }} */
  let proc = null;
  /** @type {null | { command: string, code: number | null }} the last command started, running or ended */
  let last = null;

  // drawing: at most every 40 ms, one drawing at a time
  let dirty = true;
  let drawing = null;
  let closed = false;
  const draw = async () => {
    if (drawing || closed) return drawing;
    dirty = false;
    const html = screen.html({ cursor: true });
    drawing = page.evaluate(h => { const s = document.getElementById('screen'); if (s) { s.innerHTML = h; s.scrollTop = s.scrollHeight; } }, html).catch(() => {}).finally(() => { drawing = null; });
    return drawing;
  };
  const timer = setInterval(() => { if (dirty) draw(); }, 40);
  const show = data => { screen.write(data); dirty = true; };
  const flush = async () => { if (drawing) await drawing; if (dirty) await draw(); };

  const prompt = () => {
    const where = conv.prompt || (tilde(cwd) === '~' ? '~' : path.basename(cwd));
    show(`\x1b[1;38;5;75m${where}\x1b[0m ${failed ? '\x1b[1;31m' : '\x1b[38;5;245m'}${process.platform === 'win32' ? '>' : '$'}\x1b[0m `);
  };
  prompt();
  await flush();

  const typeVisibly = async text => {
    for (const ch of String(text)) {
      show(ch);
      await sleep(TYPE_DELAY + (ch === ' ' ? 25 : 0));
    }
  };

  let interrupted = false;
  const ended = code => {
    if (screen.col !== 0) show('\r\n');
    failed = code !== 0 && !interrupted; // stopped with Control+C on purpose: not an error
    interrupted = false;
    prompt();
  };

  /** What the command printed since it started (its last lines), for an error message. */
  const printedSince = (from, n) => screen.text().split('\n').slice(from, -1).filter(l => l.trim()).slice(-n).join(' / ').slice(0, 300);

  /** Types `command` at the prompt and runs it; resolves when it ends if `wait`, else once it started. */
  async function command(text, { wait, where }) {
    if (proc) await Promise.race([proc.done, sleep(2000)]); // one that printed its last line is about to end
    if (proc) throw new Error(`"${proc.command}" still runs in ${conv.name}: stop it first (press: Control+C), or wait for its output (wait for: ...)`);
    await sleep(250);
    await typeVisibly(text);
    await sleep(380);
    show('\r\n');
    const cd = text.trim().match(/^cd(?:\s+(.+))?$/);
    if (cd) {
      const raw = (cd[1] || '~').trim().replace(/^["'](.*)["']$/, '$1');
      const dir = path.resolve(cwd, raw.replace(/^~(?=$|\/)/, os.homedir()));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { show(`cd: no such file or directory: ${raw}\r\n`); ended(1); throw new Error(`cd: no folder ${raw} in ${cwd}`); }
      cwd = dir;
      ended(0);
      await sleep(400);
      return;
    }
    if (/^(clear|cls)$/.test(text.trim())) { screen.reset(); failed = false; prompt(); await sleep(400); return; }
    const from = screen.text().split('\n').length;
    const baseEnv = cleanEnv({ ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', COLUMNS: String(screen.cols), LINES: String(screen.rows), CLICOLOR: '1' });
    let child;
    if (python) {
      child = spawn(python, [HELPER, String(screen.cols), String(screen.rows), shell || '/bin/sh', '-c', text], { cwd, env: baseEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    } else if (shell) {
      child = spawn(shell, ['-c', text], { cwd, env: { ...baseEnv, FORCE_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } else {
      child = spawn(text, { cwd, env: { ...baseEnv, FORCE_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
    }
    const p = { child, command: text, code: null, where, done: /** @type {Promise<number>} */ (new Promise(resolve => {
      child.on('error', e => { show(`${e.message}\r\n`); resolve(127); });
      child.on('close', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
    })) };
    child.stdout.on('data', d => show(d.toString('utf8')));
    child.stderr.on('data', d => show(d.toString('utf8')));
    child.stdin.on('error', () => {});
    proc = p;
    last = p;
    p.done.then(code => { p.code = code; if (proc === p) { proc = null; ended(code); } });
    if (!wait) { await sleep(900); return; }
    let timer2;
    const code = await Promise.race([p.done, new Promise(resolve => { timer2 = setTimeout(() => resolve(-1), RUN_TIMEOUT); })]);
    clearTimeout(timer2);
    if (code === -1) throw new Error(`"${text}" still runs after ${RUN_TIMEOUT / 60000} minutes`);
    await flush();
    await sleep(700);
    const printed = printedSince(from, 3);
    if (code !== 0) throw new Error(`"${text}" ended with exit code ${code}${printed ? `: ${printed}` : ''}`);
  }

  /**
   * Types into the command that runs, one key at a time. A pseudo-terminal echoes the keys and gives the line to the
   * command on Enter; with pipes, the window does both (the line goes on press: Enter, as a terminal would send it).
   */
  let line = '';
  async function typeInto(text, where) {
    if (!proc) throw new Error(`nothing runs in ${conv.name} to type into: run: or start: a command first`);
    for (const ch of String(text)) {
      if (!proc) throw new Error(`"${text}": the command ended while it was typed`);
      if (python) proc.child.stdin.write(ch);
      else { line += ch; show(ch); }
      await sleep(TYPE_DELAY + 20);
    }
    await sleep(300);
  }

  async function press(key, where) {
    const bytes = keyBytes(key);
    if (!proc) {
      if (bytes === '\x03') { show('^C\r\n'); failed = false; prompt(); }
      else if (bytes === '\r') { show('\r\n'); prompt(); }
      await sleep(500);
      return;
    }
    const p = proc;
    if (bytes === '\x03') interrupted = true;
    if (python) p.child.stdin.write(bytes);
    else if (bytes === '\x03') { show('^C\r\n'); try { process.kill(-p.child.pid, 'SIGINT'); } catch { p.child.kill('SIGINT'); } }
    else if (bytes === '\x04') p.child.stdin.end();
    else if (bytes === '\r') { show('\r\n'); p.child.stdin.write(line + '\n'); line = ''; }
    else if (bytes === '\x7f') { if (line) { line = line.slice(0, -1); show('\b \b'); } }
    else p.child.stdin.write(bytes);
    if (bytes === '\x03') {
      const stopped = await Promise.race([p.done.then(() => true), sleep(6000).then(() => false)]);
      if (!stopped) throw new Error(`"${p.command}" did not stop on Control+C`);
    }
    await sleep(600);
  }

  /**
   * Waits until `text` shows on the screen (any case), as long as the command that runs keeps running (up to the
   * run timeout). When it ended without printing it, or nothing runs, nothing more can come: the step fails at once.
   */
  async function waitForText(text) {
    const has = () => screen.text().toLowerCase().includes(String(text).toLowerCase());
    const watched = proc || last;
    if (!watched) { if (has()) return; throw new Error(`no "${text}" in ${conv.name}: no command ran there yet`); }
    const deadline = Date.now() + RUN_TIMEOUT;
    while (Date.now() < deadline) {
      if (has()) { await flush(); await sleep(500); return; }
      if (watched && watched.code !== null) {
        await sleep(200);
        if (has()) { await flush(); await sleep(500); return; }
        throw new Error(`"${watched.command}" ended (exit code ${watched.code}) without printing "${text}"`);
      }
      await sleep(150);
    }
    throw new Error(`no "${text}" in ${conv.name} after ${RUN_TIMEOUT / 60000} minutes`);
  }

  /** Ends what still runs (at the end of a take): SIGTERM to the command's process group, then SIGKILL. */
  async function stopAll() {
    const p = proc;
    if (!p) return;
    const kill = sig => { try { if (python || process.platform === 'win32') p.child.kill(sig); else process.kill(-p.child.pid, sig); } catch { /* gone */ } };
    kill('SIGTERM');
    const done = await Promise.race([p.done.then(() => true), sleep(3000).then(() => false)]);
    if (!done) kill('SIGKILL');
  }

  return {
    name: conv.name,
    conv,
    kind: 'terminal',
    context,
    page,
    base: null,
    who: tilde(conv.folder),
    created,
    surface: null,
    screen,
    links: () => screen.links(),
    flush,
    /** Runs a step of this window; false when it is a step any page knows (wait for, point...). */
    async act(step) {
      switch (step.type) {
        case 'run': await command(step.command, { wait: true, where: step.where }); return true;
        case 'start': await command(step.command, { wait: false, where: step.where }); return true;
        case 'type': await typeInto(step.text, step.where); return true;
        case 'press': await press(step.key, step.where); return true;
        case 'wait-for': await waitForText(step.text); return true;
        case 'code': for (const line of step.code.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))) await command(line, { wait: true, where: step.where }); return true;
        default: return false;
      }
    },
    async finish() {
      await stopAll();
      await flush().catch(() => {});
      closed = true;
      clearInterval(timer);
      const video = page.video();
      await context.close().catch(() => {});
      return video ? video.path().catch(() => null) : null;
    },
  };
}
