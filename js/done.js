/* "Done" button in the top bar. It opens a popup that shows how long the calculator
 * has been in use since the page loaded, when that was, the top bar's logo and a
 * message set in the Appearance panel, so a student can show it to their teacher. */
(function (root) {
  'use strict';

  function elapsed(start, now) {
    const m = Math.max(0, Math.floor((now - start) / 60000));
    return m + (m === 1 ? ' minute' : ' minutes');
  }
  function startTime(d) {
    const pad = n => String(n).padStart(2, '0');
    const h = d.getHours();
    return (h % 12 || 12) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + (h < 12 ? ' AM' : ' PM');
  }
  function paragraphs(text) {
    return String(text == null ? '' : text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  }

  const api = { elapsed, startTime, paragraphs };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  const started = new Date();
  const btn = document.getElementById('btn-done');
  const dlg = document.getElementById('done-dialog');
  const mins = dlg.querySelector('.dd-minutes');
  let tick = null;

  function show() {
    const brand = root.__branding ? root.__branding.get() : {};
    mins.textContent = elapsed(started, new Date());
    dlg.querySelector('.dd-start').textContent = 'Start time: ' + startTime(started);
    const logo = dlg.querySelector('.dd-logo');
    // the logo the top bar shows: the top-left one, or else the centre icon
    const src = brand.showLogo !== false ? brand.logo || 'assets/logo.svg' : brand.centerIcon;
    if (src) logo.src = src; else logo.removeAttribute('src');
    logo.classList.toggle('hidden', !src);
    logo.style.background = brand.barColor || '';
    const msg = dlg.querySelector('.dd-message');
    msg.replaceChildren(...paragraphs(brand.doneMessage).map(t => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    }));
    clearInterval(tick);
    tick = setInterval(() => { mins.textContent = elapsed(started, new Date()); }, 1000);
    dlg.showModal();
    dlg.querySelector('.dd-continue').focus();
  }
  btn.addEventListener('click', show);
  dlg.addEventListener('close', () => { clearInterval(tick); tick = null; });
  dlg.querySelectorAll('.dd-x, .dd-continue').forEach(b => b.addEventListener('click', () => dlg.close()));
})(typeof window !== 'undefined' ? window : globalThis);
