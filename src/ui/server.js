/**
 * sfdemo ui: a local web server for the project. It edits scenario files, starts runs and doctor checks with the
 * same engine as the CLI, streams their progress (server-sent events), answers type-from prompts, and serves the
 * recordings.
 *
 * Security: it listens on 127.0.0.1 only (by default); the printed URL carries a random token that becomes an
 * HttpOnly cookie; every request needs it, changes also need it in the X-Sfdemo-Token header (so no other site can
 * trigger one), and the Host header must be the server's own (no DNS rebinding). Passwords never go through it: the
 * development-only credentials files are picked by path and only their usernames are listed.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, saveConfig } from '../config.js';
import { listScenarioFiles, parseScenarioText, toMarkdown } from '../scenario/parse.js';
import { resolveAll, assignFolders } from '../scenario/resolve.js';
import { loadSchema } from '../schema.js';
import { planRun, describePlan, executeRun } from '../engine/run.js';
import { InputBroker } from '../engine/input.js';
import { listOrgs } from '../engine/salesforce.js';
import { listCredentialUsers } from '../engine/credentials.js';
import { compareRuns, readRun } from '../engine/baseline.js';
import { doctorCheck } from '../doctor/doctor.js';
import { writeHealBundle } from '../doctor/bundle.js';
import { packStatus, updatePacks, promote } from '../selectors/manage.js';
import { loadDenylist } from '../denylist.js';
import YAML from 'yaml';
import { readDemo, parseDemo, speakerNotes, lengthScale, demoDefaults } from '../demo/script.js';
import { narrate, catalogue, installedVoices, synthesize } from '../demo/voice.js';
import { recordDemo, isLive, bestTake } from '../demo/recorder.js';
import { assembleDemo, missingSlides } from '../demo/assemble.js';
import { demoPaths, describeDemo } from '../commands/demo.js';

const PUBLIC = path.join(PACKAGE_ROOT, 'src', 'ui', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.vtt': 'text/vtt; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
};
const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

/** `rel` inside `root`, or an error (no path traversal). */
function inside(root, rel) {
  const full = path.resolve(root, String(rel || ''));
  if (full !== root && !full.startsWith(root + path.sep)) throw Object.assign(new Error('path outside the project'), { status: 400 });
  return full;
}

const readBody = req => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', c => { size += c.length; if (size > 2e6) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
});

/**
 * @param {{ project: any, port?: number, host?: string }} options
 * @returns {Promise<{ url: string, token: string, close: () => Promise<void>, server: http.Server }>}
 */
export async function startServer({ project, port = 4477, host = '127.0.0.1' }) {
  const token = crypto.randomBytes(18).toString('base64url');
  const clients = new Set();
  /** @type {{ id: string, kind: string, status: string, events: any[], broker?: InputBroker, controller?: AbortController, out?: string, result?: any } | null} */
  let active = null;
  let orgCache = null;

  const broadcast = event => {
    const e = { ...event, at: Date.now() };
    if (active) { active.events.push(e); if (active.events.length > 5000) active.events.shift(); }
    const line = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) res.write(line);
  };

  const listRuns = () => {
    if (!fs.existsSync(project.recordingsDir)) return [];
    return fs.readdirSync(project.recordingsDir).filter(d => fs.existsSync(path.join(project.recordingsDir, d, 'report.json'))).sort().reverse().map(id => {
      try {
        const r = readRun(path.join(project.recordingsDir, id));
        const count = s => r.results.filter(x => x.status === s).length;
        return { id, startedAt: r.startedAt, durationMs: r.durationMs, total: r.results.length, recorded: count('recorded'), flagged: count('flagged'), failed: count('failed'), names: r.results.map(x => x.name), baseline: project.config.baseline === id };
      } catch (e) { return { id, error: e.message }; }
    });
  };

  const listDoctor = () => {
    const root = path.join(project.stateDir, 'doctor');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).sort().reverse().slice(0, 20).map(d => {
      try { return { id: d, ...JSON.parse(fs.readFileSync(path.join(root, d, 'doctor.json'), 'utf8')) }; } catch { return null; }
    }).filter(Boolean);
  };

  const scenarioList = () => {
    if (!fs.existsSync(project.scenariosDir)) return [];
    return listScenarioFiles([project.scenariosDir]).map(file => {
      const rel = path.relative(project.scenariosDir, file);
      try {
        const raws = parseScenarioText(fs.readFileSync(file, 'utf8'), file);
        const { errors } = resolveAll(raws, project.config.defaults);
        return { file: rel, conversations: raws.map(r => ({ name: r.name, surface: r.settings.surface || (r.settings.site ? 'messaging' : 'lightning'), steps: r.steps.length })), errors };
      } catch (e) { return { file: rel, conversations: [], errors: [e.message] }; }
    });
  };

  const validateText = (file, text) => {
    const warnings = [];
    const full = inside(project.scenariosDir, file);
    const raws = parseScenarioText(text, full, warnings);
    const { conversations, errors } = resolveAll(raws, project.config.defaults);
    assignFolders(conversations);
    return { conversations: raws.map(r => ({ name: r.name, settings: r.settings, steps: r.steps.map(({ where, ...s }) => s) })), plan: conversations.length ? describePlan(conversations, project.config.parallel) : [], errors, warnings };
  };

  const startRun = body => {
    if (active && active.status === 'running') throw Object.assign(new Error(`a ${active.kind} is already running`), { status: 409 });
    const inputs = (body.files || []).map(f => inside(project.scenariosDir, f));
    const { conversations, warnings, errors } = planRun({ project, inputs, defaults: body.defaults || {}, only: body.only || null });
    if (errors.length) throw Object.assign(new Error(errors.join('\n')), { status: 400 });
    if (!conversations.length) throw Object.assign(new Error('no conversation to record'), { status: 400 });
    const broker = new InputBroker();
    const controller = new AbortController();
    active = { id: crypto.randomUUID(), kind: 'run', status: 'running', events: [], broker, controller };
    const run = active;
    broker.on('request', req => broadcast({ type: 'input-request', ...req }));
    broker.on('resolved', r => broadcast({ type: 'input-resolved', ...r }));
    warnings.forEach(w => broadcast({ type: 'warning', message: w }));
    executeRun(conversations, { project, parallel: body.parallel || project.config.parallel, headed: !!body.headed, emit: broadcast, broker, signal: controller.signal })
      .then(r => { run.status = 'done'; run.out = r.out; broadcast({ type: 'done', kind: 'run', id: path.basename(r.out) }); })
      .catch(e => { run.status = 'failed'; broadcast({ type: 'done', kind: 'run', error: e.message }); });
    return { id: active.id, plan: describePlan(conversations, body.parallel || project.config.parallel) };
  };

  const startDoctor = body => {
    if (active && active.status === 'running') throw Object.assign(new Error(`a ${active.kind} is already running`), { status: 409 });
    const targets = (body.targets || []).filter(t => t && (t.org || t.site));
    if (!targets.length) throw Object.assign(new Error('give an org (Lightning) or a site (Messaging)'), { status: 400 });
    active = { id: crypto.randomUUID(), kind: 'doctor', status: 'running', events: [] };
    const run = active;
    (async () => {
      const reports = [];
      for (const t of targets) {
        try { reports.push(await doctorCheck({ project, settings: t, canary: body.canary && body.canary.length ? body.canary : undefined, headed: !!body.headed, emit: broadcast })); } catch (e) { broadcast({ type: 'warning', message: `doctor: ${e.message}` }); }
      }
      run.status = 'done';
      run.result = reports.map(r => path.basename(r.dir));
      broadcast({ type: 'done', kind: 'doctor', ids: run.result });
    })();
    return { id: active.id };
  };

  // ---- demos ----

  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const demoFiles = () => (fs.existsSync(project.demosDir) ? fs.readdirSync(project.demosDir).filter(f => /\.md$/i.test(f)).sort() : []);
  const runsUrl = (name, file) => `/runs/${encodeURIComponent(name)}/${encodeURIComponent(file)}`;
  const demoSummary = file => {
    try {
      const demo = readDemo(inside(project.demosDir, file), { defaults: demoDefaults(project) });
      const { out } = demoPaths(project, demo);
      const has = f => fs.existsSync(path.join(out, f));
      return { file, name: demo.name, title: String(demo.settings.title || demo.name), voice: demo.settings.voice, chapters: demo.chapters.length, live: demo.chapters.filter(isLive).length,
        video: has(`${demo.name}.mp4`) ? runsUrl(demo.name, `${demo.name}.mp4`) : null, subtitles: has(`${demo.name}.vtt`) ? runsUrl(demo.name, `${demo.name}.vtt`) : null, errors: [] };
    } catch (e) { return { file, name: path.parse(file).name, title: path.parse(file).name, errors: [e.message] }; }
  };
  const demoDetails = file => {
    const full = inside(project.demosDir, file);
    const text = fs.readFileSync(full, 'utf8');
    let demo;
    try { demo = readDemo(full, { defaults: demoDefaults(project) }); } catch (e) { return { file, text, errors: [e.message] }; }
    const paths = demoPaths(project, demo);
    return {
      file, text, errors: [], summary: demoSummary(file),
      settings: { title: demo.settings.title || demo.name, voice: demo.settings.voice, pace: demo.settings.pace || 'presenter', slides: path.relative(project.dir, paths.slidesDir) },
      chapters: demo.chapters.map((c, i) => {
        const take = isLive(c) ? bestTake(paths.out, i + 1) : null;
        return { n: i + 1, title: c.title, live: isLive(c), windows: [...new Set(c.steps.filter(s => s.type === 'window').map(s => s.name))], lines: c.steps.filter(s => s.type === 'say').map(s => s.text),
          take: take && { take: take.take, failed: take.failed, reason: take.reason } };
      }),
      notes: speakerNotes(demo), missing: missingSlides(demo, paths.slidesDir), assembly: readJson(path.join(paths.out, 'assembly.json')),
    };
  };
  /** The front matter of `text` with `changes` applied (comments and the rest of the file kept). */
  const withSettings = (text, changes) => {
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
    const doc = YAML.parseDocument(fm ? fm[1] : '');
    for (const [k, v] of Object.entries(changes)) if (v !== undefined && v !== null && v !== '') doc.set(k, v);
    return `---\n${doc.toString().trimEnd()}\n---\n${fm ? text.slice(fm[0].length) : text}`;
  };
  const startDemo = body => {
    if (active && active.status === 'running') throw Object.assign(new Error(`a ${active.kind} is already running`), { status: 409 });
    const demo = readDemo(inside(project.demosDir, body.file), { org: body.org || undefined, defaults: demoDefaults(project) });
    const paths = demoPaths(project, demo);
    const missing = missingSlides(demo, paths.slidesDir);
    if (missing.length) throw Object.assign(new Error(`no image for slide(s) ${missing.join(', ')} in ${paths.slidesDir}: export the deck's slides there first`), { status: 400 });
    const broker = new InputBroker();
    active = { id: crypto.randomUUID(), kind: 'demo', status: 'running', events: [], broker };
    const run = active;
    broker.on('request', req => broadcast({ type: 'input-request', ...req }));
    broker.on('resolved', r => broadcast({ type: 'input-resolved', ...r }));
    broadcast({ type: 'demo-start', file: body.file, chapters: demo.chapters.map((c, i) => ({ name: `${i + 1}. ${c.title}`, live: isLive(c), skipped: !!body.only && Number(body.only) !== i + 1 })) });
    (async () => {
      broadcast({ type: 'log', message: `voice-over (${demo.settings.voice})...` });
      const narration = await narrate(demo, { cacheDir: paths.cacheDir });
      if (!body.videoOnly) await recordDemo(demo, { out: paths.out, stock: narration.stock, stateDir: paths.stateDir, only: body.only ? [Number(body.only)] : [], retake: !!body.retake, emit: broadcast, broker, aiCacheFile: paths.aiCache });
      const video = await assembleDemo(demo, { out: paths.out, slidesDir: paths.slidesDir, emit: broadcast });
      run.status = 'done';
      broadcast({ type: 'done', kind: 'demo', file: body.file, video: runsUrl(demo.name, path.basename(video.mp4)), seconds: Math.round(video.duration) });
    })().catch(e => { run.status = 'failed'; broadcast({ type: 'done', kind: 'demo', file: body.file, error: e.message }); });
    return { id: active.id };
  };

  const routes = {
    'GET /api/demos': () => demoFiles().map(demoSummary),
    'GET /api/demo': (req, url) => demoDetails(url.searchParams.get('file')),
    'PUT /api/demo': (req, url, body) => {
      const file = inside(project.demosDir, body.file);
      if (!/\.md$/i.test(file)) throw Object.assign(new Error('a demo script ends with .md'), { status: 400 });
      try { parseDemo(String(body.text || ''), file, { defaults: demoDefaults(project) }); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); } // a script that does not read is not saved
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(body.text || ''));
      return demoDetails(path.relative(project.demosDir, file));
    },
    'POST /api/demo/settings': (req, url, body) => {
      const file = inside(project.demosDir, body.file);
      const text = withSettings(fs.readFileSync(file, 'utf8'), { voice: body.voice, pace: body.pace });
      try { parseDemo(text, file, { defaults: demoDefaults(project) }); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
      fs.writeFileSync(file, text);
      return demoDetails(path.relative(project.demosDir, file));
    },
    'GET /api/voices': async () => {
      const installed = new Set(installedVoices().map(v => v.key));
      let list;
      try { list = await catalogue(); } catch { list = installedVoices().map(v => ({ key: v.key, language: v.language, languageName: v.language, country: '', quality: '', sizeBytes: null })); }
      return list.map(v => ({ key: v.key, language: v.language, languageName: v.languageName, country: v.country, quality: v.quality, sizeBytes: v.sizeBytes, installed: installed.has(v.key) }));
    },
    'POST /api/voice/try': async (req, url, body) => {
      if (!/^[A-Za-z]{2,3}_[A-Za-z]{2}-[\w]+-[a-z_]+$/.test(String(body.voice || ''))) throw Object.assign(new Error('not a voice name'), { status: 400 });
      const r = await synthesize({ text: String(body.text || 'Hello, this is how I sound when I present your demo.').slice(0, 400), voice: body.voice, lengthScale: lengthScale(body.pace || 'presenter'), cacheDir: path.join(project.stateDir, 'narration') });
      return { url: `/voice-samples/${path.basename(r.wav)}`, seconds: r.duration };
    },
    'POST /api/demo/default-voice': (req, url, body) => {
      if (!/^[A-Za-z]{2,3}_[A-Za-z]{2}-[\w]+-[a-z_]+$/.test(String(body.voice || ''))) throw Object.assign(new Error('not a voice name'), { status: 400 });
      lengthScale(body.pace || project.config.pace); // a bad pace is an error before anything is written
      saveConfig(project, { voice: body.voice, ...(body.pace ? { pace: body.pace } : {}) });
      return { voice: project.config.voice, pace: project.config.pace };
    },
    'POST /api/demo/narrate': async (req, url, body) => {
      const demo = readDemo(inside(project.demosDir, body.file), { defaults: demoDefaults(project) });
      const paths = demoPaths(project, demo);
      const r = await narrate(demo, { cacheDir: paths.cacheDir });
      return { plan: describeDemo(demo), seconds: r.seconds, lines: r.lines, missing: missingSlides(demo, paths.slidesDir) };
    },
    'POST /api/demo/record': (req, url, body) => startDemo(body),
    'GET /api/state': () => ({
      version: VERSION, project: { dir: project.dir, hasConfig: !!project.file, config: project.config, scenarios: path.relative(project.dir, project.scenariosDir), demos: path.relative(project.dir, project.demosDir), recordings: path.relative(project.dir, project.recordingsDir) },
      packs: packStatus(project), active: active && { id: active.id, kind: active.kind, status: active.status, pending: active.broker ? active.broker.pending() : [] },
    }),
    'GET /api/orgs': async () => {
      if (!orgCache || Date.now() - orgCache.at > 60000) orgCache = { at: Date.now(), orgs: await listOrgs() };
      return orgCache.orgs;
    },
    'GET /api/schema': () => loadSchema('scenario'),
    'GET /api/scenarios': () => scenarioList(),
    'GET /api/scenario': (req, url) => {
      const file = inside(project.scenariosDir, url.searchParams.get('file'));
      const text = fs.readFileSync(file, 'utf8');
      let parsed = null;
      try { parsed = validateText(path.relative(project.scenariosDir, file), text); } catch (e) { parsed = { error: e.message }; }
      return { file: path.relative(project.scenariosDir, file), text, parsed };
    },
    'POST /api/scenario/validate': (req, url, body) => {
      try { return validateText(body.file || 'scenario.md', String(body.text || '')); } catch (e) { return { errors: [e.message], conversations: [], plan: [], warnings: [] }; }
    },
    'POST /api/scenario/render': (req, url, body) => ({ text: toMarkdown({ settings: body.settings || {}, steps: body.steps || [], title: body.title || '' }) }),
    'PUT /api/scenario': (req, url, body) => {
      const file = inside(project.scenariosDir, body.file);
      if (!/\.(md|csv)$/i.test(file)) throw Object.assign(new Error('a scenario file ends with .md or .csv'), { status: 400 });
      parseScenarioText(String(body.text || ''), file); // a file that does not parse is not saved
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(body.text || ''));
      return validateText(path.relative(project.scenariosDir, file), String(body.text || ''));
    },
    'DELETE /api/scenario': (req, url) => { fs.rmSync(inside(project.scenariosDir, url.searchParams.get('file'))); return { ok: true }; },
    'GET /api/credentials': (req, url) => listCredentialUsers(inside(project.dir, url.searchParams.get('file'))),
    'POST /api/plan': (req, url, body) => {
      const inputs = (body.files || []).map(f => inside(project.scenariosDir, f));
      const { conversations, warnings, errors } = planRun({ project, inputs, defaults: body.defaults || {}, only: body.only || null });
      return { plan: conversations.length ? describePlan(conversations, body.parallel || project.config.parallel) : [], errors, warnings, names: conversations.map(c => c.name) };
    },
    'POST /api/runs': (req, url, body) => startRun(body),
    'POST /api/cancel': () => { if (active && active.controller) active.controller.abort(); return { ok: true }; },
    'POST /api/input': (req, url, body) => ({ ok: !!(active && active.broker && active.broker.answer(body.id, body.value)) }),
    'GET /api/runs': () => listRuns(),
    'GET /api/run': (req, url) => {
      const id = url.searchParams.get('id');
      const dir = inside(project.recordingsDir, id);
      const report = readRun(dir);
      const base = project.config.baseline && project.config.baseline !== id ? path.join(project.recordingsDir, project.config.baseline) : null;
      if (!report.comparison && base && fs.existsSync(path.join(base, 'report.json'))) report.comparison = compareRuns(report.results, readRun(base));
      return { id, report, baseline: project.config.baseline };
    },
    'POST /api/baseline': (req, url, body) => {
      if (body.id) inside(project.recordingsDir, body.id);
      saveConfig(project, { baseline: body.id || null });
      return { baseline: project.config.baseline };
    },
    'POST /api/doctor': (req, url, body) => startDoctor(body),
    'GET /api/doctor': () => listDoctor(),
    'POST /api/heal': (req, url, body) => {
      const dir = inside(path.join(project.stateDir, 'doctor'), body.id);
      return { dir: writeHealBundle(project, dir, { denylist: loadDenylist(project.stateDir) }) };
    },
    'POST /api/selectors/update': async () => updatePacks(project.config.packsUrl),
    'POST /api/selectors/promote': (req, url, body) => { const r = promote(project, body.surface, { force: !!body.force }); return { version: r.pack.version, written: r.written }; },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || host}`);
    const send = (status, body, headers = {}) => {
      const isBuffer = Buffer.isBuffer(body);
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...(isBuffer || typeof body === 'string' ? {} : { 'Content-Type': 'application/json' }), ...headers });
      res.end(isBuffer || typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const expectedHost = `${host}:${server.address() && typeof server.address() === 'object' ? /** @type {any} */ (server.address()).port : port}`;
      if (req.headers.host !== expectedHost && req.headers.host !== expectedHost.replace('127.0.0.1', 'localhost')) return send(421, 'wrong host');
      const cookie = Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2));
      if (url.pathname === '/' && url.searchParams.get('token') === token) {
        return send(302, '', { Location: '/', 'Set-Cookie': `sfdemo_token=${token}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (cookie.sfdemo_token !== token) return send(401, 'Open the link sfdemo ui printed (it carries the access token).', { 'Content-Type': 'text/plain; charset=utf-8' });
      if (req.method !== 'GET' && req.headers['x-sfdemo-token'] !== token) return send(403, { error: 'missing X-Sfdemo-Token' });

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__SFDEMO_TOKEN__', token);
        return send(200, html, { 'Content-Type': TYPES['.html'], 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      }
      if (url.pathname.startsWith('/static/')) {
        const file = inside(PUBLIC, url.pathname.slice('/static/'.length));
        if (!fs.existsSync(file)) return send(404, 'not found');
        return send(200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      }
      if (url.pathname.startsWith('/voice-samples/')) {
        const file = inside(path.join(project.stateDir, 'narration'), decodeURIComponent(url.pathname.slice('/voice-samples/'.length)));
        if (!/\.wav$/.test(file) || !fs.existsSync(file)) return send(404, 'not found');
        return serveFile(req, res, file);
      }
      if (url.pathname.startsWith('/runs/')) {
        const file = inside(project.recordingsDir, decodeURIComponent(url.pathname.slice('/runs/'.length)));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'not found');
        return serveFile(req, res, file);
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'hello', active: active && { id: active.id, kind: active.kind, status: active.status } })}\n\n`);
        if (active) for (const e of active.events) res.write(`data: ${JSON.stringify({ ...e, replay: true })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(404, { error: 'not found' });
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      return send(200, await handler(req, url, body));
    } catch (e) {
      return send(e.status || 500, { error: e.message });
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(undefined)); });
  const actual = /** @type {any} */ (server.address()).port;
  return {
    url: `http://${host}:${actual}/?token=${token}`,
    token,
    server,
    close: () => new Promise(resolve => { for (const c of clients) c.end(); server.close(() => resolve(undefined)); }),
  };
}

/** Serves a file, with byte ranges so videos can seek. */
function serveFile(req, res, file) {
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (path.extname(file) === '.html') headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'";
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}
