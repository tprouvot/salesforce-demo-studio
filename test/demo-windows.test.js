/**
 * Terminal, VS Code and Cursor windows in demo scripts: their settings, their steps, code blocks by window, links
 * opened from a terminal, prepare: steps, and the speaker-notes cues. Parsing only (no browser, no editor).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseDemo, speakerNotes, kindOf } from '../src/demo/script.js';
import { editorSettings, launchArgs } from '../src/demo/editor.js';
import { keyBytes } from '../src/demo/terminal.js';

const FILE = path.join(path.sep, 'work', 'demos', 'tour.md');
const demo = (body, windows = 'windows:\n  Shell: { terminal: . }\n  Code: { vscode: .., files: [README.md] }\n  Admin: { org: myOrg }') => parseDemo(`---\n${windows}\n---\n# One\n${body}\n`, FILE);
const steps = d => d.chapters.flatMap(c => c.steps);

test('terminal and editor windows: their folder (from the script), their settings, checked', () => {
  const d = demo('- window: Shell\n- run: ls', `windows:
  Shell: { terminal: ., label: Terminal, theme: light, prompt: "my-demos %", title: my-demos }
  Home: { terminal: ~/projects }
  Abs: { terminal: /tmp/work }
  Code: { vscode: .., files: README.md, extensions: [salesforce.salesforcedx-vscode], settings: { "editor.fontSize": 18 }, theme: Default Light Modern, zoom: 1 }
  Cur: { cursor: ../app }`);
  assert.deepEqual(d.windows.Shell, { name: 'Shell', label: 'Terminal', surface: 'terminal', signIn: 'none', identity: 'terminal|Shell', folder: path.resolve(path.sep, 'work', 'demos'), title: 'my-demos', prompt: 'my-demos %', theme: 'light' });
  assert.equal(d.windows.Home.folder, path.join(os.homedir(), 'projects'));
  assert.equal(d.windows.Abs.folder, path.resolve('/tmp/work'));
  assert.equal(d.windows.Code.surface, 'editor');
  assert.equal(d.windows.Code.editor, 'vscode');
  assert.equal(d.windows.Code.folder, path.resolve(path.sep, 'work'));
  assert.deepEqual(d.windows.Code.files, ['README.md'], 'one file is a list of one');
  assert.deepEqual(d.windows.Code.extensions, ['salesforce.salesforcedx-vscode']);
  assert.equal(d.windows.Code.zoom, 1);
  assert.equal(d.windows.Cur.editor, 'cursor');
  assert.deepEqual(d.windows.Cur.files, []);
  assert.deepEqual(Object.values(d.windows).map(kindOf), ['terminal', 'terminal', 'terminal', 'editor', 'editor']);

  const bad = (windows, re) => assert.throws(() => demo('- window: W\n- wait: 1', `windows:\n  W: ${windows}`), re);
  bad('{ terminal: ., org: myOrg }', /is a terminal: it takes no org/);
  bad('{ terminal: ., theme: blue }', /theme: is dark or light/);
  bad('{ terminal: 42 }', /terminal: is the folder to open/);
  bad('{ vscode: ., extensions: [not an id] }', /"not an id" is not an extension id/);
  bad('{ vscode: ., settings: [1] }', /settings: are VS Code settings/);
  bad('{ cursor: ., zoom: big }', /zoom: is Cursor's zoom level/);
  bad('{ vscode: ., site: https://x.example.com }', /is VS Code: it takes no site/);
  bad('{ org: myOrg, from: Shell }', /from: goes with url:/);
});

test('each kind of window plays its own steps; the others are errors that say where they go', () => {
  const d = demo(`- window: Shell
- run: npm test
- start: sfdemo ui --no-open
- type: yes
- press: Control+C
- wait for: passed
- window: Code
- open: src/app.js:12
- command: View: Toggle Terminal
- type: "hello"
- run: ls
- window: Admin
- type: Acme`);
  assert.deepEqual(steps(d).filter(s => s.type !== 'window').map(s => [s.type, s.kind, s.command || s.text || s.key || s.target || s.name]), [
    ['run', 'terminal', 'npm test'], ['start', 'terminal', 'sfdemo ui --no-open'], ['type', 'terminal', 'yes'], ['press', 'terminal', 'Control+C'],
    ['wait-for', 'terminal', 'passed'], ['open', 'editor', 'src/app.js:12'], ['command', 'editor', 'View: Toggle Terminal'], ['type', 'editor', 'hello'],
    ['run', 'editor', 'ls'], ['type', 'browser', 'Acme'],
  ]);
  assert.throws(() => demo('- window: Admin\n- run: ls'), /"run:" does not go in Admin, a browser window: it needs a terminal window or a VS Code or Cursor window/);
  assert.throws(() => demo('- window: Shell\n- open: /lightning/page/home'), /"open:" does not go in Shell, a terminal window: it needs a browser window .* or a VS Code or Cursor window/);
  assert.throws(() => demo('- window: Shell\n- setup: Users'), /"setup:" does not go in Shell/);
  assert.throws(() => demo('- window: Code\n1. Hi there'), /"a chat message" does not go in Code, a VS Code window: it needs a browser window/);
  assert.throws(() => demo('- window: Admin\n- command: File: Save'), /"command:" does not go in Admin.*VS Code or Cursor window/);
  assert.throws(() => demo('- run: ls'), /"run" needs a window first/);
});

test('a code block belongs to the window above it: run in a terminal, typed in an editor, Apex in Salesforce', () => {
  const d = demo(`- window: Shell
\`\`\`sh
# a comment line is not run
npm install
npm test
\`\`\`
- window: Code
- open: src/app.js
   \`\`\`js
   function hi() {
     return 1;
   }
   \`\`\`
- window: Admin
\`\`\`apex
System.debug(1);
\`\`\``);
  const [sh, js, apex] = steps(d).filter(s => ['code', 'apex'].includes(s.type));
  assert.deepEqual([sh.type, sh.lang, sh.kind, sh.code], ['code', 'sh', 'terminal', '# a comment line is not run\nnpm install\nnpm test']);
  assert.deepEqual([js.type, js.lang, js.kind, js.code], ['code', 'js', 'editor', 'function hi() {\n  return 1;\n}'], 'the block\'s own indentation is taken off, the code\'s is kept');
  assert.deepEqual([apex.type, apex.code], ['apex', 'System.debug(1);']);
  assert.throws(() => demo('- window: Shell\n```python\nprint(1)\n```'), /a ```python block in the terminal Shell: its lines run as commands, write ```sh/);
  assert.throws(() => demo('- window: Admin\n```js\nx\n```'), /a browser window runs only ```apex/);
  assert.throws(() => demo('```sh\nls\n```'), /"```sh" needs a window first/);
  assert.throws(() => demo('- window: Code\n```js\nx'), /the ```js block is not closed/);
});

test('one window of an editor per chapter: two would share its demo profile', () => {
  const windows = 'windows:\n  A: { vscode: . }\n  B: { vscode: .. }\n  C: { cursor: . }';
  assert.throws(() => demo('- window: A\n- open: x\n- window: B\n- open: y', windows), /chapter "One" shows A and B: one VS Code window per chapter/);
  assert.doesNotThrow(() => demo('- window: A\n- open: x\n- window: C\n- open: y\n# Two\n- window: B\n- open: z', windows), 'VS Code and Cursor together, or one per chapter, are fine');
});

test('every chapter names its window: a live step does not borrow the window of the chapter before', () => {
  assert.throws(() => demo('- window: Shell\n- run: ls\n# Two\n- run: pwd'), /"run" needs a window first: add "- window: <name>" above it, in this chapter/);
});

test('a web window can open the link a terminal printed (from:), shown in the same chapter', () => {
  const windows = 'windows:\n  Shell: { terminal: . }\n  UI: { url: "http://127.0.0.1:4477/", from: Shell, label: sfdemo ui }\n  Admin: { org: myOrg }';
  const d = demo('- window: Shell\n- start: sfdemo ui --no-open\n- window: UI\n- click: Demos', windows);
  assert.equal(d.windows.UI.from, 'Shell');
  assert.equal(d.windows.UI.url, 'http://127.0.0.1:4477/');
  assert.throws(() => demo('- window: UI\n- click: Demos', windows), /chapter "One" shows UI, which opens the link Shell prints: show Shell in that chapter too/);
  assert.throws(() => demo('- window: UI\n- click: x', 'windows:\n  UI: { url: "http://x.example.com/", from: Ghost }'), /from: Ghost is not a window/);
  assert.throws(() => demo('- window: UI\n- click: x', 'windows:\n  A: { org: myOrg }\n  UI: { url: "http://x.example.com/", from: A }'), /from: A must be a terminal window/);
});

test('prepare: runs before the chapter, needs no window, and is not a cue of the speaker notes', () => {
  const d = demo('- slide: 1\nHello.\n- prepare: rm -rf work && mkdir work\n- window: Shell\n- run: ls work\n- window: Code\n- command: File: Save\n- open: README.md');
  assert.deepEqual(steps(d).find(s => s.type === 'prepare'), { type: 'prepare', command: 'rm -rf work && mkdir work', where: `${FILE}:10` });
  const [notes] = speakerNotes(d);
  assert.equal(notes.notes, ['Hello.', '▶ Switch to Shell', '▶ Run in the terminal: ls work', '▶ Switch to Code', '▶ Command Palette › File: Save', '▶ Open the file README.md (Quick Open)'].join('\n\n'));
});

test('the demo profile of an editor: nothing that asks, suggests or reformats; the window\'s settings win', () => {
  const s = editorSettings('vscode', { theme: 'Default Light Modern', zoom: 1, settings: { 'editor.fontSize': 19 } });
  assert.equal(s['chat.disableAIFeatures'], true, 'VS Code\'s AI features (and their GitHub sign-in) are off');
  assert.equal(s['keyboard.dispatch'], 'keyCode', 'shortcuts are read by key code, whatever the keyboard layout');
  assert.equal(s['editor.autoClosingBrackets'], 'never');
  assert.equal(s['editor.autoIndent'], 'none');
  assert.equal(s['terminal.integrated.gpuAcceleration'], 'off');
  assert.equal(s['workbench.colorTheme'], 'Default Light Modern');
  assert.equal(s['window.zoomLevel'], 1);
  assert.equal(s['editor.fontSize'], 19);
  assert.equal(editorSettings('cursor')['chat.disableAIFeatures'], undefined, 'Cursor keeps its own AI: the user logged in to it');
  const profile = { data: '/p/data', extensions: '/p/ext' };
  const none = launchArgs('vscode', { folder: '/work' }, { port: 9333, profile });
  assert.deepEqual(none.slice(0, 5), ['--user-data-dir', '/p/data', '--extensions-dir', '/p/ext', '--remote-debugging-port=9333']);
  assert.ok(none.includes('--disable-extensions'), 'no extension asked: none loads');
  assert.equal(none.at(-1), '/work');
  const some = launchArgs('vscode', { folder: '/work', extensions: ['Salesforce.salesforcedx-vscode'] }, { port: 1, profile, installed: ['salesforce.salesforcedx-vscode', 'someone.else'] });
  assert.ok(!some.includes('--disable-extensions'));
  assert.deepEqual(some.slice(some.indexOf('--disable-extension'), some.indexOf('--disable-extension') + 2), ['--disable-extension', 'someone.else'], 'an extension another demo installed stays off');
});

test('keys of press: in a terminal, as the bytes a terminal sends', () => {
  assert.equal(keyBytes('Control+C'), '\x03');
  assert.equal(keyBytes('ctrl+d'), '\x04');
  assert.equal(keyBytes('^Z'), '\x1a');
  assert.equal(keyBytes('Enter'), '\r');
  assert.equal(keyBytes('Arrow Up'), '\x1b[A');
  assert.equal(keyBytes('y'), 'y');
  assert.throws(() => keyBytes('Hyper+K'), /not a key a terminal knows/);
});
