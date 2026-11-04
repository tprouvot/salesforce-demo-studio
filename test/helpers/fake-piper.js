/**
 * A fake Piper for the tests: SFDEMO_PIPER points at a script that writes a silent WAV (16-bit mono, 22050 Hz) of
 * 0.05 s per character times the length scale, and logs each call; SFDEMO_VOICES holds fake voice files. Every
 * platform: the script is run with node.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = `
const fs = require('fs');
const args = process.argv.slice(2);
const opt = k => args[args.indexOf(k) + 1];
let text = '';
process.stdin.on('data', d => { text += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.SFDEMO_FAKE_PIPER_LOG, JSON.stringify({ args, text }) + '\\n');
  if (text.includes('FAIL')) { process.stderr.write('fake piper: asked to fail'); process.exit(3); }
  const seconds = Math.max(0.5, text.length * 0.05 * Number(opt('--length-scale') || 1));
  const rate = 22050, samples = Math.round(seconds * rate), data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  fs.writeFileSync(opt('-f'), b);
});
`;

/** Installs the fake for this process; `voices` are the keys of the fake installed voices. */
export function installFakePiper(voices = ['en_US-ryan-high', 'fr_FR-siwis-low']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-piper-'));
  const voicesDir = path.join(dir, 'voices');
  fs.mkdirSync(voicesDir);
  for (const v of voices) { fs.writeFileSync(path.join(voicesDir, `${v}.onnx`), 'fake'); fs.writeFileSync(path.join(voicesDir, `${v}.onnx.json`), '{}'); }
  const script = path.join(dir, 'piper.cjs');
  fs.writeFileSync(script, SCRIPT);
  let bin = path.join(dir, process.platform === 'win32' ? 'piper.cmd' : 'piper');
  fs.writeFileSync(bin, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(log, '');
  const saved = { SFDEMO_PIPER: process.env.SFDEMO_PIPER, SFDEMO_VOICES: process.env.SFDEMO_VOICES, SFDEMO_FAKE_PIPER_LOG: process.env.SFDEMO_FAKE_PIPER_LOG };
  Object.assign(process.env, { SFDEMO_PIPER: bin, SFDEMO_VOICES: voicesDir, SFDEMO_FAKE_PIPER_LOG: log });
  return {
    dir, voicesDir, bin,
    calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)),
    restore() { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } },
  };
}
