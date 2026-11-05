/**
 * The terminal screen of terminal windows: what a real terminal would show from what commands print.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Screen } from '../src/demo/screen.js';

const screenOf = (data, size) => { const s = new Screen(size); s.write(data); return s; };

test('text, new lines, carriage returns and tabs', () => {
  assert.equal(screenOf('hello\nworld').text(), 'hello\nworld');
  assert.equal(screenOf('one\r\ntwo\r\n').text(), 'one\ntwo');
  assert.equal(screenOf('abcdef\rXY').text(), 'XYcdef', 'a carriage return writes over the line');
  assert.equal(screenOf('a\tb').text(), 'a       b');
  assert.equal(screenOf('abc\b\bZ').text(), 'aZc');
});

test('a spinner draws on one line: erase in line, then the next frame', () => {
  const s = new Screen();
  s.write('\x1b[?25l');
  for (const f of ['⠋ Deploying 0%', '⠙ Deploying 50%']) s.write(`\r\x1b[2K${f}`);
  assert.equal(s.cursorVisible, false, 'the spinner hid the cursor');
  s.write('\r\x1b[2K✔ Deployed\n\x1b[?25h');
  assert.equal(s.text(), '✔ Deployed');
  assert.equal(s.cursorVisible, true);
});

test('a progress block of several lines: the cursor goes up and the lines are drawn again', () => {
  const s = new Screen();
  s.write('task 1 ...\ntask 2 ...\n');
  s.write('\x1b[2A\x1b[2Ktask 1 done\n\x1b[2Ktask 2 done\n');
  assert.equal(s.text(), 'task 1 done\ntask 2 done');
  s.write('abc\x1b[1Dz\x1b[K'); // back one column, write, erase what follows
  assert.equal(s.text().split('\n')[2], 'abz');
});

test('long lines wrap at the width, clear empties the screen, the scrollback is kept to the newest lines', () => {
  assert.equal(screenOf('abcdefgh', { cols: 5, rows: 3 }).text(), 'abcde\nfgh');
  const s = screenOf('one\ntwo\nthree');
  s.write('\x1b[H\x1b[2J\x1b[3J');
  s.write('fresh');
  assert.equal(s.text(), 'fresh', 'clear sends the cursor home and erases everything');
  const big = new Screen();
  big.write(Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n'));
  assert.ok(big.lines.length <= 2000);
  assert.ok(big.text().endsWith('line 2499'));
});

test('cursor positions are on the visible screen; save and restore come back', () => {
  const s = new Screen({ cols: 20, rows: 3 });
  s.write('a\nb\nc\nd'); // a scrolled off: the screen shows b, c, d
  s.write('\x1b[1;1HB');
  assert.equal(s.text(), 'a\nB\nc\nd');
  s.write('\x1b7\x1b[3;3Hx\x1b8y');
  assert.equal(s.text(), 'a\nBy\nc\nd x');
});

test('colours and styles become classes, 256 colours and true colours inline styles, HTML is escaped', () => {
  const s = screenOf('\x1b[1;31merror\x1b[0m <b>&\x1b[38;5;208m!\x1b[38;2;10;20;30m?\x1b[0m');
  const html = s.html();
  assert.match(html, /<span class="f1 bo">error<\/span>/);
  assert.match(html, / &lt;b&gt;&amp;/);
  assert.match(html, /style="color:rgb\(255,135,0\)">!/);
  assert.match(html, /style="color:rgb\(10,20,30\)">\?/);
  assert.match(screenOf('\x1b[7minv').html(), /class="fk bd"|class="f\w* b\w*"/, 'inverse swaps the colours');
});

test('links are found and underlined, the cursor is drawn where it is', () => {
  const s = screenOf('open http://127.0.0.1:4477/?token=abc123. now\r\n$ ');
  assert.deepEqual(s.links(), ['http://127.0.0.1:4477/?token=abc123']);
  const html = s.html({ cursor: true });
  assert.match(html, /<span class="un ln">http:\/\/127\.0\.0\.1:4477\/\?token=abc123<\/span>\./);
  assert.match(html, /\$ <span class="cur"> <\/span>/);
});

test('escape sequences cut between two chunks, titles and unknown sequences are not shown', () => {
  const s = new Screen();
  s.write('\x1b[3');
  s.write('2mgreen\x1b]0;my title\x07 ok\x1b[?1049h\x1b(B');
  assert.equal(s.text(), 'green ok');
  assert.match(s.html(), /class="f2">green ok/);
});
