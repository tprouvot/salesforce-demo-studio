/**
 * The project: the folder holding sfdemo.config.json (searched upward from the working directory, else the working
 * directory itself), its settings with defaults filled in, and the tool's own folders.
 *
 *   <project>/.sfdemo/            local state, gitignored: overrides.json (healed selectors), doctor/, heal/, baseline
 *   ~/.sfdemo/packs/              selector packs downloaded by `sfdemo selectors update` (SFDEMO_HOME moves ~/.sfdemo)
 *
 * The tool was called afrec: afrec.config.json, .afrec/, ~/.afrec and AFREC_HOME still work when the new ones are absent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, validate } from './schema.js';

export const CONFIG_FILE = 'sfdemo.config.json';
const LEGACY_CONFIG_FILE = 'afrec.config.json';
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PACKS_URL = 'https://raw.githubusercontent.com/tprouvot/salesforce-demo-studio/main/packs/';

const DEFAULTS = {
  scenarios: 'scenarios',
  demos: 'demos',
  recordings: '.local/recordings',
  defaults: {},
  parallel: 3,
  baseline: null,
  checks: { gifMaxBytes: 15000000, videoSlackSeconds: 3, minBytesPerMegapixel: 7000 },
  doctor: { canary: ['Hi', 'What can you help me with?'] },
  packsUrl: DEFAULT_PACKS_URL,
};

/** The config file of `dir`: sfdemo.config.json, else the older afrec.config.json; null when there is neither. */
function configIn(dir) {
  for (const name of [CONFIG_FILE, LEGACY_CONFIG_FILE]) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  return null;
}

/** The folder holding sfdemo.config.json (or afrec.config.json), from `start` upward; null when there is none. */
export function findProjectDir(start = process.cwd()) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (configIn(dir)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** `name` in `dir`, unless only the older `legacy` exists there. */
const newOrLegacy = (dir, name, legacy) => (!fs.existsSync(path.join(dir, name)) && fs.existsSync(path.join(dir, legacy)) ? path.join(dir, legacy) : path.join(dir, name));

/** The local state folder of a project folder: .sfdemo, or an existing .afrec from the tool's former name. */
export const stateDirOf = dir => newOrLegacy(dir, '.sfdemo', '.afrec');

/**
 * @param {{ dir?: string, file?: string }} [options] an explicit config file, or the folder to start the search from
 */
export function loadProject(options = {}) {
  const file = options.file ? path.resolve(options.file) : (() => { const d = findProjectDir(options.dir); return d ? configIn(d) : null; })();
  const dir = file ? path.dirname(file) : path.resolve(options.dir || process.cwd());
  let user = {};
  if (file) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file}: ${e.message}`); }
    const problems = validate(user, loadSchema('config'));
    if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  }
  const config = {
    ...DEFAULTS, ...user,
    checks: { ...DEFAULTS.checks, ...(user.checks || {}) },
    doctor: { ...DEFAULTS.doctor, ...(user.doctor || {}) },
  };
  return {
    dir,
    file,
    config,
    scenariosDir: path.resolve(dir, config.scenarios),
    demosDir: path.resolve(dir, config.demos),
    recordingsDir: path.resolve(dir, config.recordings),
    stateDir: stateDirOf(dir),
  };
}

/** Writes changed keys back to sfdemo.config.json (creating it when missing), keeping the others as they are. */
export function saveConfig(project, changes) {
  const file = project.file || path.join(project.dir, CONFIG_FILE);
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const next = { ...current, ...changes };
  const problems = validate(next, loadSchema('config'));
  if (problems.length) throw new Error(problems.join('; '));
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  project.file = file;
  Object.assign(project.config, changes);
}

/** ~/.sfdemo, or SFDEMO_HOME (AFREC_HOME, and an existing ~/.afrec, from the tool's former name). */
export function homeDir() {
  const env = process.env.SFDEMO_HOME || process.env.AFREC_HOME;
  return env ? path.resolve(env) : newOrLegacy(os.homedir(), '.sfdemo', '.afrec');
}

export const timestamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
