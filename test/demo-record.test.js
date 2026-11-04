/**
 * Recording demo chapters for real, in Chromium, against the fake org of helpers/fake-org.js (Setup pages, a
 * Developer Console, the Agentforce panel), with a fake sf CLI and a fake Piper. Needs Chromium and a POSIX shell.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { recordChapter, recordDemo, bestTake } from '../src/demo/recorder.js';
import { parseDemo } from '../src/demo/script.js';
import { narrate } from '../src/demo/voice.js';
import { installFakeSf, orgRules, fakeSfSupported } from './helpers/fake-sf.js';
import { installFakePiper } from './helpers/fake-piper.js';
import { startFakeOrg } from './helpers/fake-org.js';

const hasBrowser = fs.existsSync(chromium.executablePath());
if (!hasBrowser && process.env.SFDEMO_REQUIRE_BROWSER) throw new Error('Chromium is missing: npx playwright install chromium');
const skip = !hasBrowser ? 'Chromium is not installed' : !fakeSfSupported ? 'the fake sf CLI needs a POSIX shell' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-record-'));

let browser;
let org;
let sf;
let piper;
before(async () => {
  if (skip) return;
  org = await startFakeOrg();
  sf = installFakeSf(orgRules('fake', org.url));
  piper = installFakePiper();
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (sf) sf.restore();
  if (piper) piper.restore();
  if (org) await org.close();
});

/** A narrated demo from its text, with its own output folder. */
async function prepare(name, text) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const demo = parseDemo(text, path.join(dir, `${name}.md`));
  const { stock } = await narrate(demo, { cacheDir: path.join(tmp, 'narration') });
  return { demo, stock, out: path.join(dir, 'out'), stateDir: path.join(dir, '.sfdemo'), aiCache: path.join(dir, `${name}.ai-steps.json`) };
}

test('a live chapter: Setup through Quick Find, click, fill, select, point, scroll, wait for, and Apex in the Developer Console', { skip }, async () => {
  const p = await prepare('setup', `---
org: fake
pause: 0.2
windows:
  Admin: { path: /lightning/setup/SetupOneHome/home, label: "Admin · Setup" }
---
# Setup
- window: Admin
Here is Setup.
- setup: Named Credentials
- click: Demo ERP API
- point: Allow Formulas in HTTP Header
- fill: Label = Demo ERP API v2
- select: Status = Active
- click: Save
- wait for: Saved
- scroll: Custom Headers
\`\`\`apex
System.debug('order: ' + 42);
\`\`\`
`);
  const logs = [];
  const r = await recordChapter(browser, p.demo, 1, 1, { ...p, emit: e => logs.push(e.message) });
  assert.equal(r.reason, null, logs.join('\n'));
  assert.equal(r.failed, false);
  assert.ok(fs.existsSync(r.windows.Admin.video), 'the window was filmed');
  assert.ok(r.windows.Admin.offset > 0, 'the video started before the chapter (the sign-in and the start page are cut)');
  assert.deepEqual(r.events.filter(e => e.kind === 'do').map(e => e.action), ['setup', 'click', 'point', 'fill', 'select', 'click', 'wait-for', 'scroll', 'apex']);
  assert.deepEqual(r.events.filter(e => ['view', 'say'].includes(e.kind)).map(e => e.kind), ['view', 'say']);
  assert.ok(r.events.find(e => e.kind === 'say').t >= 0.9, 'the window shows a moment before the voice starts');
  assert.ok(logs.some(l => /Admin: ready \(admin@fake\.example \(CLI user of fake\)\)/.test(l)), logs.join('\n'));
  const events = JSON.parse(fs.readFileSync(path.join(p.out, 'takes', 'ch01', 'take1', 'events.json'), 'utf8'));
  assert.equal(events.title, 'Setup');
});

test('the Apex step types only into Execute Anonymous, never into the class editor that had the focus', { skip }, async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const { apex } = await import('../src/demo/actions.js');
    await page.goto(org.url + '/_ui/common/apex/debug/ApexCSIPage');
    await apex({ name: 'Admin', page, base: org.url }, "System.debug('hello');");
    assert.equal(await page.locator('#classText').inputValue(), 'public class AuditTrail {}', 'the open class is untouched');
    assert.match(await page.locator('#lines').innerText(), /USER_DEBUG\|System\.debug\('hello'\);/);
    assert.equal(await page.locator('#debugOnly').isChecked(), true);
  } finally { await context.close(); }
});

test('a chat chapter: the voice speaks while the agent answers; a failed check fails the take, and the chapter is tried again', { skip }, async () => {
  const p = await prepare('chat', `---
org: fake
pause: 0.2
takes: 2
windows:
  Agent: { label: "Agentforce" }
---
# Chat
- window: Agent
1. How much is a two-hour ride?
   - expect: \\$8
While the agent thinks, the voice explains.
2. Hello
   - expect: never in this answer
`);
  const chapters = [];
  const summary = await recordDemo(p.demo, { ...p, aiCacheFile: p.aiCache, emit: e => { if (e.type === 'chapter-end') chapters.push([e.take, e.failed]); } });
  assert.deepEqual(chapters, [[1, true], [2, true]], 'two takes, as takes: says');
  assert.deepEqual(summary.map(s => [s.chapter, s.status]), [[1, 'failed']]);
  assert.match(summary[0].reason, /chat\.md:\d+: the reply does not match never in this answer/);
  const take = bestTake(p.out, 1);
  assert.equal(take.take, 2);
  assert.deepEqual(take.exchanges.map(x => [x.reply, x.checks.map(c => c.ok)]), [['A two-hour ride costs $8.', [true]], ['Hello! I can find stations and prices.', [false]]]);
  const said = take.events.find(e => e.kind === 'say');
  const answered = take.events.find(e => e.kind === 'reply');
  assert.ok(said.t < answered.t, 'the narration after the message started before the answer was read');
  assert.equal(take.events.at(-1).kind, 'fail');
});

test('an ai: step asks once, then every take replays the saved steps', { skip }, async () => {
  const p = await prepare('ai', '---\norg: fake\npause: 0.1\nwindows:\n  Admin: { path: /lightning/setup/NamedCredential/home }\n---\n# Ai\n- window: Admin\n- ai: open the Demo ERP API named credential\n- wait for: Allow Formulas in HTTP Header\n');
  const asked = [];
  const ask = async prompt => { asked.push(prompt); return { steps: [{ type: 'click', label: 'Demo ERP API' }] }; };
  for (const take of [1, 2]) {
    const r = await recordChapter(browser, p.demo, 1, take, { ...p, ask });
    assert.equal(r.reason, null);
  }
  assert.equal(asked.length, 1, 'the second take did not ask');
  assert.match(asked[0], /Instruction: open the Demo ERP API named credential/);
  assert.match(asked[0], /Demo ERP API/, 'the page\'s accessibility tree is in the prompt');
  const cache = JSON.parse(fs.readFileSync(p.aiCache, 'utf8'));
  assert.deepEqual(Object.values(cache)[0].steps, [{ type: 'click', label: 'Demo ERP API' }]);
});

test('a step that finds nothing fails the take with the line and what was missing, and leaves a screenshot', { skip }, async () => {
  const p = await prepare('missing', '---\norg: fake\nwindows:\n  Admin: { path: /lightning/setup/SetupOneHome/home }\n---\n- window: Admin\n- click: No Such Button\n');
  const r = await recordChapter(browser, p.demo, 1, 1, p);
  assert.equal(r.failed, true);
  assert.match(r.reason, /missing\.md:7: click: no button or link "No Such Button" visible in Admin after 15 s/);
  assert.ok(fs.existsSync(path.join(p.out, 'takes', 'ch01', 'take1', 'Admin-failed.png')));
});
