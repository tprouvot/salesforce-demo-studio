/**
 * What a recorded window draws on top of the page, for the viewer: a mouse cursor (Playwright's videos have none), a
 * label in the corner naming the window ("Jordan · resident portal"), and a ring around what `point:` shows.
 * Functions evaluated in the page: self-contained, no imports.
 */

/** Installed in every page of a recorded window (an init script). */
export function installOverlay({ label }) {
  if (window !== window.top) return; // one cursor, in the top page: the recorder moves it over frames too
  // pages made to open as popups (the Developer Console) resize their window, and the video would keep only that part
  window.resizeTo = () => {};
  window.resizeBy = () => {};
  window.moveTo = () => {};
  const install = () => {
    if (document.getElementById('__sfdemoCursor')) return;
    const c = document.createElement('div');
    c.id = '__sfdemoCursor';
    c.style.cssText = 'position:fixed;left:-60px;top:-60px;width:26px;height:26px;z-index:2147483647;pointer-events:none;'
      + 'transition:left .35s ease-out,top .35s ease-out,transform .1s';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l6.5 19 2.7-7.6L21 11.2z" fill="#16325c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const move = e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mousedown', e => { move(e); c.style.transform = 'scale(.82)'; }, true);
    document.addEventListener('mouseup', () => { c.style.transform = ''; }, true);
    if (label) {
      const l = document.createElement('div');
      l.id = '__sfdemoLabel';
      l.textContent = label;
      l.style.cssText = 'position:fixed;left:14px;bottom:18px;z-index:2147483646;pointer-events:none;background:rgba(3,45,96,.9);'
        + 'color:#fff;font:600 15px/1.25 -apple-system,Helvetica,Arial,sans-serif;padding:7px 12px;border-radius:6px;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,.25)';
      document.documentElement.appendChild(l);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
}

/** A ring around a box of the page (CSS pixels), for `seconds`. */
export function drawRing({ x, y, width, height, seconds }) {
  const r = document.createElement('div');
  r.className = '__sfdemoRing';
  r.style.cssText = `position:fixed;left:${x - 8}px;top:${y - 6}px;width:${width + 16}px;height:${height + 12}px;z-index:2147483645;`
    + 'pointer-events:none;border:3px solid #fe9339;border-radius:10px;box-shadow:0 0 0 4px rgba(254,147,57,.25);transition:opacity .4s';
  document.documentElement.appendChild(r);
  setTimeout(() => { r.style.opacity = '0'; }, Math.max(seconds * 1000 - 400, 0));
  setTimeout(() => r.remove(), seconds * 1000);
}
