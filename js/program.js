/* Program: analyses the whole expression list, resolves definitions and
 * produces graphable objects. Depends on GMath. */
(function (root) {
  'use strict';
  const M = (typeof module !== 'undefined' && module.exports) ? require('./math.js') : root.GMath;
  const { parse, compile, freeVars, MathError, isPt, isList, BUILTIN_CONSTS } = M;

  const GRAPH_VARS = new Set(['x', 'y', 't', 'theta', 'r']);

  function isNumLiteral(n) {
    return n.type === 'num' || (n.type === 'neg' && n.a.type === 'num');
  }
  function literalValue(n) { return n.type === 'num' ? n.v : -n.a.v; }

  function substitute(node, map) {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'var' && map.has(node.name)) return map.get(node.name);
    const out = Array.isArray(node) ? [] : {};
    for (const k of Object.keys(node)) {
      const v = node[k];
      out[k] = Array.isArray(v) ? v.map(e => substitute(e, map)) : (v && typeof v === 'object' ? substitute(v, map) : v);
    }
    return out;
  }

  // Levenberg-Marquardt least squares: resid(params) -> array of residuals
  function fitLM(resid, p0) {
    let p = p0.slice();
    let r = resid(p);
    let cost = r.reduce((s, v) => s + v * v, 0);
    if (!Number.isFinite(cost)) return null;
    let lambda = 1e-3;
    const n = p.length;
    for (let iter = 0; iter < 200; iter++) {
      // Jacobian
      const J = [];
      for (let j = 0; j < n; j++) {
        const h = 1e-6 * Math.max(1, Math.abs(p[j]));
        const q = p.slice(); q[j] += h;
        const r2 = resid(q);
        J.push(r2.map((v, i) => (v - r[i]) / h));
      }
      // A = J^T J, g = J^T r
      const A = [], g = [];
      for (let a = 0; a < n; a++) {
        A.push([]);
        let s = 0;
        for (let i = 0; i < r.length; i++) s += J[a][i] * r[i];
        g.push(s);
        for (let b = 0; b < n; b++) {
          let t = 0;
          for (let i = 0; i < r.length; i++) t += J[a][i] * J[b][i];
          A[a].push(t);
        }
      }
      let improved = false;
      for (let tries = 0; tries < 10; tries++) {
        const Al = A.map((row, i) => row.map((v, j) => i === j ? v * (1 + lambda) + 1e-12 : v));
        const delta = solve(Al, g.map(v => -v));
        if (!delta) { lambda *= 10; continue; }
        const q = p.map((v, i) => v + delta[i]);
        const rq = resid(q);
        const cq = rq.reduce((s, v) => s + v * v, 0);
        if (Number.isFinite(cq) && cq <= cost) {
          const done = Math.abs(cost - cq) <= 1e-14 * Math.max(1, cost);
          p = q; r = rq; cost = cq; lambda = Math.max(lambda / 10, 1e-12); improved = true;
          if (done) return p;
          break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return p;
  }
  function solve(A, b) {
    const n = b.length, M2 = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M2[r][c]) > Math.abs(M2[piv][c])) piv = r;
      if (Math.abs(M2[piv][c]) < 1e-300) return null;
      [M2[c], M2[piv]] = [M2[piv], M2[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M2[r][c] / M2[c][c];
        for (let k = c; k <= n; k++) M2[r][k] -= f * M2[c][k];
      }
    }
    return M2.map((row, i) => row[n] / row[i]);
  }

  function parseCell(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    try {
      const st = parse(s);
      if (st.type !== 'expr') return NaN;
      const f = compile(st.expr, { locals: new Set(), lookupVar: () => null, lookupFn: () => null, unknown: new Set() });
      const v = f({});
      return typeof v === 'number' ? v : NaN;
    } catch (e) { return NaN; }
  }

  /**
   * build(items) -> { byId: Map(id -> result), graphs: [graphable] }
   * result: { error, value, slider, missing, regression, kind }
   */
  function build(items, opts) {
    opts = opts || {};
    const results = new Map();
    const varDefs = new Map();   // name -> { node, itemId, value?, state }
    const fnDefs = new Map();    // name -> { params, body, itemId, compiled?, state }
    const listDefs = new Map();  // name -> array (table columns)
    const dupes = new Set();
    const parsed = [];
    const graphs = [];

    const res = id => { if (!results.has(id)) results.set(id, {}); return results.get(id); };

    // ---- pass 1: parse and collect definitions
    for (const it of items) {
      if (it.type === 'table') {
        const r = res(it.id);
        r.columns = [];
        it.columns.forEach((col, ci) => {
          let name = null, headerAst = null, err = null;
          try {
            const st = parse(col.latex || '');
            if (st.type === 'expr') {
              headerAst = st.expr;
              if (st.expr.type === 'var' && !GRAPH_VARS.has(st.expr.name) && !(st.expr.name in BUILTIN_CONSTS)) name = st.expr.name;
              else if (st.expr.type === 'var' && (st.expr.name === 'x' || st.expr.name === 'y')) name = null;
            }
          } catch (e) { err = e.message; }
          const values = col.values.map(parseCell);
          r.columns.push({ name, headerAst, values, error: err });
          if (name) {
            if (varDefs.has(name) || listDefs.has(name)) dupes.add(name);
            listDefs.set(name, values.filter(v => v !== null));
          }
        });
        continue;
      }
      if (it.type !== 'expression') continue;
      const r = res(it.id);
      let st;
      try { st = parse(it.latex || ''); } catch (e) { r.error = e.message; continue; }
      parsed.push({ it, st });
      if (st.type === 'rel' && st.ops.length === 1 && st.ops[0] === '=') {
        const lhs = st.exprs[0], rhs = st.exprs[1];
        if (lhs.type === 'var' && !GRAPH_VARS.has(lhs.name)) {
          if (lhs.name in BUILTIN_CONSTS && lhs.name !== 'e') { r.error = 'Cannot redefine ' + lhs.name; continue; }
          if (varDefs.has(lhs.name) || listDefs.has(lhs.name) || fnDefs.has(lhs.name)) dupes.add(lhs.name);
          varDefs.set(lhs.name, { node: rhs, itemId: it.id, state: 0 });
          r.defines = lhs.name;
          if (isNumLiteral(rhs)) r.slider = { name: lhs.name, value: literalValue(rhs) };
        } else if (lhs.type === 'var' && lhs.name === 'r' && !freeVars(rhs).has('theta') && !freeVars(rhs).has('x') && !freeVars(rhs).has('y')) {
          // "r = 3" is a slider named r when it does not involve theta
          if (varDefs.has('r')) dupes.add('r');
          varDefs.set('r', { node: rhs, itemId: it.id, state: 0 });
          r.defines = 'r';
          if (isNumLiteral(rhs)) r.slider = { name: 'r', value: literalValue(rhs) };
        } else if (lhs.type === 'call' && !lhs.primes && lhs.args.length && lhs.args.every(a => a.type === 'var') && !GRAPH_VARS.has(lhs.name)) {
          if (varDefs.has(lhs.name) || fnDefs.has(lhs.name)) dupes.add(lhs.name);
          fnDefs.set(lhs.name, { params: lhs.args.map(a => a.name), body: rhs, itemId: it.id, state: 0 });
          r.definesFn = lhs.name;
        }
      }
    }

    // ---- context with lazy, cycle-checked definitions
    const ctxBase = {
      lookupVar(name) {
        if (dupes.has(name)) throw new MathError('"' + name + '" is defined more than once');
        if (listDefs.has(name)) { const v = listDefs.get(name); return { get: () => v }; }
        const d = varDefs.get(name);
        if (!d) return null;
        if (d.state === 2) { const v = d.value; return { get: () => v }; }
        if (d.state === 1) throw new MathError('"' + name + '" cannot be defined in terms of itself');
        d.state = 1;
        try {
          const f = compile(d.node, makeCtx(new Set()));
          d.value = f({});
          d.state = 2;
        } catch (e) { d.state = 0; throw e; }
        const v = d.value;
        return { get: () => v };
      },
      lookupFn(name) {
        if (dupes.has(name)) throw new MathError('"' + name + '" is defined more than once');
        const d = fnDefs.get(name);
        if (!d) return null;
        return {
          params: d.params,
          get() {
            if (d.state === 2) return d.compiled;
            if (d.state === 1) throw new MathError('Function ' + name + ' cannot be defined in terms of itself');
            d.state = 1;
            try { d.compiled = compile(d.body, makeCtx(new Set(d.params))); d.state = 2; }
            catch (e) { d.state = 0; throw e; }
            return d.compiled;
          }
        };
      }
    };
    function makeCtx(locals) {
      return { locals, lookupVar: ctxBase.lookupVar, lookupFn: ctxBase.lookupFn, unknown: new Set() };
    }
    const isDefined = n => varDefs.has(n) || listDefs.has(n) || fnDefs.has(n) || (n in BUILTIN_CONSTS);

    function depsOf(node) {
      const raw = freeVars(node);
      const out = new Set();
      for (const n of raw) {
        if (n.startsWith('#fn:')) {
          const name = n.slice(4);
          if (!fnDefs.has(name)) out.add(name);
        } else if (!(n in BUILTIN_CONSTS) || varDefs.has(n)) out.add(n);
      }
      return out;
    }
    function missingOf(deps, allowed) {
      return [...deps].filter(n => !allowed.has(n) && !isDefined(n));
    }

    // ---- pass 2: regressions (their parameters become definitions)
    for (const { it, st } of parsed) {
      if (st.type !== 'regression') continue;
      const r = res(it.id);
      try {
        const deps = new Set([...depsOf(st.lhs), ...depsOf(st.rhs)]);
        const params = [...deps].filter(n => !isDefined(n) && !GRAPH_VARS.has(n));
        const listVars = [...deps].filter(n => listDefs.has(n) || (varDefs.has(n) && isList(safeValue(n))));
        if (!listVars.length) throw new MathError('Regressions need a list of data, like a table column');
        const ctx = makeCtx(new Set(params));
        const L = compile(st.lhs, ctx), R = compile(st.rhs, ctx);
        const resid = p => {
          const env = {};
          params.forEach((n, i) => { env[n] = p[i]; });
          let a = L(env), b = R(env);
          const out = [];
          if (!isList(a) && !isList(b)) return [a - b];
          const n = Math.min(isList(a) ? a.length : Infinity, isList(b) ? b.length : Infinity);
          for (let i = 0; i < n; i++) {
            const ai = isList(a) ? a[i] : a, bi = isList(b) ? b[i] : b;
            const d = ai - bi;
            if (Number.isFinite(d)) out.push(d);
          }
          return out;
        };
        let best = null;
        const starts = [params.map(() => 1), params.map(() => 0.5), params.map(() => -1), params.map(() => 0.1)];
        for (const s of starts) {
          const p = params.length ? fitLM(resid, s) : [];
          if (!p) continue;
          const c = resid(p).reduce((acc, v) => acc + v * v, 0);
          if (Number.isFinite(c) && (!best || c < best.cost)) best = { p, cost: c };
        }
        if (!best) throw new MathError('Could not fit this model');
        const values = {};
        params.forEach((n, i) => {
          values[n] = best.p[i];
          if (varDefs.has(n)) dupes.add(n);
          varDefs.set(n, { node: { type: 'num', v: best.p[i] }, itemId: it.id, state: 2, value: best.p[i] });
        });
        // R^2 against the lhs data
        const lhsVals = L(Object.fromEntries(params.map((n, i) => [n, best.p[i]])));
        let r2 = null;
        if (isList(lhsVals)) {
          const ys = lhsVals.filter(Number.isFinite);
          const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
          const ssTot = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
          r2 = ssTot > 0 ? 1 - best.cost / ssTot : null;
        }
        r.regression = { params: values, order: params, r2 };
        // graph: substitute the independent list variable with x
        const indep = listVars.find(n => depsOf(st.rhs).has(n));
        if (st.lhs.type === 'var' && indep) {
          const map = new Map([[indep, { type: 'var', name: 'x' }]]);
          params.forEach((n, i) => map.set(n, { type: 'num', v: best.p[i] }));
          const model = substitute(st.rhs, map);
          r.regressionModel = model;
        }
      } catch (e) {
        r.error = e.message;
      }
    }
    function safeValue(n) { try { return ctxBase.lookupVar(n).get(); } catch (e) { return null; } }

    // ---- pass 3: everything else
    for (const { it, st } of parsed) {
      const r = res(it.id);
      if (r.error) continue;
      const style = { color: it.color, lineStyle: it.lineStyle || 'solid', hidden: !!it.hidden, id: it.id, width: it.lineWidth || 2.5, pointStyle: it.pointStyle || 'point', fillOpacity: it.fillOpacity };
      try {
        analyse(it, st, r, style);
      } catch (e) {
        r.error = e instanceof MathError || e instanceof Error ? e.message : String(e);
        if (r.missing && r.missing.length) r.error = null;
      }
    }

    // ---- tables
    for (const it of items) {
      if (it.type !== 'table') continue;
      const r = res(it.id);
      const cols = r.columns;
      if (cols.length < 2) continue;
      // first column is x; others are y columns
      const xs = cols[0].values;
      const xHeader = cols[0];
      for (let ci = 1; ci < cols.length; ci++) {
        const col = it.columns[ci];
        if (col.hidden) continue;
        const pts = [];
        for (let i = 0; i < Math.min(xs.length, cols[ci].values.length); i++) {
          const x = xs[i], y = cols[ci].values[i];
          if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        }
        void xHeader;
        graphs.push({
          kind: 'points', pts, id: it.id, sub: ci, color: col.color || it.color,
          hidden: !!it.hidden, lines: !!col.lines, pointStyle: col.pointStyle || 'point', lineStyle: col.lineStyle || 'solid', width: 2.5,
          showPoints: col.showPoints !== false, draggable: false
        });
      }
    }

    function analyse(it, st, r, style) {
      const push = g => {
        if (g.f) {
          // a half-typed expression can throw at evaluation time; treat that as undefined
          const raw = g.f;
          const bad = g.kind === 'param' ? null : NaN;
          g.f = (a, b) => { try { return raw(a, b); } catch (e) { return bad; } };
        }
        graphs.push(Object.assign({}, style, g));
      };
      if (st.type === 'empty') { r.empty = true; return; }

      if (st.type === 'regression') {
        if (r.regressionModel) {
          const f = compile(r.regressionModel, makeCtx(new Set(['x'])));
          push({ kind: 'fx', f: x => f({ x }), ineq: null });
        }
        return;
      }

      if (r.defines) {
        if (dupes.has(r.defines)) throw new MathError('"' + r.defines + '" is defined more than once');
        const deps = depsOf(st.exprs[1]);
        const miss = missingOf(deps, new Set());
        if (miss.length) { r.missing = miss; throw new MathError('Too many variables'); }
        const v = ctxBase.lookupVar(r.defines).get();
        if (!r.slider) r.value = v;
        plotValue(v, r);
        return;
      }
      if (r.definesFn) {
        if (dupes.has(r.definesFn)) throw new MathError('"' + r.definesFn + '" is defined more than once');
        const d = fnDefs.get(r.definesFn);
        const deps = depsOf(d.body);
        const miss = missingOf(deps, new Set(d.params));
        if (miss.length) { r.missing = miss; throw new MathError('Too many variables'); }
        const body = ctxBase.lookupFn(r.definesFn).get();
        if (d.params.length === 1 && d.params[0] === 'x') pushFx(x => body({ x }), null);
        else if (d.params.length === 1 && d.params[0] === 'y') push({ kind: 'fy', f: y => num(body({ y })), ineq: null });
        return;
      }

      if (st.type === 'expr') {
        const e = st.expr;
        const deps = depsOf(e);
        const miss = missingOf(deps, GRAPH_VARS);
        if (miss.length) { r.missing = miss; throw new MathError('Too many variables'); }
        const gv = [...deps].filter(n => GRAPH_VARS.has(n) && !isDefined(n));
        if (!gv.length) {
          const v = compile(e, makeCtx(new Set()))({});
          r.value = v;
          plotValue(v, r);
          return;
        }
        if (gv.length === 1 && gv[0] === 'x') {
          const f = compile(e, makeCtx(new Set(['x'])));
          pushFx(x => f({ x }), null);
          return;
        }
        if (gv.length === 1 && gv[0] === 't') {
          const f = compile(e, makeCtx(new Set(['t'])));
          const test = f({ t: 0.5 });
          if (isPt(test)) {
            const dom = it.domain || { min: 0, max: 1 };
            r.paramDomain = true;
            push({ kind: 'param', f: t => { const p = f({ t }); return isPt(p) ? p : null; }, tmin: num(parseCell(dom.min)), tmax: num(parseCell(dom.max)) });
            return;
          }
        }
        if (gv.includes('x') && gv.includes('y')) throw new MathError('Did you mean to write an equation? Try adding "= 0"');
        throw new MathError('Variable ' + gv.filter(n => n !== 'x').join(', ') + ' is not defined');
      }

      if (st.type === 'rel') {
        const { exprs, ops } = st;
        const allDeps = new Set();
        exprs.forEach(e => depsOf(e).forEach(d => allDeps.add(d)));
        const miss = missingOf(allDeps, GRAPH_VARS);
        if (miss.length) { r.missing = miss; throw new MathError('Too many variables'); }
        const gv = new Set([...allDeps].filter(n => GRAPH_VARS.has(n) && !isDefined(n)));
        if (exprs.length === 2) {
          const [lhs, rhs] = exprs;
          let op = ops[0];
          const only = (node, allowed) => [...depsOf(node)].every(n => !GRAPH_VARS.has(n) || isDefined(n) || allowed.includes(n));
          const flip = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=' };
          const ineq = op === '=' ? null : op;
          // polar
          if (lhs.type === 'var' && lhs.name === 'r' && only(rhs, ['theta']) && !gv.has('x') && !gv.has('y')) {
            const f = compile(rhs, makeCtx(new Set(['theta'])));
            const dom = it.domain || { min: 0, max: '12\\pi' };
            r.polarDomain = true;
            push({ kind: 'polar', f: th => num(f({ theta: th })), tmin: num(parseCellLatex(dom.min, 0)), tmax: num(parseCellLatex(dom.max, 12 * Math.PI)), ineq });
            return;
          }
          if (lhs.type === 'var' && lhs.name === 'y' && only(rhs, ['x'])) {
            const f = compile(rhs, makeCtx(new Set(['x'])));
            pushFx(x => f({ x }), ineq);
            return;
          }
          if (rhs.type === 'var' && rhs.name === 'y' && only(lhs, ['x'])) {
            const f = compile(lhs, makeCtx(new Set(['x'])));
            pushFx(x => f({ x }), ineq ? flip[ineq] : null);
            return;
          }
          if (lhs.type === 'var' && lhs.name === 'x' && only(rhs, ['y'])) {
            const f = compile(rhs, makeCtx(new Set(['y'])));
            pushFy(y => f({ y }), ineq);
            return;
          }
          if (rhs.type === 'var' && rhs.name === 'x' && only(lhs, ['y'])) {
            const f = compile(lhs, makeCtx(new Set(['y'])));
            pushFy(y => f({ y }), ineq ? flip[ineq] : null);
            return;
          }
          if ([...gv].every(n => n === 'x' || n === 'y') && gv.size) {
            const ctx = makeCtx(new Set(['x', 'y']));
            const L = compile(lhs, ctx), R = compile(rhs, ctx);
            const env = { x: 0, y: 0 };
            const F = (x, y) => { env.x = x; env.y = y; return num(L(env)) - num(R(env)); };
            push({ kind: 'implicit', f: F, ineq });
            return;
          }
          if (!gv.size) {
            // a numeric comparison like 2 < 3 or 1 = 1
            const ctx = makeCtx(new Set());
            const a = compile(lhs, ctx)({}), b = compile(rhs, ctx)({});
            if (typeof a === 'number' && typeof b === 'number') {
              const ok = op === '=' ? Math.abs(a - b) < 1e-12 : ({ '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b })[op];
              r.value = ok ? 'true' : 'false';
              return;
            }
          }
          throw new MathError('Unsupported equation');
        }
        // chained inequality: shaded region only
        if ([...gv].every(n => n === 'x' || n === 'y')) {
          if (ops.includes('=')) throw new MathError('Chained equations are not supported');
          const ctx = makeCtx(new Set(['x', 'y']));
          const fs = exprs.map(e => compile(e, ctx));
          const env = { x: 0, y: 0 };
          const cond = (x, y) => {
            env.x = x; env.y = y;
            let prev = num(fs[0](env));
            for (let i = 0; i < ops.length; i++) {
              const cur = num(fs[i + 1](env));
              const o = ops[i];
              const ok = o === '<' ? prev < cur : o === '>' ? prev > cur : o === '<=' ? prev <= cur : prev >= cur;
              if (!ok) return false;
              prev = cur;
            }
            return true;
          };
          // boundaries: each adjacent pair
          const bounds = [];
          for (let i = 0; i < ops.length; i++) {
            const a = fs[i], b = fs[i + 1], strict = ops[i] === '<' || ops[i] === '>';
            bounds.push({ f: (x, y) => { env.x = x; env.y = y; return num(a(env)) - num(b(env)); }, strict });
          }
          push({ kind: 'region', cond, bounds });
          return;
        }
        throw new MathError('Unsupported inequality');
      }

      function pushFx(f, ineq) {
        // lists like y = [1,2,3]x make several curves
        let probe;
        try { probe = f(0.123456); } catch (e) { probe = NaN; }
        if (isList(probe)) {
          probe.forEach((_, i) => push({ kind: 'fx', f: x => { const v = f(x); return isList(v) ? num(v[i]) : NaN; }, ineq }));
          return;
        }
        if (isPt(probe)) throw new MathError('Cannot graph a point as a function of x');
        push({ kind: 'fx', f: x => num(f(x)), ineq });
      }
      function pushFy(f, ineq) {
        let probe;
        try { probe = f(0.123456); } catch (e) { probe = NaN; }
        if (isList(probe)) {
          probe.forEach((_, i) => push({ kind: 'fy', f: y => { const v = f(y); return isList(v) ? num(v[i]) : NaN; }, ineq }));
          return;
        }
        push({ kind: 'fy', f: y => num(f(y)), ineq });
      }
      function plotValue(v, rr) {
        if (isPt(v)) { push({ kind: 'points', pts: [v], draggable: rr === r ? dragInfo(st) : null }); return; }
        if (isList(v) && v.length && v.every(isPt)) push({ kind: 'points', pts: v });
      }
    }

    function dragInfo(st) {
      // a point like (a, b) where a and b are slider variables can be dragged
      let node = st.type === 'expr' ? st.expr : (st.type === 'rel' ? st.exprs[1] : null);
      if (!node || node.type !== 'point') return null;
      const sx = node.a.type === 'var' && varDefs.has(node.a.name) && isNumLiteral(varDefs.get(node.a.name).node) ? node.a.name : null;
      const sy = node.b.type === 'var' && varDefs.has(node.b.name) && isNumLiteral(varDefs.get(node.b.name).node) ? node.b.name : null;
      if (!sx && !sy) return null;
      return { x: sx, y: sy, xItem: sx && varDefs.get(sx).itemId, yItem: sy && varDefs.get(sy).itemId };
    }

    function parseCellLatex(s, dflt) {
      if (s === undefined || s === null || s === '') return dflt;
      const v = parseCell(s);
      return v === null || Number.isNaN(v) ? dflt : v;
    }

    return { byId: results, graphs };
  }

  function num(v) { return typeof v === 'number' ? v : NaN; }

  const api = { build, fitLM, parseCell, substitute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GProgram = api;
})(typeof window !== 'undefined' ? window : globalThis);
