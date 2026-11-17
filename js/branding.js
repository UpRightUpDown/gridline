/* Branding panel: change the top bar colour, logo, name, header text and
 * "powered by" text. Open it with Ctrl+Shift+` (Cmd+Shift+` on a Mac). Saved in this
 * browser's local storage, separately from the graph. */
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
    powered: 'gridline'
  };
  const DEFAULT_LOGO = 'assets/logo.svg';
  const MAX_LOGO_BYTES = 1024 * 1024;
  const HEX = /^#[0-9a-f]{6}$/i;
  const IMAGE_URL = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/;

  let brand = load();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === 'object') return sanitize(Object.assign({}, DEFAULTS, saved));
    } catch (e) { /* storage unavailable or corrupt */ }
    return Object.assign({}, DEFAULTS);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(brand)); }
    catch (e) { alert('Could not save the branding. The logo may be too large for browser storage.'); }
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
  // read a chosen image file as a data: URL, after checking its size and type
  function readImage(input, done) {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > MAX_LOGO_BYTES) { alert('Please choose an image under 1 MB.'); return; }
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.type)) { alert('Please choose a PNG, JPEG, GIF, WebP or SVG image.'); return; }
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
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
    file.addEventListener('change', () => readImage(file, url => {
      brand.logo = url; sanitize(brand); brand.showLogo = true; showCb.checked = true; apply(); save(); syncPrev();
    }));
    def.addEventListener('click', () => { brand.logo = ''; apply(); save(); syncPrev(); });
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
    cFile.addEventListener('change', () => readImage(cFile, url => { brand.centerIcon = url; sanitize(brand); apply(); save(); syncCenter(); }));
    cRemove.addEventListener('click', () => { brand.centerIcon = ''; apply(); save(); syncCenter(); });
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
      field('Powered by', textInput('powered', 'Name under "powered by"'), 'Leave blank to hide the "powered by" line.')
    );

    panel.querySelector('.bp-x').addEventListener('click', close);
    panel.querySelector('.bp-done').addEventListener('click', close);
    panel.querySelector('.bp-reset').addEventListener('click', () => {
      if (!confirm('Reset the top bar, logo and text to the defaults?')) return;
      brand = Object.assign({}, DEFAULTS); apply(); save(); close(); open();
    });
    panel.addEventListener('mousedown', e => { if (e.target === panel) close(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.body.appendChild(panel);
    panel.querySelector('.bp-body input[type="text"]').focus();
  }
  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
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
  window.__branding = { open, close, get: () => Object.assign({}, brand) };
})();
