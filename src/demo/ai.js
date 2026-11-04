/**
 * `ai:` steps: a live step written in plain words ("open the newest case of Acme"). The first take asks Claude, through
 * the user's own Claude Code (`claude -p`, no API key), to turn it into fixed steps from what the page shows (its
 * accessibility tree). The answer is saved next to the demo (.sfdemo/ai-steps.json), so every later take replays the
 * same steps, with no model call: recordings stay repeatable, and a wrong answer is fixed by editing that file or by
 * writing the fixed steps in the script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scopesOf } from './actions.js';

const ALLOWED = ['click', 'fill', 'select', 'press', 'scroll', 'open', 'wait-for', 'point'];
const SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ALLOWED },
          label: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' },
          key: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' },
        },
        required: ['type'],
      },
    },
    unsure: { type: 'string' },
  },
  required: ['steps'],
};
const NEEDS = { click: ['label'], point: ['label'], fill: ['field', 'value'], select: ['field', 'value'], press: ['key'], scroll: ['target'], open: ['target'], 'wait-for': ['text'] };

/** What the page shows, for the model: the accessibility tree of the page and its frames, trimmed. */
async function pageText(page, limit = 24000) {
  const parts = [];
  for (const scope of scopesOf(page)) {
    const tree = await scope.locator('body').ariaSnapshot({ timeout: 10000 }).catch(() => '');
    if (tree) parts.push(scope === page ? tree : `# frame ${new URL(scope.url()).pathname}\n${tree}`);
  }
  const text = parts.join('\n');
  return text.length > limit ? text.slice(0, limit) + '\n(truncated)' : text;
}

/** Runs `claude -p` with the prompt on stdin; returns the structured answer. SFDEMO_CLAUDE names another binary. */
export function askClaude(prompt, { timeout = 180000 } = {}) {
  const bin = process.env.SFDEMO_CLAUDE || 'claude';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--model', 'sonnet'];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`claude -p gave no answer within ${timeout / 1000} s`)); }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`ai: steps need Claude Code (claude) on this machine: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out.slice(out.indexOf('{'))); } catch { /* below */ }
      if (code !== 0 || !json) return reject(new Error(`claude -p failed (exit ${code}): ${(err || out).trim().split('\n').slice(-1)[0] || 'no output'}`));
      if (json.is_error) return reject(new Error(`claude -p: ${json.result || 'error'}`));
      let answer = json.structured_output;
      if (!answer && typeof json.result === 'string') { try { answer = JSON.parse(json.result.slice(json.result.indexOf('{'))); } catch { answer = null; } }
      if (!answer) return reject(new Error('claude -p answered without steps'));
      resolve(answer);
    });
    child.stdin.end(prompt);
  });
}

/** Checks the steps a model returned: only allowed kinds, each with what it needs. */
export function checkSteps(steps, where) {
  if (!Array.isArray(steps) || !steps.length) throw new Error(`${where}: the ai: step came back without any step`);
  if (steps.length > 12) throw new Error(`${where}: the ai: step came back with ${steps.length} steps: write it as several steps`);
  return steps.map((s, i) => {
    if (!ALLOWED.includes(s.type)) throw new Error(`${where}: step ${i + 1} of the ai: answer is "${s.type}", not one of ${ALLOWED.join(', ')}`);
    for (const k of NEEDS[s.type]) if (!s[k]) throw new Error(`${where}: step ${i + 1} (${s.type}) of the ai: answer has no ${k}`);
    return { type: s.type, ...Object.fromEntries(NEEDS[s.type].map(k => [k, String(s[k])])), where };
  });
}

/**
 * The fixed steps for `step.instruction` in window `w`: from the cache, else from Claude (then cached).
 * @param {any} w a recorded window ({ name, page })
 * @param {{ instruction: string, where: string }} step
 * @param {{ cacheFile: string, ask?: typeof askClaude, log?: (m: string) => void }} options
 */
export async function resolveAi(w, step, { cacheFile, ask = askClaude, log = () => {} }) {
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const key = `${w.name} | ${step.instruction}`;
  if (cache[key]) return checkSteps(cache[key].steps, step.where);
  log(`ai: asking Claude how to "${step.instruction}" (once: the answer is saved for the next takes)`);
  const prompt = [
    'You turn one instruction for a live software demo into fixed browser steps. The user watches a recording, so',
    'use only what is on the page below, by the labels a person sees. Steps:',
    '- click {label}: a button, link, tab or menu item, by its visible name',
    '- fill {field, value}: type value into the field labeled field',
    '- select {field, value}: pick the option value in the field labeled field',
    '- press {key}: a key such as Enter or Escape',
    '- scroll {target}: down, up, or a text to bring into view',
    '- open {target}: a path of the same site, such as /lightning/o/Case/list',
    '- wait-for {text}: wait until that text shows',
    '- point {label}: show something without clicking it',
    'Give the fewest steps that do the instruction. If the page cannot do it, return no step and say why in unsure.',
    '',
    `Instruction: ${step.instruction}`,
    `Page: ${new URL(w.page.url()).pathname}`,
    'What the page shows (accessibility tree):',
    await pageText(w.page),
  ].join('\n');
  const answer = await ask(prompt);
  if ((!answer.steps || !answer.steps.length) && answer.unsure) throw new Error(`${step.where}: ai: "${step.instruction}": ${answer.unsure}`);
  const steps = checkSteps(answer.steps, step.where);
  cache[key] = { steps: steps.map(({ where, ...s }) => s), page: new URL(w.page.url()).pathname, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n');
  return steps;
}
