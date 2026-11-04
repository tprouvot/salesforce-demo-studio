/** ai: steps: the answer's checks, and the call to Claude Code, against a fake `claude` (SFDEMO_CLAUDE). */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSteps, askClaude } from '../src/demo/ai.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-ai-'));
// On Windows claude is a .cmd run through a shell with quoted arguments; a fake .cmd would not prove that quoting.
const skip = process.platform === 'win32' && 'the fake claude needs a POSIX shell';
const saved = process.env.SFDEMO_CLAUDE;
after(() => { if (saved === undefined) delete process.env.SFDEMO_CLAUDE; else process.env.SFDEMO_CLAUDE = saved; });

/** A fake claude: logs its arguments and stdin, answers `reply` (a JSON text) with exit code `code`. */
function fakeClaude(reply, code = 0) {
  const script = path.join(tmp, `claude-${Math.random().toString(36).slice(2)}.cjs`);
  const log = script + '.log';
  fs.writeFileSync(script, `let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), input }));
  process.stdout.write(${JSON.stringify(reply)});
  process.exit(${code});
});`);
  const bin = path.join(tmp, path.basename(script, '.cjs') + (process.platform === 'win32' ? '.cmd' : ''));
  fs.writeFileSync(bin, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  process.env.SFDEMO_CLAUDE = bin;
  return () => JSON.parse(fs.readFileSync(log, 'utf8'));
}

test('the steps of an answer: only the allowed kinds, each with what it needs, a dozen at most', () => {
  assert.deepEqual(checkSteps([{ type: 'click', label: 'Demo ERP Credential', extra: 'dropped' }, { type: 'fill', field: 'Label', value: 'x' }], 'd.md:3'),
    [{ type: 'click', label: 'Demo ERP Credential', where: 'd.md:3' }, { type: 'fill', field: 'Label', value: 'x', where: 'd.md:3' }]);
  assert.throws(() => checkSteps([], 'd.md:3'), /d\.md:3: the ai: step came back without any step/);
  assert.throws(() => checkSteps([{ type: 'apex', code: 'delete [SELECT Id FROM Account];' }], 'd.md:3'), /step 1 of the ai: answer is "apex", not one of click, fill/);
  assert.throws(() => checkSteps([{ type: 'fill', field: 'Label' }], 'd.md:3'), /step 1 \(fill\) of the ai: answer has no value/);
  assert.throws(() => checkSteps(Array.from({ length: 13 }, () => ({ type: 'press', key: 'Tab' })), 'd.md:3'), /came back with 13 steps/);
});

test('Claude Code is asked with the prompt on stdin, no tools, a JSON schema and no saved session', { skip }, async () => {
  const seen = fakeClaude(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: { steps: [{ type: 'click', label: 'Manage' }] } }));
  const answer = await askClaude('Instruction: open the callout settings');
  assert.deepEqual(answer, { steps: [{ type: 'click', label: 'Manage' }] });
  const { args, input } = seen();
  assert.equal(input, 'Instruction: open the callout settings');
  assert.equal(args[0], '-p');
  assert.equal(args[args.indexOf('--tools') + 1], '', 'Claude cannot run anything itself');
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(JSON.parse(args[args.indexOf('--json-schema') + 1]).properties.steps.items.properties.type.enum[0], 'click');
});

test('an answer in the result text, a refusal, an error exit: each read or reported', { skip }, async () => {
  fakeClaude(JSON.stringify({ result: 'Here you go: {"steps":[{"type":"point","label":"x-api-key"}]}' }));
  assert.deepEqual(await askClaude('p'), { steps: [{ type: 'point', label: 'x-api-key' }] });
  fakeClaude(JSON.stringify({ is_error: true, result: 'Credit balance is too low' }));
  await assert.rejects(askClaude('p'), /claude -p: Credit balance is too low/);
  fakeClaude('not json', 1);
  await assert.rejects(askClaude('p'), /claude -p failed \(exit 1\)/);
  process.env.SFDEMO_CLAUDE = path.join(tmp, 'no-such-claude');
  await assert.rejects(askClaude('p'), /ai: steps need Claude Code \(claude\) on this machine/);
});
