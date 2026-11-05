/**
 * A small terminal screen: it takes what a command prints (text, colours, the cursor moves and line erases that
 * spinners and progress bars use) and keeps what a real terminal would show, to draw it as HTML in the filmed page.
 * It understands the usual escape sequences (SGR colours and styles, cursor moves, erase in line and display, save
 * and restore, hide and show the cursor); the others (titles, alternate screen, keypad modes) are read and ignored.
 * Full-screen programs (vim, top) are not its job: commands that print lines are.
 */

const ESC = '\x1b';
const MAX_LINES = 2000;
/** The 16 colours, as a dark terminal shows them (the light theme overrides them in CSS). */
const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]}]/g;

const blankStyle = () => ({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });
const styleKey = s => [s.fg ?? '', s.bg ?? '', s.bold ? 'b' : '', s.dim ? 'd' : '', s.italic ? 'i' : '', s.underline ? 'u' : '', s.inverse ? 'v' : ''].join('|');
const STYLES = new Map([['||||||', blankStyle()]]);
const keyOf = s => { const k = styleKey(s); if (!STYLES.has(k)) STYLES.set(k, { ...s }); return k; };
const PLAIN = '||||||';

/** The xterm 256-colour palette entry `n` above 15, as a CSS colour. */
function color256(n) {
  if (n < 232) {
    const i = n - 16;
    const level = v => (v ? 55 + v * 40 : 0);
    return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

export class Screen {
  /** @param {{ cols?: number, rows?: number }} [size] */
  constructor({ cols = 100, rows = 28 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.reset();
  }

  reset() {
    /** @type {{ c: string, k: string }[][]} */
    this.lines = [[]];
    this.row = 0;
    this.col = 0;
    this.style = blankStyle();
    this.key = PLAIN;
    this.saved = null;
    this.pending = '';
    this.cursorVisible = true;
  }

  /** The first line of the visible screen (the ones above are scrollback). */
  get top() { return Math.max(0, this.lines.length - this.rows); }

  /** Feeds what a program printed. Escape sequences cut between two chunks are completed by the next one. */
  write(data) {
    const s = this.pending + String(data);
    this.pending = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ESC) {
        const end = this.escape(s, i);
        if (end < 0) { this.pending = s.slice(i); break; }
        i = end;
        continue;
      }
      const code = s.charCodeAt(i);
      if (ch === '\r') this.col = 0;
      else if (ch === '\n' || ch === '\v' || ch === '\f') this.lineFeed();
      else if (ch === '\b') this.col = Math.max(0, this.col - 1);
      else if (ch === '\t') this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8);
      else if (code >= 0x20 && code !== 0x7f) {
        const cp = s.codePointAt(i) || code;
        const glyph = String.fromCodePoint(cp);
        this.put(glyph);
        i += glyph.length;
        continue;
      }
      i++;
    }
  }

  /** A new line: the cursor goes to the start of the next one (as a terminal does with its output translated). */
  lineFeed() {
    this.row++;
    while (this.lines.length <= this.row) this.lines.push([]);
    this.col = 0;
    if (this.lines.length > MAX_LINES) {
      const drop = this.lines.length - MAX_LINES;
      this.lines.splice(0, drop);
      this.row -= drop;
    }
  }

  put(glyph) {
    if (this.col >= this.cols) this.lineFeed();
    const line = this.lines[this.row];
    while (line.length < this.col) line.push({ c: ' ', k: PLAIN });
    line[this.col] = { c: glyph, k: this.key };
    this.col++;
  }

  /** Reads the escape sequence at `i`; returns the index after it, or -1 when it is not complete yet. */
  escape(s, i) {
    const next = s[i + 1];
    if (next === undefined) return -1;
    if (next === '[') {
      let j = i + 2;
      while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
      if (j >= s.length) return -1;
      this.csi(s.slice(i + 2, j), s[j]);
      return j + 1;
    }
    if (next === ']' || next === 'P' || next === '_' || next === '^') { // OSC, DCS...: up to BEL or ESC \
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === '\x07') return j + 1;
        if (s[j] === ESC && s[j + 1] === '\\') return j + 2;
        if (s[j] === ESC && s[j + 1] === undefined) return -1;
      }
      return -1;
    }
    if ('()*+'.includes(next)) return s.length > i + 2 ? i + 3 : -1; // character sets
    if (next === '7') this.saved = { row: this.row, col: this.col };
    else if (next === '8' && this.saved) ({ row: this.row, col: this.col } = this.saved);
    else if (next === 'M') this.row = Math.max(this.top, this.row - 1);
    else if (next === 'c') this.reset();
    return i + 2;
  }

  csi(params, final) {
    const priv = params.startsWith('?');
    const nums = params.replace(/^[?>=!]/, '').split(';').map(p => (p === '' ? NaN : Number(p)));
    const n = (k = 0, d = 1) => (Number.isFinite(nums[k]) && nums[k] > 0 ? nums[k] : d);
    const line = () => this.lines[this.row];
    switch (final) {
      case 'm': if (!priv) this.sgr(nums); break;
      case 'A': this.row = Math.max(this.top, this.row - n()); break;
      case 'B': this.row = Math.min(this.lines.length - 1, this.row + n()); break;
      case 'C': this.col = Math.min(this.cols - 1, this.col + n()); break;
      case 'D': this.col = Math.max(0, this.col - n()); break;
      case 'E': this.row = Math.min(this.lines.length - 1, this.row + n()); this.col = 0; break;
      case 'F': this.row = Math.max(this.top, this.row - n()); this.col = 0; break;
      case 'G': case '`': this.col = Math.min(this.cols - 1, n() - 1); break;
      case 'd': this.moveTo(n() - 1, this.col); break;
      case 'H': case 'f': this.moveTo(n(0) - 1, n(1) - 1); break;
      case 'K': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        const l = line();
        if (mode === 0) l.length = Math.min(l.length, this.col);
        else if (mode === 1) for (let c = 0; c <= this.col && c < l.length; c++) l[c] = { c: ' ', k: PLAIN };
        else l.length = 0;
        break;
      }
      case 'J': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        if (mode === 0) { line().length = Math.min(line().length, this.col); this.lines.length = this.row + 1; }
        else if (mode === 1) { for (let r = this.top; r < this.row; r++) this.lines[r] = []; }
        else if (mode === 2) { const top = this.top; for (let r = top; r < this.lines.length; r++) this.lines[r] = []; }
        else if (mode === 3) { const top = this.top; this.lines.splice(0, top); this.row = Math.max(0, this.row - top); }
        break;
      }
      case 'h': case 'l': if (priv && nums.includes(25)) this.cursorVisible = final === 'h'; break;
      case 's': this.saved = { row: this.row, col: this.col }; break;
      case 'u': if (this.saved) ({ row: this.row, col: this.col } = this.saved); break;
      default: break;
    }
  }

  /** Moves to a row and column of the visible screen (0-based), adding the lines it needs. */
  moveTo(r, c) {
    const target = this.top + Math.max(0, Math.min(this.rows - 1, r));
    while (this.lines.length <= target) this.lines.push([]);
    this.row = target;
    this.col = Math.max(0, Math.min(this.cols - 1, c));
  }

  sgr(nums) {
    const s = this.style;
    const list = nums.length ? nums : [0];
    for (let k = 0; k < list.length; k++) {
      const p = Number.isFinite(list[k]) ? list[k] : 0;
      if (p === 0) Object.assign(s, blankStyle());
      else if (p === 1) s.bold = true;
      else if (p === 2) s.dim = true;
      else if (p === 3) s.italic = true;
      else if (p === 4) s.underline = true;
      else if (p === 7) s.inverse = true;
      else if (p === 21 || p === 22) { s.bold = false; s.dim = false; }
      else if (p === 23) s.italic = false;
      else if (p === 24) s.underline = false;
      else if (p === 27) s.inverse = false;
      else if (p >= 30 && p <= 37) s.fg = p - 30;
      else if (p >= 90 && p <= 97) s.fg = p - 90 + 8;
      else if (p === 39) s.fg = null;
      else if (p >= 40 && p <= 47) s.bg = p - 40;
      else if (p >= 100 && p <= 107) s.bg = p - 100 + 8;
      else if (p === 49) s.bg = null;
      else if (p === 38 || p === 48) {
        const which = p === 38 ? 'fg' : 'bg';
        if (list[k + 1] === 5 && Number.isFinite(list[k + 2])) { const c = list[k + 2]; s[which] = c < 16 ? c : color256(c); k += 2; }
        else if (list[k + 1] === 2 && list.slice(k + 2, k + 5).every(Number.isFinite)) { s[which] = `rgb(${list.slice(k + 2, k + 5).join(',')})`; k += 4; }
      }
    }
    this.key = keyOf(s);
  }

  /** The text of every line, as shown (trailing blank lines left out). */
  text() {
    const lines = this.lines.map(l => l.map(c => c.c).join('').replace(/\s+$/, ''));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
  }

  /** The links printed so far, in order. */
  links() { return [...this.text().matchAll(URL_RE)].map(m => m[0]); }

  /**
   * The screen as HTML: one div per line, runs of the same style as spans (class f0..f15 / b0..b15 for the 16
   * colours, inline colours for the others), links underlined, the cursor as a block when `cursor` is true.
   * @param {{ cursor?: boolean, last?: number }} [options] last: how many lines at most (the newest)
   */
  html({ cursor = false, last = 400 } = {}) {
    let end = this.lines.length;
    while (end > this.row + 1 && !this.lines[end - 1].length) end--;
    const start = Math.max(0, end - last);
    const out = [];
    for (let r = start; r < end; r++) {
      const cells = this.lines[r].slice();
      const showCursor = cursor && this.cursorVisible && r === this.row;
      if (showCursor) while (cells.length <= this.col) cells.push({ c: ' ', k: PLAIN });
      const text = cells.map(c => c.c).join('');
      const link = new Array(cells.length).fill(false);
      for (const m of text.matchAll(URL_RE)) {
        // indices of the joined text are in UTF-16 units; cells hold one code point each
        const before = Array.from(text.slice(0, m.index)).length;
        const len = Array.from(m[0]).length;
        for (let c = before; c < before + len && c < link.length; c++) link[c] = true;
      }
      let html = '';
      let run = '';
      let runKey = null;
      const flush = () => { if (runKey !== null && run) html += span(runKey, run); run = ''; };
      cells.forEach((cell, c) => {
        const k = `${cell.k}#${link[c] ? 'L' : ''}#${showCursor && c === this.col ? 'C' : ''}`;
        if (k !== runKey) { flush(); runKey = k; }
        run += cell.c;
      });
      flush();
      out.push(`<div class="l">${html || ' '}</div>`);
    }
    return out.join('');
  }
}

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function span(key, text) {
  const [styleId, link, cur] = key.split('#');
  const s = STYLES.get(styleId) || blankStyle();
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) { [fg, bg] = [bg ?? 'fg', fg ?? 'bg']; }
  const classes = [];
  const css = [];
  const paint = (v, prefix, prop) => {
    if (v === null || v === undefined) return;
    if (v === 'fg' || v === 'bg') classes.push(`${prefix}${v === 'fg' ? 'd' : 'k'}`);
    else if (typeof v === 'number') classes.push(`${prefix}${v}`);
    else css.push(`${prop}:${v}`);
  };
  paint(fg, 'f', 'color');
  paint(bg, 'b', 'background');
  if (s.bold) classes.push('bo');
  if (s.dim) classes.push('di');
  if (s.italic) classes.push('it');
  if (s.underline || link) classes.push('un');
  if (link) classes.push('ln');
  if (cur) classes.push('cur');
  if (!classes.length && !css.length) return escapeHtml(text);
  return `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}>${escapeHtml(text)}</span>`;
}
