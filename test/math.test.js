const test = require('node:test');
const assert = require('node:assert');
const M = require('../js/math.js');
const P = require('../js/program.js');

const ctx0 = () => ({ locals: new Set(['x', 'y', 't']), lookupVar: () => null, lookupFn: () => null, unknown: new Set() });
function ev(latex, env = {}) {
  const st = M.parse(latex);
  assert.strictEqual(st.type, 'expr');
  return M.compile(st.expr, ctx0())(env);
}
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('arithmetic and precedence', () => {
  close(ev('1+2\\cdot3'), 7);
  close(ev('2^{3}'), 8);
  close(ev('-2^{2}'), -4);
  close(ev('\\frac{1}{4}+1'), 1.25);
  close(ev('2\\left(3+1\\right)'), 8);
  close(ev('2x', { x: 3 }), 6);
  close(ev('\\sqrt{16}'), 4);
  close(ev('\\sqrt[3]{-8}'), -2);
  close(ev('\\left|-3\\right|'), 3);
  close(ev('5!'), 120);
  close(ev('x^{\\frac{1}{3}}', { x: -27 }), -3);
});

test('functions with and without parentheses', () => {
  close(ev('\\sin\\left(\\frac{\\pi}{2}\\right)'), 1);
  close(ev('\\sin x', { x: Math.PI / 2 }), 1);
  close(ev('\\sin^{2}x+\\cos^{2}x', { x: 0.7 }), 1);
  close(ev('\\ln e'), 1);
  close(ev('\\log_{2}8'), 3);
  close(ev('\\log100'), 2);
  close(ev('\\operatorname{mean}\\left(\\left[1,2,3\\right]\\right)'), 2);
  close(ev('\\operatorname{mod}\\left(-1,3\\right)'), 2);
  close(ev('\\operatorname{nCr}\\left(5,2\\right)'), 10);
  close(ev('sin(x)', { x: 0 }), 0);
});

test('lists, ranges, points, piecewise, sums and integrals', () => {
  assert.deepStrictEqual(ev('\\left[1,2,3\\right]\\cdot2'), [2, 4, 6]);
  assert.deepStrictEqual(ev('\\left[1...5\\right]'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(ev('\\left(1,2\\right)+\\left(3,4\\right)'), { x: 4, y: 6 });
  close(ev('\\left\\{x<0:-x,x\\right\\}', { x: -3 }), 3);
  assert.ok(Number.isNaN(ev('x\\left\\{x>0\\right\\}', { x: -1 })));
  close(ev('\\sum_{n=1}^{10}n'), 55);
  close(ev('\\prod_{n=1}^{5}n'), 120);
  close(ev('\\int_{0}^{1}x^{2}dx'), 1 / 3, 1e-6);
});

test('program classifies expressions', () => {
  const items = [
    { id: 1, type: 'expression', latex: 'y=x^{2}', color: '#c74440' },
    { id: 2, type: 'expression', latex: 'a=3', color: '#2d70b3' },
    { id: 3, type: 'expression', latex: 'f\\left(x\\right)=ax+1', color: '#388c46' },
    { id: 4, type: 'expression', latex: 'f\\left(2\\right)', color: '#6042a6' },
    { id: 5, type: 'expression', latex: 'x^{2}+y^{2}=25', color: '#000' },
    { id: 6, type: 'expression', latex: 'y=bx', color: '#000' },
    { id: 7, type: 'expression', latex: '\\left(1,2\\right)', color: '#000' },
    { id: 8, type: 'expression', latex: 'r=\\theta', color: '#000' },
    { id: 9, type: 'expression', latex: 'f\'\\left(2\\right)', color: '#000' },
  ];
  const out = P.build(items);
  assert.strictEqual(out.byId.get(2).slider.value, 3);
  close(out.byId.get(4).value, 7);
  assert.deepStrictEqual(out.byId.get(6).missing, ['b']);
  close(out.byId.get(9).value, 3, 1e-5);
  const kinds = out.graphs.map(g => g.kind).sort();
  assert.deepStrictEqual(kinds, ['fx', 'fx', 'implicit', 'points', 'polar']);
});

test('regression fits a line through table data', () => {
  const items = [
    { id: 1, type: 'table', color: '#c74440', columns: [
      { latex: 'x_{1}', values: ['1', '2', '3', '4'] },
      { latex: 'y_{1}', values: ['3', '5', '7', '9'] }] },
    { id: 2, type: 'expression', latex: 'y_{1}\\sim mx_{1}+b', color: '#2d70b3' },
  ];
  const out = P.build(items);
  const reg = out.byId.get(2).regression;
  close(reg.params.m, 2, 1e-4);
  close(reg.params.b, 1, 1e-4);
  close(reg.r2, 1, 1e-6);
});
