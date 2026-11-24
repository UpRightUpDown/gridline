/* App: expression list UI, sliders, tables, settings, keypad, undo/redo. */
(function () {
  'use strict';
  const MQ = MathQuill.getInterface(2);
  const { build } = window.GProgram;
  const GM = window.GMath;

  const COLORS = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#000000', '#fa7e19'];
  const STORE_KEY = 'gridline-state-v1';
  const OPERATOR_NAMES = 'sin cos tan sec csc cot arcsin arccos arctan arcsec arccsc arccot sinh cosh tanh sech csch coth arcsinh arccosh arctanh ' +
    'ln log exp abs floor ceil round sign sgn min max mean median total length count sort stdev stddev var gcd lcm mod nCr nPr cbrt';
  const MQ_CONFIG = {
    spaceBehavesLikeTab: true,
    leftRightIntoCmdGoes: 'up',
    restrictMismatchedBrackets: true,
    sumStartsWithNEquals: true,
    supSubsRequireOperand: true,
    charsThatBreakOutOfSupSub: '+-=<>*~',
    autoSubscriptNumerals: true,
    autoCommands: 'pi theta sqrt sum prod int alpha beta gamma delta phi tau infty',
    autoOperatorNames: OPERATOR_NAMES
  };

  // ------------------------------------------------------------- state
  let state = loadState() || defaultState();
  let history = [JSON.stringify(state.items)], histIndex = 0, histTimer = null;
  let selectedId = null;
  let lastResult = { byId: new Map(), graphs: [] };
  const rows = new Map(); // id -> { el, mq, extra, ... }
  let lastFocusedMQ = null;
  let suppressEdit = false;
  let boundInputs = [];

  function defaultState() {
    return {
      items: [{ id: 1, type: 'expression', latex: '', color: COLORS[0] }],
      nextId: 2, colorIdx: 1,
      settings: { grid: true, minorGrid: true, axisNumbers: true, xAxis: true, yAxis: true, arrows: false, degrees: false, xLabel: '', yLabel: '' },
      panelWidth: 480, collapsed: false
    };
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.items)) { s.settings = Object.assign(defaultState().settings, s.settings || {}); return s; }
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  // Rows waiting for Claude are left out of saved state and undo history.
  const savedItems = () => state.items.filter(i => !i.pending);
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, state, { items: savedItems() }))); } catch (e) { /* ignore */ }
  }
  function nextColor() { const c = COLORS[state.colorIdx % 5]; state.colorIdx++; return c; }
  function newItem(type, extra) {
    const it = Object.assign({ id: state.nextId++, type, color: nextColor() }, extra || {});
    if (type === 'expression' && it.latex == null) it.latex = '';
    if (type === 'note') it.text = it.text || '';
    if (type === 'table' && !it.columns) {
      it.columns = [{ latex: 'x_{1}', values: ['', '', '', '', ''] }, { latex: 'y_{1}', values: ['', '', '', '', ''], color: it.color }];
    }
    return it;
  }
  const itemById = id => state.items.find(i => i.id === id);
  const indexOf = id => state.items.findIndex(i => i.id === id);

  // ---------------------------------------------------------- history
  function commit(immediate) {
    save();
    clearTimeout(histTimer);
    const push = () => {
      const snap = JSON.stringify(savedItems());
      if (snap === history[histIndex]) return;
      history = history.slice(0, histIndex + 1);
      history.push(snap);
      if (history.length > 200) history.shift();
      histIndex = history.length - 1;
      updateUndoButtons();
    };
    if (immediate) push(); else histTimer = setTimeout(push, 350);
  }
  function undo() {
    clearTimeout(histTimer);
    const snap = JSON.stringify(savedItems());
    if (snap !== history[histIndex]) { history = history.slice(0, histIndex + 1); history.push(snap); histIndex++; }
    if (histIndex <= 0) return;
    histIndex--;
    restore();
  }
  function redo() {
    if (histIndex >= history.length - 1) return;
    histIndex++;
    restore();
  }
  function restore() {
    state.items = JSON.parse(history[histIndex]);
    renderList();
    refresh();
    save();
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('#btn-undo').disabled = histIndex <= 0 && JSON.stringify(savedItems()) === history[histIndex];
    $('#btn-redo').disabled = histIndex >= history.length - 1;
  }

  // ------------------------------------------------------------ helpers
  function $(sel, el) { return (el || document).querySelector(sel); }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  function nameHTML(n) {
    const greek = { theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', phi: 'φ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', tau: 'τ', rho: 'ρ' };
    const [base, sub] = n.split('_');
    const b = greek[base] || base;
    return '<i>' + b + '</i>' + (sub ? '<sub>' + sub + '</sub>' : '');
  }
  function nameLatex(n) {
    const [base, sub] = n.split('_');
    const b = base.length > 1 ? '\\' + base : base;
    return sub ? b + '_{' + sub + '}' : b;
  }
  const dispNum = v => fmtSlider(v).replace(/^-/, '−');
  function fmtSlider(v) {
    const s = parseFloat(v.toPrecision(10));
    return String(s);
  }

  // ----------------------------------------------------------- graph
  const graph = new window.Graph($('#graph'), {
    onSelect(id) { setSelected(id); },
    onView(b, isDefault) {
      $('#btn-home').classList.toggle('hidden', isDefault);
      syncBoundsInputs(b);
    },
    onDragPoint(info, x, y) {
      if (info.x) setSliderValue(info.xItem, info.x, x);
      if (info.y) setSliderValue(info.yItem, info.y, y);
    },
    onSketchStart() { heldZ = null; } // the Z press was for drawing, not typing
  });
  // Hold Z over the graph and drag to draw. The strokes go to Claude with the next question.
  // A Z pressed over the graph is held back: if no drawing starts, it is typed after all,
  // when Z comes up or just before the next key.
  let heldZ = null; // { key, target }
  let zDown = false; // a Z pressed over the graph is still down
  function typeHeldZ() {
    const z = heldZ; heldZ = null;
    if (!z || document.activeElement !== z.target) return;
    const field = z.target.closest && z.target.closest('.mq-field');
    if (field) { const mq = MQ(field); if (mq) mq.typedText(z.key); return; }
    if (z.target.setRangeText && typeof z.target.selectionStart === 'number') {
      z.target.setRangeText(z.key, z.target.selectionStart, z.target.selectionEnd, 'end');
      z.target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  window.addEventListener('keydown', e => {
    const plainZ = e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Z held over the graph + Backspace or Delete erases every stroke; drawing carries on
    if (zDown && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault(); e.stopPropagation();
      heldZ = null; // the Z was for the canvas, not for typing
      graph.takeSketches();
      return;
    }
    if (!plainZ) {
      if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key) || !heldZ) return;
      // another key while Z is down means typing: put the z in first, and stop drawing
      typeHeldZ();
      graph.setDrawKey(false);
      return;
    }
    if (e.repeat) {
      if (zDown) { e.preventDefault(); e.stopPropagation(); } // no row of z's
      return;
    }
    if (!graph.hovering) return;
    e.preventDefault(); e.stopPropagation();
    heldZ = { key: e.key, target: document.activeElement };
    zDown = true;
    graph.setDrawKey(true);
  }, true);
  window.addEventListener('keyup', e => {
    if (e.key.toLowerCase() !== 'z' || !zDown) return;
    typeHeldZ();
    zDown = false;
    graph.setDrawKey(false);
  });
  window.addEventListener('blur', () => { heldZ = null; zDown = false; graph.setDrawKey(false); });
  graph.setSettings(state.settings);
  GM.settings.degrees = !!state.settings.degrees;

  function setSelected(id) {
    selectedId = id;
    for (const [rid, r] of rows) r.el.classList.toggle('selected', rid === id);
    graph.select(id);
  }

  // ------------------------------------------------------------ refresh
  let refreshQueued = false;
  function refresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; doRefresh(); });
  }
  function doRefresh() {
    try { lastResult = build(state.items); }
    catch (e) { console.error(e); lastResult = { byId: new Map(), graphs: [] }; }
    const graphed = new Set(lastResult.graphs.map(g => g.id));
    let num = 0;
    state.items.forEach(it => {
      if (it.pending) return; // hidden placeholder for a question sent to Claude
      num++;
      const row = rows.get(it.id);
      if (!row) return;
      row.num.textContent = num;
      decorate(it, row, lastResult.byId.get(it.id) || {}, graphed.has(it.id));
    });
    graph.setGraphs(lastResult.graphs, selectedId);
  }

  // ------------------------------------------------------------ list UI
  const listEl = $('#exp-list');

  function renderList() {
    for (const r of rows.values()) r.el.remove();
    rows.clear();
    // always keep a blank expression at the end
    const last = state.items[state.items.length - 1];
    if (!last || last.type !== 'expression' || last.latex) state.items.push(newItem('expression'));
    state.items.forEach(it => listEl.appendChild(makeRow(it).el));
  }

  function makeRow(it) {
    let row;
    if (it.type === 'note') row = makeNoteRow(it);
    else if (it.type === 'table') row = makeTableRow(it);
    else row = makeExprRow(it);
    rows.set(it.id, row);
    return row;
  }

  function tab(it) {
    const num = h('span', { class: 'expr-num' });
    const icon = h('button', {
      class: 'expr-icon', title: 'Click to show/hide. Right-click for style.',
      onmousedown: e => e.preventDefault(),
      onclick: () => { it.hidden = !it.hidden; commit(true); refresh(); },
      oncontextmenu: e => { e.preventDefault(); openStyleMenu(it, e.currentTarget); }
    });
    let pressTimer;
    icon.addEventListener('pointerdown', e => { if (e.button === 0) pressTimer = setTimeout(() => { pressTimer = 'fired'; openStyleMenu(it, icon); }, 500); });
    icon.addEventListener('pointerup', () => { if (pressTimer === 'fired') { icon.addEventListener('click', stopOnce, true); } clearTimeout(pressTimer); });
    const warn = h('span', { class: 'expr-warn hidden' }, h('span', { class: 'warn-tri' }), h('span', { class: 'warn-tip' }));
    const t = h('div', { class: 'expr-tab' }, num, icon, warn);
    return { t, num, icon, warn };
  }
  function stopOnce(e) { e.stopPropagation(); e.preventDefault(); e.currentTarget.removeEventListener('click', stopOnce, true); }

  function rowShell(it, body, extraClass) {
    const { t, num, icon, warn } = tab(it);
    const del = h('button', { class: 'expr-del', title: 'Delete', onmousedown: e => e.preventDefault(), onclick: () => deleteItem(it.id) });
    const dup = h('button', { class: 'expr-dup', title: 'Duplicate', onclick: () => duplicateItem(it.id) }, h('span', { class: 'i-dup' }));
    const el = h('div', { class: 'expr ' + (extraClass || ''), 'data-id': it.id }, t, body, h('div', { class: 'expr-tools' }, dup, del));
    el.addEventListener('mousedown', e => { if (e.target === el || e.target.classList.contains('expr-body')) { const r = rows.get(it.id); if (r && r.mq) { e.preventDefault(); r.mq.focus(); } } });
    return { el, num, icon, warn, del };
  }

  function makeExprRow(it) {
    const mqEl = h('span', { class: 'mq-field' });
    const extra = h('div', { class: 'expr-extra' });
    const value = h('div', { class: 'expr-value hidden' });
    const body = h('div', { class: 'expr-body' }, mqEl, value, extra);
    const shell = rowShell(it, body);
    const row = Object.assign(shell, { it, extra, value, mqEl });
    const mq = MQ.MathField(mqEl, Object.assign({}, MQ_CONFIG, {
      handlers: {
        edit(f) {
          if (suppressEdit) return;
          const latex = f.latex();
          if (latex === it.latex) return;
          it.latex = latex;
          // typing in the last blank row adds a new blank row
          if (latex && state.items[state.items.length - 1] === it) {
            const n = newItem('expression');
            state.items.push(n);
            listEl.appendChild(makeRow(n).el);
          }
          commit();
          refresh();
        },
        enter() { insertAfter(it.id, newItem('expression'), true); },
        upOutOf() { focusSibling(it.id, -1); },
        downOutOf() { focusSibling(it.id, 1); },
        deleteOutOf(dir, f) {
          if (dir === MQ.L && !f.latex()) {
            const i = indexOf(it.id);
            if (i > 0 || state.items.length > 1) { const prev = state.items[i - 1] || state.items[i + 1]; deleteItem(it.id); focusItem(prev && prev.id, true); }
          }
        }
      }
    }));
    suppressEdit = true;
    mq.latex(it.latex || '');
    suppressEdit = false;
    row.mq = mq;
    // Shift+Enter sends the row to Claude; capture it before MathQuill sees Enter.
    mqEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); askClaude(it); } }, true);
    mqEl.addEventListener('focusin', () => { lastFocusedMQ = { mq, it }; setSelected(it.id); row.el.classList.add('focused'); showKeypadTarget(); });
    mqEl.addEventListener('focusout', () => { row.el.classList.remove('focused'); });
    return row;
  }

  function makeNoteRow(it) {
    const ta = h('textarea', { class: 'note-text', rows: 1, placeholder: '' });
    ta.value = it.text || '';
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', () => { it.text = ta.value; autosize(); commit(); });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); insertAfter(it.id, newItem('expression'), true); }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); askClaude(it); }
      if (e.key === 'Backspace' && !ta.value) { e.preventDefault(); const i = indexOf(it.id); const prev = state.items[i - 1]; deleteItem(it.id); focusItem(prev && prev.id, true); }
      if (e.key === 'ArrowUp' && ta.selectionStart === 0) { e.preventDefault(); focusSibling(it.id, -1); }
      if (e.key === 'ArrowDown' && ta.selectionEnd === ta.value.length) { e.preventDefault(); focusSibling(it.id, 1); }
    });
    ta.addEventListener('focus', () => setSelected(it.id));
    const body = h('div', { class: 'expr-body' }, ta);
    const shell = rowShell(it, body, 'note');
    shell.icon.replaceWith(h('span', { class: 'note-icon' }, '\u201C'));
    setTimeout(autosize);
    return Object.assign(shell, { it, ta, focus: () => ta.focus() });
  }

  function makeTableRow(it) {
    const table = h('table', { class: 'tbl' });
    const body = h('div', { class: 'expr-body table-body' }, table);
    const shell = rowShell(it, body, 'table-row');
    const row = Object.assign(shell, { it, table, headers: [] });
    renderTable(row);
    return row;
  }
  function renderTable(row) {
    const it = row.it, table = row.table;
    table.innerHTML = '';
    row.headers = [];
    const nRows = Math.max(...it.columns.map(c => c.values.length));
    // keep one empty row at the bottom
    const lastHasData = it.columns.some(c => (c.values[nRows - 1] || '').trim());
    if (lastHasData) it.columns.forEach(c => { while (c.values.length < nRows + 1) c.values.push(''); });
    it.columns.forEach(c => { while (c.values.length < Math.max(nRows, 1)) c.values.push(''); });
    const thead = h('tr');
    it.columns.forEach((col, ci) => {
      const mqEl = h('span', { class: 'mq-field' });
      const th = h('th', {}, mqEl);
      if (ci > 0) {
        const dot = h('button', {
          class: 'col-icon', style: '--c:' + (col.color || it.color), title: 'Right-click for style',
          onmousedown: e => e.preventDefault(),
          onclick: () => { col.hidden = !col.hidden; commit(true); refresh(); renderTable(row); },
          oncontextmenu: e => { e.preventDefault(); openStyleMenu(it, e.currentTarget, col); }
        });
        if (col.hidden) dot.classList.add('off');
        th.prepend(dot);
      }
      const mq = MQ.MathField(mqEl, Object.assign({}, MQ_CONFIG, {
        handlers: {
          edit(f) { col.latex = f.latex(); commit(); refresh(); },
          enter() { focusCell(row, 0, ci); },
          downOutOf() { focusCell(row, 0, ci); },
          upOutOf() { focusSibling(it.id, -1); },
          moveOutOf(dir) { const ni = ci + (dir === MQ.R ? 1 : -1); if (row.headers[ni]) row.headers[ni].focus(); }
        }
      }));
      mq.latex(col.latex || '');
      mqEl.addEventListener('focusin', () => { lastFocusedMQ = { mq, it }; setSelected(it.id); });
      row.headers.push(mq);
      thead.appendChild(th);
    });
    const addCol = h('th', { class: 'add-col' }, h('button', {
      title: 'Add column', onclick: () => {
        const k = it.columns.length;
        it.columns.push({ latex: 'y_{' + (k + 1) + '}', values: it.columns[0].values.map(() => ''), color: nextColor() });
        commit(true); renderTable(row); refresh();
      }
    }, '+'));
    thead.appendChild(addCol);
    table.appendChild(h('thead', {}, thead));
    const tbody = h('tbody');
    const total = it.columns[0].values.length;
    for (let ri = 0; ri < total; ri++) {
      const tr = h('tr');
      it.columns.forEach((col, ci) => {
        const inp = h('input', { class: 'cell', value: col.values[ri] || '', 'data-r': ri, 'data-c': ci, spellcheck: 'false', autocomplete: 'off' });
        inp.addEventListener('input', () => {
          col.values[ri] = inp.value;
          commit(); refresh();
          if (ri === total - 1 && inp.value.trim()) {
            it.columns.forEach(c => c.values.push(''));
            const pos = inp.selectionStart;
            renderTable(row);
            const again = row.table.querySelector(`input[data-r="${ri}"][data-c="${ci}"]`);
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
          }
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (!focusCell(row, ri + 1, ci) && e.key === 'ArrowDown') focusSibling(it.id, 1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (ri === 0) row.headers[ci].focus(); else focusCell(row, ri - 1, ci); }
          else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) { if (focusCell(row, ri, ci + 1)) e.preventDefault(); }
          else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) { if (focusCell(row, ri, ci - 1)) e.preventDefault(); }
        });
        inp.addEventListener('focus', () => { setSelected(it.id); lastFocusedMQ = null; });
        tr.appendChild(h('td', {}, inp));
      });
      tr.appendChild(h('td', { class: 'add-col' }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    row.focus = () => row.headers[0] && row.headers[0].focus();
  }
  function focusCell(row, r, c) {
    const inp = row.table.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (inp) { inp.focus(); return true; }
    return false;
  }

  // decorations: icon, error, value, slider, missing variables, regression
  function decorate(it, row, r, graphed) {
    const color = it.color;
    row.icon.style.setProperty('--c', color);
    row.icon.classList.toggle('off', !!it.hidden);
    row.icon.classList.toggle('none', !graphed && it.type !== 'table');
    row.icon.dataset.kind = iconKind(lastResult.graphs.find(g => g.id === it.id));
    const err = r.error && !r.empty ? r.error : null;
    row.warn.classList.toggle('hidden', !err);
    if (err) { row.warn.querySelector('.warn-tip').textContent = err; row.icon.classList.add('none'); }
    row.el.classList.toggle('has-error', !!err);
    if (it.type === 'table') {
      if (row.table) row.table.querySelectorAll('.col-icon').forEach((d, k) => { const col = it.columns[k + 1]; d.style.setProperty('--c', col.color || it.color); d.classList.toggle('off', !!col.hidden); });
      return;
    }
    if (it.type !== 'expression') return;
    // value
    const isPointVal = GM.isPt(r.value) || (Array.isArray(r.value) && r.value.length && r.value.every(GM.isPt));
    const showVal = r.value !== undefined && !r.slider && !err && !isPointVal;
    row.value.classList.toggle('hidden', !showVal);
    if (showVal) {
      row.value.innerHTML = '';
      row.value.append(h('span', { class: 'eq' }, '='), h('span', { class: 'val' }, typeof r.value === 'string' ? r.value : GM.formatValue(r.value, 10).replace(/-/g, '−')));
    }
    // extra (slider / missing / regression / domain): rebuild only when its shape changes
    const key = JSON.stringify([r.slider && r.slider.name, r.missing, !!r.regression, r.paramDomain, r.polarDomain, it.slider]);
    if (row.extraKey !== key) {
      row.extraKey = key;
      row.extra.innerHTML = '';
      if (row.tabExtras) { row.tabExtras.forEach(e => e.remove()); row.tabExtras = null; }
      row.sliderUI = null;
      if (r.slider) row.extra.appendChild(makeSlider(it, row, r.slider));
      else if (r.missing && r.missing.length) row.extra.appendChild(makeMissing(it, r.missing));
      else if (r.paramDomain) row.extra.appendChild(makeDomain(it, 't', '0', '1'));
      else if (r.polarDomain) row.extra.appendChild(makeDomain(it, 'θ', '0', '12\\pi'));
      if (r.regression) { row.regUI = h('div', { class: 'reg' }); row.extra.appendChild(row.regUI); }
    }
    if (r.slider && row.sliderUI) row.sliderUI.sync(r.slider.value);
    if (r.regression && row.regUI) {
      const reg = r.regression;
      row.regUI.innerHTML = '<div class="reg-h">PARAMETERS</div><div class="reg-params">' +
        reg.order.map(n => `<span class="reg-p">${nameHTML(n)} <span class="eq">=</span> <span class="reg-v">${GM.formatNumber(reg.params[n], 6)}</span></span>`).join('') +
        '</div>' + (reg.r2 != null ? `<div class="reg-h">STATISTICS</div><div class="reg-params"><span class="reg-p"><i>R</i><sup>2</sup> <span class="eq">=</span> <span class="reg-v">${GM.formatNumber(reg.r2, 4)}</span></span></div>` : '');
    }
  }
  function iconKind(g) {
    if (!g) return 'none';
    if (g.kind === 'points') return 'point';
    if (g.ineq || g.kind === 'region') return 'fill';
    return 'line';
  }

  function makeMissing(it, names) {
    const wrap = h('div', { class: 'missing' }, h('span', { class: 'missing-label' }, 'add slider:'));
    const add = list => {
      let after = it.id;
      list.forEach(n => {
        const ni = newItem('expression', { latex: nameLatex(n) + '=1' });
        insertAfter(after, ni, false);
        after = ni.id;
      });
      refresh();
      focusItem(it.id);
    };
    names.forEach(n => wrap.appendChild(h('button', { class: 'pill', html: nameHTML(n), onmousedown: e => e.preventDefault(), onclick: () => add([n]) })));
    if (names.length > 1) wrap.appendChild(h('button', { class: 'pill all', onmousedown: e => e.preventDefault(), onclick: () => add(names) }, 'all'));
    return wrap;
  }

  function makeDomain(it, v, dmin, dmax) {
    it.domain = it.domain || { min: dmin, max: dmax };
    const mk = key => {
      const span = h('span', { class: 'mq-field small' });
      const f = MQ.MathField(span, Object.assign({}, MQ_CONFIG, { handlers: { edit(m) { it.domain[key] = m.latex(); commit(); refresh(); } } }));
      f.latex(String(it.domain[key]));
      return span;
    };
    return h('div', { class: 'domain' }, mk('min'), h('span', { class: 'dom-op', html: '≤ <i>' + v + '</i> ≤' }), mk('max'));
  }

  // ---------------------------------------------------------------- sliders
  function makeSlider(it, row, info) {
    it.slider = it.slider || {};
    const s = it.slider;
    if (s.min == null) s.min = Math.min(-10, Math.floor(info.value));
    if (s.max == null) s.max = Math.max(10, Math.ceil(info.value));
    const play = h('button', { class: 'play' + (it.playing ? ' on' : ''), title: 'Play', onmousedown: e => e.preventDefault() });
    const range = h('input', { type: 'range', class: 'range' });
    const minIn = h('input', { class: 'lim min', value: dispNum(s.min), spellcheck: 'false' });
    const maxIn = h('input', { class: 'lim max', value: dispNum(s.max), spellcheck: 'false' });
    const setRange = () => { range.min = s.min; range.max = s.max; range.step = s.step || Math.max((s.max - s.min) / 1000, 1e-12); };
    setRange();
    const sizeLim = el => { el.style.width = Math.max(1.6, el.value.length * 0.62 + 0.4) + 'em'; };
    [minIn, maxIn].forEach(sizeLim);
    const limChange = () => {
      const a = GProgram.parseCell(minIn.value), b = GProgram.parseCell(maxIn.value);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) { s.min = a; s.max = b; setRange(); range.value = info.value; commit(); }
      minIn.value = dispNum(s.min); maxIn.value = dispNum(s.max);
      [minIn, maxIn].forEach(sizeLim);
    };
    [minIn, maxIn].forEach(inp => {
      inp.addEventListener('input', () => sizeLim(inp));
      inp.addEventListener('change', limChange);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    });
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      setSliderValue(it.id, info.name, snapSlider(v, s));
    });
    play.addEventListener('click', () => { it.playing = !it.playing; play.classList.toggle('on', it.playing); if (it.playing) startAnimation(); commit(true); });
    const wrap = h('div', { class: 'slider' }, minIn, range, maxIn);
    // the play button and loop toggle live in the row's tab, in place of the colour icon
    const loop = h('button', { class: 'loop-btn', title: 'Animation: back and forth', onmousedown: e => e.preventDefault() });
    const tabEl = row.el.querySelector('.expr-tab');
    tabEl.append(play, loop);
    row.tabExtras = [play, loop];
    row.sliderUI = {
      sync(v) {
        if (v < s.min) { s.min = Math.floor(v); minIn.value = dispNum(s.min); sizeLim(minIn); setRange(); }
        if (v > s.max) { s.max = Math.ceil(v); maxIn.value = dispNum(s.max); sizeLim(maxIn); setRange(); }
        range.value = v;
        const pct = (v - s.min) / (s.max - s.min) * 100;
        range.style.setProperty('--pct', Math.max(0, Math.min(100, pct)) + '%');
      }
    };
    row.sliderUI.sync(info.value);
    if (it.playing) startAnimation();
    return wrap;
  }
  function snapSlider(v, s) {
    if (s.step) return s.min + Math.round((v - s.min) / s.step) * s.step;
    const span = s.max - s.min;
    const q = Math.pow(10, Math.floor(Math.log10(span)) - 2);
    return Math.round(v / q) * q;
  }
  function setSliderValue(itemId, name, v) {
    const it = itemById(itemId);
    if (!it) return;
    v = parseFloat(v.toPrecision(12));
    it.latex = nameLatex(name) + '=' + fmtSlider(v).replace('e', '\\cdot10^{').replace(/(\^\{[-+0-9]+)$/, '$1}');
    const row = rows.get(itemId);
    if (row && row.mq) { suppressEdit = true; row.mq.latex(it.latex); suppressEdit = false; }
    commit();
    refresh();
  }
  let animating = false, animLast = 0;
  function startAnimation() {
    if (animating) return;
    animating = true; animLast = performance.now();
    const tick = now => {
      const dt = Math.min(0.1, (now - animLast) / 1000); animLast = now;
      const players = state.items.filter(i => i.playing);
      if (!players.length) { animating = false; return; }
      for (const it of players) {
        const r = lastResult.byId.get(it.id);
        if (!r || !r.slider || !it.slider) continue;
        const s = it.slider;
        it.dir = it.dir || 1;
        let v = r.slider.value + it.dir * (s.max - s.min) * dt / 4;
        if (v > s.max) { v = s.max; it.dir = -1; }
        if (v < s.min) { v = s.min; it.dir = 1; }
        r.slider.value = v;
        setSliderValue(it.id, r.slider.name, s.step ? snapSlider(v, s) : v);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ list ops
  function insertAfter(id, item, focus) {
    const i = indexOf(id);
    state.items.splice(i + 1, 0, item);
    const row = makeRow(item);
    const ref = rows.get(id);
    ref.el.after(row.el);
    commit(true);
    refresh();
    if (focus) focusItem(item.id);
  }
  // Send a row to Claude: the row disappears at once and the answer later fills its place.
  function askClaude(it) {
    const question = ((it.type === 'note' ? it.text : it.latex) || '').trim();
    if (!question) return;
    commit(true); // the question gets its own undo step, separate from the answer
    // a hidden placeholder holds the question's place until the answer comes back
    const wait = newItem('note', { pending: true });
    const at0 = indexOf(it.id);
    state.items.splice(at0, 1, wait);
    const waitRow = makeRow(wait);
    waitRow.el.style.display = 'none';
    const qRow = rows.get(it.id);
    qRow.el.replaceWith(waitRow.el);
    rows.delete(it.id);
    if (lastFocusedMQ && lastFocusedMQ.it === it) lastFocusedMQ = null;
    if (selectedId === it.id) setSelected(null);
    const last = state.items[state.items.length - 1];
    if (last === wait || last.type !== 'expression' || last.latex) {
      const n = newItem('expression');
      state.items.push(n);
      listEl.appendChild(makeRow(n).el);
    }
    const next = state.items[at0 + 1];
    if (next) focusItem(next.id);
    commit(true);
    refresh();
    const context = window.GAsk.describeItems(savedItems());
    const sketches = graph.takeSketches();
    window.GAsk.ask(question, context, null, sketches).then(steps => {
      const at = indexOf(wait.id);
      if (at < 0) return; // the placeholder was undone away, so the answer is no longer wanted
      const added = steps.map(s => s.type === 'note' ? newItem('note', { text: s.content }) : newItem('expression', { latex: s.content }));
      state.items.splice(at, 1, ...added);
      const original = new Map();
      for (const a of added) {
        const r = makeRow(a);
        waitRow.el.before(r.el);
        if (r.mq) { original.set(a.id, a.latex); a.latex = r.mq.latex(); } // keep the stored LaTeX the same as what MathQuill shows
      }
      // a row the calculator cannot read at all is shown as text instead of an error
      let checked = new Map();
      try { checked = build(savedItems()).byId; } catch (e) { console.error(e); }
      for (const a of added) {
        const err = a.type === 'expression' && (checked.get(a.id) || {}).error;
        if (!err || !/^Unsupported command/.test(err)) continue;
        const old = rows.get(a.id);
        a.type = 'note'; a.text = original.get(a.id); delete a.latex;
        old.el.replaceWith(makeRow(a).el);
      }
      waitRow.el.remove();
      rows.delete(wait.id);
      commit(true);
      refresh();
    }, err => {
      console.error(err);
      const at = indexOf(wait.id);
      if (at < 0) return;
      // put the question back where it was so it is not lost
      state.items.splice(at, 1, it);
      waitRow.el.replaceWith(makeRow(it).el);
      rows.delete(wait.id);
      commit(true);
      refresh();
    });
  }

  function deleteItem(id) {
    const i = indexOf(id);
    if (i < 0) return;
    state.items.splice(i, 1);
    const r = rows.get(id);
    if (r) { r.el.remove(); rows.delete(id); }
    if (selectedId === id) setSelected(null);
    const last = state.items[state.items.length - 1];
    if (!last || last.type !== 'expression' || last.latex) {
      const n = newItem('expression');
      state.items.push(n);
      listEl.appendChild(makeRow(n).el);
    }
    commit(true);
    refresh();
  }
  function duplicateItem(id) {
    const it = itemById(id);
    const copy = JSON.parse(JSON.stringify(it));
    copy.id = state.nextId++;
    copy.color = nextColor();
    insertAfter(id, copy, false);
  }
  function focusItem(id, atEnd) {
    const r = rows.get(id);
    if (!r) return;
    if (r.mq) { r.mq.focus(); if (atEnd) r.mq.moveToRightEnd(); }
    else if (r.focus) r.focus();
    r.el.scrollIntoView({ block: 'nearest' });
  }
  function focusSibling(id, dir) {
    const i = indexOf(id) + dir;
    if (i >= 0 && i < state.items.length) focusItem(state.items[i].id);
  }

  // ------------------------------------------------------------ style menu
  let menuEl = null;
  function closeMenus() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.querySelectorAll('.popover.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.tb-btn.active').forEach(b => b.classList.remove('active'));
  }
  function openStyleMenu(it, anchor, col) {
    closeMenus();
    const target = col || it;
    const g = lastResult.graphs.find(x => x.id === it.id);
    const isPoints = g && g.kind === 'points';
    const swatches = h('div', { class: 'swatches' }, COLORS.map(c => h('button', {
      class: 'swatch' + ((target.color || it.color) === c ? ' sel' : ''), style: '--c:' + c,
      onclick: () => { target.color = c; if (!col) it.columns && it.columns.forEach((cc, k) => { if (k) cc.color = cc.color || c; }); commit(true); refresh(); closeMenus(); }
    })));
    const lineStyles = h('div', { class: 'styles' }, ['solid', 'dashed', 'dotted'].map(s => h('button', {
      class: 'style-btn' + ((target.lineStyle || 'solid') === s ? ' sel' : ''), title: s,
      onclick: () => { target.lineStyle = s; commit(true); refresh(); closeMenus(); }
    }, h('span', { class: 'ls ls-' + s }))));
    const kids = [h('div', { class: 'menu-h' }, 'Color'), swatches];
    if (!isPoints || col) kids.push(h('div', { class: 'menu-h' }, 'Line'), lineStyles);
    if (isPoints || col) {
      kids.push(h('div', { class: 'menu-h' }, 'Points'), h('div', { class: 'styles' }, ['point', 'open', 'cross'].map(s => h('button', {
        class: 'style-btn' + ((target.pointStyle || 'point') === s ? ' sel' : ''), title: s,
        onclick: () => { target.pointStyle = s; commit(true); refresh(); closeMenus(); }
      }, h('span', { class: 'ps ps-' + s })))));
    }
    if (col) {
      kids.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!col.lines, onchange: e => { col.lines = e.target.checked; commit(true); refresh(); } }), ' Connect points with lines'));
    }
    menuEl = h('div', { class: 'style-menu' }, kids);
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.left = (r.right + 8) + 'px';
    menuEl.style.top = Math.min(r.top - 6, window.innerHeight - menuEl.offsetHeight - 8) + 'px';
  }
  document.addEventListener('mousedown', e => {
    if (menuEl && !menuEl.contains(e.target)) { menuEl.remove(); menuEl = null; }
    if (!e.target.closest('.popover') && !e.target.closest('.tb-btn')) {
      document.querySelectorAll('.popover.open').forEach(p => p.classList.remove('open'));
      document.querySelectorAll('.tb-btn.active').forEach(b => b.classList.remove('active'));
    }
  });

  // ---------------------------------------------------------- toolbar
  function togglePopover(btn, pop) {
    const open = !pop.classList.contains('open');
    closeMenus();
    if (open) { pop.classList.add('open'); btn.classList.add('active'); }
  }
  $('#btn-add').addEventListener('click', e => togglePopover(e.currentTarget, $('#add-menu')));
  $('#add-menu').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    closeMenus();
    const type = b.dataset.add;
    const item = newItem(type);
    const ref = selectedId != null && itemById(selectedId) ? selectedId : state.items[state.items.length - 2] ? state.items[state.items.length - 2].id : null;
    // insert after the selected item, or before the trailing blank row
    if (ref != null && indexOf(ref) < state.items.length - 1) insertAfter(ref, item, true);
    else {
      const blank = state.items[state.items.length - 1];
      state.items.splice(state.items.length - 1, 0, item);
      const row = makeRow(item);
      rows.get(blank.id).el.before(row.el);
      commit(true); refresh(); focusItem(item.id);
    }
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-edit').addEventListener('click', () => {
    const p = $('#exp-panel');
    p.classList.toggle('editing');
    $('#btn-edit').classList.toggle('on', p.classList.contains('editing'));
  });
  $('#btn-delete-all').addEventListener('click', () => {
    state.items = [];
    renderList(); refresh(); commit(true);
    $('#exp-panel').classList.remove('editing'); $('#btn-edit').classList.remove('on');
  });
  $('#btn-edit-done').addEventListener('click', () => { $('#exp-panel').classList.remove('editing'); $('#btn-edit').classList.remove('on'); });
  $('#btn-collapse').addEventListener('click', () => setCollapsed(true));
  $('#btn-expand').addEventListener('click', () => setCollapsed(false));
  function setCollapsed(c) {
    state.collapsed = c;
    document.body.classList.toggle('collapsed', c);
    save();
  }
  setCollapsed(!!state.collapsed);

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') closeMenus();
  });

  // panel resizing
  const resizer = $('#resizer');
  function setPanelWidth(w) {
    w = Math.max(280, Math.min(w, window.innerWidth - 200));
    state.panelWidth = w;
    document.documentElement.style.setProperty('--panel-w', w + 'px');
  }
  setPanelWidth(state.panelWidth || 480);
  resizer.addEventListener('pointerdown', e => {
    resizer.setPointerCapture(e.pointerId);
    const move = ev => setPanelWidth(ev.clientX);
    const up = () => { resizer.removeEventListener('pointermove', move); resizer.removeEventListener('pointerup', up); save(); };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });

  // --------------------------------------------------------- graph controls
  $('#btn-zoom-in').addEventListener('click', () => graph.zoom(1.5));
  $('#btn-zoom-out').addEventListener('click', () => graph.zoom(1 / 1.5));
  $('#btn-home').addEventListener('click', () => graph.setDefaultView());
  $('#btn-settings').addEventListener('click', e => togglePopover(e.currentTarget, $('#settings-pop')));
  const pop = $('#settings-pop');
  pop.querySelectorAll('input[type=checkbox][data-s]').forEach(cb => {
    cb.checked = !!state.settings[cb.dataset.s];
    cb.addEventListener('change', () => { state.settings[cb.dataset.s] = cb.checked; graph.setSettings(state.settings); applyDisplaySettings(); save(); });
  });
  function applyDisplaySettings() {
    document.body.classList.toggle('reverse-contrast', !!state.settings.reverseContrast);
    document.body.classList.toggle('large-text', state.settings.textSize === 'large');
    pop.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('sel', b.dataset.size === (state.settings.textSize || 'normal')));
  }
  pop.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    state.settings.textSize = b.dataset.size;
    applyDisplaySettings(); save();
  }));
  applyDisplaySettings();
  pop.querySelectorAll('input[data-label]').forEach(inp => {
    inp.value = state.settings[inp.dataset.label] || '';
    inp.addEventListener('input', () => { state.settings[inp.dataset.label] = inp.value; graph.setSettings(state.settings); save(); });
  });
  function syncAngleButtons() {
    pop.querySelectorAll('[data-angle]').forEach(b => b.classList.toggle('sel', (b.dataset.angle === 'deg') === !!state.settings.degrees));
  }
  pop.querySelectorAll('[data-angle]').forEach(b => b.addEventListener('click', () => {
    state.settings.degrees = b.dataset.angle === 'deg';
    GM.settings.degrees = state.settings.degrees;
    syncAngleButtons(); save(); refresh();
  }));
  syncAngleButtons();
  boundInputs = ['xmin', 'xmax', 'ymin', 'ymax'].map(k => pop.querySelector(`[data-b="${k}"]`));
  function syncBoundsInputs(b) {
    boundInputs.forEach(inp => { if (document.activeElement !== inp) inp.value = GM.formatNumber(b[inp.dataset.b], 4).replace(' × 10^', 'e').replace(/^-/, '−'); });
  }
  syncBoundsInputs(graph.bounds);
  $('#btn-settings').addEventListener('click', () => syncBoundsInputs(graph.bounds));
  boundInputs.forEach(inp => inp.addEventListener('change', () => {
    const v = {};
    boundInputs.forEach(i => { v[i.dataset.b] = GProgram.parseCell(i.value.replace(/e([-+]?\d+)/, '\\cdot10^{$1}')); });
    if ([v.xmin, v.xmax, v.ymin, v.ymax].every(Number.isFinite)) graph.setBounds(v);
    syncBoundsInputs(graph.bounds);
  }));
  $('#btn-square').addEventListener('click', () => {
    const b = graph.bounds;
    const s = Math.min(graph.sx, graph.sy);
    graph.setBounds({ xmin: (b.xmin + b.xmax) / 2 - graph.w / 2 / s, xmax: (b.xmin + b.xmax) / 2 + graph.w / 2 / s, ymin: (b.ymin + b.ymax) / 2 - graph.h / 2 / s, ymax: (b.ymin + b.ymax) / 2 + graph.h / 2 / s });
  });
  $('#btn-screenshot').addEventListener('click', () => {
    const a = h('a', { href: graph.snapshotPNG(), download: 'graph.png' });
    document.body.appendChild(a); a.click(); a.remove();
  });

  // -------------------------------------------------------------- keypad
  const keypad = $('#keypad');
  $('#btn-keypad').addEventListener('click', () => {
    const open = !document.body.classList.contains('keypad-open');
    document.body.classList.toggle('keypad-open', open);
    if (open && !lastFocusedMQ) { const first = state.items.find(i => i.type === 'expression'); if (first) focusItem(first.id); }
  });
  $('#btn-keypad-close').addEventListener('click', () => document.body.classList.remove('keypad-open'));
  function showKeypadTarget() { /* keypad follows lastFocusedMQ */ }
  keypad.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  keypad.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'abc') { keypad.classList.toggle('abc'); return; }
    if (k === 'funcs') { $('#func-pop').classList.toggle('open'); return; }
    if (k === 'shift') { keypad.classList.toggle('shift'); return; }
    if (!lastFocusedMQ) { const first = state.items.find(i => i.type === 'expression'); if (first) focusItem(first.id); }
    const t = lastFocusedMQ && lastFocusedMQ.mq;
    if (!t) return;
    keyAction(t, k, lastFocusedMQ.it);
    if (b.closest('#func-pop')) $('#func-pop').classList.remove('open');
    if (keypad.classList.contains('shift') && b.closest('.abc-keys')) keypad.classList.remove('shift');
  });
  function keyAction(mq, k, it) {
    switch (k) {
      case 'left': mq.keystroke('Left'); break;
      case 'right': mq.keystroke('Right'); break;
      case 'back': mq.keystroke('Backspace'); break;
      case 'enter': if (it && it.type === 'expression') insertAfter(it.id, newItem('expression'), true); break;
      case 'sq': mq.cmd('^'); mq.typedText('2'); mq.keystroke('Right'); break;
      case 'pow': mq.cmd('^'); break;
      case 'sqrt': mq.cmd('\\sqrt'); break;
      case 'nthroot': mq.write('\\sqrt[]{}'); mq.keystroke('Left'); mq.keystroke('Left'); break;
      case 'abs': mq.cmd('|'); break;
      case 'frac': mq.cmd('/'); break;
      case 'le': mq.cmd('\\le'); break;
      case 'ge': mq.cmd('\\ge'); break;
      case 'pi': mq.cmd('\\pi'); break;
      case 'theta': mq.cmd('\\theta'); break;
      case 'times': mq.cmd('\\cdot'); break;
      case 'sub': mq.cmd('_'); break;
      case 'ex': mq.typedText('e'); mq.cmd('^'); break;
      case 'tenx': mq.typedText('10'); mq.cmd('^'); break;
      case 'logb': mq.typedText('log'); mq.cmd('_'); break;
      case 'fact': mq.typedText('!'); break;
      case 'sim': mq.cmd('\\sim'); break;
      case 'clear': mq.latex(''); break;
      default:
        if (k.startsWith('fn:')) { mq.typedText(k.slice(3)); mq.cmd('('); }
        else mq.typedText(k);
    }
    mq.focus();
  }

  // ------------------------------------------------------------- startup
  renderList();
  refresh();
  updateUndoButtons();
  window.addEventListener('beforeunload', save);
  // expose for debugging/tests
  window.__app = { state, graph, refresh, get result() { return lastResult; } };
})();
