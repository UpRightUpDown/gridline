/* Math engine: LaTeX tokenizer, parser, compiler and expression analysis.
 * Works in the browser (window.GMath) and in Node (module.exports). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- names
  const FUNCS = [
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
    'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth', 'arcsinh', 'arccosh', 'arctanh',
    'ln', 'log', 'exp', 'abs', 'floor', 'ceil', 'round', 'sign', 'sgn',
    'min', 'max', 'mean', 'median', 'total', 'length', 'count', 'sort', 'stdev', 'stddev', 'var',
    'gcd', 'lcm', 'mod', 'nCr', 'nPr', 'sqrt', 'cbrt'
  ];
  const FUNC_SET = new Set(FUNCS);
  // longest first so "arcsin" wins over "sin" when scanning plain letters
  const FUNCS_BY_LEN = FUNCS.slice().sort((a, b) => b.length - a.length);
  const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
    'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega']);
  const BUILTIN_CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

  class MathError extends Error {}

  // ------------------------------------------------------------- tokenizer
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    const push = (t, v) => toks.push({ t, v });

    function readSubscript() {
      // after "_" read {abc} or a single char; returns string
      if (src[i] === '{') {
        let depth = 1, j = i + 1, out = '';
        while (j < n && depth) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') { depth--; if (!depth) break; }
          out += src[j]; j++;
        }
        i = j + 1;
        const clean = out.replace(/\\[a-zA-Z]+\s*/g, m => m.replace(/\\|\s/g, '')).replace(/\s/g, '');
        if (!/^[A-Za-z0-9]+$/.test(clean)) throw new MathError('Subscripts may only contain letters and numbers');
        return clean;
      }
      return src[i++];
    }

    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        if (src.startsWith('...', i)) { push('dots'); i += 3; continue; }
        let j = i;
        while (j < n && /[0-9]/.test(src[j])) j++;
        if (src[j] === '.' && !src.startsWith('...', j)) { j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        const s = src.slice(i, j);
        if (s === '.') throw new MathError('Unexpected "."');
        push('num', parseFloat(s));
        i = j;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        // plain-text function names (e.g. typed "sin(x)" without MathQuill)
        let matched = null;
        for (const f of FUNCS_BY_LEN) {
          if (f.length > 1 && src.startsWith(f, i) && !/[A-Za-z]/.test(src[i + f.length] || '')) { matched = f; break; }
        }
        if (!matched && src.startsWith('pi', i) && !/[A-Za-z]/.test(src[i + 2] || '')) { push('id', 'pi'); i += 2; continue; }
        if (matched) { push('fn', matched); i += matched.length; continue; }
        let name = c; i++;
        if (src[i] === '_') { i++; name += '_' + readSubscript(); }
        push('id', name);
        continue;
      }
      if (c === '\\') {
        let j = i + 1;
        if (/[A-Za-z]/.test(src[j])) { while (j < n && /[A-Za-z]/.test(src[j])) j++; }
        else j++;
        const cmd = src.slice(i + 1, j);
        i = j;
        switch (cmd) {
          case ' ': case ',': case ':': case ';': case '!': case 'quad': case 'qquad': continue;
          case 'left': case 'right': {
            while (src[i] === ' ') i++;
            let d = src[i];
            if (d === '\\') {
              let k = i + 1;
              if (/[A-Za-z]/.test(src[k])) { while (k < n && /[A-Za-z]/.test(src[k])) k++; } else k++;
              d = src.slice(i, k); i = k;
            } else i++;
            const L = cmd === 'left';
            if (d === '(') push('(');
            else if (d === ')') push(')');
            else if (d === '[') push('[');
            else if (d === ']') push(']');
            else if (d === '\\{' || d === '\\lbrace') push('lb');
            else if (d === '\\}' || d === '\\rbrace') push('rb');
            else if (d === '|' || d === '\\vert') push(L ? 'absL' : 'absR');
            else if (d === '.') { /* invisible delimiter */ }
            else throw new MathError('Unsupported delimiter ' + d);
            continue;
          }
          case '{': push('lb'); continue;
          case '}': push('rb'); continue;
          case 'cdot': case 'times': case 'ast': push('op', '*'); continue;
          case 'div': push('op', '/'); continue;
          case 'le': case 'leq': push('op', '<='); continue;
          case 'ge': case 'geq': push('op', '>='); continue;
          case 'lt': push('op', '<'); continue;
          case 'gt': push('op', '>'); continue;
          case 'sim': push('op', '~'); continue;
          case 'ldots': case 'dots': case 'cdots': push('dots'); continue;
          case 'infty': push('num', Infinity); continue;
          case 'frac': case 'dfrac': case 'tfrac': push('frac'); continue;
          case 'sqrt': push('sqrt'); continue;
          case 'sum': push('sum'); continue;
          case 'prod': push('prod'); continue;
          case 'int': push('int'); continue;
          case '%': push('op', '%'); continue;
          case 'prime': push('op', "'"); continue;
          case 'operatorname': case 'mathrm': case 'text': case 'mathit': {
            const name = readSubscript();
            if (FUNC_SET.has(name)) push('fn', name);
            else if (name.length === 1) push('id', name);
            else throw new MathError('"' + name + '" is not a function');
            continue;
          }
          default:
            if (FUNC_SET.has(cmd)) { push('fn', cmd); continue; }
            if (GREEK.has(cmd)) {
              let name = cmd;
              if (src[i] === '_') { i++; name += '_' + readSubscript(); }
              push('id', name);
              continue;
            }
            throw new MathError('Unsupported command \\' + cmd);
        }
      }
      if (c === '{') { push('{'); i++; continue; }
      if (c === '}') { push('}'); i++; continue; }
      if (c === '(' || c === ')' || c === '[' || c === ']') { push(c); i++; continue; }
      if (c === '|') { push('bar'); i++; continue; }
      if (c === '_') { push('_'); i++; continue; }
      if (c === '<' || c === '>') {
        if (src[i + 1] === '=') { push('op', c + '='); i += 2; } else { push('op', c); i++; }
        continue;
      }
      if ('+-*/^=,:!~\''.includes(c)) { push('op', c); i++; continue; }
      if (c === '−') { push('op', '-'); i++; continue; }
      if (c === '×' || c === '·') { push('op', '*'); i++; continue; }
      if (c === '÷') { push('op', '/'); i++; continue; }
      if (c === '≤') { push('op', '<='); i++; continue; }
      if (c === '≥') { push('op', '>='); i++; continue; }
      if (c === 'π') { push('id', 'pi'); i++; continue; }
      if (c === 'θ') { push('id', 'theta'); i++; continue; }
      throw new MathError('Unexpected "' + c + '"');
    }
    return toks;
  }

  // ---------------------------------------------------------------- parser
  const REL = new Set(['=', '<', '>', '<=', '>=']);

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    let barDepth = 0; // inside plain |...|
    const peek = (k = 0) => toks[pos + k];
    const isOp = (tok, v) => tok && tok.t === 'op' && tok.v === v;
    const next = () => toks[pos++];
    function expect(t, v) {
      const tok = next();
      if (!tok || tok.t !== t || (v !== undefined && tok.v !== v)) {
        throw new MathError(tok ? 'Unexpected ' + describe(tok) : 'Expression is incomplete');
      }
      return tok;
    }
    function describe(tok) {
      if (tok.t === 'op') return '"' + tok.v + '"';
      if (tok.t === 'num') return String(tok.v);
      if (tok.t === 'id' || tok.t === 'fn') return tok.v;
      return '"' + ({ absR: '|', rb: '}', '}': '}', ')': ')', ']': ']' }[tok.t] || tok.t) + '"';
    }

    function parseStatement() {
      if (!toks.length) return { type: 'empty' };
      const first = parseExpr();
      if (isOp(peek(), '~')) {
        next();
        const rhs = parseExpr();
        end();
        return { type: 'regression', lhs: first, rhs };
      }
      const exprs = [first], ops = [];
      while (peek() && peek().t === 'op' && REL.has(peek().v)) {
        ops.push(next().v);
        exprs.push(parseExpr());
      }
      end();
      if (!ops.length) return { type: 'expr', expr: first };
      return { type: 'rel', exprs, ops };
    }
    function end() {
      if (pos < toks.length) throw new MathError('Unexpected ' + describe(peek()));
    }

    function parseExpr(opts) { return parseAdd(opts || {}); }

    function parseAdd(opts) {
      let left = parseMul(opts);
      while (isOp(peek(), '+') || isOp(peek(), '-')) {
        const op = next().v;
        left = { type: 'bin', op, a: left, b: parseMul(opts) };
      }
      return left;
    }

    function startsTerm(tok) {
      if (!tok) return false;
      return ['num', 'id', 'fn', '(', 'absL', 'frac', 'sqrt', 'lb', '[', 'sum', 'prod', 'int', '{'].includes(tok.t) ||
        (tok.t === 'bar' && barDepth === 0);
    }

    function parseMul(opts) {
      let left = parseUnary(opts);
      for (;;) {
        const tok = peek();
        if (isOp(tok, '*') || isOp(tok, '/')) {
          next();
          left = { type: 'bin', op: tok.v, a: left, b: parseUnary(opts) };
        } else if (startsTerm(tok)) {
          if (opts.stopAtD && tok.t === 'id' && tok.v === 'd' && peek(1) && peek(1).t === 'id') break;
          left = { type: 'bin', op: '*', a: left, b: parsePower(opts) };
        } else break;
      }
      return left;
    }

    function parseUnary(opts) {
      if (isOp(peek(), '-')) { next(); return { type: 'neg', a: parseUnary(opts) }; }
      if (isOp(peek(), '+')) { next(); return parseUnary(opts); }
      return parsePower(opts);
    }

    function parseExponent() {
      if (peek() && peek().t === '{') return parseGroup();
      if (isOp(peek(), '-')) { next(); return { type: 'neg', a: parsePostfix({}) }; }
      return parsePostfix({});
    }

    function parsePower(opts) {
      const base = parsePostfix(opts);
      if (isOp(peek(), '^')) {
        next();
        const ex = parseExponent();
        let node = { type: 'pow', a: base, b: ex };
        while (isOp(peek(), '!')) { next(); node = { type: 'fact', a: node }; }
        return node;
      }
      return base;
    }

    function parsePostfix(opts) {
      let node = parsePrimary(opts);
      for (;;) {
        if (isOp(peek(), '!')) { next(); node = { type: 'fact', a: node }; continue; }
        if (isOp(peek(), '%')) { next(); node = { type: 'bin', op: '*', a: node, b: { type: 'num', v: 0.01 } }; continue; }
        if (peek() && peek().t === '[' && node.type === 'var') {
          next();
          const idx = parseExpr();
          expect(']');
          node = { type: 'index', a: node, i: idx };
          continue;
        }
        break;
      }
      return node;
    }

    function parseGroup() {
      expect('{');
      if (peek() && peek().t === '}') throw new MathError('Expression is incomplete');
      const e = parseExpr();
      expect('}');
      return e;
    }

    function parseArgsParen() {
      expect('(');
      const args = [];
      if (peek() && peek().t === ')') { next(); return args; }
      args.push(parseExpr());
      while (isOp(peek(), ',')) { next(); args.push(parseExpr()); }
      expect(')');
      return args;
    }

    // argument of a function written without parentheses: "\sin 2x"
    function parseBareArg(opts) {
      let node = parseUnary(opts);
      while (startsTerm(peek()) && peek().t !== 'fn') {
        node = { type: 'bin', op: '*', a: node, b: parsePower(opts) };
      }
      return node;
    }

    function parseCondition() {
      const exprs = [parseExpr()], ops = [];
      while (peek() && peek().t === 'op' && REL.has(peek().v)) { ops.push(next().v); exprs.push(parseExpr()); }
      if (!ops.length) return { cond: null, expr: exprs[0] };
      return { cond: { type: 'cmp', exprs, ops } };
    }

    function parsePrimary(opts) {
      const tok = next();
      if (!tok) throw new MathError('Expression is incomplete');
      switch (tok.t) {
        case 'num': return { type: 'num', v: tok.v };
        case 'id': {
          let primes = 0;
          while (isOp(peek(), "'")) { next(); primes++; }
          if (peek() && peek().t === '(') {
            const args = parseArgsParen();
            return { type: 'call', name: tok.v, args, primes };
          }
          if (primes) throw new MathError("Derivative of " + tok.v + ' needs an argument');
          return { type: 'var', name: tok.v };
        }
        case 'fn': {
          let name = tok.v;
          let base = null, power = null;
          if (name === 'log' && peek() && peek().t === '_') {
            next();
            base = peek().t === '{' ? parseGroup() : parsePrimary({});
          }
          if (isOp(peek(), '^')) {
            next();
            power = parseExponent();
            if (power.type === 'neg' && power.a.type === 'num' && power.a.v === 1 &&
              ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh'].includes(name)) {
              name = 'arc' + name; power = null;
            }
          }
          let args;
          if (peek() && peek().t === '(') args = parseArgsParen();
          else args = [parseBareArg(opts)];
          if (base) args = [args[0], base];
          let node = { type: 'fn', name, args };
          if (power) node = { type: 'pow', a: node, b: power };
          return node;
        }
        case '(': {
          const items = [parseExpr()];
          while (isOp(peek(), ',')) { next(); items.push(parseExpr()); }
          expect(')');
          if (items.length === 1) return items[0];
          if (items.length === 2) return { type: 'point', a: items[0], b: items[1] };
          throw new MathError('Points may only have 2 coordinates');
        }
        case '{': {
          pos--;
          return parseGroup();
        }
        case 'absL': {
          const e = parseExpr();
          expect('absR');
          return { type: 'fn', name: 'abs', args: [e] };
        }
        case 'bar': {
          barDepth++;
          const e = parseExpr();
          barDepth--;
          expect('bar');
          return { type: 'fn', name: 'abs', args: [e] };
        }
        case 'frac': {
          // derivative operator d/dx
          const t = toks;
          if (t[pos] && t[pos].t === '{' && t[pos + 1] && t[pos + 1].t === 'id' && t[pos + 1].v === 'd' && t[pos + 2] && t[pos + 2].t === '}' &&
            t[pos + 3] && t[pos + 3].t === '{' && t[pos + 4] && t[pos + 4].t === 'id' && t[pos + 4].v === 'd' &&
            t[pos + 5] && t[pos + 5].t === 'id' && t[pos + 6] && t[pos + 6].t === '}') {
            const v = t[pos + 5].v;
            pos += 7;
            return { type: 'deriv', v, a: parseBareArg(opts) };
          }
          const num = parseGroup();
          const den = parseGroup();
          return { type: 'bin', op: '/', a: num, b: den };
        }
        case 'sqrt': {
          let idx = null;
          if (peek() && peek().t === '[') { next(); idx = parseExpr(); expect(']'); }
          const e = parseGroup();
          if (idx) return { type: 'pow', a: e, b: { type: 'bin', op: '/', a: { type: 'num', v: 1 }, b: idx }, root: true };
          return { type: 'fn', name: 'sqrt', args: [e] };
        }
        case '[': {
          const items = [];
          if (peek() && peek().t === ']') { next(); return { type: 'list', items }; }
          let range = false;
          items.push(parseExpr());
          while (isOp(peek(), ',') || (peek() && peek().t === 'dots')) {
            if (peek().t === 'dots') {
              next(); range = true; items.push(null);
              if (isOp(peek(), ',')) next();
              if (peek() && peek().t !== ']') items.push(parseExpr());
              continue;
            }
            next();
            if (peek() && peek().t === 'dots') continue;
            items.push(parseExpr());
          }
          expect(']');
          if (range) {
            const di = items.indexOf(null);
            const before = items.slice(0, di), after = items.slice(di + 1);
            if (!before.length || after.length !== 1 || before.length > 2) throw new MathError('Invalid list range');
            return { type: 'range', start: before[0], second: before[1] || null, end: after[0] };
          }
          return { type: 'list', items };
        }
        case 'lb': {
          const branches = [];
          let otherwise = null;
          if (peek() && peek().t === 'rb') { next(); return { type: 'num', v: 1 }; }
          for (;;) {
            const c = parseCondition();
            if (c.cond) {
              let val = { type: 'num', v: 1 };
              if (isOp(peek(), ':')) { next(); val = parseExpr(); }
              branches.push({ cond: c.cond, val });
            } else {
              otherwise = c.expr;
            }
            if (isOp(peek(), ',')) { next(); continue; }
            break;
          }
          expect('rb');
          return { type: 'piece', branches, otherwise };
        }
        case 'sum': case 'prod': {
          expect('_');
          expect('{');
          const v = expect('id').v;
          expect('op', '=');
          const lo = parseExpr();
          expect('}');
          expect('op', '^');
          const hi = parseExponent();
          const body = parseMul(opts);
          return { type: tok.t, v, lo, hi, body };
        }
        case 'int': {
          expect('_');
          const lo = peek().t === '{' ? parseGroup() : parsePostfix({});
          expect('op', '^');
          const hi = parseExponent();
          const body = parseAdd({ stopAtD: true });
          const d = next();
          if (!d || d.t !== 'id' || d.v !== 'd') throw new MathError('Integral needs d' + 'x at the end');
          const v = expect('id').v;
          return { type: 'int', v, lo, hi, body };
        }
        default:
          throw new MathError(tok ? 'Unexpected ' + describe(tok) : 'Expression is incomplete');
      }
    }

    return parseStatement();
  }

  // ------------------------------------------------------- value helpers
  const isPt = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isList = Array.isArray;
  const mkPt = (x, y) => ({ x, y });

  function broadcast1(f, a) {
    if (isList(a)) return a.map(v => broadcast1(f, v));
    if (isPt(a)) throw new MathError('Cannot apply this function to a point');
    return f(a);
  }
  function broadcast2(f, a, b) {
    if (isList(a) || isList(b)) {
      if (isList(a) && isList(b)) {
        const n = Math.min(a.length, b.length), out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = broadcast2(f, a[i], b[i]);
        return out;
      }
      if (isList(a)) return a.map(v => broadcast2(f, v, b));
      return b.map(v => broadcast2(f, a, v));
    }
    return f(a, b);
  }
  function arith(op, a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return pow(a, b);
      }
    }
    if (isList(a) || isList(b)) return broadcast2((x, y) => arith(op, x, y), a, b);
    const pa = isPt(a), pb = isPt(b);
    if (pa && pb) {
      if (op === '+') return mkPt(a.x + b.x, a.y + b.y);
      if (op === '-') return mkPt(a.x - b.x, a.y - b.y);
      throw new MathError('Cannot ' + ({ '*': 'multiply', '/': 'divide', '^': 'exponentiate' }[op]) + ' two points');
    }
    if (pa && (op === '*' || op === '/')) return mkPt(arith(op, a.x, b), arith(op, a.y, b));
    if (pb && op === '*') return mkPt(a * b.x, a * b.y);
    throw new MathError('Cannot ' + ({ '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '^': 'exponentiate' }[op]) + ' a point and a number');
  }
  function pow(a, b) {
    if (a < 0 && !Number.isInteger(b)) {
      // odd roots of negative numbers, e.g. x^(1/3)
      const inv = 1 / b;
      const r = Math.round(inv);
      if (Math.abs(inv - r) < 1e-9 && r % 2 !== 0) return -Math.pow(-a, b);
      // rational exponents p/q with odd q
      for (let q = 3; q <= 15; q += 2) {
        const p = b * q;
        if (Math.abs(p - Math.round(p)) < 1e-9) {
          const pr = Math.round(p);
          const mag = Math.pow(-a, b);
          return pr % 2 === 0 ? mag : -mag;
        }
      }
    }
    return Math.pow(a, b);
  }
  function factorial(n) {
    if (n < 0 || !Number.isFinite(n)) return NaN;
    if (Number.isInteger(n)) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
    return gamma(n + 1);
  }
  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function gcd2(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; }
  function flatNums(args) {
    const out = [];
    for (const a of args) {
      if (isList(a)) out.push(...flatNums(a));
      else if (isPt(a)) throw new MathError('Expected numbers, got a point');
      else out.push(a);
    }
    return out;
  }
  const sum = a => a.reduce((s, v) => s + v, 0);
  function median(a) {
    const s = a.slice().sort((p, q) => p - q), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function variance(a) { const m = sum(a) / a.length; return sum(a.map(v => (v - m) ** 2)) / (a.length - 1); }

  // settings that affect evaluation
  const settings = { degrees: false };
  const toRad = v => settings.degrees ? v * Math.PI / 180 : v;
  const fromRad = v => settings.degrees ? v * 180 / Math.PI : v;

  const SCALAR = {
    sin: x => Math.sin(toRad(x)), cos: x => Math.cos(toRad(x)), tan: x => Math.tan(toRad(x)),
    sec: x => 1 / Math.cos(toRad(x)), csc: x => 1 / Math.sin(toRad(x)), cot: x => 1 / Math.tan(toRad(x)),
    arcsin: x => fromRad(Math.asin(x)), arccos: x => fromRad(Math.acos(x)),
    arcsec: x => fromRad(Math.acos(1 / x)), arccsc: x => fromRad(Math.asin(1 / x)),
    arccot: x => fromRad(Math.atan(1 / x) + (x < 0 ? Math.PI : 0)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sech: x => 1 / Math.cosh(x), csch: x => 1 / Math.sinh(x), coth: x => 1 / Math.tanh(x),
    arcsinh: Math.asinh, arccosh: Math.acosh, arctanh: Math.atanh,
    ln: Math.log, exp: Math.exp, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
    sign: Math.sign, sgn: Math.sign, sqrt: Math.sqrt, cbrt: Math.cbrt
  };
  const LIST_FUNCS = {
    min: a => a.length ? Math.min(...a) : NaN,
    max: a => a.length ? Math.max(...a) : NaN,
    mean: a => a.length ? sum(a) / a.length : NaN,
    median: a => a.length ? median(a) : NaN,
    total: a => sum(a),
    length: a => a.length,
    count: a => a.length,
    stdev: a => a.length > 1 ? Math.sqrt(variance(a)) : NaN,
    stddev: a => a.length > 1 ? Math.sqrt(variance(a)) : NaN,
    var: a => a.length > 1 ? variance(a) : NaN,
    gcd: a => a.reduce(gcd2),
    lcm: a => a.reduce((p, q) => Math.abs(p * q) / gcd2(p, q))
  };

  function callBuiltin(name, args) {
    if (name in SCALAR) {
      if (args.length !== 1) throw new MathError(name + ' takes 1 argument');
      const f = SCALAR[name];
      const a = args[0];
      return typeof a === 'number' ? f(a) : broadcast1(f, a);
    }
    switch (name) {
      case 'log':
        if (args.length === 2) return broadcast2((x, b) => Math.log(x) / Math.log(b), args[0], args[1]);
        return broadcast1(Math.log10, args[0]);
      case 'arctan':
        if (args.length === 2) return broadcast2((y, x) => fromRad(Math.atan2(y, x)), args[0], args[1]);
        return broadcast1(x => fromRad(Math.atan(x)), args[0]);
      case 'round':
        if (args.length === 2) return broadcast2((x, d) => Math.round(x * 10 ** d) / 10 ** d, args[0], args[1]);
        return broadcast1(Math.round, args[0]);
      case 'mod':
        if (args.length !== 2) throw new MathError('mod takes 2 arguments');
        return broadcast2((a, b) => ((a % b) + b) % b, args[0], args[1]);
      case 'nCr':
        return broadcast2((n, k) => k < 0 || k > n ? 0 : Math.round(factorial(n) / (factorial(k) * factorial(n - k))), args[0], args[1]);
      case 'nPr':
        return broadcast2((n, k) => k < 0 || k > n ? 0 : Math.round(factorial(n) / factorial(n - k)), args[0], args[1]);
      case 'sort': {
        const a = flatNums(args);
        return a.sort((p, q) => p - q);
      }
    }
    if (name in LIST_FUNCS) {
      if ((name === 'min' || name === 'max') && args.length === 1 && isPt(args[0])) throw new MathError(name + ' needs numbers');
      return LIST_FUNCS[name](flatNums(args));
    }
    throw new MathError('Unknown function ' + name);
  }

  function truthy(v) { return typeof v === 'number' ? v : NaN; }
  function compare(op, a, b) {
    switch (op) {
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case '=': return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
    }
    return false;
  }

  // -------------------------------------------------------------- compile
  // ctx: { lookupVar(name) -> {kind:'const', value} | null, lookupFn(name) -> {params, body} | null,
  //        locals: Set }
  function compile(node, ctx) {
    const c = n => compile(n, ctx);
    switch (node.type) {
      case 'num': { const v = node.v; return () => v; }
      case 'var': {
        const name = node.name;
        if (ctx.locals.has(name)) return env => env[name];
        const d = ctx.lookupVar(name);
        if (d) return d.get;
        if (name in BUILTIN_CONSTS) { const v = BUILTIN_CONSTS[name]; return () => v; }
        if (ctx.lookupFn(name)) throw new MathError(name + ' is a function. Try ' + name + '(x)');
        ctx.unknown.add(name);
        throw new MathError('Too many variables. Try defining "' + name + '"');
      }
      case 'neg': {
        const a = c(node.a);
        return env => { const v = a(env); return typeof v === 'number' ? -v : arith('*', v, -1); };
      }
      case 'bin': {
        const a = c(node.a), b = c(node.b), op = node.op;
        if (op === '+') return env => { const x = a(env), y = b(env); return typeof x === 'number' && typeof y === 'number' ? x + y : arith(op, x, y); };
        if (op === '-') return env => { const x = a(env), y = b(env); return typeof x === 'number' && typeof y === 'number' ? x - y : arith(op, x, y); };
        if (op === '*') return env => { const x = a(env), y = b(env); return typeof x === 'number' && typeof y === 'number' ? x * y : arith(op, x, y); };
        return env => { const x = a(env), y = b(env); return typeof x === 'number' && typeof y === 'number' ? x / y : arith(op, x, y); };
      }
      case 'pow': {
        const a = c(node.a), b = c(node.b);
        if (node.b.type === 'num' && node.b.v === 2) return env => { const x = a(env); return typeof x === 'number' ? x * x : arith('^', x, 2); };
        return env => { const x = a(env), y = b(env); return typeof x === 'number' && typeof y === 'number' ? pow(x, y) : arith('^', x, y); };
      }
      case 'fact': { const a = c(node.a); return env => broadcast1(factorial, a(env)); }
      case 'point': {
        const a = c(node.a), b = c(node.b);
        return env => {
          const x = a(env), y = b(env);
          if (isList(x) || isList(y)) return broadcast2(mkPt, x, y);
          if (isPt(x) || isPt(y)) throw new MathError('Points cannot contain points');
          return mkPt(x, y);
        };
      }
      case 'list': {
        const items = node.items.map(c);
        return env => {
          const out = [];
          for (const it of items) {
            const v = it(env);
            if (isList(v)) out.push(...v); else out.push(v);
          }
          return out;
        };
      }
      case 'range': {
        const s = c(node.start), e = c(node.end), sec = node.second ? c(node.second) : null;
        return env => {
          const a = s(env), b = e(env);
          let step = sec ? sec(env) - a : (b >= a ? 1 : -1);
          if (!(step) || !Number.isFinite(a) || !Number.isFinite(b)) throw new MathError('Invalid range');
          const n = Math.floor((b - a) / step + 1e-9) + 1;
          if (n > 10000) throw new MathError('Lists are limited to 10,000 elements');
          const out = [];
          for (let i = 0; i < n; i++) out.push(a + i * step);
          return out;
        };
      }
      case 'index': {
        const a = c(node.a), i = c(node.i);
        return env => {
          const l = a(env), k = i(env);
          if (!isList(l)) throw new MathError('Can only index into lists');
          return broadcast1(j => { const r = l[Math.round(j) - 1]; return r === undefined ? NaN : r; }, k);
        };
      }
      case 'fn': {
        const args = node.args.map(c), name = node.name;
        if (args.length === 1 && name in SCALAR) {
          const f = SCALAR[name], a = args[0];
          return env => { const v = a(env); return typeof v === 'number' ? f(v) : broadcast1(f, v); };
        }
        return env => callBuiltin(name, args.map(a => a(env)));
      }
      case 'call': {
        const fn = ctx.lookupFn(node.name);
        if (fn) {
          if (fn.params.length !== node.args.length) throw new MathError('Function ' + node.name + ' requires ' + fn.params.length + ' argument' + (fn.params.length === 1 ? '' : 's'));
          const args = node.args.map(c);
          const body = fn.get();
          const params = fn.params;
          if (node.primes) {
            if (params.length !== 1) throw new MathError('Derivatives need a function of one variable');
            const p = params[0];
            let g = x => { const inner = {}; inner[p] = x; const r = body(inner); return typeof r === 'number' ? r : NaN; };
            for (let k = 0; k < node.primes; k++) {
              const prev = g;
              g = x => { const h = 1e-4 * Math.max(1, Math.abs(x)); return (prev(x + h) - prev(x - h)) / (2 * h); };
            }
            const a0 = args[0];
            return env => broadcast1(g, a0(env));
          }
          return env => {
            const inner = {};
            for (let i = 0; i < params.length; i++) inner[params[i]] = args[i](env);
            return body(inner);
          };
        }
        if (node.primes) throw new MathError('Function ' + node.name + ' is not defined');
        // implicit multiplication: a(x+1) or a(1,2)
        const mul = { type: 'bin', op: '*', a: { type: 'var', name: node.name }, b: node.args.length === 1 ? node.args[0] : { type: 'point', a: node.args[0], b: node.args[1] } };
        if (node.args.length > 2) throw new MathError('Function ' + node.name + ' is not defined');
        return c(mul);
      }
      case 'deriv': {
        const body = c(node.a), v = node.v;
        if (!ctx.locals.has(v)) throw new MathError('Can only differentiate with respect to a variable in use');
        return env => {
          const x = env[v];
          const h = 1e-5 * Math.max(1, Math.abs(x));
          const e1 = Object.assign({}, env), e2 = Object.assign({}, env);
          e1[v] = x + h; e2[v] = x - h;
          return arith('/', arith('-', body(e1), body(e2)), 2 * h);
        };
      }
      case 'piece': {
        const br = node.branches.map(b => ({ cond: c(b.cond), val: c(b.val) }));
        const other = node.otherwise ? c(node.otherwise) : null;
        return env => {
          for (const b of br) if (b.cond(env)) return b.val(env);
          return other ? other(env) : NaN;
        };
      }
      case 'cmp': {
        const ex = node.exprs.map(c), ops = node.ops;
        return env => {
          let prev = ex[0](env);
          for (let i = 0; i < ops.length; i++) {
            const cur = ex[i + 1](env);
            if (typeof prev !== 'number' || typeof cur !== 'number') throw new MathError('Conditions need numbers');
            if (!compare(ops[i], prev, cur)) return false;
            prev = cur;
          }
          return true;
        };
      }
      case 'sum': case 'prod': {
        const v = node.v;
        const lo = c(node.lo), hi = c(node.hi);
        const inner = Object.assign({}, ctx, { locals: new Set([...ctx.locals, v]) });
        const body = compile(node.body, inner);
        const isSum = node.type === 'sum';
        return env => {
          const a = Math.round(lo(env)), b = Math.round(hi(env));
          if (b - a > 1e6) throw new MathError('Too many terms');
          let acc = isSum ? 0 : 1;
          const e = Object.assign({}, env);
          for (let k = a; k <= b; k++) {
            e[v] = k;
            const val = body(e);
            acc = isSum ? arith('+', acc, val) : arith('*', acc, val);
          }
          return acc;
        };
      }
      case 'int': {
        const v = node.v;
        const lo = c(node.lo), hi = c(node.hi);
        const inner = Object.assign({}, ctx, { locals: new Set([...ctx.locals, v]) });
        const body = compile(node.body, inner);
        return env => {
          const a = lo(env), b = hi(env);
          if (typeof a !== 'number' || typeof b !== 'number') throw new MathError('Integral bounds must be numbers');
          return integrate(t => { const e = Object.assign({}, env); e[v] = t; const r = body(e); return typeof r === 'number' ? r : NaN; }, a, b);
        };
      }
    }
    throw new MathError('Cannot evaluate ' + node.type);
  }

  function integrate(f, a, b) {
    if (a === b) return 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      // map infinite range: x = t/(1-t^2)
      const g = t => { const x = t / (1 - t * t); return f(x) * (1 + t * t) / ((1 - t * t) ** 2); };
      const ta = a === -Infinity ? -1 : (a === Infinity ? 1 : solveMap(a));
      const tb = b === Infinity ? 1 : (b === -Infinity ? -1 : solveMap(b));
      return simpson(g, ta + 1e-9 * Math.sign(tb - ta), tb - 1e-9 * Math.sign(tb - ta), 2000);
    }
    return simpson(f, a, b, 1000);
  }
  function solveMap(x) { return x === 0 ? 0 : (-1 + Math.sqrt(1 + 4 * x * x)) / (2 * x); }
  function simpson(f, a, b, n) {
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }

  // ---------------------------------------------------------- free vars
  function freeVars(node, bound = new Set(), out = new Set(), calls = new Set()) {
    if (!node) return out;
    switch (node.type) {
      case 'var': if (!bound.has(node.name)) out.add(node.name); break;
      case 'call':
        calls.add(node.name);
        out.add('#fn:' + node.name);
        node.args.forEach(a => freeVars(a, bound, out, calls));
        break;
      case 'sum': case 'prod': case 'int': {
        freeVars(node.lo, bound, out, calls); freeVars(node.hi, bound, out, calls);
        const b2 = new Set(bound); b2.add(node.v);
        freeVars(node.body, b2, out, calls);
        break;
      }
      case 'deriv': freeVars(node.a, bound, out, calls); out.add(node.v); break;
      case 'piece':
        node.branches.forEach(b => { freeVars(b.cond, bound, out, calls); freeVars(b.val, bound, out, calls); });
        freeVars(node.otherwise, bound, out, calls);
        break;
      case 'cmp': node.exprs.forEach(e => freeVars(e, bound, out, calls)); break;
      case 'list': node.items.forEach(e => freeVars(e, bound, out, calls)); break;
      case 'range': freeVars(node.start, bound, out, calls); freeVars(node.second, bound, out, calls); freeVars(node.end, bound, out, calls); break;
      case 'fn': node.args.forEach(a => freeVars(a, bound, out, calls)); break;
      case 'index': freeVars(node.a, bound, out, calls); freeVars(node.i, bound, out, calls); break;
      default:
        for (const k of ['a', 'b']) if (node[k]) freeVars(node[k], bound, out, calls);
    }
    return out;
  }

  // ------------------------------------------------------------ formatting
  function formatNumber(v, digits) {
    if (typeof v !== 'number') return String(v);
    if (Number.isNaN(v)) return 'undefined';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '-∞';
    if (Object.is(v, -0) || Math.abs(v) < 1e-14) return '0';
    const a = Math.abs(v);
    if (a >= 1e12 || a < 1e-6) {
      const [m, e] = v.toExponential(digits == null ? 8 : Math.max(0, digits - 1)).split('e');
      return trimZeros(m) + ' × 10^' + parseInt(e, 10);
    }
    const s = digits != null ? v.toFixed(Math.max(0, digits)) : String(parseFloat(v.toPrecision(12)));
    return digits != null ? trimZeros(s) : s;
  }
  function trimZeros(s) { return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function formatValue(v, digits) {
    if (isList(v)) return '[' + v.slice(0, 50).map(x => formatValue(x, digits)).join(', ') + (v.length > 50 ? ', ...' : '') + ']';
    if (isPt(v)) return '(' + formatNumber(v.x, digits) + ', ' + formatNumber(v.y, digits) + ')';
    return formatNumber(v, digits);
  }

  const api = {
    tokenize, parse, compile, freeVars, formatNumber, formatValue, callBuiltin,
    MathError, settings, isPt, isList, BUILTIN_CONSTS, FUNC_SET, arith
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
