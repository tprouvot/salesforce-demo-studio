/**
 * The sfdemo command line, run as a child process (bin/sfdemo.js) in throwaway projects: help, init, the dry-run plan,
 * selectors, baseline and compare, and the exit codes (0 fine, 1 degraded or different, 2 bad input). None of these
 * touch an org or a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, settingsFromFlags, settingSpec } from '../src/commands/args.js';
import { doctorTargets } from '../src/commands/index.js';
import { makeRun, result } from './helpers/runs.js';

const BIN = fileURLToPath(new URL('../bin/sfdemo.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-cli-'))); // the real path: what the child sees as its cwd
const home = path.join(tmp, 'home');
const fresh = name => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };

/** Runs sfdemo in `cwd`; returns { code, out, err }. */
function sfdemo(cwd, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, SFDEMO_HOME: home }, timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('arguments: positionals, --key value, --key=value, booleans, numbers, lists, and --', () => {
  /** @type {Record<string, 'boolean' | 'string' | 'number' | 'list'>} */
  const spec = { parallel: 'number', only: 'list', 'dry-run': 'boolean', out: 'string' };
  assert.deepEqual(parseArgs(['a.md', '--parallel', '2', '--only=Guest, Rider', '--only', 'Fleet', '--dry-run', 'b/', '--out=x=y'], spec),
    { _: ['a.md', 'b/'], parallel: 2, only: ['Guest', 'Rider', 'Fleet'], 'dry-run': true, out: 'x=y' });
  assert.equal(parseArgs(['--dry-run=no'], spec)['dry-run'], false);
  assert.equal(parseArgs(['--dry-run=yes'], spec)['dry-run'], true);
  assert.deepEqual(parseArgs(['--', '--not-an-option', '-x'], spec)._, ['--not-an-option', '-x']);
  assert.throws(() => parseArgs(['--paralel', '2'], spec), /unknown option --paralel \(see --help\)/);
  assert.throws(() => parseArgs(['--parallel', 'two'], spec), /--parallel needs a number, got "two"/);
  assert.throws(() => parseArgs(['--out'], spec), /--out needs a value/);
});

test('setting flags become conversation settings, in their schema names', () => {
  const args = parseArgs(['--org', 'myOrg', '--reply-timeout', '90', '--login-url', 'https://x.example.com', '--hide-login-as-banner', '--no-fresh'], settingSpec());
  assert.deepEqual(settingsFromFlags(args), { org: 'myOrg', replyTimeout: '90', loginUrl: 'https://x.example.com', hideLoginAsBanner: true, fresh: false });
  assert.deepEqual(settingsFromFlags(parseArgs([], settingSpec())), {});
});

test('doctor targets: from flags, from the project defaults, or one per surface of a scenario file', () => {
  const project = { config: { defaults: {} } };
  const targets = (argv, defaults = {}) => doctorTargets({ config: { defaults } }, parseArgs(argv, settingSpec()));
  assert.deepEqual(targets(['--org', 'myOrg']), [{ settings: { org: 'myOrg', surface: 'lightning' } }]);
  assert.deepEqual(targets(['--org', 'myOrg', '--site', 'https://x.example.com/', '--user', 'rider']), [
    { settings: { org: 'myOrg', agent: undefined, surface: 'lightning' } },
    { settings: { site: 'https://x.example.com/', org: 'myOrg', surface: 'messaging' } },
  ], 'the user goes with the site only when the site is the only target');
  assert.deepEqual(targets(['--site', 'https://x.example.com/', '--user', 'rider']), [{ settings: { site: 'https://x.example.com/', org: undefined, surface: 'messaging', user: 'rider' } }]);
  assert.deepEqual(targets(['--surface', 'messaging'], { site: 'https://d.example.com/' }), [{ settings: { site: 'https://d.example.com/', surface: 'messaging' } }]);
  assert.throws(() => doctorTargets(project, parseArgs([], settingSpec())), /nothing to check/);
  const dir = fresh('doctor-files');
  for (const [f, text] of [['a.md', '---\nsite: https://a.example.com/\n---\n1. Hi\n'], ['b.md', '---\nsite: https://b.example.com/\n---\n1. Hi\n'], ['c.md', '---\norg: myOrg\nsurface: lightning\n---\n1. Hi\n']]) fs.writeFileSync(path.join(dir, f), text);
  const fromFiles = doctorTargets(project, parseArgs([dir], settingSpec()));
  assert.deepEqual(fromFiles.map(t => [t.settings.surface, t.settings.site || t.settings.org, path.basename(t.file)]), [['messaging', 'https://a.example.com/', 'a.md'], ['lightning', 'myOrg', 'c.md']]);
});

test('help, version, an unknown command or option: exit codes and messages', () => {
  const cwd = fresh('help');
  const help = sfdemo(cwd, '--help');
  assert.equal(help.code, 0);
  assert.match(help.out, new RegExp(`^sfdemo ${VERSION.replace(/\./g, '\\.')}: records scripted Agentforce conversations`));
  assert.match(help.out, /Usage: sfdemo <command> \[options\]/);
  assert.equal(sfdemo(cwd).code, 0, 'no command prints the help');
  assert.match(sfdemo(cwd, 'doctor', '-h').out, /Usage: sfdemo/);
  assert.deepEqual(sfdemo(cwd, '--version'), { code: 0, out: VERSION + '\n', err: '' });
  const unknown = sfdemo(cwd, 'recrod');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command "recrod" \(sfdemo --help\)/);
  const option = sfdemo(cwd, 'run', '--paralel', '2');
  assert.equal(option.code, 2);
  assert.equal(option.err, 'error: unknown option --paralel (see --help)\n');
  assert.match(sfdemo(cwd, 'heal').err, /no doctor check to repair from: run sfdemo doctor first/);
});

test('init: the config, the example scenarios, the .gitignore entries; never twice without --force', () => {
  const cwd = fresh('init');
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n.local/');
  const first = sfdemo(cwd, 'init', '--org', 'myOrg');
  assert.equal(first.code, 0, first.err);
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'sfdemo.config.json'), 'utf8'));
  assert.deepEqual(config.defaults, { org: 'myOrg' });
  assert.deepEqual(fs.readdirSync(path.join(cwd, 'scenarios')).sort(), fs.readdirSync(path.join(ROOT, 'examples', 'ebike')).sort());
  assert.equal(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'), 'node_modules/\n.local/\n# sfdemo: recordings and local state show org data\n.sfdemo/\n');
  assert.match(first.out, /added \.sfdemo\/ to \.gitignore/);
  const again = sfdemo(cwd, 'init');
  assert.equal(again.code, 2);
  assert.match(again.err, /sfdemo\.config\.json already exists \(use --force to overwrite\)/);
  fs.writeFileSync(path.join(cwd, 'scenarios', '01-guest-prices-and-stations.md'), 'my edits');
  assert.equal(sfdemo(cwd, 'init', '--force').code, 0);
  assert.notEqual(fs.readFileSync(path.join(cwd, 'scenarios', '01-guest-prices-and-stations.md'), 'utf8'), 'my edits', '--force overwrites the examples too');
  assert.equal(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8').match(/\.sfdemo\//g).length, 1, 'the entries are added once');
  const none = fresh('init-none');
  assert.equal(sfdemo(none, 'init', '--example', 'none').code, 0);
  assert.deepEqual(fs.readdirSync(path.join(none, 'scenarios')), []);
  const bad = sfdemo(fresh('init-bad'), 'init', '--example', 'pizza');
  assert.match(bad.err, /no example "pizza" \(available: ebike\)/);
});

test('run --dry-run: the plan, from the scenarios folder or the shorthand; --only and errors exit 2', () => {
  const cwd = fresh('plan');
  sfdemo(cwd, 'init', '--org', 'myAdminAlias');
  const plan = sfdemo(cwd, 'run', '--dry-run', '--parallel', '1');
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /^6 conversation\(s\), up to 1 at a time:\n/, 'five files, two conversations in the CSV');
  assert.match(plan.out, /Same identity, run one after the other: 04-fleet-manager-morning -> FleetBatteries/);
  const shorthand = sfdemo(cwd, 'scenarios', '--dry-run');
  assert.equal(shorthand.code, 0, shorthand.err);
  assert.match(shorthand.out, /up to 3 at a time/, 'the project\'s parallel setting');
  const only = sfdemo(cwd, 'run', '--dry-run', '--only', 'nobody');
  assert.equal(only.code, 2);
  assert.match(only.err, /error: --only: no conversation named nobody/);
  fs.writeFileSync(path.join(cwd, 'scenarios', 'broken.md'), '---\nsurface: messaging\n---\n1. Hi\n');
  const broken = sfdemo(cwd, 'run', '--dry-run');
  assert.equal(broken.code, 2);
  assert.match(broken.err, /broken\.md: a messaging conversation needs site:/);
  const empty = fresh('plan-empty');
  fs.mkdirSync(path.join(empty, 'scenarios'));
  assert.deepEqual(sfdemo(empty, 'run', '--dry-run'), { code: 2, out: '', err: 'error: no scenario file given (.md or .csv)\n' });
});

test('selectors: list (text and JSON), check a pack file, refuse an unknown subcommand', () => {
  const cwd = fresh('selectors');
  const list = sfdemo(cwd, 'selectors', 'list');
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /^lightning\s+\d{4}\.\d+\.\d+\s+from API \d+ \(.+\)\s+bundled/m);
  assert.match(list.out, /^messaging\s/m);
  const json = JSON.parse(sfdemo(cwd, 'selectors', 'list', '--json').out);
  assert.deepEqual(json.packs.map(p => p.surface).sort(), ['lightning', 'messaging']);
  assert.deepEqual(json.overrides, {});
  const ok = sfdemo(cwd, 'selectors', 'check', path.join(ROOT, 'packs', 'messaging.json'));
  assert.equal(ok.code, 0);
  assert.match(ok.out, /: valid \(messaging \d{4}\.\d+\.\d+, \d+ elements\)/);
  const badFile = path.join(cwd, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify({ id: 'lightning', surface: 'lightning', version: '1', minApiVersion: 60, elements: { input: { candidates: [{ css: 'textarea', name: '(' }] } } }));
  const bad = sfdemo(cwd, 'selectors', 'check', badFile);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /\d+ problem\(s\)\n {2}/);
  assert.match(sfdemo(cwd, 'selectors', 'promote').out, /no healed locators to promote/);
  assert.match(sfdemo(cwd, 'selectors', 'frob').err, /unknown: sfdemo selectors frob/);
});

test('baseline and compare: set, show, clear; compare exits 1 on a change and --write puts the diff in the report', () => {
  const cwd = fresh('baseline');
  fs.writeFileSync(path.join(cwd, 'sfdemo.config.json'), JSON.stringify({ recordings: 'runs' }));
  const runs = path.join(cwd, 'runs');
  makeRun(runs, '20261020-100000', [result('Guest', ['Rides cost $4 an hour.'])]);
  const latest = makeRun(runs, '20261026-100000', [result('Guest', ['Rides cost $5 an hour.'])], '2026-10-26T10:00:00.000Z');
  fs.mkdirSync(path.join(runs, '20261027-100000')); // an unfinished run, without report.json
  assert.match(sfdemo(cwd, 'baseline').out, /no baseline \(sfdemo baseline set <run>\)/);
  assert.match(sfdemo(cwd, 'compare').err, /no baseline: sfdemo baseline set <run>, or pass --with <run>/);
  assert.match(sfdemo(cwd, 'baseline', 'set', 'nope').err, /no run \(report\.json\) at nope/);
  assert.equal(sfdemo(cwd, 'baseline', 'set', '20261020-100000').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'sfdemo.config.json'), 'utf8')).baseline, '20261020-100000');
  assert.equal(sfdemo(cwd, 'baseline', 'show').out.trim(), path.join(runs, '20261020-100000'));
  const cmp = sfdemo(cwd, 'compare', 'latest', '--write');
  assert.equal(cmp.code, 1, cmp.err);
  assert.match(cmp.out, /0 same, 1 changed, 0 new, 0 missing\n {2}Guest: #1 \d+% alike/);
  const report = JSON.parse(fs.readFileSync(path.join(latest, 'report.json'), 'utf8'));
  assert.equal(report.comparison.conversations[0].status, 'changed');
  assert.match(fs.readFileSync(path.join(latest, 'report.md'), 'utf8'), /## Compared with the baseline\n\n- Guest: changed/);
  assert.equal(sfdemo(cwd, 'compare', '20261020-100000', '--with', path.join(runs, '20261020-100000')).code, 0, 'a run is the same as itself');
  assert.equal(sfdemo(cwd, 'baseline', 'clear').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'sfdemo.config.json'), 'utf8')).baseline, null);
  assert.match(sfdemo(cwd, 'baseline', 'drop').err, /unknown: sfdemo baseline drop/);
});

test('an invalid sfdemo.config.json stops every command that reads it, naming the file', () => {
  const cwd = fresh('bad-config');
  fs.writeFileSync(path.join(cwd, 'sfdemo.config.json'), JSON.stringify({ parallel: 0 }));
  const r = sfdemo(cwd, 'run', '--dry-run');
  assert.equal(r.code, 2);
  assert.match(r.err, /sfdemo\.config\.json: .*parallel/);
  const nested = path.join(cwd, 'scenarios', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  assert.match(sfdemo(nested, 'baseline').err, /sfdemo\.config\.json: /, 'found from a sub-folder');
});
