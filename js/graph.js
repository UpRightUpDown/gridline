/* Graph canvas: grid, axes, curves, regions, points, panning, zooming,
 * tracing and points of interest. */
(function (root) {
  'use strict';
  const FMT = root.GMath.formatNumber;
  const CLAMP = 1e5;
  const cl = v => v > CLAMP ? CLAMP : v < -CLAMP ? -CLAMP : v;

  function niceStep(pxPerUnit, minPx) {
    const raw = minPx / pxPerUnit;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return { step: m * p, minor: m === 2 ? 4 : 5 };
    return { step: 10 * p, minor: 5 };
  }

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function labelText(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) {
      const e = Math.floor(Math.log10(a));
      let m = v / Math.pow(10, e);
      m = Math.round(m * 1000) / 1000;
      const sup = String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || '⁻').join('');
      return (m === 1 ? '' : m === -1 ? '-' : m + '×') + '10' + sup;
    }
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return (v < 0 ? '-' : '') + parseFloat(a.toFixed(decimals)).toString();
  }

  class Graph {
    constructor(el, hooks) {
      this.el = el;
      this.hooks = hooks || {};
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'graph-canvas';
      el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.graphs = [];
      this.selectedId = null;
      this.settings = { grid: true, minorGrid: true, axisNumbers: true, xAxis: true, yAxis: true, arrows: false, xLabel: '', yLabel: '' };
      this.cx = 0; this.cy = 0; this.sx = 0; this.sy = 0; // center + px per unit
      this.w = 0; this.h = 0;
      this.pois = [];
      this.label = null;      // {x, y, color, gx, gy} pinned label
      this.trace = null;      // active trace
      this.pointers = new Map();
      this.sketches = [];     // hand-drawn strokes, each [[x, y], ...] in graph coordinates
      this.drawKey = false;   // Z is held: a left drag draws instead of panning
      this.hovering = false;
      this.dirty = true;
      this.resize();
      this.setDefaultView();
      new ResizeObserver(() => { this.resize(); this.redraw(); }).observe(el);
      this.bind();
      const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    // ---------------------------------------------------------- viewport
    resize() {
      const r = this.el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const oldW = this.w, oldH = this.h;
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      this.dpr = dpr;
      if (!oldW) return;
      // keep the top edge of the view fixed when the height changes (e.g. the keypad opens)
      if (this.sy && oldH !== this.h) this.cy += (oldH - this.h) / 2 / this.sy;
    }
    setDefaultView() {
      this.sx = this.w / 20;
      this.sy = this.sx;
      this.cx = 0; this.cy = 0;
      this.isDefault = true;
      this.viewChanged(true);
    }
    get bounds() {
      return { xmin: this.cx - this.w / 2 / this.sx, xmax: this.cx + this.w / 2 / this.sx, ymin: this.cy - this.h / 2 / this.sy, ymax: this.cy + this.h / 2 / this.sy };
    }
    setBounds(b) {
      if (!(b.xmax > b.xmin) || !(b.ymax > b.ymin)) return;
      this.sx = this.w / (b.xmax - b.xmin);
      this.sy = this.h / (b.ymax - b.ymin);
      this.cx = (b.xmin + b.xmax) / 2; this.cy = (b.ymin + b.ymax) / 2;
      this.viewChanged();
    }
    viewChanged(isDefault) {
      this.isDefault = !!isDefault;
      this.computePOIs();
      this.redraw();
      if (this.hooks.onView) this.hooks.onView(this.bounds, this.isDefault);
    }
    X(x) { return (x - this.cx) * this.sx + this.w / 2; }
    Y(y) { return this.h / 2 - (y - this.cy) * this.sy; }
    gx(px) { return (px - this.w / 2) / this.sx + this.cx; }
    gy(py) { return (this.h / 2 - py) / this.sy + this.cy; }
    zoom(f, px = this.w / 2, py = this.h / 2) {
      const gx = this.gx(px), gy = this.gy(py);
      const ns = this.sx * f;
      if (ns > 1e12 || ns < 1e-12) return;
      this.sx *= f; this.sy *= f;
      this.cx = gx - (px - this.w / 2) / this.sx;
      this.cy = gy + (py - this.h / 2) / this.sy;
      this.viewChanged();
    }
    redraw() { this.dirty = true; }
    setDrawKey(on) {
      this.drawKey = on;
      if (!this.pointers.size) this.canvas.style.cursor = on ? 'crosshair' : '';
    }
    // Hand the strokes over and clear them from the graph.
    takeSketches() { const s = this.sketches; this.sketches = []; this.redraw(); return s; }

    setGraphs(graphs, selectedId) {
      this.graphs = graphs;
      this.selectedId = selectedId;
      if (this.label && this.label.id != null && !graphs.some(g => g.id === this.label.id && !g.hidden)) this.label = null;
      this.computePOIs();
      this.redraw();
    }
    select(id) { this.selectedId = id; this.computePOIs(); this.redraw(); }
    setSettings(s) { Object.assign(this.settings, s); this.redraw(); }

    // ------------------------------------------------------------- input
    bind() {
      const c = this.canvas;
      c.addEventListener('wheel', e => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoom(Math.exp(-d * 0.0018), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      c.addEventListener('pointerdown', e => this.onDown(e));
      c.addEventListener('pointermove', e => this.onMove(e));
      c.addEventListener('pointerup', e => this.onUp(e));
      c.addEventListener('pointercancel', e => this.onUp(e));
      c.addEventListener('pointerenter', () => { this.hovering = true; });
      c.addEventListener('pointerleave', () => { this.hovering = false; if (!this.pointers.size && this.hover) { this.hover = null; this.redraw(); } });
    }
    local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    onDown(e) {
      const p = this.local(e);
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        this.mode = 'pinch';
        this.trace = null;
        return;
      }
      this.downAt = p; this.moved = false;
      if (this.drawKey && e.button === 0) {
        this.mode = 'sketch';
        this.sketches.push([[this.gx(p.x), this.gy(p.y)]]);
        this.lastSketchPx = p;
        if (this.hooks.onSketchStart) this.hooks.onSketchStart();
        return;
      }
      // draggable points first
      const dp = this.hitDraggable(p);
      if (dp) { this.mode = 'drag'; this.dragging = dp; this.canvas.style.cursor = 'grabbing'; return; }
      const poi = this.hitPOI(p);
      if (poi) { this.mode = 'poi'; this.label = poi; this.redraw(); return; }
      const hit = this.hitCurve(p);
      if (hit) {
        this.mode = 'trace';
        this.trace = hit;
        this.label = null;
        if (this.hooks.onSelect) this.hooks.onSelect(hit.g.id);
        this.redraw();
        return;
      }
      this.mode = 'pan';
      this.panStart = { cx: this.cx, cy: this.cy, p };
      this.canvas.style.cursor = 'move';
    }
    onMove(e) {
      const p = this.local(e);
      if (!this.pointers.has(e.pointerId)) {
        this.hovering = true;
        if (this.drawKey) { this.canvas.style.cursor = 'crosshair'; return; }
        // hover cursor
        const over = this.hitDraggable(p) ? 'grab' : (this.hitPOI(p) || this.hitCurve(p)) ? 'pointer' : '';
        this.canvas.style.cursor = over;
        return;
      }
      this.pointers.set(e.pointerId, p);
      if (this.mode === 'pinch' && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom(d / this.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinch.d = d;
        return;
      }
      if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 3) this.moved = true;
      if (this.mode === 'sketch') {
        const q = this.lastSketchPx;
        if (Math.hypot(p.x - q.x, p.y - q.y) < 2) return;
        this.sketches[this.sketches.length - 1].push([this.gx(p.x), this.gy(p.y)]);
        this.lastSketchPx = p;
        this.redraw();
      } else if (this.mode === 'pan') {
        const s = this.panStart;
        this.cx = s.cx - (p.x - s.p.x) / this.sx;
        this.cy = s.cy + (p.y - s.p.y) / this.sy;
        this.viewChanged();
      } else if (this.mode === 'trace') {
        const hit = this.traceAt(this.trace.g, p);
        if (hit) { this.trace = hit; this.redraw(); }
      } else if (this.mode === 'drag') {
        const d = this.dragging;
        let x = this.gx(p.x), y = this.gy(p.y);
        const snap = v => { const { step } = niceStep(this.sx, 90); const s = step / 20; return Math.round(v / s) * s; };
        x = snap(x); y = snap(y);
        if (this.hooks.onDragPoint) this.hooks.onDragPoint(d.info, x, y);
      }
    }
    onUp(e) {
      this.pointers.delete(e.pointerId);
      if (this.mode === 'pinch') { if (!this.pointers.size) this.mode = null; return; }
      if (this.mode === 'pan' && !this.moved) {
        this.label = null;
        if (this.hooks.onSelect) this.hooks.onSelect(null);
      }
      if (this.mode === 'trace' && this.trace) {
        const t = this.trace;
        this.label = { x: t.x, y: t.y, color: t.g.color, id: t.g.id };
        this.trace = null;
      }
      this.mode = null;
      this.canvas.style.cursor = this.drawKey ? 'crosshair' : '';
      this.redraw();
    }

    visibleGraphs() { return this.graphs.filter(g => !g.hidden); }

    hitDraggable(p) {
      for (const g of this.visibleGraphs()) {
        if (g.kind !== 'points' || !g.draggable) continue;
        for (const pt of g.pts) if (Math.hypot(this.X(pt.x) - p.x, this.Y(pt.y) - p.y) < 14) return { g, info: g.draggable };
      }
      return null;
    }
    hitPOI(p) {
      for (const q of this.pois) if (Math.hypot(this.X(q.x) - p.x, this.Y(q.y) - p.y) < 10) return q;
      for (const g of this.visibleGraphs()) {
        if (g.kind !== 'points' || !g.showPoints && g.showPoints !== undefined) continue;
        for (const pt of g.pts) if (Math.hypot(this.X(pt.x) - p.x, this.Y(pt.y) - p.y) < 10) return { x: pt.x, y: pt.y, color: g.color, id: g.id };
      }
      return null;
    }
    traceAt(g, p) {
      if (g.kind === 'fx') {
        const x = this.gx(p.x), y = g.f(x);
        return Number.isFinite(y) ? { g, x, y } : null;
      }
      if (g.kind === 'fy') {
        const y = this.gy(p.y), x = g.f(y);
        return Number.isFinite(x) ? { g, x, y } : null;
      }
      if (g.kind === 'param' || g.kind === 'polar') {
        let best = null, bd = Infinity;
        const N = 600;
        for (let i = 0; i <= N; i++) {
          const t = g.tmin + (g.tmax - g.tmin) * i / N;
          const q = this.paramPoint(g, t);
          if (!q) continue;
          const d = Math.hypot(this.X(q.x) - p.x, this.Y(q.y) - p.y);
          if (d < bd) { bd = d; best = q; }
        }
        return best ? { g, x: best.x, y: best.y } : null;
      }
      return null;
    }
    paramPoint(g, t) {
      if (g.kind === 'param') { const q = g.f(t); return q && Number.isFinite(q.x) && Number.isFinite(q.y) ? q : null; }
      const r = g.f(t);
      return Number.isFinite(r) ? { x: r * Math.cos(t), y: r * Math.sin(t) } : null;
    }
    hitCurve(p) {
      let best = null, bd = 12;
      for (const g of this.visibleGraphs()) {
        if (g.ineq && g.kind !== 'fx' && g.kind !== 'fy') continue;
        if (g.kind === 'fx' || g.kind === 'fy') {
          // distance by sampling a small neighbourhood (handles steep curves)
          for (let dx = -8; dx <= 8; dx += 2) {
            const q = g.kind === 'fx' ? { x: this.gx(p.x + dx) } : { y: this.gy(p.y + dx) };
            if (g.kind === 'fx') q.y = g.f(q.x); else q.x = g.f(q.y);
            if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
            const d = Math.hypot(this.X(q.x) - p.x, this.Y(q.y) - p.y);
            if (d < bd) { bd = d; best = this.traceAt(g, p) || { g, x: q.x, y: q.y }; }
          }
        } else if (g.kind === 'param' || g.kind === 'polar') {
          const h = this.traceAt(g, p);
          if (h) { const d = Math.hypot(this.X(h.x) - p.x, this.Y(h.y) - p.y); if (d < bd) { bd = d; best = h; } }
        }
      }
      return best;
    }

    // ------------------------------------------------- points of interest
    computePOIs() {
      this.pois = [];
      if (this.selectedId == null) return;
      const sel = this.visibleGraphs().filter(g => g.id === this.selectedId && g.kind === 'fx' && !g.ineq);
      if (!sel.length) return;
      const b = this.bounds;
      const N = 500;
      const others = this.visibleGraphs().filter(g => g.kind === 'fx' && !g.ineq && !sel.includes(g));
      const add = (x, y, g) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < b.xmin || x > b.xmax || y < b.ymin || y > b.ymax) return;
        const tol = 2 / this.sx;
        if (this.pois.some(q => Math.abs(q.x - x) < tol && Math.abs(q.y - y) < 2 / this.sy)) return;
        this.pois.push({ x: clean(x, this.sx), y: clean(y, this.sy), color: g.color, id: g.id, poi: true });
      };
      for (const g of sel) {
        const xs = [], ys = [];
        for (let i = 0; i <= N; i++) { const x = b.xmin + (b.xmax - b.xmin) * i / N; xs.push(x); ys.push(g.f(x)); }
        // y-intercept
        if (b.xmin <= 0 && b.xmax >= 0) add(0, g.f(0), g);
        for (let i = 0; i < N; i++) {
          const y0 = ys[i], y1 = ys[i + 1];
          if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
          // roots
          if (y0 === 0) add(xs[i], 0, g);
          else if (y0 * y1 < 0) {
            const r = bisect(g.f, xs[i], xs[i + 1]);
            if (r !== null && Math.abs(g.f(r)) < 1e-6 * (1 + Math.abs(y0) + Math.abs(y1))) add(r, 0, g);
          }
          // extrema
          if (i > 0 && Number.isFinite(ys[i - 1])) {
            const a = ys[i - 1];
            if ((y0 > a && y0 > y1) || (y0 < a && y0 < y1)) {
              const isMax = y0 > a;
              const x = golden(g.f, xs[i - 1], xs[i + 1], isMax);
              const y = g.f(x);
              // reject cusps at discontinuities
              if (Math.abs(y - y0) < Math.abs(y1 - a) * 4 + 1e-9 + 10 / this.sy) add(x, y, g);
            }
          }
        }
        // intersections with other curves
        for (const o of others) {
          const d = x => g.f(x) - o.f(x);
          let prev = d(xs[0]);
          for (let i = 1; i <= N; i++) {
            const cur = d(xs[i]);
            if (Number.isFinite(prev) && Number.isFinite(cur) && prev * cur <= 0 && !(prev === 0 && cur === 0)) {
              const r = prev === 0 ? xs[i - 1] : bisect(d, xs[i - 1], xs[i]);
              if (r !== null && Math.abs(d(r)) < 1e-6 * (1 + Math.abs(g.f(r)))) add(r, g.f(r), g);
            }
            prev = cur;
          }
        }
      }
    }

    // ------------------------------------------------------------ drawing
    draw() {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawGrid();
      const vis = this.visibleGraphs();
      // fills first
      for (const g of vis) this.safe(() => this.drawFill(g));
      for (const g of vis) this.safe(() => this.drawCurve(g));
      for (const g of vis) if (g.kind === 'points') this.safe(() => this.drawPoints(g));
      // POIs
      for (const q of this.pois) {
        if (this.label && this.label.x === q.x && this.label.y === q.y) continue;
        this.dot(q.x, q.y, '#999', 4.5, true);
      }
      this.safe(() => this.drawSketches());
      if (this.trace) {
        this.dot(this.trace.x, this.trace.y, this.trace.g.color, 4.5);
        this.drawLabel(this.trace.x, this.trace.y);
      } else if (this.label) {
        this.dot(this.label.x, this.label.y, this.label.color, 4.5);
        this.drawLabel(this.label.x, this.label.y);
      }
    }
    drawSketches() {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(40,40,40,0.85)';
      ctx.fillStyle = 'rgba(40,40,40,0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash([]);
      for (const s of this.sketches) {
        if (s.length === 1) { ctx.beginPath(); ctx.arc(this.X(s[0][0]), this.Y(s[0][1]), 1.5, 0, Math.PI * 2); ctx.fill(); continue; }
        ctx.beginPath();
        s.forEach(([x, y], i) => i ? ctx.lineTo(this.X(x), this.Y(y)) : ctx.moveTo(this.X(x), this.Y(y)));
        ctx.stroke();
      }
    }
    safe(fn) { try { fn(); } catch (e) { /* bad expression mid-edit */ } }

    drawGrid() {
      const ctx = this.ctx, s = this.settings;
      const b = this.bounds;
      const gx = niceStep(this.sx, 90), gy = niceStep(this.sy, 90);
      const x0 = this.X(0), y0 = this.Y(0);
      ctx.lineWidth = 1;
      if (s.grid) {
        if (s.minorGrid) {
          ctx.strokeStyle = 'rgba(0,0,0,0.07)';
          ctx.beginPath();
          const mx = gx.step / gx.minor, my = gy.step / gy.minor;
          for (let k = Math.ceil(b.xmin / mx); k * mx <= b.xmax; k++) { const px = Math.round(this.X(k * mx)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, this.h); }
          for (let k = Math.ceil(b.ymin / my); k * my <= b.ymax; k++) { const py = Math.round(this.Y(k * my)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(this.w, py); }
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        for (let k = Math.ceil(b.xmin / gx.step); k * gx.step <= b.xmax; k++) { const px = Math.round(this.X(k * gx.step)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, this.h); }
        for (let k = Math.ceil(b.ymin / gy.step); k * gy.step <= b.ymax; k++) { const py = Math.round(this.Y(k * gy.step)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(this.w, py); }
        ctx.stroke();
      }
      // axes
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (s.xAxis && y0 >= 0 && y0 <= this.h) { ctx.moveTo(0, Math.round(y0) + 0.5); ctx.lineTo(this.w, Math.round(y0) + 0.5); }
      if (s.yAxis && x0 >= 0 && x0 <= this.w) { ctx.moveTo(Math.round(x0) + 0.5, 0); ctx.lineTo(Math.round(x0) + 0.5, this.h); }
      ctx.stroke();
      if (s.arrows) {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        if (s.xAxis && y0 >= 0 && y0 <= this.h) { this.arrow(this.w - 1, y0 + 0.5, 1, 0); this.arrow(1, y0 + 0.5, -1, 0); }
        if (s.yAxis && x0 >= 0 && x0 <= this.w) { this.arrow(x0 + 0.5, 1, 0, -1); this.arrow(x0 + 0.5, this.h - 1, 0, 1); }
      }
      if (!s.axisNumbers) { this.axisLabels(x0, y0); return; }
      ctx.font = '14px "Helvetica Neue", Arial, sans-serif';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#000';
      // x numbers
      if (s.xAxis) {
        const ly = Math.min(Math.max(y0 + 4, 4), this.h - 20);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let k = Math.ceil(b.xmin / gx.step); k * gx.step <= b.xmax; k++) {
          if (k === 0) continue;
          const v = k * gx.step, px = this.X(v);
          const t = labelText(v, gx.step);
          const tx = Math.min(Math.max(px - (v < 0 ? 3 : 0), ctx.measureText(t).width / 2 + 2), this.w - ctx.measureText(t).width / 2 - 2);
          ctx.strokeText(t, tx, ly); ctx.fillText(t, tx, ly);
        }
      }
      if (s.yAxis) {
        const onLeft = x0 - 6 < 30;
        ctx.textAlign = onLeft ? 'left' : 'right'; ctx.textBaseline = 'middle';
        const lx = onLeft ? Math.max(x0 + 6, 4) : Math.min(x0 - 6, this.w - 4);
        for (let k = Math.ceil(b.ymin / gy.step); k * gy.step <= b.ymax; k++) {
          if (k === 0) continue;
          const v = k * gy.step, py = this.Y(v);
          const t = labelText(v, gy.step);
          ctx.strokeText(t, lx, py); ctx.fillText(t, lx, py);
        }
      }
      if (s.xAxis && s.yAxis && x0 >= 0 && x0 <= this.w && y0 >= 0 && y0 <= this.h) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.strokeText('0', x0 - 6, y0 + 4); ctx.fillText('0', x0 - 6, y0 + 4);
      }
      this.axisLabels(x0, y0);
    }
    axisLabels(x0, y0) {
      const ctx = this.ctx, s = this.settings;
      ctx.font = 'italic 16px "Times New Roman", serif';
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      if (s.xLabel && s.xAxis) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; const y = Math.min(Math.max(y0 - 6, 20), this.h - 4); ctx.strokeText(s.xLabel, this.w - 8, y); ctx.fillText(s.xLabel, this.w - 8, y); }
      if (s.yLabel && s.yAxis) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; const x = Math.min(Math.max(x0 + 8, 4), this.w - 40); ctx.strokeText(s.yLabel, x, 8); ctx.fillText(s.yLabel, x, 8); }
    }
    arrow(x, y, dx, dy) {
      const ctx = this.ctx, L = 10, W = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - dx * L - dy * W, y - dy * L - dx * W);
      ctx.lineTo(x - dx * L + dy * W, y - dy * L + dx * W);
      ctx.closePath(); ctx.fill();
    }

    setStroke(g, strict) {
      const ctx = this.ctx;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = (g.width || 2.5) + (g.id === this.selectedId && this.selectedId != null ? 0.5 : 0);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const style = strict ? 'dashed' : g.lineStyle;
      ctx.setLineDash(style === 'dashed' ? [10, 7] : style === 'dotted' ? [0.1, 7] : []);
    }

    // sample y=f(x) adaptively into polylines (arrays of [px,py])
    samplePolylines(f, a, b, toP, span, vScale) {
      const lines = [];
      let cur = null;
      const N = Math.ceil(span / 2);
      const H = 4 * Math.max(this.w, this.h);
      const emit = (u, v) => { const p = toP(u, v); if (!cur) { cur = []; lines.push(cur); } cur.push(p); };
      const brk = () => { cur = null; };
      const edge = (u0, u1, okAt0) => {
        // binary search for the domain boundary between a finite and a NaN sample
        let lo = u0, hi = u1;
        for (let k = 0; k < 30; k++) {
          const m = (lo + hi) / 2;
          const v = f(m);
          if (Number.isFinite(v) === okAt0) lo = m; else hi = m;
        }
        const u = okAt0 ? lo : hi;
        const v = f(u);
        return Number.isFinite(v) ? [u, v] : null;
      };
      const seg = (u0, v0, u1, v1, d) => {
        const dv = Math.abs((v1 - v0) * vScale);
        if (dv < 3 || d >= 12) {
          if (d >= 12 && dv > H / 8) { brk(); emit(u1, v1); return; }
          emit(u1, v1); return;
        }
        const um = (u0 + u1) / 2, vm = f(um);
        if (!Number.isFinite(vm)) { seg2(u0, v0, um, u1, v1, d); return; }
        seg(u0, v0, um, vm, d + 1);
        seg(um, vm, u1, v1, d + 1);
      };
      const seg2 = (u0, v0, um, u1, v1, d) => {
        // a NaN gap in the middle of a step
        const e1 = edge(u0, um, true);
        if (e1) emit(e1[0], e1[1]);
        brk();
        const e2 = edge(um, u1, false);
        if (e2) emit(e2[0], e2[1]);
        emit(u1, v1);
        void d;
      };
      let u0 = a, v0 = f(a);
      if (Number.isFinite(v0)) emit(u0, v0);
      for (let i = 1; i <= N; i++) {
        const u1 = a + (b - a) * i / N, v1 = f(u1);
        const ok0 = Number.isFinite(v0), ok1 = Number.isFinite(v1);
        if (ok0 && ok1) seg(u0, v0, u1, v1, 0);
        else if (ok0 && !ok1) { const e = edge(u0, u1, true); if (e) emit(e[0], e[1]); brk(); }
        else if (!ok0 && ok1) { brk(); const e = edge(u0, u1, false); if (e) emit(e[0], e[1]); emit(u1, v1); }
        u0 = u1; v0 = v1;
      }
      return lines;
    }

    curveLines(g) {
      const b = this.bounds;
      if (g.kind === 'fx') {
        return this.samplePolylines(g.f, b.xmin, b.xmax, (x, y) => [cl(this.X(x)), cl(this.Y(y))], this.w, this.sy);
      }
      if (g.kind === 'fy') {
        return this.samplePolylines(g.f, b.ymin, b.ymax, (y, x) => [cl(this.X(x)), cl(this.Y(y))], this.h, this.sx);
      }
      if (g.kind === 'param' || g.kind === 'polar') {
        const lines = [];
        let cur = null;
        if (!(g.tmax > g.tmin)) return lines;
        const N = g.kind === 'polar' ? 4000 : 1500;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = g.tmin + (g.tmax - g.tmin) * i / N;
          const q = this.paramPoint(g, t);
          if (!q) { cur = null; prev = null; continue; }
          const p = [cl(this.X(q.x)), cl(this.Y(q.y))];
          if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > Math.max(this.w, this.h)) cur = null;
          if (!cur) { cur = []; lines.push(cur); }
          cur.push(p);
          prev = p;
        }
        return lines;
      }
      return [];
    }

    drawFill(g) {
      const ctx = this.ctx;
      const alpha = g.fillOpacity != null ? g.fillOpacity : 0.4;
      if ((g.kind === 'fx' || g.kind === 'fy') && g.ineq) {
        const lines = this.curveLines(g);
        ctx.fillStyle = hexToRgba(g.color, alpha);
        const above = g.ineq === '>' || g.ineq === '>=';
        for (const line of lines) {
          if (line.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(line[0][0], line[0][1]);
          for (const p of line) ctx.lineTo(p[0], p[1]);
          const last = line[line.length - 1], first = line[0];
          if (g.kind === 'fx') {
            const edge = above ? -10 : this.h + 10;
            ctx.lineTo(last[0], edge); ctx.lineTo(first[0], edge);
          } else {
            const edge = above ? this.w + 10 : -10;
            ctx.lineTo(edge, last[1]); ctx.lineTo(edge, first[1]);
          }
          ctx.closePath(); ctx.fill();
        }
      } else if (g.kind === 'implicit' && g.ineq) {
        const test = { '<': v => v < 0, '<=': v => v <= 0, '>': v => v > 0, '>=': v => v >= 0 }[g.ineq];
        this.fillRegion((x, y) => test(g.f(x, y)), hexToRgba(g.color, alpha));
      } else if (g.kind === 'region') {
        this.fillRegion(g.cond, hexToRgba(g.color, alpha));
      }
    }
    fillRegion(cond, color) {
      const ctx = this.ctx, R = 3;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let py = 0; py < this.h; py += R) {
        const y = this.gy(py + R / 2);
        let start = -1;
        for (let px = 0; px <= this.w; px += R) {
          const inside = px < this.w && cond(this.gx(px + R / 2), y);
          if (inside && start < 0) start = px;
          if (!inside && start >= 0) { ctx.rect(start, py, px - start, R); start = -1; }
        }
      }
      ctx.fill();
    }

    drawCurve(g) {
      const ctx = this.ctx;
      if (g.kind === 'points') {
        if (!g.lines || g.pts.length < 2) return;
        this.setStroke(g);
        ctx.beginPath();
        g.pts.forEach((p, i) => { const X = cl(this.X(p.x)), Y = cl(this.Y(p.y)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      if (g.kind === 'implicit') {
        this.setStroke(g, g.ineq === '<' || g.ineq === '>');
        this.marching(g.f, null);
        ctx.setLineDash([]);
        return;
      }
      if (g.kind === 'region') {
        for (const bd of g.bounds) {
          this.setStroke(g, bd.strict);
          this.marching(bd.f, g.cond);
        }
        ctx.setLineDash([]);
        return;
      }
      const lines = this.curveLines(g);
      this.setStroke(g, g.ineq === '<' || g.ineq === '>');
      ctx.beginPath();
      for (const line of lines) {
        if (line.length === 1) { ctx.moveTo(line[0][0], line[0][1]); ctx.lineTo(line[0][0] + 0.01, line[0][1]); continue; }
        line.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    marching(f, cond) {
      const ctx = this.ctx, R = 4;
      const nx = Math.ceil(this.w / R) + 1, ny = Math.ceil(this.h / R) + 1;
      const vals = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) {
        const y = this.gy(j * R);
        for (let i = 0; i < nx; i++) vals[j * nx + i] = f(this.gx(i * R), y);
      }
      ctx.beginPath();
      const all = [];
      const lerp = (a, b) => a / (a - b);
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = vals[j * nx + i], b = vals[j * nx + i + 1], c = vals[(j + 1) * nx + i + 1], d = vals[(j + 1) * nx + i];
          if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
          const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const x0 = i * R, y0 = j * R;
          // discontinuity filter
          const fc = f(this.gx(x0 + R / 2), this.gy(y0 + R / 2));
          const mx = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
          if (!Number.isFinite(fc) || Math.abs(fc) > 2 * mx) continue;
          const top = [x0 + R * lerp(a, b), y0], right = [x0 + R, y0 + R * lerp(b, c)];
          const bottom = [x0 + R * lerp(d, c), y0 + R], left = [x0, y0 + R * lerp(a, d)];
          const segs = [];
          switch (idx) {
            case 1: case 14: segs.push([left, bottom]); break;
            case 2: case 13: segs.push([bottom, right]); break;
            case 3: case 12: segs.push([left, right]); break;
            case 4: case 11: segs.push([top, right]); break;
            case 6: case 9: segs.push([top, bottom]); break;
            case 7: case 8: segs.push([left, top]); break;
            case 5: segs.push(fc > 0 ? [left, top] : [left, bottom], fc > 0 ? [bottom, right] : [top, right]); break;
            case 10: segs.push(fc > 0 ? [top, right] : [left, top], fc > 0 ? [left, bottom] : [bottom, right]); break;
          }
          for (const [p, q] of segs) {
            if (cond) {
              const mxp = (p[0] + q[0]) / 2, myp = (p[1] + q[1]) / 2;
              let ok = false;
              for (const [ox, oy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (cond(this.gx(mxp + ox), this.gy(myp + oy))) { ok = true; break; }
              if (!ok) continue;
            }
            all.push(p, q);
          }
        }
      }
      // chain the cell segments into polylines so dash patterns run continuously
      const key = p => Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100);
      const ends = new Map();
      const addEnd = (k, s) => { const l = ends.get(k); if (l) l.push(s); else ends.set(k, [s]); };
      const nseg = all.length / 2, used = new Uint8Array(nseg);
      for (let s = 0; s < nseg; s++) { addEnd(key(all[2 * s]), s); addEnd(key(all[2 * s + 1]), s); }
      const nextFrom = (pt, s) => {
        const l = ends.get(key(pt));
        if (!l) return -1;
        for (const t of l) if (t !== s && !used[t]) return t;
        return -1;
      };
      const walk = (start, s0) => {
        const line = [];
        let pt = start, s = s0;
        while (s >= 0) {
          used[s] = 1;
          const a = all[2 * s], b = all[2 * s + 1];
          const other = key(a) === key(pt) ? b : a;
          line.push(other);
          pt = other;
          s = nextFrom(pt, s);
        }
        return line;
      };
      for (let s = 0; s < nseg; s++) {
        if (used[s]) continue;
        used[s] = 1;
        const a = all[2 * s], b = all[2 * s + 1];
        const fwd = walk(b, nextFrom(b, s));
        const back = walk(a, nextFrom(a, s));
        const line = back.reverse().concat([a, b], fwd);
        ctx.moveTo(line[0][0], line[0][1]);
        for (let k = 1; k < line.length; k++) ctx.lineTo(line[k][0], line[k][1]);
      }
      ctx.stroke();
    }

    drawPoints(g) {
      if (g.showPoints === false) return;
      const r = g.pointStyle === 'open' ? 4.5 : 4.5;
      for (const p of g.pts) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const X = this.X(p.x), Y = this.Y(p.y);
        if (X < -20 || X > this.w + 20 || Y < -20 || Y > this.h + 20) continue;
        if (g.draggable) {
          this.ctx.fillStyle = hexToRgba(g.color, 0.3);
          this.ctx.beginPath(); this.ctx.arc(X, Y, 11, 0, Math.PI * 2); this.ctx.fill();
        }
        if (g.pointStyle === 'open') {
          this.ctx.fillStyle = '#fff'; this.ctx.strokeStyle = g.color; this.ctx.lineWidth = 2.5; this.ctx.setLineDash([]);
          this.ctx.beginPath(); this.ctx.arc(X, Y, r, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke();
        } else if (g.pointStyle === 'cross') {
          const c = this.ctx; c.strokeStyle = g.color; c.lineWidth = 2.5; c.setLineDash([]);
          c.beginPath(); c.moveTo(X - 5, Y - 5); c.lineTo(X + 5, Y + 5); c.moveTo(X + 5, Y - 5); c.lineTo(X - 5, Y + 5); c.stroke();
        } else this.dot(p.x, p.y, g.color, r);
      }
    }
    dot(x, y, color, r, ring) {
      const ctx = this.ctx, X = this.X(x), Y = this.Y(y);
      ctx.beginPath();
      ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (ring) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([]); ctx.stroke(); }
    }
    drawLabel(x, y) {
      const ctx = this.ctx;
      const dx = Math.max(0, Math.ceil(-Math.log10(1 / this.sx * 2))) + 1;
      const dy = Math.max(0, Math.ceil(-Math.log10(1 / this.sy * 2))) + 1;
      const t = ('(' + FMT(roundTo(x, dx), Math.min(dx + 1, 6)) + ', ' + FMT(roundTo(y, dy), Math.min(dy + 1, 6)) + ')').replace(/-/g, '−');
      ctx.font = '20px Symbola, "Times New Roman", serif';
      const w = ctx.measureText(t).width + 16, h = 34;
      let X = this.X(x) + 6, Y = this.Y(y) + 6;
      if (X + w > this.w - 4) X = this.X(x) - w - 10;
      if (Y + h > this.h - 4) Y = this.Y(y) - h - 6;
      ctx.fillStyle = '#fff';
      roundRect(ctx, X + 0.5, Y + 0.5, w, h, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
      ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(t, X + 8, Y + h / 2 + 1);
    }

    // ------------------------------------------------------------ export
    snapshotPNG() { return this.canvas.toDataURL('image/png'); }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function roundTo(v, d) { const k = Math.pow(10, Math.min(d, 12)); return Math.round(v * k) / k; }
  function clean(v, scale) {
    // snap values that are within floating error of a short decimal
    const r = Math.round(v * 1e9) / 1e9;
    return Math.abs(r - v) < 1e-9 ? r : v;
    void scale;
  }
  function bisect(f, a, b) {
    let fa = f(a);
    for (let i = 0; i < 80; i++) {
      const m = (a + b) / 2, fm = f(m);
      if (!Number.isFinite(fm)) return null;
      if (fm === 0) return m;
      if (fa * fm < 0) b = m; else { a = m; fa = fm; }
    }
    return (a + b) / 2;
  }
  function golden(f, a, b, isMax) {
    const g = (Math.sqrt(5) - 1) / 2;
    const s = isMax ? -1 : 1;
    let c = b - g * (b - a), d = a + g * (b - a);
    for (let i = 0; i < 80; i++) {
      if (s * f(c) < s * f(d)) b = d; else a = c;
      c = b - g * (b - a); d = a + g * (b - a);
    }
    return (a + b) / 2;
  }

  root.Graph = Graph;
  root.GraphUtil = { niceStep, labelText };
})(window);
