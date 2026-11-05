/**
 * A fake VS Code for the tests: an executable that takes VS Code's command line (its profile, the debugging port,
 * the folder) and opens headless Chromium on a stand-in workbench (fake-editor/workbench.html), and a fake `code`
 * command line next to it (bin/code) that "installs" extensions into the profile. POSIX only (shell scripts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-editor', 'workbench.html');
export const fakeEditorSupported = process.platform !== 'win32';

/**
 * Installs the fake editor; SFDEMO_VSCODE points to it, SFDEMO_HOME to a fresh folder (the demo profiles).
 * @param {{ wall?: boolean }} [options] wall: the editor shows a login screen (as Cursor does before a login)
 */
export function installFakeEditor({ wall = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdemo-fake-editor-'));
  const app = path.join(dir, 'code-app');
  const calls = path.join(dir, 'calls.log');
  fs.writeFileSync(app, `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
port=""; ud=""; folder=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user-data-dir) ud="$2"; shift 2; continue;;
    --extensions-dir|--disable-extension) shift 2; continue;;
    --remote-debugging-port=*) port="\${1#*=}";;
    --*) ;;
    *) folder="$1";;
  esac
  shift
done
exec "${chromium.executablePath()}" --headless=new --no-first-run --no-default-browser-check --user-data-dir="$ud/fake-chromium" --remote-debugging-port="$port" "file://${PAGE}?folder=$folder&wall=${wall ? 1 : 0}"
`);
  fs.chmodSync(app, 0o755);
  fs.mkdirSync(path.join(dir, 'bin'));
  const cli = path.join(dir, 'bin', 'code');
  fs.writeFileSync(cli, `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, 'cli ' + a.join(' ') + '\\n');
const dir = a[a.indexOf('--extensions-dir') + 1];
const list = path.join(dir, 'extensions.json');
const have = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
a.forEach((x, i) => { if (x === '--install-extension') have.push({ identifier: { id: a[i + 1] } }); });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(list, JSON.stringify(have));
`);
  fs.chmodSync(cli, 0o755);
  const saved = { vscode: process.env.SFDEMO_VSCODE, home: process.env.SFDEMO_HOME };
  process.env.SFDEMO_VSCODE = app;
  process.env.SFDEMO_HOME = path.join(dir, 'home');
  return {
    dir,
    calls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []),
    restore() {
      for (const [k, v] of [['SFDEMO_VSCODE', saved.vscode], ['SFDEMO_HOME', saved.home]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
