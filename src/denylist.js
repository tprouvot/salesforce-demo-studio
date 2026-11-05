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
  // both state folders (.sfdemo, and .afrec from the tool's former name) and both home folders: a list must never
  // go unread because the folder holding it was renamed, or because a new one appeared beside it
  const sibling = dir => path.join(path.dirname(dir), path.basename(dir) === '.sfdemo' ? '.afrec' : path.basename(dir) === '.afrec' ? '.sfdemo' : path.basename(dir));
  const home = homeDir();
  const files = [...new Set([stateDir, stateDir && sibling(stateDir), home, sibling(home)].filter(Boolean).map(d => path.join(d, 'denylist.txt')))];
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
