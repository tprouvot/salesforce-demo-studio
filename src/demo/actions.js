/**
 * The live steps of a demo, in a signed-in window: open a page, a Setup page (through Quick Find, as a presenter
 * would) or a record, click, fill a field, pick an option, press a key, scroll, wait for a text, point at something,
 * and run Apex in the Developer Console. Every element is found by what the viewer sees (its label, its text, its
 * role), in the page and in its frames (Setup shows many pages in an iframe). The drawn cursor moves to each target
 * before acting, so the viewer can follow.
 */
import { findVisible, labelCandidates } from '../selectors/locate.js';
import { drawRing } from './overlay.js';
import { query, soqlString } from '../engine/salesforce.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TYPE_DELAY = 45;

/** Where a step looks: the page, then each of its frames. */
export const scopesOf = page => [page, ...page.frames().filter(f => f !== page.mainFrame() && !f.isDetached())];

/** Moves the drawn cursor (and the mouse) to a point of the page, smoothly. */
export async function moveCursor(page, x, y) {
  await page.mouse.move(x, y, { steps: 14 });
  await page.evaluate(([cx, cy]) => {
    const c = document.getElementById('__sfdemoCursor');
    if (c) { c.style.left = cx + 'px'; c.style.top = cy + 'px'; }
  }, [x, y]).catch(() => {});
}

/** Pages that never load anything to wait for (editor windows, terminals): a beat for the viewer is enough. */
export const quietPages = new WeakSet();

/** Lets the page settle after an action: its load, then a beat for the viewer. */
export async function settle(page, ms = 1200) {
  if (!quietPages.has(page)) {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }
  await sleep(ms);
}

async function find(w, candidates, what, timeout = 15000) {
  const scopes = w.scopes ? await w.scopes() : scopesOf(w.page);
  const hit = await findVisible(scopes, candidates, { timeout });
  if (!hit) throw new Error(`no ${what} visible in ${w.name} after ${Math.round(timeout / 1000)} s`);
  return hit.locator;
}

async function aim(w, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (box) { await moveCursor(w.page, box.x + Math.min(box.width / 2, 60), box.y + box.height / 2); await sleep(350); }
  return box;
}

/** A label's candidates, the exact ones first: "Manage" is the Manage link, not the Object Manager tab. */
export function labelFirstExact(label) {
  if (/^\/.+\/[a-z]*$/.test(label)) return labelCandidates(label);
  return [...labelCandidates(`/^\\s*${escapeRe(label)}\\s*$/`), ...labelCandidates(label)];
}

const fieldCandidates = field => {
  const f = escapeRe(field);
  return [{ label: `^\\s*\\*?\\s*${f}\\s*$` }, { role: 'textbox', name: `^\\s*\\*?\\s*${f}` }, { role: 'combobox', name: `^\\s*\\*?\\s*${f}` }, { label: f }, { role: 'textbox', name: f }, { css: `[placeholder="${String(field).replace(/"/g, '\\"')}" i]` }];
};

export async function click(w, label) {
  const target = await find(w, labelFirstExact(label), `button or link "${label}"`);
  await aim(w, target);
  await target.click({ timeout: 10000 });
  await settle(w.page);
}

/** Types `value` into the field labeled `field`, visibly (one key at a time). */
export async function fill(w, field, value) {
  const target = await find(w, fieldCandidates(field), `field "${field}"`);
  await aim(w, target);
  await target.click({ timeout: 10000 });
  await target.fill('');
  await target.pressSequentially(String(value), { delay: TYPE_DELAY });
  await sleep(500);
}

/** Picks `value` in the field labeled `field`: a native select, or a Lightning combobox (open it, click the option). */
export async function select(w, field, value) {
  const target = await find(w, [{ role: 'combobox', name: escapeRe(field) }, ...fieldCandidates(field)], `field "${field}"`);
  await aim(w, target);
  if (await target.evaluate(el => el.tagName === 'SELECT').catch(() => false)) {
    await target.selectOption({ label: value });
  } else {
    await target.click({ timeout: 10000 });
    await sleep(700);
    const option = await find(w, [{ role: 'option', name: `^\\s*${escapeRe(value)}\\s*$` }, { role: 'option', name: escapeRe(value) }, { role: 'menuitemradio', name: escapeRe(value) }], `option "${value}" of ${field}`, 8000);
    await aim(w, option);
    await option.click({ timeout: 10000 });
  }
  await sleep(600);
}

export async function press(w, key) {
  await w.page.keyboard.press(key);
  await settle(w.page, 800);
}

/** down, up, top, bottom, or a text to bring into view. */
export async function scroll(w, target) {
  const v = w.page.viewportSize() || { width: 1440, height: 810 };
  const t = String(target).toLowerCase();
  if (['down', 'up'].includes(t)) {
    await moveCursor(w.page, v.width / 2, v.height / 2);
    for (let i = 0; i < 6; i++) { await w.page.mouse.wheel(0, t === 'down' ? 110 : -110); await sleep(60); }
  } else if (['top', 'bottom'].includes(t)) {
    await w.page.keyboard.press(t === 'top' ? 'Home' : 'End');
  } else {
    const hit = await find(w, [{ text: escapeRe(target) }], `text "${target}"`, 10000);
    await hit.scrollIntoViewIfNeeded({ timeout: 5000 });
  }
  await sleep(900);
}

/** Waits until `text` shows, in the page or a frame. */
export async function waitFor(w, text, seconds = 45) {
  await find(w, [{ text: escapeRe(text) }], `text "${text}"`, seconds * 1000);
  await sleep(500);
}

/** Moves the cursor to what is labeled `label` (or shows that text) and rings it, without clicking. */
export async function point(w, label, seconds = 2.2) {
  const target = await find(w, [...labelFirstExact(label), { text: `^\\s*${escapeRe(label)}\\s*$` }, { text: escapeRe(label) }], `"${label}"`);
  const box = await aim(w, target);
  if (box) await w.page.evaluate(drawRing, { ...box, seconds }).catch(() => {});
  await sleep(seconds * 1000);
}

/** A path (/lightning/...), a URL, or the label of a tab or link to click. */
export async function open(w, target) {
  if (/^https?:\/\//i.test(target) || target.startsWith('/')) {
    await w.page.goto(target.startsWith('/') ? w.base + target : target, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(w.page, 2500);
    return;
  }
  await click(w, target);
}

/** Opens a Setup page the way a presenter does: Setup, then its name in Quick Find, then the result. */
export async function setup(w, pageName) {
  if (!/\/lightning\/setup\//.test(w.page.url())) {
    await w.page.goto(w.base + '/lightning/setup/SetupOneHome/home', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await settle(w.page, 2500);
  }
  const quickFind = await find(w, [{ css: 'input[placeholder="Quick Find"]' }, { role: 'searchbox', name: 'Quick Find' }, { label: '^Quick Find$' }], 'Quick Find box', 30000);
  await aim(w, quickFind);
  await quickFind.click();
  await quickFind.fill('');
  await quickFind.pressSequentially(pageName, { delay: TYPE_DELAY + 15 });
  await sleep(1200);
  const name = escapeRe(pageName);
  const result = await find(w, [{ role: 'link', name: `^\\s*${name}\\s*$` }, { role: 'treeitem', name: `^\\s*${name}\\s*$` }, { role: 'link', name }], `Setup page "${pageName}" in Quick Find`, 10000);
  await aim(w, result);
  await result.click();
  await settle(w.page, 3500);
}

/** Opens the record of `object` named `name` (the newest one when several share it), found with SOQL. */
export async function record(w, object, name) {
  if (!w.conv || !w.conv.org) throw new Error(`record: needs a window signed in to an org (${w.name} has none)`);
  if (!/^\w+$/.test(object)) throw new Error(`record: "${object}" is not an object API name (Account, Case, MyObject__c)`);
  const rows = await query(w.conv.org, `SELECT Id FROM ${object} WHERE Name = ${soqlString(name)} ORDER BY CreatedDate DESC LIMIT 1`);
  if (!rows.length) throw new Error(`no ${object} named "${name}" in ${w.conv.org}`);
  await open(w, `/lightning/r/${object}/${rows[0].Id}/view`);
}

/**
 * Runs Apex in the Developer Console, in the window's own tab: Execute Anonymous, then the log, filtered to the
 * debug lines. Keys are typed only once the focus is checked to be inside the "Enter Apex Code" window: the console
 * also shows the classes left open in it, and typing there would edit one (nothing is ever saved: no save shortcut).
 */
export async function apex(w, code) {
  const origin = w.classicBase || w.base;
  await w.page.goto(origin + '/_ui/common/apex/debug/ApexCSIPage', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(w.page, 4000);
  const debug = await find(w, [{ text: '^Debug$' }, { role: 'button', name: '^Debug$' }], 'Debug menu of the Developer Console', 60000);
  await aim(w, debug);
  await debug.click();
  await sleep(700);
  const openWindow = await find(w, [{ text: '^Open Execute Anonymous Window' }, { role: 'menuitem', name: 'Open Execute Anonymous Window' }], 'menu item "Open Execute Anonymous Window"', 10000);
  await aim(w, openWindow);
  await openWindow.click();
  const dialog = w.page.locator('div.x-window').filter({ has: w.page.getByText('Enter Apex Code', { exact: true }) }).last();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await sleep(800);
  const editor = dialog.locator('.CodeMirror').first();
  await aim(w, editor);
  await editor.click();
  if (!(await dialog.evaluate(d => d.contains(document.activeElement)).catch(() => false))) throw new Error('the Execute Anonymous editor did not take the focus: nothing was typed');
  await w.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await w.page.keyboard.press('Backspace');
  for (const line of String(code).split('\n')) {
    if (!(await dialog.evaluate(d => d.contains(document.activeElement)).catch(() => false))) throw new Error('the Execute Anonymous editor lost the focus: typing stopped');
    await w.page.keyboard.type(line.trimStart(), { delay: 18 });
    await w.page.keyboard.press('Enter');
  }
  await sleep(600);
  const openLog = dialog.getByText('Open Log', { exact: true }).first();
  const box = dialog.locator('input[type="checkbox"], .x-form-checkbox').first();
  if (await box.isVisible().catch(() => false) && !(await box.isChecked().catch(() => false))) { await aim(w, openLog); await box.click().catch(() => openLog.click()); }
  const execute = dialog.getByText('Execute', { exact: true }).first();
  await aim(w, execute);
  await execute.click();
  const debugOnly = await find(w, [{ text: '^Debug Only$' }, { role: 'checkbox', name: 'Debug Only' }], 'the log ("Debug Only")', 90000);
  await sleep(1500);
  await aim(w, debugOnly);
  await debugOnly.click();
  await sleep(2500);
}

/**
 * Runs one live step (not a message or a check) in window `w`. A terminal or editor window plays its own steps
 * first (run, type, open a file, a command...); what it leaves (click, point, wait for...) works on any page.
 */
export async function runAction(w, step) {
  if (w.act && await w.act(step)) return undefined;
  switch (step.type) {
    case 'open': return open(w, step.target);
    case 'setup': return setup(w, step.page);
    case 'record': return record(w, step.object, step.name);
    case 'click': return w.surface && w.chatClick ? w.chatClick(step.label) : click(w, step.label);
    case 'fill': return fill(w, step.field, step.value);
    case 'select': return select(w, step.field, step.value);
    case 'press': return press(w, step.key);
    case 'type': await w.page.keyboard.type(String(step.text), { delay: TYPE_DELAY }); return sleep(400);
    case 'scroll': return scroll(w, step.target);
    case 'wait-for': return waitFor(w, step.text);
    case 'point': return point(w, step.label);
    case 'apex': return apex(w, step.code);
    default: throw new Error(`${step.where}: no live step "${step.type}"`);
  }
}
