/**
 * VS Code and Cursor windows of a demo: the real application, filmed. Each editor runs with a profile of its own
 * for demos (~/.sfdemo/editors/<editor>: its settings, its state, its extensions), never the user's: no personal
 * extension, notification or recent file shows, and the user's own editor can stay open meanwhile. sfdemo never
 * signs in to anything in it (GitHub, Copilot, Cursor's account): VS Code's AI features are off in that profile;
 * Cursor asks for a login once, done by the user with `sfdemo editor cursor`.
 *
 * The editor is driven through the Chrome DevTools protocol (it is an Electron app): sfdemo starts it with a
 * debugging port, finds its window, sets it to the size of the video and films it (Playwright's screencast), as it
 * films browser pages. Steps work as a presenter's hands would: Quick Open for a file, the Command Palette for a
 * command, the keyboard for code, the integrated terminal for a command line.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { homeDir } from '../config.js';
import { installOverlay } from './overlay.js';
import { cleanEnv } from './terminal.js';
import { moveCursor, quietPages } from './actions.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPE_DELAY = 40;
const CODE_DELAY = 22;
const RUN_TIMEOUT = 10 * 60 * 1000;
/** The prompt of the integrated terminal in the demo profile: the folder, then $; "✗ <code>" before it after an error. */
const PROMPT_RE = /^(?:✗ (\d+) )?\S(?:.*\S)? \$$/;

/** The editors sfdemo can film. */
export const EDITORS = {
  vscode: {
    name: 'VS Code', env: 'SFDEMO_VSCODE', cli: ['code'],
    mac: { app: 'Visual Studio Code.app', bin: ['Code', 'Electron'] },
    win: [['Microsoft VS Code', 'Code.exe']],
    linux: ['/usr/share/code/code', '/opt/visual-studio-code/code', '/snap/code/current/usr/share/code/code'],
    settings: { 'chat.disableAIFeatures': true, 'github.copilot.enable': { '*': false } },
  },
  cursor: {
    name: 'Cursor', env: 'SFDEMO_CURSOR', cli: ['cursor', 'code'],
    mac: { app: 'Cursor.app', bin: ['Cursor'] },
    win: [['cursor', 'Cursor.exe']],
    linux: ['/usr/share/cursor/cursor', '/opt/Cursor/cursor', '/opt/cursor/cursor'],
    settings: {},
  },
};

/** What every demo profile sets: nothing that asks, suggests, autocompletes or changes what is typed. */
const BASE_SETTINGS = {
  // shortcuts are sent as US keys: read them by key code, not by the physical key of the user's layout (on AZERTY,
  // the key of A is Q: Cmd+A would quit)
  'keyboard.dispatch': 'keyCode',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.editor.empty.hint': 'hidden',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'window.restoreWindows': 'none',
  'window.newWindowDimensions': 'default',
  'extensions.ignoreRecommendations': true,
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'git.openRepositoryInParentFolders': 'never',
  'files.hotExit': 'off',
  'window.zoomLevel': 1, // 120 %: the video is watched smaller than a screen; zoom: 0 in a window for 100 %
  'editor.fontSize': 15,
  'editor.minimap.enabled': false,
  'editor.autoIndent': 'none',
  'editor.autoClosingBrackets': 'never',
  'editor.autoClosingQuotes': 'never',
  'editor.autoClosingComments': 'never',
  'editor.autoSurround': 'never',
  'editor.formatOnType': false,
  'editor.formatOnSave': false,
  'editor.quickSuggestions': { other: 'off', comments: 'off', strings: 'off' },
  'editor.suggestOnTriggerCharacters': false,
  'editor.acceptSuggestionOnEnter': 'off',
  'editor.wordBasedSuggestions': 'off',
  'editor.parameterHints.enabled': false,
  'editor.inlineSuggest.enabled': false,
  'editor.linkedEditing': false,
  'editor.tabCompletion': 'off',
  'editor.stickyScroll.enabled': false,
  'html.autoClosingTags': false,
  'emmet.showExpandedAbbreviation': 'never',
  'markdown.editor.filePaste.enabled': 'never',
  'terminal.integrated.fontSize': 14,
  'terminal.integrated.gpuAcceleration': 'off', // the DOM renderer: what the terminal shows can be read
  'terminal.integrated.shellIntegration.enabled': false,
  'terminal.integrated.enablePersistentSessions': false,
  'terminal.integrated.showExitAlert': false,
};

/** The integrated terminal's shell in the demo profile: no rc files, a prompt the recorder can read. */
function terminalSettings() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const os_ = process.platform === 'darwin' ? 'osx' : 'linux';
    const zsh = fs.existsSync('/bin/zsh') && process.platform === 'darwin';
    const profile = zsh
      ? { path: '/bin/zsh', args: ['-f'], env: { PS1: '%(?..%F{red}✗ %?%f )%F{75}%1~%f %F{245}$%f ' } }
      : { path: '/bin/bash', args: ['--noprofile', '--norc'], env: { PS1: '$(c=$?; [ $c -ne 0 ] && printf "✗ %s " $c)\\[\\e[38;5;75m\\]\\W\\[\\e[0m\\] \\[\\e[38;5;245m\\]$\\[\\e[0m\\] ' } };
    return { [`terminal.integrated.profiles.${os_}`]: { sfdemo: profile }, [`terminal.integrated.defaultProfile.${os_}`]: 'sfdemo' };
  }
  return {};
}

const which = name => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};

/**
 * Where the editor is: { app, cli } (cli: its command line, to install extensions; may be null), or null.
 * SFDEMO_VSCODE / SFDEMO_CURSOR give the application's executable when it is somewhere else.
 */
export function findEditor(kind) {
  const e = EDITORS[kind];
  if (!e) throw new Error(`no editor "${kind}" (vscode or cursor)`);
  const cliNear = dir => {
    for (const c of e.cli) for (const f of [c, `${c}.cmd`]) { const p = path.join(dir, f); if (fs.existsSync(p)) return p; }
    return null;
  };
  if (process.env[e.env]) {
    const app = path.resolve(process.env[e.env]);
    if (!fs.existsSync(app)) throw new Error(`${e.env}=${process.env[e.env]}: no such file`);
    const macBin = app.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
    return { app, cli: macBin ? cliNear(path.join(macBin[1], 'Contents', 'Resources', 'app', 'bin')) : cliNear(path.join(path.dirname(app), 'bin')) };
  }
  if (process.platform === 'darwin') {
    const fromMac = appDir => {
      for (const bin of e.mac.bin) { const p = path.join(appDir, 'Contents', 'MacOS', bin); if (fs.existsSync(p)) return { app: p, cli: cliNear(path.join(appDir, 'Contents', 'Resources', 'app', 'bin')) }; }
      return null;
    };
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const hit = fromMac(path.join(dir, e.mac.app));
      if (hit) return hit;
    }
    for (const c of e.cli) {
      const p = which(c);
      const m = p && fs.realpathSync(p).match(/^(.*\.app)\/Contents\/Resources\/app\/bin\/[^/]+$/);
      if (m && path.basename(m[1]) === e.mac.app) { const hit = fromMac(m[1]); if (hit) return hit; }
    }
    return null;
  }
  if (process.platform === 'win32') {
    for (const [dir, exe] of e.win) {
      for (const root of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles].filter(Boolean)) {
        const app = path.join(/** @type {string} */ (root), dir, exe);
        if (fs.existsSync(app)) return { app, cli: cliNear(path.join(path.dirname(app), 'bin')) || cliNear(path.join(path.dirname(app), 'resources', 'app', 'bin')) };
      }
    }
    return null;
  }
  for (const app of e.linux) if (fs.existsSync(app)) return { app, cli: cliNear(path.join(path.dirname(app), 'bin')) };
  for (const c of e.cli.slice(0, 1)) {
    const p = which(c);
    if (!p) continue;
    const real = fs.realpathSync(p);
    const app = path.join(path.dirname(path.dirname(real)), path.basename(real));
    if (/\/bin\/[^/]+$/.test(real) && fs.existsSync(app)) return { app, cli: real };
  }
  return null;
}

/** The demo profile of an editor: { root, data (user data folder), extensions }. */
export function profileOf(kind) {
  const root = path.join(homeDir(), 'editors', kind);
  return { root, data: path.join(root, 'data'), extensions: path.join(root, 'extensions') };
}

/** The profile's settings for a window: sfdemo's, then the editor's, then the window's (theme, zoom, settings). */
export function editorSettings(kind, conv = {}) {
  return {
    ...BASE_SETTINGS,
    ...terminalSettings(),
    ...EDITORS[kind].settings,
    ...(conv.theme ? { 'workbench.colorTheme': conv.theme } : {}),
    ...(conv.zoom !== undefined ? { 'window.zoomLevel': Number(conv.zoom) } : {}),
    ...(conv.settings || {}),
  };
}

/**
 * Gets the profile ready for a take: its settings written, what a previous take left (open files, unsaved text,
 * terminals) removed, an editor left running from a crashed take closed.
 */
export function prepareProfile(kind, conv) {
  const p = profileOf(kind);
  fs.mkdirSync(path.join(p.data, 'User'), { recursive: true });
  fs.mkdirSync(p.extensions, { recursive: true });
  for (const leftover of [path.join(p.data, 'User', 'workspaceStorage'), path.join(p.data, 'Backups')]) fs.rmSync(leftover, { recursive: true, force: true });
  fs.writeFileSync(path.join(p.data, 'User', 'settings.json'), JSON.stringify(editorSettings(kind, conv), null, 2) + '\n');
  killLeftover(p);
  return p;
}

const pidFile = p => path.join(p.root, 'sfdemo.pid');
function killLeftover(p) {
  if (!fs.existsSync(pidFile(p))) return;
  const pid = Number(fs.readFileSync(pidFile(p), 'utf8'));
  fs.rmSync(pidFile(p), { force: true });
  if (!pid || process.platform === 'win32') return;
  const cmd = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || '';
  if (!cmd.includes(p.data)) return; // that number is another program now
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

/** The extensions of the profile (lowercase ids). */
function installedExtensions(p) {
  const list = path.join(p.extensions, 'extensions.json');
  if (fs.existsSync(list)) {
    try { return JSON.parse(fs.readFileSync(list, 'utf8')).map(x => String(x.identifier && x.identifier.id).toLowerCase()); } catch { /* scanned below */ }
  }
  return fs.existsSync(p.extensions) ? fs.readdirSync(p.extensions).map(d => d.replace(/-\d+\.\d+\.\d+.*$/, '').toLowerCase()).filter(d => d.includes('.')) : [];
}

/**
 * Installs the extensions a window asks for that the profile lacks, from the editor's marketplace (publisher.name ids).
 * @param {string} kind
 * @param {string[]} wanted
 * @param {{ log?: (m: string) => void }} [options]
 */
export async function ensureExtensions(kind, wanted, { log = () => {} } = {}) {
  const p = profileOf(kind);
  const have = new Set(installedExtensions(p));
  const missing = wanted.filter(id => !have.has(String(id).toLowerCase()));
  if (!missing.length) return;
  const found = findEditor(kind);
  if (!found || !found.cli) throw new Error(`cannot install ${missing.join(', ')}: ${EDITORS[kind].name}'s command line was not found`);
  log(`installing ${missing.join(', ')} into the demo profile of ${EDITORS[kind].name}`);
  const args = ['--user-data-dir', p.data, '--extensions-dir', p.extensions, ...missing.flatMap(id => ['--install-extension', id])];
  const r = await new Promise(resolve => {
    const c = spawn(found.cli, args, { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let text = '';
    c.stdout.on('data', d => { text += d; });
    c.stderr.on('data', d => { text += d; });
    c.on('close', code => resolve({ code, text }));
    c.on('error', e => resolve({ code: 1, text: e.message }));
  });
  if (r.code !== 0) throw new Error(`installing ${missing.join(', ')} failed: ${String(r.text).trim().split('\n').slice(-2).join(' ')}`);
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = /** @type {any} */ (s.address()); s.close(() => resolve(port)); });
});

/** The editor's command line for a window: its own profile, a debugging port, the folder. */
export function launchArgs(kind, conv, { port, profile, installed = [] }) {
  const wanted = new Set((conv.extensions || []).map(x => String(x).toLowerCase()));
  const extensionArgs = !wanted.size ? ['--disable-extensions'] : installed.filter(id => !wanted.has(id)).flatMap(id => ['--disable-extension', id]);
  return [
    '--user-data-dir', profile.data, '--extensions-dir', profile.extensions, `--remote-debugging-port=${port}`,
    '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    // keep drawing when the window is behind others: it is filmed, not looked at
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
    ...extensionArgs, conv.folder,
  ];
}

const visible = async (locator, timeout = 0) => {
  try { await locator.first().waitFor({ state: 'visible', timeout: Math.max(timeout, 1) }); return true; } catch { return false; }
};

/** Cursor's login screen, when its demo profile is not logged in. */
async function loginWall(page) {
  return (await page.getByText(/^\s*Log In\s*$/).first().isVisible().catch(() => false)) && (await page.getByText(/^\s*Sign Up\s*$/).first().isVisible().catch(() => false));
}

/** Closes what an editor shows when it starts (a sign-in offer, a walkthrough): always the button that declines. */
async function dismissStartup(page) {
  for (let round = 0; round < 3; round++) {
    let clicked = false;
    for (const label of ['Continue without Signing In', 'Skip for now', 'Skip', 'Not Now', 'Maybe Later', 'No Thanks']) {
      const b = page.getByRole('button', { name: label, exact: true });
      if (await b.first().isVisible().catch(() => false)) { await b.first().click().catch(() => {}); clicked = true; await sleep(600); }
    }
    if (!clicked) break;
  }
}

/** The label of a Command Palette row without its keybinding ("View: Toggle Terminal, ⌃`" -> "View: Toggle Terminal"). */
const rowLabel = aria => String(aria || '').replace(/\s+/g, ' ').trim();
const sameCommand = (aria, name) => {
  const a = rowLabel(aria).toLowerCase();
  const n = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return a === n || a.startsWith(n + ',');
};

/**
 * Opens an editor window off camera: the demo profile prepared, the extensions it needs installed, the editor
 * started on the folder, its startup offers declined, the files opened, then filmed.
 * @param {any} conv the resolved window ({ name, label, editor, folder, files?, extensions?, settings?, theme?, zoom? })
 * @param {{ viewport: any, dir: string, env?: Record<string, string>, log?: (m: string) => void }} options
 */
export async function openEditor(conv, { viewport, dir, env = {}, log = () => {} }) {
  const kind = conv.editor;
  const e = EDITORS[kind];
  const found = findEditor(kind);
  if (!found) throw new Error(`${e.name} is not installed (or not found: set ${e.env} to its executable)`);
  fs.mkdirSync(conv.folder, { recursive: true });
  const profile = prepareProfile(kind, conv);
  if (conv.extensions && conv.extensions.length) await ensureExtensions(kind, conv.extensions, { log });
  const port = await freePort();
  const logFile = path.join(dir, `${conv.name}-${kind}.log`);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(found.app, launchArgs(kind, conv, { port, profile, installed: installedExtensions(profile) }), { env: cleanEnv(env), stdio: ['ignore', out, out], detached: process.platform !== 'win32' });
  fs.closeSync(out);
  fs.writeFileSync(pidFile(profile), String(child.pid));
  let exited = false;
  child.on('exit', () => { exited = true; });
  const { chromium } = await import('playwright');
  let browser = null;
  const quit = async () => {
    if (browser) {
      const s = await browser.newBrowserCDPSession().catch(() => null);
      if (s) await Promise.race([s.send('Browser.close').catch(() => {}), sleep(4000)]);
    }
    for (let i = 0; i < 20 && !exited; i++) await sleep(250);
    if (!exited) { try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(pidFile(profile), { force: true });
  };
  try {
    log(`${conv.name}: starting ${e.name} on ${conv.folder}`);
    for (let i = 0; i < 120 && !browser; i++) {
      if (exited) throw new Error(`${e.name} closed at once (see ${logFile}): is it open already with the demo profile? Close it.`);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await sleep(500);
    }
    if (!browser) throw new Error(`${e.name} did not open its debugging port in 60 s (see ${logFile})`);
    let page = null;
    for (let i = 0; i < 120 && !page; i++) {
      page = browser.contexts().flatMap(c => c.pages()).find(pg => /workbench(\.esm)?\.html/.test(pg.url())) || null;
      if (!page) await sleep(500);
    }
    if (!page) throw new Error(`${e.name}'s window did not show in 60 s`);
    await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
    await page.setViewportSize(viewport);
    quietPages.add(page);
    const w = { name: conv.name, conv, kind: 'editor', page, context: null, base: null, who: `${e.name}, demo profile`, created: Date.now(), surface: null, video: null };
    await sleep(2500);
    if (await loginWall(page)) throw new Error(`${e.name} shows its login screen: log in once in its demo profile (sfdemo editor ${kind}), then record again. sfdemo never logs in for you.`);
    await dismissStartup(page);
    for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await sleep(150); }
    await runCommand(w, 'Notifications: Clear All Notifications', { quick: true, optional: true });
    await runCommand(w, 'View: Close All Editors', { quick: true, optional: true });
    for (const f of conv.files || []) await quickOpen(w, f, { quick: true });
    await page.evaluate(installOverlay, { label: conv.label }).catch(() => {});
    page.on('load', () => { page.evaluate(installOverlay, { label: conv.label }).catch(() => {}); });
    await sleep(800);
    const video = path.join(dir, 'video', `${conv.name}-${kind}.webm`);
    fs.mkdirSync(path.dirname(video), { recursive: true });
    await page.screencast.start({ path: video, size: viewport });
    w.created = Date.now();
    log(`${conv.name}: ${e.name} ready`);
    return Object.assign(w, {
      act: step => editorAct(w, step),
      async finish() {
        await page.screencast.stop().catch(() => {});
        await quit();
        return fs.existsSync(video) ? video : null;
      },
    });
  } catch (err) {
    await quit();
    throw err;
  }
}

const quickInput = page => page.locator('.quick-input-widget input.input, .quick-input-widget input').first();
const rows = page => page.locator('.quick-input-widget .quick-input-list .monaco-list-row');

async function aimAt(w, locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (box) { await moveCursor(w.page, box.x + Math.min(box.width / 2, 80), box.y + box.height / 2); await sleep(300); }
}

/** Opens a file through Quick Open (Ctrl/Cmd+P): its path, as a presenter types it; `file:42` goes to line 42. */
export async function quickOpen(w, file, { quick = false } = {}) {
  const page = w.page;
  await page.keyboard.press('ControlOrMeta+P');
  const input = quickInput(page);
  if (!(await visible(input, 8000))) throw new Error(`Quick Open did not show in ${w.name}`);
  await input.fill('');
  await page.keyboard.type(String(file), { delay: quick ? 0 : TYPE_DELAY });
  const base = path.basename(String(file).replace(/:\d+(:\d+)?$/, ''));
  const deadline = Date.now() + 20000;
  let hit = false;
  while (Date.now() < deadline) {
    const labels = await rows(page).evaluateAll(rs => rs.map(r => r.getAttribute('aria-label') || r.textContent || '')).catch(() => []);
    if (labels.length && labels[0].toLowerCase().includes(base.toLowerCase())) { hit = true; break; }
    await sleep(250);
  }
  if (!hit) { await page.keyboard.press('Escape'); throw new Error(`no file "${file}" in ${w.name}'s folder (Quick Open found none)`); }
  await sleep(quick ? 100 : 450);
  await page.keyboard.press('Enter');
  const tab = page.locator('.tabs-container .tab.active, .title .label-name').filter({ hasText: base }).first();
  await visible(tab, 10000);
  await sleep(quick ? 300 : 900);
}

/**
 * Runs a command of the Command Palette (F1), by its label as the palette shows it ("Terminal: Create New
 * Terminal", "SFDX: Deploy This Source to Org"): typed, then its row clicked (the exact one, not the first).
 */
export async function runCommand(w, name, { quick = false, optional = false } = {}) {
  const page = w.page;
  await page.keyboard.press('F1');
  const input = quickInput(page);
  if (!(await visible(input, 8000))) { if (optional) return false; throw new Error(`the Command Palette did not open in ${w.name}`); }
  await page.keyboard.type(String(name), { delay: quick ? 0 : TYPE_DELAY });
  const deadline = Date.now() + (quick ? 4000 : 10000);
  let seen = [];
  while (Date.now() < deadline) {
    seen = await rows(page).evaluateAll(rs => rs.map(r => r.getAttribute('aria-label') || '')).catch(() => []);
    const k = seen.findIndex(a => sameCommand(a, name));
    if (k >= 0) {
      const row = rows(page).nth(k);
      if (!quick) { await sleep(350); await aimAt(w, row); }
      await row.click();
      await sleep(quick ? 400 : 1200);
      return true;
    }
    await sleep(250);
  }
  await page.keyboard.press('Escape');
  if (optional) return false;
  throw new Error(`no command "${name}" in ${w.name}'s Command Palette${seen.length ? ` (it shows: ${seen.slice(0, 5).map(rowLabel).join(' | ')})` : ''}`);
}

/** Types into what has the focus (the open file), visibly. */
async function typeText(w, text, delay = TYPE_DELAY) {
  await w.page.keyboard.type(String(text), { delay });
  await sleep(400);
}

/**
 * Types a block of code into the open file where the cursor is, line after line, each ending with Enter: whole
 * lines are inserted (the profile adds no indentation or brackets of its own).
 */
async function typeCode(w, code) {
  for (const line of String(code).split('\n')) {
    if (line) await w.page.keyboard.type(line, { delay: CODE_DELAY });
    await w.page.keyboard.press('Enter');
  }
  await sleep(600);
}

/** The text of the integrated terminal on screen, one string per row, without trailing spaces. */
async function terminalLines(page) {
  const text = await page.locator('.terminal-wrapper.active .xterm-rows, .terminal-group .xterm-rows').last().innerText({ timeout: 2000 }).catch(() => '');
  return text.split('\n').map(l => l.replace(/[\s ]+$/, ''));
}
const lastLine = lines => [...lines].reverse().find(l => l.trim()) || '';

/** Shows the integrated terminal and gives it the focus; resolves once its prompt is there. */
async function focusTerminal(w) {
  const page = w.page;
  const term = page.locator('.terminal-wrapper.active .xterm, .terminal-group .xterm').last();
  if (!(await term.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Backquote');
    if (!(await visible(term, 15000))) await runCommand(w, 'Terminal: Create New Terminal');
    if (!(await visible(term, 15000))) throw new Error(`the terminal of ${w.name} did not open`);
  } else if (!(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.terminal-wrapper, .xterm')).catch(() => false))) {
    const screenArea = page.locator('.terminal-wrapper.active .xterm-screen, .terminal-group .xterm-screen').last();
    await aimAt(w, screenArea);
    await screenArea.click();
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (PROMPT_RE.test(lastLine(await terminalLines(page))) || process.platform === 'win32') return;
    await sleep(250);
  }
  throw new Error(`the terminal of ${w.name} shows no prompt`);
}

/** Types a command in the integrated terminal; with `wait`, until its prompt comes back (an error ends the take). */
async function terminalRun(w, command, { wait, where }) {
  const page = w.page;
  await focusTerminal(w);
  const before = (await terminalLines(page)).join('\n');
  await sleep(250);
  await page.keyboard.type(command, { delay: TYPE_DELAY + 5 });
  await sleep(350);
  await page.keyboard.press('Enter');
  if (!wait) { await sleep(900); return; }
  const deadline = Date.now() + RUN_TIMEOUT;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(300);
    const lines = await terminalLines(page);
    const text = lines.join('\n');
    if (text !== last) { last = text; stableSince = Date.now(); continue; }
    const end = lastLine(lines);
    const m = end.match(PROMPT_RE);
    const quiet = Date.now() - stableSince;
    if (text !== before && ((m && quiet > 500) || (process.platform === 'win32' && quiet > 2500))) {
      await sleep(500);
      const shown = lines.filter(l => l.trim());
      const echoed = shown.map(l => l.includes(command)).lastIndexOf(true);
      const printed = shown.slice(echoed + 1, -1).slice(-3).join(' / ').slice(0, 300);
      if (m && m[1]) throw new Error(`"${command}" ended with exit code ${m[1]}${printed ? `: ${printed}` : ''}`);
      return;
    }
  }
  throw new Error(`"${command}" still runs after ${RUN_TIMEOUT / 60000} minutes`);
}

/** Runs a step of an editor window; false for the steps any page knows (click, point, wait for, press...). */
async function editorAct(w, step) {
  switch (step.type) {
    case 'open': await quickOpen(w, step.target); return true;
    case 'command': await runCommand(w, step.name); return true;
    case 'type': await typeText(w, step.text); return true;
    case 'code': await typeCode(w, step.code); return true;
    case 'run': await terminalRun(w, step.command, { wait: true, where: step.where }); return true;
    case 'start': await terminalRun(w, step.command, { wait: false, where: step.where }); return true;
    case 'scroll':
      if (/^(top|bottom)$/i.test(step.target)) { await w.page.keyboard.press(/^top$/i.test(step.target) ? 'ControlOrMeta+Home' : 'ControlOrMeta+End'); await sleep(700); return true; }
      return false;
    default: return false;
  }
}

/**
 * Opens an editor with its demo profile, for the user (no debugging port, nothing filmed): to log in (Cursor),
 * install extensions, look at it. sfdemo rewrites the profile's settings before each recording: a demo's own
 * settings go in its window (settings: { ... }).
 */
export function openProfileForUser(kind, folder) {
  const e = EDITORS[kind];
  const found = findEditor(kind);
  if (!found) throw new Error(`${e.name} is not installed (or not found: set ${e.env} to its executable)`);
  const profile = prepareProfile(kind, {});
  const child = spawn(found.app, ['--user-data-dir', profile.data, '--extensions-dir', profile.extensions, '--new-window', ...(folder ? [path.resolve(folder)] : [])], { env: cleanEnv(), stdio: 'ignore', detached: true });
  child.unref();
  return profile;
}
