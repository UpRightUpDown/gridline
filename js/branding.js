/* Branding panel: change the top bar colour, logo, name, header text and
 * "powered by" text. Open it with Ctrl+Shift+` (Cmd+Shift+` on a Mac). Settings are
 * shared by every device through the worker in worker/, and cached in this browser's
 * local storage so the page shows them before the shared copy arrives. */
(function () {
  'use strict';
  const KEY = 'gridline-branding-v1';
  const DEFAULTS = {
    barColor: '#2f4858',
    textColor: '#ffffff',
    logo: '',            // data: URL of an uploaded image; empty means the built-in logo
    showLogo: true,
    name: 'gridline',
    nameBold: true,
    centerIcon: '',      // data: URL; empty means no centre icon
    centerSize: 32,
    centerText: '',
    title: 'Graphing Calculator',
    subtitle: '',
    powered: 'gridline',
    doneMessage: 'If you’re done, show this screen to your teacher. Press “Continue Session” to return to the calculator.'
  };
  const DEFAULT_LOGO = 'assets/logo.svg';
  const MAX_LOGO_BYTES = 1024 * 1024; // size of a saved image's data: URL
  const LOGO_HEIGHT = 176;             // 4x the tallest an image is shown, for sharp high-DPI screens
  const LOGO_WIDTH = 1600;
  const HEX = /^#[0-9a-f]{6}$/i;
  const IMAGE_URL = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/;
  const REMOTE = 'https://gridline-settings.uprightupdown.workers.dev/branding';
  const PUSH_DELAY = 800;

  let brand = load();
  let edited = false;     // changed here since the last shared copy arrived
  let pushTimer = null;
  let warned = false;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === 'object') return sanitize(Object.assign({}, DEFAULTS, saved));
    } catch (e) { /* storage unavailable or corrupt */ }
    return Object.assign({}, DEFAULTS);
  }
  function cache() {
    try { localStorage.setItem(KEY, JSON.stringify(brand)); return true; }
    catch (e) { return false; }
  }
  function save() {
    edited = true;
    cache();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  }
  // send the settings to the shared store, a moment after the last change
  function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    fetch(REMOTE, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brand) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); edited = false; })
      .catch(() => {
        if (warned) return;
        warned = true;
        alert('Could not save the appearance for other devices. The change shows on this device only.');
      });
  }
  // fetch the shared settings, unless there are changes here still to send
  function pull() {
    if (panel || pushTimer || edited) return;
    fetch(REMOTE, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || typeof data !== 'object' || !Object.keys(data).length) return;
        if (panel || pushTimer || edited) return;
        brand = sanitize(Object.assign({}, DEFAULTS, data));
        cache();
        apply();
      })
      .catch(() => { /* offline or blocked: keep the cached settings */ });
  }
  function sanitize(b) {
    if (!HEX.test(b.barColor)) b.barColor = DEFAULTS.barColor;
    if (!HEX.test(b.textColor)) b.textColor = DEFAULTS.textColor;
    for (const k of ['logo', 'centerIcon']) {
      if (typeof b[k] !== 'string' || (b[k] && !IMAGE_URL.test(b[k]))) b[k] = '';
    }
    b.nameBold = b.nameBold !== false;
    b.centerSize = Math.min(44, Math.max(16, Number(b.centerSize) || DEFAULTS.centerSize));
    for (const k of ['name', 'title', 'subtitle', 'powered', 'centerText']) b[k] = String(b[k] == null ? '' : b[k]).slice(0, 80);
    b.doneMessage = String(b.doneMessage == null ? '' : b.doneMessage).slice(0, 500);
    b.showLogo = b.showLogo !== false;
    return b;
  }

  // ------------------------------------------------------------ apply
  const $ = s => document.querySelector(s);
  function apply() {
    const bar = $('.topbar');
    bar.style.background = brand.barColor;
    bar.style.color = brand.textColor;
    $('.brand').style.color = brand.textColor;
    $('.brand').setAttribute('aria-label', brand.name || 'Home');
    const logo = $('.brand-logo');
    logo.src = brand.logo || DEFAULT_LOGO;
    logo.classList.toggle('hidden', !brand.showLogo);
    $('.wordmark').textContent = brand.name;
    $('.wordmark').style.fontWeight = brand.nameBold ? '600' : '300';
    const center = $('.topbar-center');
    if (brand.centerIcon) center.src = brand.centerIcon; else center.removeAttribute('src');
    center.style.height = brand.centerSize + 'px';
    center.classList.toggle('hidden', !brand.centerIcon);
    const cText = $('.topbar-center-text');
    cText.textContent = brand.centerText;
    cText.classList.toggle('hidden', !brand.centerText);
    $('.topbar-center-group').classList.toggle('hidden', !brand.centerIcon && !brand.centerText);
    $('.wordmark').classList.toggle('hidden', !brand.name);
    $('.topbar-title').textContent = brand.title;
    $('.topbar-title').classList.toggle('hidden', !brand.title);
    $('.topbar-sep:not(.sub-sep)').classList.toggle('hidden', !brand.title || (!brand.name && !brand.showLogo));
    $('.topbar-subtitle').textContent = brand.subtitle;
    $('.topbar-subtitle').classList.toggle('hidden', !brand.subtitle);
    $('.sub-sep').classList.toggle('hidden', !brand.subtitle);
    document.querySelectorAll('.topbar-sep').forEach(s => { s.style.background = brand.textColor; s.style.opacity = '0.45'; });
    $('.powered-name').textContent = brand.powered;
    $('.powered').classList.toggle('hidden', !brand.powered);
    document.title = [brand.name, brand.title].filter(Boolean).join(' ') || 'Graphing Calculator';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = brand.logo || DEFAULT_LOGO;
  }

  // ------------------------------------------------------------ panel
  let panel = null;
  // Read a chosen image file as a data: URL. The top bar shows images at most
  // 44px tall, so a large photo or PNG is scaled down to LOGO_HEIGHT first;
  // that keeps the saved settings small enough for browser storage and the worker.
  // A newer upload, "Use default", "Remove" or a reset cancels a read still in progress.
  const uploadGen = { logo: 0, center: 0 }; // one counter per image slot
  function readImage(slot, input, done) {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.type)) { alert('Please choose a PNG, JPEG, GIF, WebP or SVG image.'); return; }
    if (f.type === 'image/svg+xml' && f.size > MAX_LOGO_BYTES) { alert('Please choose an SVG under 1 MB.'); return; }
    const gen = ++uploadGen[slot];
    const finish = url => { if (gen === uploadGen[slot]) done(url); };
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (f.type === 'image/svg+xml') { finish(url); return; }
      const img = new Image();
      img.onload = () => {
        let scale = Math.min(1, LOGO_HEIGHT / img.naturalHeight, LOGO_WIDTH / img.naturalWidth);
        const canvas = document.createElement('canvas');
        for (;;) {
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          let small = canvas.toDataURL('image/png');
          if (small.length > MAX_LOGO_BYTES) small = canvas.toDataURL('image/webp', 0.9); // lossy, keeps transparency
          if (small.length <= MAX_LOGO_BYTES) { finish(small); return; }
          // still too big (for example no WebP encoder): try again at half the size, down to the shown height
          if (canvas.height <= 44) { alert('That image is too detailed to save. Please try a simpler one.'); return; }
          scale /= 2;
        }
      };
      img.onerror = () => alert('That image could not be read. Please try another file.');
      img.src = url;
    };
    reader.readAsDataURL(f);
  }
  function field(label, input, hint) {
    const row = document.createElement('label');
    row.className = 'bp-field';
    const span = document.createElement('span');
    span.className = 'bp-label';
    span.textContent = label;
    row.append(span, input);
    if (hint) { const h = document.createElement('span'); h.className = 'bp-hint'; h.textContent = hint; row.append(h); }
    return row;
  }
  function textInput(key, placeholder) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 80; inp.value = brand[key]; inp.placeholder = placeholder || '';
    inp.addEventListener('input', () => { brand[key] = inp.value; apply(); save(); });
    return inp;
  }
  function doneInput() {
    const ta = document.createElement('textarea');
    ta.maxLength = 500; ta.rows = 4; ta.value = brand.doneMessage;
    ta.addEventListener('input', () => { brand.doneMessage = ta.value; save(); });
    return ta;
  }
  function colorInput(key) {
    const wrap = document.createElement('span');
    wrap.className = 'bp-color';
    const pick = document.createElement('input');
    pick.type = 'color'; pick.value = brand[key];
    const hex = document.createElement('input');
    hex.type = 'text'; hex.value = brand[key]; hex.maxLength = 7; hex.spellcheck = false;
    pick.addEventListener('input', () => { brand[key] = pick.value; hex.value = pick.value; apply(); save(); });
    hex.addEventListener('input', () => {
      const v = hex.value.startsWith('#') ? hex.value : '#' + hex.value;
      if (HEX.test(v)) { brand[key] = v.toLowerCase(); pick.value = brand[key]; apply(); save(); }
    });
    wrap.append(pick, hex);
    return wrap;
  }

  // Reference material for Ask Claude: a list of the shared files, each with Remove, and an
  // upload button. Changes go straight to the shared store (window.GRefs, js/references.js).
  function refsBox() {
    const box = document.createElement('div');
    box.className = 'bp-refs';
    const list = document.createElement('ul');
    const status = document.createElement('span');
    status.className = 'bp-hint';
    status.setAttribute('role', 'status');
    const file = document.createElement('input');
    file.type = 'file'; file.multiple = true; file.className = 'hidden';
    file.accept = '.pdf,.txt,.md,.csv,.tex,application/pdf,text/plain,image/png,image/jpeg,image/gif,image/webp';
    const upload = document.createElement('button');
    upload.textContent = 'Upload files…';
    const empty = document.createElement('span');
    empty.className = 'bp-hint hidden';
    empty.textContent = 'No files yet.';
    const say = text => { status.textContent = text; };
    // The list is loaded once when the panel opens, then kept here: the store's own list can
    // take up to a minute to show a change.
    let items = [];
    const render = () => {
      list.replaceChildren(...items.map(r => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = r.name;
        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.setAttribute('aria-label', 'Remove ' + r.name);
        rm.addEventListener('click', async () => {
          rm.disabled = true;
          try { await window.GRefs.remove(r.id); items = items.filter(i => i.id !== r.id); render(); say(''); }
          catch (e) { rm.disabled = false; say(e.message); }
        });
        li.append(name, rm);
        return li;
      }));
      list.classList.toggle('hidden', !items.length);
      empty.classList.toggle('hidden', !!items.length);
    };
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const files = Array.from(file.files);
      file.value = '';
      upload.disabled = true;
      for (const f of files) {
        say('Uploading ' + f.name + '…');
        try { items.push(await window.GRefs.add(await window.GRefs.readFile(f))); render(); }
        catch (e) { say(f.name + ': ' + e.message); upload.disabled = false; return; }
      }
      upload.disabled = false;
      say('');
    });
    say('Loading…');
    upload.disabled = true;
    window.GRefs.list()
      .then(loaded => { items = loaded; render(); say(''); upload.disabled = false; })
      .catch(e => say(e.message));
    box.append(list, empty, upload, file, status);
    return box;
  }

  // A div, not field()'s <label>: a click on a label's text would press its first button, Remove.
  function refsField() {
    const row = field('Reference material for Ask Claude', refsBox(), 'PDFs, text files or images showing the methods you teach. Claude uses them to choose how to solve a problem but never mentions them. Shared by every device; up to 5 MB in all.');
    const div = document.createElement('div');
    div.className = row.className;
    div.append(...row.childNodes);
    return div;
  }

  function open() {
    if (panel) { close(); return; }
    panel = document.createElement('div');
    panel.className = 'bp-backdrop';
    panel.innerHTML = '<div class="bp" role="dialog" aria-modal="true" aria-labelledby="bp-h"><div class="bp-head"><h2 id="bp-h">Appearance</h2><button class="bp-x" aria-label="Close">×</button></div><div class="bp-body"></div><div class="bp-foot"><button class="bp-reset">Reset to defaults</button><button class="bp-done">Done</button></div></div>';
    const body = panel.querySelector('.bp-body');

    // logo
    const logoBox = document.createElement('div');
    logoBox.className = 'bp-logo';
    const prev = document.createElement('img');
    prev.alt = '';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    file.className = 'hidden';
    const upload = document.createElement('button'); upload.textContent = 'Upload image…';
    const def = document.createElement('button'); def.textContent = 'Use default';
    const show = document.createElement('label'); show.className = 'check';
    const showCb = document.createElement('input'); showCb.type = 'checkbox'; showCb.checked = brand.showLogo;
    show.append(showCb, ' Show logo');
    const syncPrev = () => { prev.src = brand.logo || DEFAULT_LOGO; prev.style.background = brand.barColor; };
    syncPrev();
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', () => readImage('logo', file, url => {
      brand.logo = url; sanitize(brand); brand.showLogo = true; showCb.checked = true; apply(); save(); syncPrev();
    }));
    def.addEventListener('click', () => { uploadGen.logo++; brand.logo = ''; apply(); save(); syncPrev(); });
    showCb.addEventListener('change', () => { brand.showLogo = showCb.checked; apply(); save(); });
    logoBox.append(prev, upload, def, file, show);

    // name, with a bold toggle
    const nameBox = document.createElement('div');
    nameBox.className = 'bp-inline';
    const boldLbl = document.createElement('label'); boldLbl.className = 'check';
    const boldCb = document.createElement('input'); boldCb.type = 'checkbox'; boldCb.checked = brand.nameBold;
    boldLbl.append(boldCb, ' Bold');
    boldCb.addEventListener('change', () => { brand.nameBold = boldCb.checked; apply(); save(); });
    nameBox.append(textInput('name', 'Shown next to the logo'), boldLbl);

    // icon in the centre of the top bar
    const cBox = document.createElement('div');
    cBox.className = 'bp-logo';
    const cPrev = document.createElement('img'); cPrev.alt = '';
    const cFile = document.createElement('input');
    cFile.type = 'file'; cFile.accept = file.accept; cFile.className = 'hidden';
    const cUpload = document.createElement('button'); cUpload.textContent = 'Upload image…';
    const cRemove = document.createElement('button'); cRemove.textContent = 'Remove';
    const cSizeLbl = document.createElement('label'); cSizeLbl.className = 'check';
    const cSize = document.createElement('input');
    cSize.type = 'range'; cSize.min = 16; cSize.max = 44; cSize.step = 1; cSize.value = brand.centerSize;
    cSizeLbl.append('Size ', cSize);
    const syncCenter = () => {
      cPrev.classList.toggle('hidden', !brand.centerIcon);
      if (brand.centerIcon) cPrev.src = brand.centerIcon;
      cPrev.style.background = brand.barColor;
      cRemove.disabled = !brand.centerIcon;
      cSizeLbl.classList.toggle('hidden', !brand.centerIcon);
    };
    syncCenter();
    cUpload.addEventListener('click', () => cFile.click());
    cFile.addEventListener('change', () => readImage('center', cFile, url => { brand.centerIcon = url; sanitize(brand); apply(); save(); syncCenter(); }));
    cRemove.addEventListener('click', () => { uploadGen.center++; brand.centerIcon = ''; apply(); save(); syncCenter(); });
    cSize.addEventListener('input', () => { brand.centerSize = Number(cSize.value); apply(); save(); });
    cBox.append(cPrev, cUpload, cRemove, cFile, cSizeLbl);

    const barColor = colorInput('barColor');
    barColor.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { syncPrev(); syncCenter(); }));
    body.append(
      field('Top bar colour', barColor),
      field('Top bar text colour', colorInput('textColor')),
      field('Logo', logoBox),
      field('Name', nameBox),
      field('Centre icon', cBox, 'Shown in the middle of the top bar. Separate from the logo at the top left.'),
      field('Centre text', textInput('centerText', 'Optional'), 'Shown to the right of the centre icon, in the same style as the "powered by" name. The icon and text are centred together.'),
      field('Header text', textInput('title', 'e.g. Graphing Calculator')),
      field('Second header text', textInput('subtitle', 'Optional'), 'Shown after another divider. Leave blank to hide it.'),
      field('Powered by', textInput('powered', 'Name under "powered by"'), 'Leave blank to hide the "powered by" line.'),
      field('Done popup message', doneInput(), 'Shown when someone clicks Done at the top right. Leave a blank line to start a new paragraph.'),
      refsField()
    );

    panel.querySelector('.bp-x').addEventListener('click', close);
    panel.querySelector('.bp-done').addEventListener('click', close);
    panel.querySelector('.bp-reset').addEventListener('click', () => {
      if (!confirm('Reset the top bar, logo and text to the defaults?')) return;
      uploadGen.logo++; uploadGen.center++;
      brand = Object.assign({}, DEFAULTS); apply(); save(); close(); open();
    });
    panel.addEventListener('mousedown', e => { if (e.target === panel) close(); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      // undo and redo belong to the field being typed in, not the calculator behind the panel
      else if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) e.stopPropagation();
    });
    document.body.appendChild(panel);
    panel.querySelector('.bp-body input[type="text"]').focus();
  }
  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    if (pushTimer) push();
  }

  // ------------------------------------------------------------ shortcut: Ctrl+Shift+` (Cmd+Shift+` on a Mac)
  // Matched by physical key (the one above Tab), so it works on any keyboard layout.
  // No Alt: Ctrl+Alt is AltGr on many non-US keyboards.
  window.addEventListener('keydown', e => {
    if (e.code === 'Backquote' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  }, true);

  apply();
  pull();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.__branding = { open, close, get: () => Object.assign({}, brand) };
})();
