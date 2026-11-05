import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDemo, readDemo, speakerNotes, isDemoText, lengthScale, cue } from '../src/demo/script.js';

const demo = (body, front = 'org: myOrg\nwindows:\n  Admin: { path: /lightning/setup/SetupOneHome/home, label: "Admin · Setup" }\n  Visitor: { site: https://riders.example.com/s/ }') => parseDemo(`---\n${front}\n---\n${body}`, '/demos/tour.md');
const kinds = d => d.chapters.map(c => [c.title, c.steps.map(s => s.type)]);

test('a demo: chapters from headings, a paragraph is one spoken line, list items and step lines are live steps', () => {
  const d = demo(`# Opening
- slide: 1

Thank you for joining.
This line is the same paragraph.

A second paragraph.

# Live
slide: 2
- window: Admin
- setup: Named Credentials
- click: Demo ERP API   # a comment after a step
- fill: Label = Demo ERP API
- select: Status = Active
- press: Enter
- scroll: down
- wait for: Saved
- point: "Allow Formulas in HTTP Header"
- record: Account Acme Corp
- open: /lightning/o/Case/list
- ai: open the newest case
- wait: 1.5

\`\`\`apex
System.debug('one');
System.debug('two');
\`\`\`

- window: Visitor
1. How much is a ride?
   - expect: \\$
   - max-seconds: 20
The voice speaks while the agent answers.
> note: the presenter's own reminder, never spoken
<!-- and a comment -->
`);
  assert.deepEqual(kinds(d), [
    ['Opening', ['slide', 'say', 'say']],
    ['Live', ['slide', 'window', 'setup', 'click', 'fill', 'select', 'press', 'scroll', 'wait-for', 'point', 'record', 'open', 'ai', 'wait', 'apex', 'window', 'message', 'expect', 'max-seconds', 'say']],
  ]);
  const [opening, live] = d.chapters;
  assert.equal(opening.steps[1].text, 'Thank you for joining. This line is the same paragraph.');
  const step = type => live.steps.find(s => s.type === type);
  assert.equal(step('click').label, 'Demo ERP API', 'the comment is not part of the label');
  assert.deepEqual([step('fill').field, step('fill').value], ['Label', 'Demo ERP API']);
  assert.equal(step('point').label, 'Allow Formulas in HTTP Header', 'quotes are dropped');
  assert.deepEqual([step('record').object, step('record').name], ['Account', 'Acme Corp']);
  assert.equal(step('apex').code, "System.debug('one');\nSystem.debug('two');");
  assert.equal(step('wait').seconds, 1.5);
  assert.equal(live.steps.at(-1).text, 'The voice speaks while the agent answers.');
  assert.match(step('setup').where, /^\/demos\/tour\.md:\d+$/);
});

test('settings: defaults, pace as a name or a number, unknown keys and bad values are errors that say how to fix them', () => {
  const d = demo('- slide: 1\n\nHi.', 'title: Tour');
  assert.deepEqual([d.settings.voice, d.settings.lengthScale, d.settings.pause, d.settings.takes, d.settings.size], ['en_US-amy-medium', 1.25, 0.7, 3, '1920x1080']);
  assert.equal(d.chapters[0].title, 'Tour', 'the first chapter is named after the demo until a heading');
  assert.equal(lengthScale('normal'), 1);
  assert.equal(lengthScale('brisk'), 0.87);
  assert.equal(lengthScale(0.5), 2);
  assert.throws(() => lengthScale('sleepy'), /pace: "sleepy" is not a pace/);
  assert.throws(() => demo('Hi.', 'voise: x'), /unknown setting "voise"/);
  assert.throws(() => demo('Hi.', 'takes: 0'), /takes: is how many times/);
  assert.throws(() => demo('Hi.', 'size: big'), /size: is the video size/);
  assert.throws(() => demo('Hi.', 'pause: 9'), /pause: is the silence between/);
  assert.throws(() => demo('', 'title: x'), /the demo is empty/);
});

test('windows: Lightning as the CLI user or Login-As, a site as a guest, a plain web page; each named as the label says', () => {
  const d = demo('- window: Admin\n- window: Jordan\n- window: Visitor\n- window: GitHub\n1. Hi', 'org: myOrg\nwindows:\n  Admin: { app: Sales }\n  Jordan: { user: jordan.lee }\n  Visitor: { site: https://riders.example.com/s/, label: "Visitor · website" }\n  GitHub: { url: https://github.com/tprouvot/apex-http-callout/pulls }');
  const w = d.windows;
  assert.deepEqual([w.Admin.surface, w.Admin.signIn, w.Admin.org, w.Admin.label], ['lightning', 'alias-user', 'myOrg', 'Admin']);
  assert.deepEqual([w.Jordan.surface, w.Jordan.signIn], ['lightning', 'login-as']);
  assert.deepEqual([w.Visitor.surface, w.Visitor.signIn, w.Visitor.label], ['messaging', 'guest', 'Visitor · website']);
  assert.deepEqual([w.GitHub.surface, w.GitHub.signIn, w.GitHub.url], ['web', 'none', 'https://github.com/tprouvot/apex-http-callout/pulls']);
  assert.equal(w.GitHub.chat, true, 'the message after the last window step goes to its chat');
  assert.equal(w.Admin.chat, undefined);
  assert.throws(() => demo('- window: Admin\n1. Hi', 'windows:\n  Admin: { app: Sales }'), /needs org:/);
  assert.throws(() => demo('- window: Web\n- click: x', 'windows:\n  Web: { url: https://x.example.com, org: a }'), /takes no org/);
  assert.throws(() => demo('- window: Ghost\n- click: x'), /no window "Ghost" in windows: \(Admin, Visitor\)/);
  assert.throws(() => demo('- slide: 1\n- click: Save'), /"click" needs a window first/);
  assert.equal(parseDemo('---\norg: a\nwindows: { Admin: {} }\n---\n- window: Admin\n- click: x', '/d.md', { org: 'SDO' }).windows.Admin.org, 'SDO', '--org replaces the demo\'s org');
});

test('step errors name the line and what is missing', () => {
  assert.throws(() => demo('- slide: first'), /tour\.md:7: "slide:" needs a slide number/);
  assert.throws(() => demo('- window: Admin\n- fill: Subject'), /write "fill: Field = value"/);
  assert.throws(() => demo('- window: Admin\n- record: Account'), /write "record: <object> <record name>"/);
  assert.throws(() => demo('- window: Admin\n```js\nx\n```'), /a code block in a demo is Apex/);
  assert.throws(() => demo('- window: Admin\n```apex\nx'), /the ```apex block is not closed/);
});

test('speaker notes: what is said on each slide, then the live part as cues, up to the next slide', () => {
  const d = demo('- slide: 2\nOn slide two.\n- window: Admin\n- setup: Named Credentials\nLive line.\n- window: Visitor\n1. Hi there\n   - expect: hello\n- slide: 1\nBack to one.\n- slide: 2\nAgain two.');
  assert.deepEqual(speakerNotes(d), [
    { slide: 1, notes: 'Back to one.' },
    { slide: 2, notes: 'On slide two.\n\n▶ Switch to Admin\n\n▶ Setup › Named Credentials\n\nLive line.\n\n▶ Switch to Visitor\n\n▶ Type in the chat: “Hi there”\n\nAgain two.' },
  ]);
  assert.equal(cue({ type: 'scroll', target: 'down' }), '▶ Scroll down');
  assert.equal(cue({ type: 'scroll', target: 'Headers' }), '▶ Scroll to “Headers”');
  assert.equal(cue({ type: 'expect', pattern: 'x' }), null, 'checks are not cues');
});

test('a demo is told from a conversation by its front matter; the sample tour reads', () => {
  assert.equal(isDemoText('---\ntype: demo\n---\nHi'), true);
  assert.equal(isDemoText('---\nvoice: en_US-amy-medium\n---\n1. Hi'), true);
  assert.equal(isDemoText('---\nsite: https://x.example.com/\n---\n1. Hi'), false);
  assert.equal(isDemoText('1. Hi'), false);
  const file = fileURLToPath(new URL('../examples/apex-callout-tour/apex-callout-tour.md', import.meta.url));
  assert.ok(fs.existsSync(file));
  const tour = readDemo(file, { org: 'SDO_simple' });
  assert.deepEqual(tour.chapters.map(c => c.title), ['Opening', 'The External Credential holds the secret', 'The Named Credential points to the API', 'One setting per callout', 'Call it from Apex', 'Close']);
  assert.deepEqual(speakerNotes(tour).map(n => n.slide), [1, 2, 3, 4, 5, 6, 7]);
});

test('the project\'s voice and pace apply to a script that sets none; a script\'s own win', () => {
  const defaults = { voice: 'fr_FR-siwis-low', pace: 'normal' };
  const plain = parseDemo('---\ntitle: x\n---\nHi.', '/d/x.md', { defaults });
  assert.deepEqual([plain.settings.voice, plain.settings.lengthScale], ['fr_FR-siwis-low', 1]);
  const own = parseDemo('---\nvoice: en_US-amy-medium\npace: slow\n---\nHi.', '/d/x.md', { defaults });
  assert.deepEqual([own.settings.voice, own.settings.lengthScale], ['en_US-amy-medium', 1.333]);
  assert.throws(() => parseDemo('---\ntitle: x\n---\nHi.', '/d/x.md', { defaults: { pace: 'sleepy' } }), /pace: "sleepy" is not a pace/);
});
