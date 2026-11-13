/** The pixel size of the images and videos a recording writes, for tests that check what was cropped. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ffmpegBinary } from '../../src/engine/media.js';

export const gifSize = file => { const b = fs.readFileSync(file); return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }; };

export const pngSize = file => { const b = fs.readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };

/** From ffmpeg's banner, which it prints before failing for want of an output; null when it shows no video. */
export function videoSize(file) {
  let banner = '';
  try { execFileSync(ffmpegBinary(), ['-hide_banner', '-i', file], { stdio: 'pipe' }); } catch (e) { banner = String(e.stderr); }
  const m = banner.match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}
