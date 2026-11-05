/**
 * The browser scripts: they parse, and a report renders in Chromium (overview, one conversation, the baseline diff)
 * with no script error. Skipped without Chromium, unless SFDEMO_REQUIRE_BROWSER=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { renderReportHtml } from '../src/engine/report-html.js';

const pub = name => new URL(`../src/ui/public/${name}`, import.meta.url);
const hasBrowser = fs.existsSync(chromium.executablePath());

test('the UI scripts parse', () => {
  for (const name of ['render.js', 'app.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(pub(name), 'utf8'), { filename: name }), name);
});

const report = {
  startedAt: '2026-10-26T10:00:00.000Z', durationMs: 61000, parallel: 2, version: '0.1.0',
  comparison: { baseline: '2026-10-20T10:00:00.000Z', conversations: [{ name: 'Guest', status: 'changed', exchanges: [{ n: 1, status: 'changed', similarity: 0.6, secondsBefore: 4, diff: [{ op: '=', text: 'Rides cost ' }, { op: '-', text: '$4' }, { op: '+', text: '$5' }] }], flagsAdded: [], flagsResolved: [] }] },
  results: [{
    name: 'Guest', folder: 'Guest', surface: 'messaging', who: 'guest visitor', status: 'flagged', durationMs: 30000, outputs: ['transcript.md'],
    flags: ['1: the answer took longer than 2 s (answered in 3 s)'], warnings: [], error: null,
    selectors: { pack: 'messaging', version: '2026.10.1', release: null, healed: ['userText'] },
    exchanges: [{ n: 1, type: 'message', text: 'How much is a ride? <img src=x onerror=alert(1)>', reply: 'Rides cost $5 an hour. </script><b>bold</b>', seconds: 3, screenshot: null, checks: [{ kind: 'max-seconds', pattern: '2', ok: false, detail: 'answered in 3 s' }, { kind: 'expect', pattern: 'cost', ok: true }] }],
  }],
};

test('report.html renders, escapes org text, and shows the diff', { skip: !hasBrowser && 'Chromium is not installed' }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.setContent(renderReportHtml(report));
    await page.waitForSelector('.conv');
    assert.match(await page.textContent('body'), /Running on healed locators \(userText\)/);
    await page.click('.conv');
    await page.waitForSelector('.exchange');
    assert.equal(await page.locator('.bubble.agent b').count(), 0, 'answers are text, never HTML');
    assert.match(await page.textContent('.bubble.agent'), /<\/script><b>bold<\/b>/);
    assert.match(await page.textContent('.checks'), /slower than 2 s/);
    assert.equal(await page.locator('.diff del').textContent(), '$4');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the Demos page: the list, a demo with its voice, chapters, speaker notes and script, without a script error', { skip: !hasBrowser && 'Chromium is not installed' }, async () => {
  const { startServer } = await import('../src/ui/server.js');
  const { loadProject } = await import('../src/config.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-ui-demos-'));
  fs.mkdirSync(path.join(dir, 'demos'));
  fs.writeFileSync(path.join(dir, 'demos', 'tour.md'), '---\ntype: demo\ntitle: The tour\nwindows:\n  Web: { url: https://example.com }\n---\n# Welcome\n- slide: 1\n\nHello and welcome.\n\n# Live\n- window: Web\n- point: Example Domain\n\nOn the page.\n');
  const server = await startServer({ project: loadProject({ dir }), port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url);
    await page.click('.files button.file');
    await page.waitForSelector('.chapter');
    assert.equal(await page.locator('h1').first().textContent(), 'The tour');
    assert.deepEqual(await page.locator('.chapter strong').allTextContents(), ['1. Welcome', '2. Live']);
    assert.match(await page.locator('.chapter').nth(1).textContent(), /not recorded yet.*live in Web/s);
    assert.equal(await page.getByRole('button', { name: 'Record this chapter again' }).count(), 1, 'only the live chapter can be recorded on its own');
    assert.match(await page.textContent('details.card'), /Slide images to export into demos.slides: 1/);
    assert.match(await page.locator('textarea.code').inputValue(), /^---\ntype: demo/);
    assert.equal(await page.locator('nav.tabs a.on').textContent(), 'Demos', 'demos are the first page');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('the Demos page of a demo without slides: no speaker-notes card, and nothing stray on the page', { skip: !hasBrowser && 'Chromium is not installed' }, async () => {
  const { startServer } = await import('../src/ui/server.js');
  const { loadProject } = await import('../src/config.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-ui-live-'));
  fs.mkdirSync(path.join(dir, 'demos'));
  fs.writeFileSync(path.join(dir, 'demos', 'hello.md'), '---\ntitle: Hello\nwindows:\n  Shell: { terminal: .. }\n---\n# Hello\n- window: Shell\n\nA terminal.\n\n- run: ls\n');
  const server = await startServer({ project: loadProject({ dir }), port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.click('.files button.file');
    await page.waitForSelector('.chapter');
    assert.match(await page.locator('.chapter').textContent(), /live in Shell/);
    assert.equal(await page.locator('summary', { hasText: 'Speaker notes' }).count(), 0);
    const stray = await page.evaluate(() => [...document.querySelectorAll('main, #panel, .panel, body')].flatMap(el => [...el.childNodes]).filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()));
    assert.deepEqual(stray, [], 'no text node outside the cards (a "null" was printed there)');
  } finally { await browser.close(); await server.close(); }
});
