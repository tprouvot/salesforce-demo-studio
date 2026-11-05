/** The narrator: pronunciations, WAV durations, the cache, the catalogue and downloads (served locally), with a fake Piper. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spokenForm, sayingsFor, wavDuration, synthesize, narrate, catalogue, downloadVoice, sampleUrl, findPiper, findVoice, installedVoices, languageOf } from '../src/demo/voice.js';
import { parseDemo } from '../src/demo/script.js';
import { installFakePiper } from './helpers/fake-piper.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-voice-'));
let piper;
before(() => { piper = installFakePiper(); process.env.SFDEMO_HOME = path.join(tmp, 'home'); });
after(() => { piper.restore(); delete process.env.SFDEMO_HOME; });

test('what the voice reads: whole words only, the longest first, case kept, markdown marks dropped', () => {
  const english = sayingsFor('en_US-amy-medium', { 'Named Credential': 'named credential', CRM: 'see are em' });
  assert.equal(spokenForm('The **API** calls SOQL; the APIs, then a RAPID check and `apex`.', english), 'The A P I calls sockle; the A P Is, then a RAPID check and apex.');
  assert.equal(spokenForm('A CRM and a Named Credential.', english), 'A see are em and a named credential.', 'the demo\'s own sayings win');
  assert.equal(spokenForm('Agentforce, Omni-Channel and Data 360.', english), 'Agent force, Omni Channel and Data three sixty.');
  assert.deepEqual(sayingsFor('fr_FR-siwis-low'), {}, 'the English sayings stay off other languages');
  assert.equal(languageOf('pt_BR-faber-medium'), 'pt_BR');
});

test('a WAV\'s duration from its header; a file that is not a WAV says so', () => {
  const wav = path.join(tmp, 'tone.wav');
  const rate = 16000;
  const data = rate * 2 * 3; // 3 s, 16-bit mono
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  fs.writeFileSync(wav, b);
  assert.equal(wavDuration(wav), 3);
  fs.writeFileSync(path.join(tmp, 'x.wav'), 'not audio');
  assert.throws(() => wavDuration(path.join(tmp, 'x.wav')), /is not a WAV file/);
});

test('synthesis: Piper gets the spoken form and the pace, the result is cached by text, voice and pace', async () => {
  const cacheDir = path.join(tmp, 'cache');
  const a = await synthesize({ text: 'The API answers.', voice: 'en_US-amy-medium', lengthScale: 1.25, cacheDir });
  assert.equal(a.spoken, 'The A P I answers.');
  assert.ok(Math.abs(a.duration - 'The A P I answers.'.length * 0.05 * 1.25) < 0.01, String(a.duration));
  const call = piper.calls().at(-1);
  assert.equal(call.text, 'The A P I answers.');
  assert.equal(call.args[call.args.indexOf('--length-scale') + 1], '1.25');
  assert.equal(call.args[call.args.indexOf('-m') + 1], path.join(piper.voicesDir, 'en_US-amy-medium.onnx'));
  const calls = piper.calls().length;
  assert.equal((await synthesize({ text: 'The API answers.', voice: 'en_US-amy-medium', lengthScale: 1.25, cacheDir })).wav, a.wav);
  assert.equal(piper.calls().length, calls, 'the cache answered');
  assert.notEqual((await synthesize({ text: 'The API answers.', voice: 'en_US-amy-medium', lengthScale: 1, cacheDir })).wav, a.wav, 'another pace is another file');
  await assert.rejects(synthesize({ text: 'Please FAIL.', voice: 'en_US-amy-medium', cacheDir }), /Piper failed \(exit 3\): fake piper: asked to fail/);
  assert.ok(!fs.readdirSync(cacheDir).some(f => f.includes('part')), 'a failed line leaves no half file');
});

test('narrating a demo: every spoken paragraph gets its WAV and duration, and the stock lines are in the demo\'s language', async () => {
  const demo = parseDemo('---\nvoice: fr_FR-siwis-low\npace: normal\nfiller: Un instant, l\'agent prépare sa réponse.\n---\n# Un\n- slide: 1\n\nBonjour.\n\nVoici la démo.\n', '/d/fr.md');
  const lines = [];
  const r = await narrate(demo, { cacheDir: path.join(tmp, 'narration'), onLine: e => lines.push(e) });
  assert.equal(r.lines, 2);
  assert.deepEqual(lines.map(l => [l.n, l.total, l.chapter]), [[1, 2, 'Un'], [2, 2, 'Un']]);
  assert.ok(demo.chapters[0].steps.filter(s => s.type === 'say').every(s => fs.existsSync(s.wav) && s.dur > 0));
  assert.equal(r.stock.filler.text, 'Un instant, l\'agent prépare sa réponse.');
  assert.match(r.stock.retry.text, /let me run that part again/, 'the default when the demo gives none');
});

test('Piper and voices are found where they are installed, SFDEMO_VOICES first', () => {
  assert.equal(findPiper(), piper.bin);
  assert.ok(findVoice('en_US-amy-medium'));
  assert.equal(findVoice('xx_XX-nobody-low'), null);
  const mine = installedVoices().filter(v => v.model.startsWith(piper.voicesDir)); // the machine may hold real voices too
  assert.deepEqual(mine.map(v => [v.key, v.language]), [['en_US-amy-medium', 'en_US'], ['fr_FR-siwis-low', 'fr_FR']]);
});

test('the catalogue and a download: languages listed, MD5 checked, a damaged file refused, nothing half-written', async () => {
  const onnx = Buffer.from('a voice model');
  const files = {
    'voices.json': JSON.stringify({
      'de_DE-thorsten-medium': { key: 'de_DE-thorsten-medium', name: 'thorsten', quality: 'medium', num_speakers: 1, language: { code: 'de_DE', name_english: 'German', country_english: 'Germany' },
        files: { 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx': { size_bytes: onnx.length, md5_digest: crypto.createHash('md5').update(onnx).digest('hex') }, 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json': { size_bytes: 2, md5_digest: crypto.createHash('md5').update('{}').digest('hex') } } },
      'de_DE-broken-low': { key: 'de_DE-broken-low', name: 'broken', quality: 'low', language: { code: 'de_DE', name_english: 'German', country_english: 'Germany' },
        files: { 'de/de_DE/broken/low/de_DE-broken-low.onnx': { size_bytes: 3, md5_digest: '00000000000000000000000000000000' }, 'de/de_DE/broken/low/de_DE-broken-low.onnx.json': { size_bytes: 2, md5_digest: null } } },
    }),
    'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx': onnx,
    'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json': '{}',
    'de/de_DE/broken/low/de_DE-broken-low.onnx': 'bad',
    'de/de_DE/broken/low/de_DE-broken-low.onnx.json': '{}',
  };
  const server = http.createServer((req, res) => {
    const f = decodeURIComponent(req.url.slice(1));
    if (files[f] === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200);
    res.end(files[f]);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(undefined)));
  const baseUrl = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`;
  const saved = process.env.SFDEMO_VOICES;
  process.env.SFDEMO_VOICES = path.join(tmp, 'downloads');
  try {
    const list = await catalogue({ baseUrl, refresh: true });
    assert.deepEqual(list.map(v => [v.key, v.languageName, v.country, v.quality, v.sizeBytes]), [['de_DE-broken-low', 'German', 'Germany', 'low', 3], ['de_DE-thorsten-medium', 'German', 'Germany', 'medium', onnx.length]]);
    assert.equal(sampleUrl(list[1], baseUrl), `${baseUrl}de/de_DE/thorsten/medium/samples/speaker_0.mp3`);
    const progress = [];
    const v = await downloadVoice('de_DE-thorsten-medium', { baseUrl, onProgress: p => progress.push(p.file) });
    assert.equal(fs.readFileSync(v.model, 'utf8'), 'a voice model');
    assert.deepEqual(progress, ['de_DE-thorsten-medium.onnx', 'de_DE-thorsten-medium.onnx.json']);
    await assert.rejects(downloadVoice('de_DE-broken-low', { baseUrl }), /the download is damaged \(MD5 mismatch\)/);
    assert.ok(!fs.existsSync(path.join(process.env.SFDEMO_VOICES, 'de_DE-broken-low.onnx')));
    await assert.rejects(downloadVoice('xx_XX-nobody-low', { baseUrl }), /no voice "xx_XX-nobody-low" in Piper's catalogue/);
  } finally {
    if (saved === undefined) delete process.env.SFDEMO_VOICES; else process.env.SFDEMO_VOICES = saved;
    server.close();
  }
});

test('without Piper, synthesis says how to install it', async () => {
  const saved = { SFDEMO_PIPER: process.env.SFDEMO_PIPER, PATH: process.env.PATH, HOME: process.env.HOME };
  delete process.env.SFDEMO_PIPER;
  process.env.PATH = path.join(tmp, 'empty-path');
  process.env.HOME = path.join(tmp, 'empty-home');
  try {
    if (findPiper()) return; // a Piper outside PATH and HOME (an unusual install): nothing to check here
    await assert.rejects(synthesize({ text: 'Not cached yet.', voice: 'en_US-amy-medium', cacheDir: path.join(tmp, 'nopiper') }), /Piper, the voice engine, is not installed: run sfdemo setup --voice/);
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});
