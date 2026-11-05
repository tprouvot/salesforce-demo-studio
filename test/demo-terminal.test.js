/**
 * Terminal windows, recorded for real in Chromium: commands run on this machine in a pseudo-terminal (or pipes),
 * start: and Control+C, type: into a command that asks, a web window that opens the link a terminal printed,
 * prepare: steps, and a failing command that fails the take. Needs Chromium and a POSIX shell, with a fake Piper.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { recordChapter } from '../src/demo/recorder.js';
import { parseDemo } from '../src/demo/script.js';
import { narrate } from '../src/demo/voice.js';
import { installFakePiper } from './helpers/fake-piper.js';

const hasBrowser = fs.existsSync(chromium.executablePath());
if (!hasBrowser && process.env.SFDEMO_REQUIRE_BROWSER) throw new Error('Chromium is missing: npx playwright install chromium');
const skip = !hasBrowser ? 'Chromium is not installed' : process.platform === 'win32' ? 'the commands of these tests are POSIX ones' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-terminal-'));

let browser;
let piper;
before(async () => {
  if (skip) return;
  piper = installFakePiper();
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (piper) piper.restore();
});

/** A narrated demo in its own folder, with an app folder for its terminal (server.js, ask.js). */
async function prepare(name, text) {
  const dir = path.join(tmp, name);
  const app = path.join(dir, 'app');
  fs.mkdirSync(path.join(dir, 'demos'), { recursive: true });
  fs.mkdirSync(path.join(app, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(app, 'server.js'), `const http = require('http'); const fs = require('fs');
const s = http.createServer((req, res) => { fs.appendFileSync('requests.log', req.url + '\\n'); res.end('<h1>hello from the app</h1>'); });
s.listen(0, '127.0.0.1', () => { fs.writeFileSync('server.pid', String(process.pid)); console.log('\\x1b[32mlistening\\x1b[0m on http://127.0.0.1:' + s.address().port + '/?token=t0k3n'); });
`);
  fs.writeFileSync(path.join(app, 'ask.js'), `process.stdout.write('Name? ');
process.stdin.once('data', d => { const n = String(d).trim(); console.log('Hello ' + n); require('fs').writeFileSync('answer.txt', n); process.exit(0); });
`);
  const file = path.join(dir, 'demos', `${name}.md`);
  fs.writeFileSync(file, text);
  const demo = parseDemo(text, file);
  const { stock } = await narrate(demo, { cacheDir: path.join(tmp, 'narration') });
  return { demo, stock, app, out: path.join(dir, 'out'), stateDir: path.join(dir, '.sfdemo'), aiCache: path.join(dir, `${name}.ai-steps.json`) };
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a terminal chapter: prepare, run, start a server, open its link in a web window, Control+C, cd', { skip }, async () => {
  const p = await prepare('shell', `---
pause: 0.1
windows:
  Shell: { terminal: ../app, label: Terminal }
  App: { url: "http://127.0.0.1:", from: Shell, label: The app }
---
# Terminal
- prepare: echo ready > ../app/prepared.txt
- window: Shell
Here is a terminal.
- run: cat prepared.txt
- run: node -e "console.log('\\x1b[1;36mcolours\\x1b[0m', process.stdout.isTTY ? 'tty' : 'pipe')" > tty.txt
- start: node server.js
- wait for: listening
- window: App
- wait for: hello from the app
- window: Shell
- press: Control+C
- run: cd sub
- run: pwd > where.txt
\`\`\`sh
# comments are not run
echo one > one.txt
\`\`\`
`);
  const logs = [];
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: e => logs.push(e.message) });
  assert.equal(r.reason, null, logs.join('\n'));
  assert.equal(fs.readFileSync(path.join(p.app, 'prepared.txt'), 'utf8').trim(), 'ready', 'prepare: ran before the chapter, in the demo\'s folder');
  assert.ok(fs.existsSync(r.windows.Shell.video) && fs.existsSync(r.windows.App.video), 'both windows were filmed');
  assert.deepEqual(fs.readFileSync(path.join(p.app, 'requests.log'), 'utf8').trim().split('\n'), ['/?token=t0k3n'], 'the web window opened the link the terminal printed, its token with it');
  const pid = Number(fs.readFileSync(path.join(p.app, 'server.pid'), 'utf8'));
  assert.equal(alive(pid), false, 'Control+C stopped the server');
  assert.equal(fs.realpathSync(fs.readFileSync(path.join(p.app, 'sub', 'where.txt'), 'utf8').trim()), fs.realpathSync(path.join(p.app, 'sub')), 'cd changed the folder of the next commands');
  assert.equal(fs.readFileSync(path.join(p.app, 'sub', 'one.txt'), 'utf8').trim(), 'one', 'the ```sh block ran, line by line');
  const tty = fs.readFileSync(path.join(p.app, 'tty.txt'), 'utf8');
  assert.match(tty, /colours/);
  assert.deepEqual(r.events.filter(e => e.kind === 'do').map(e => e.action), ['run', 'run', 'start', 'wait-for', 'wait-for', 'press', 'run', 'run', 'code']);
  assert.deepEqual(r.events.filter(e => e.kind === 'view').map(e => e.window), ['Shell', 'App', 'Shell']);
});

test('type: answers a command that asks, in a pseudo-terminal and with pipes', { skip }, async () => {
  for (const pipes of [false, true]) {
    if (pipes) process.env.SFDEMO_TERMINAL_PIPES = '1';
    try {
      const p = await prepare(`ask-${pipes ? 'pipes' : 'pty'}`, `---
windows:
  Shell: { terminal: ../app }
---
# Ask
- window: Shell
- start: node ask.js
- wait for: Name?
- type: Ada
- press: Enter
- wait for: Hello Ada
`);
      const logs = [];
      const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: e => logs.push(e.message) });
      assert.equal(r.reason, null, logs.join('\n'));
      assert.equal(fs.readFileSync(path.join(p.app, 'answer.txt'), 'utf8'), 'Ada');
    } finally { delete process.env.SFDEMO_TERMINAL_PIPES; }
  }
});

test('a command that fails ends the take, with its exit code and what it printed; what still runs is stopped', { skip }, async () => {
  const p = await prepare('fails', `---
windows:
  Server: { terminal: ../app }
  Shell: { terminal: ../app }
---
# Fails
- window: Server
- start: node server.js
- wait for: listening
- run: echo busy
- window: Shell
- run: node -e "console.error('no such org: demo'); process.exit(3)"
- run: echo never > never.txt
`);
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: () => {} });
  assert.equal(r.failed, true);
  assert.match(r.reason, /fails\.md:10: run: "node server\.js" still runs in Server: stop it first \(press: Control\+C\)/, 'one terminal runs one command at a time');
  const q = await prepare('fails2', fs.readFileSync(p.demo.file, 'utf8').replace('- run: echo busy\n', ''));
  const r2 = await recordChapter(browser, q.demo, 1, 1, { ...q, emit: () => {} });
  assert.equal(r2.failed, true);
  assert.match(r2.reason, /fails2\.md:11: run: "node -e .*" ended with exit code 3: no such org: demo/);
  assert.equal(fs.existsSync(path.join(q.app, 'never.txt')), false, 'nothing after the failure ran');
  assert.ok(fs.existsSync(path.join(q.out, 'takes', 'ch01', 'take1', 'Shell-failed.png')), 'the screen at the failure is kept');
  const pid = Number(fs.readFileSync(path.join(q.app, 'server.pid'), 'utf8'));
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise(res => setTimeout(res, 100));
  assert.equal(alive(pid), false, 'the server started in the take was stopped with it');
});

test('a prepare: that fails ends the take before anything is filmed', { skip }, async () => {
  const p = await prepare('prep', `---
windows:
  Shell: { terminal: . }
---
# Prep
- prepare: echo "the template is missing" >&2; exit 4
- window: Shell
- run: ls
`);
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: () => {} });
  assert.equal(r.failed, true);
  assert.match(r.reason, /prep\.md:6: prepare: ".*" ended with exit code 4: the template is missing/);
  assert.deepEqual(r.windows, {}, 'no window was opened');
});

test('sfdemo in a filmed terminal is the sfdemo that records', { skip }, async () => {
  const p = await prepare('self', `---
windows:
  Shell: { terminal: ../app }
---
# Self
- window: Shell
- run: sfdemo --version > version.txt
`);
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: () => {} });
  assert.equal(r.reason, null);
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.match(fs.readFileSync(path.join(p.app, 'version.txt'), 'utf8'), new RegExp(version.replace(/\./g, '\\.')));
});

test('wait for: in a terminal waits while its command runs, and fails as soon as it ended without the text', { skip }, async () => {
  const p = await prepare('waits', `---
windows:
  Shell: { terminal: ../app }
---
# Waits
- window: Shell
- start: node -e "setTimeout(() => console.log('ready now'), 1500)"
- wait for: READY now
- start: node -e "console.log('bye')"
- wait for: never printed
`);
  const t = Date.now();
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: () => {} });
  assert.equal(r.failed, true);
  assert.match(r.reason, /waits\.md:10: wait-for: "node -e .*" ended \(exit code 0\) without printing "never printed"/);
  assert.ok(Date.now() - t < 30000, 'it did not wait for the 45 s of a page');
});
