/**
 * Terms that must never be published (customer names, program names, org domains, agent names): one per line in
 * <project>/.sfdemo/denylist.txt or ~/.sfdemo/denylist.txt, `#` for comments. Both files stay local (.sfdemo is
 * gitignored, ~/.sfdemo is outside the repository). `sfdemo fixtures add`, `sfdemo heal` and the pre-commit hook
 * (scripts/check-denylist.js) refuse content that contains one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './config.js';

export function loadDenylist(stateDir) {
  const files = [stateDir ? path.join(stateDir, 'denylist.txt') : null, path.join(homeDir(), 'denylist.txt')].filter(Boolean);
  const terms = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.replace(/#.*$/, '').trim();
      if (t) terms.add(t);
    }
  }
  return [...terms];
}
