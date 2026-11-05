/**
 * VS Code and Cursor windows, against a fake editor (helpers/fake-editor.js: headless Chromium on a stand-in
 * workbench, started from VS Code's command line): the demo profile, the debugging port and the screencast, Quick
 * Open, the Command Palette's exact row, typing, the integrated terminal's prompt and errors, extensions installed
 * once, a login screen refused. Needs Chromium and a POSIX shell; no real editor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { openEditor, profileOf } from '../src/demo/editor.js';
import { runAction } from '../src/demo/actions.js';
import { recordChapter } from '../src/demo/recorder.js';
import { parseDemo } from '../src/demo/script.js';
import { narrate } from '../src/demo/voice.js';
import { probeDuration } from '../src/engine/media.js';
import { installFakeEditor, fakeEditorSupported } from './helpers/fake-editor.js';
import { installFakePiper } from './helpers/fake-piper.js';

const hasBrowser = fs.existsSync(chromium.executablePath());
if (!hasBrowser && process.env.SFDEMO_REQUIRE_BROWSER) throw new Error('Chromium is missing: npx playwright install chromium');
const skip = !hasBrowser ? 'Chromium is not installed' : !fakeEditorSupported ? 'the fake editor needs a POSIX shell' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-editor-'));
const viewport = { width: 1440, height: 810 };

let piper;
before(() => { if (!skip) piper = installFakePiper(); });
after(() => { if (piper) piper.restore(); });

const folder = name => { const d = path.join(tmp, name, 'app'); fs.mkdirSync(d, { recursive: true }); return d; };
const conv = (name, extra = {}) => ({ name, label: 'VS Code', editor: 'vscode', surface: 'editor', folder: folder(name), files: [], ...extra });
const step = (type, fields) => ({ type, where: 'demo.md:1', ...fields });

test('an editor window: its own profile, the folder, Quick Open, the exact command, typing, the terminal; then filmed and closed', { skip }, async () => {
  const fake = installFakeEditor();
  const dir = path.join(tmp, 'flow-take');
  fs.mkdirSync(dir, { recursive: true });
  try {
    const c = conv('flow', { files: ['README.md'], settings: { 'editor.fontSize': 21 } });
    const w = await openEditor(c, { viewport, dir });
    const page = w.page;
    const launch = fake.calls()[0];
    const profile = profileOf('vscode');
    assert.ok(launch.startsWith(`--user-data-dir ${profile.data} --extensions-dir ${profile.extensions} --remote-debugging-port=`), launch);
    assert.ok(launch.includes('--disable-extensions') && launch.endsWith(c.folder), 'no extension asked: none loads; the folder opens');
    const settings = JSON.parse(fs.readFileSync(path.join(profile.data, 'User', 'settings.json'), 'utf8'));
    assert.equal(settings['editor.fontSize'], 21, 'the window\'s settings are in the profile');
    assert.equal(settings['chat.disableAIFeatures'], true);
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [1440, 810], 'the window has the size of the video');
    assert.equal(await page.locator('.tab.active').textContent(), 'README.md', 'files: opened off camera');
    assert.ok(await page.locator('#__sfdemoCursor').count(), 'the drawn cursor is in the editor');

    await runAction(w, step('open', { target: 'src/greet.js' }));
    assert.equal(await page.locator('.tab.active').textContent(), 'greet.js');
    await runAction(w, step('code', { code: 'export const a = 1;\n  // indented' }));
    await runAction(w, step('type', { text: ' done' }));
    assert.equal(await page.evaluate(() => window['__files']['src/greet.js']), 'export const a = 1;\n  // indented\n done', 'each typed line ends with Enter: whole lines are inserted');
    await runAction(w, step('command', { name: 'File: Save' }));
    assert.equal(await page.evaluate(() => window['__saved']['src/greet.js']), 'export const a = 1;\n  // indented\n done');
    await runAction(w, step('command', { name: 'Fake: Shout' }));
    assert.deepEqual(await page.evaluate(() => window['__shouts']), ['shout'], 'the exact row ran, not the first one ("Fake: Shout Louder")');
    await assert.rejects(runAction(w, step('command', { name: 'Fake: Whisper' })), /no command "Fake: Whisper" in flow's Command Palette/);

    await runAction(w, step('run', { command: 'ls' }));
    await runAction(w, step('run', { command: 'slow' }));
    assert.match(await page.locator('.xterm-rows').innerText(), /app \$ slow\ndone slow\napp \$/, 'run: waits until the prompt is back');
    await assert.rejects(runAction(w, step('run', { command: 'false' })), /"false" ended with exit code 1/);
    await runAction(w, step('start', { command: 'slow' }));
    assert.doesNotMatch(await page.locator('.xterm-rows').innerText(), /app \$ slow\ndone slow\n.*\n.*app \$ slow\ndone slow/s, 'start: does not wait');
    await runAction(w, step('wait-for', { text: 'done slow' }));
    assert.deepEqual(await page.evaluate(() => window['__ran']), ['ls', 'slow', 'false', 'slow']);

    const video = await w.finish();
    assert.ok(video && fs.existsSync(video), 'the screencast was saved');
    assert.ok((await probeDuration(video)) > 3);
    assert.equal(fs.existsSync(path.join(profile.root, 'sfdemo.pid')), false, 'the editor was closed');
  } finally { fake.restore(); }
});

test('extensions a window asks for are installed into the demo profile once; the others stay off', { skip }, async () => {
  const fake = installFakeEditor();
  const dir = path.join(tmp, 'ext-take');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (let i = 0; i < 2; i++) {
      const w = await openEditor(conv('ext', { extensions: ['acme.tool'] }), { viewport, dir });
      await w.finish();
    }
    const calls = fake.calls();
    assert.equal(calls.filter(c => c.startsWith('cli ') && c.includes('--install-extension acme.tool')).length, 1, 'installed once, kept for the next takes');
    const launches = calls.filter(c => !c.startsWith('cli '));
    assert.equal(launches.length, 2);
    assert.ok(launches.every(l => !l.includes('--disable-extensions')));
  } finally { fake.restore(); }
});

test('a login screen (Cursor before its login) ends the take with what to do; nothing is clicked', { skip }, async () => {
  const fake = installFakeEditor({ wall: true });
  try {
    await assert.rejects(openEditor(conv('wall'), { viewport, dir: path.join(tmp, 'wall') }), /VS Code shows its login screen: log in once in its demo profile \(sfdemo editor vscode\).*sfdemo never logs in for you/);
    assert.equal(fs.existsSync(path.join(profileOf('vscode').root, 'sfdemo.pid')), false, 'the editor was closed');
  } finally { fake.restore(); }
});

test('an editor chapter recorded: events, the window\'s video and its offset', { skip }, async () => {
  const fake = installFakeEditor();
  try {
    const dir = path.join(tmp, 'chapter');
    fs.mkdirSync(path.join(dir, 'demos'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    const text = `---
pause: 0.1
windows:
  Code: { vscode: ../app, label: VS Code }
---
# Editor
- window: Code
This is the editor.
- open: notes.md
\`\`\`markdown
# Notes
\`\`\`
- command: File: Save
- run: ls
`;
    const file = path.join(dir, 'demos', 'chapter.md');
    fs.writeFileSync(file, text);
    const demo = parseDemo(text, file);
    const { stock } = await narrate(demo, { cacheDir: path.join(tmp, 'narration') });
    const browser = await chromium.launch();
    try {
      const logs = [];
      const r = await recordChapter(browser, demo, 1, 1, { out: path.join(dir, 'out'), stock, stateDir: path.join(dir, '.sfdemo'), aiCache: path.join(dir, 'ai.json'), emit: e => logs.push(e.message) });
      assert.equal(r.reason, null, logs.join('\n'));
      assert.deepEqual(r.events.filter(e => e.kind === 'do').map(e => e.action), ['open', 'code', 'command', 'run']);
      assert.ok(fs.existsSync(r.windows.Code.video));
      assert.ok(r.windows.Code.offset >= 0 && r.windows.Code.offset < 2, 'the editor is filmed from when it is ready, not from its start');
    } finally { await browser.close(); }
  } finally { fake.restore(); }
});
