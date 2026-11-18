const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/ask.js');

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok: status < 400, status, json: async () => body }; };
  fn.calls = calls;
  return fn;
};

test('ask posts the question and context, and returns the steps as rows', async () => {
  const f = fakeFetch(200, { steps: [{ type: 'note', content: 'Use the power rule.' }, { type: 'expression', content: 'f(x)=x^{2}' }] });
  const steps = await A.ask('derivative of x^2', ['g(x)=x'], f);
  assert.deepStrictEqual(steps, [{ type: 'note', content: 'Use the power rule.' }, { type: 'expression', content: 'f(x)=x^{2}' }]);
  assert.strictEqual(f.calls[0].url, A.ASK_URL);
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(f.calls[0].opts.body), { question: 'derivative of x^2', context: ['g(x)=x'] });
});

test('ask drops malformed steps and fails when nothing usable comes back', async () => {
  const f = fakeFetch(200, { steps: [{ type: 'script', content: 'x' }, { type: 'note', content: '  ' }, { type: 'expression', content: 5 }, null, { type: 'expression', content: ' a=1 ' }] });
  assert.deepStrictEqual(await A.ask('q', [], f), [{ type: 'expression', content: 'a=1' }]);
  await assert.rejects(A.ask('q', [], fakeFetch(200, { steps: 'nope' })), /no steps/i);
});

test('ask passes on the error the server gives', async () => {
  await assert.rejects(A.ask('q', [], fakeFetch(503, { error: 'Claude is offline right now.' })), /offline/);
  const broken = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(A.ask('q', [], broken), /could not reach Claude/i);
});

test('ask sends hand-drawn strokes as rounded, thinned point lists', async () => {
  const f = fakeFetch(200, { steps: [{ type: 'expression', content: 'a=1' }] });
  const long = Array.from({ length: 2000 }, (_, i) => [i / 100, Math.sin(i / 100)]);
  await A.ask('what is this', [], f, [[[0.12345678, -2.98765432], [1, 2]], [[5, 5]], [], long]);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepStrictEqual(body.sketches[0], [[0.123457, -2.98765], [1, 2]]);
  assert.deepStrictEqual(body.sketches[1], [[5, 5]], 'a dot is sent as a one-point stroke');
  assert.strictEqual(body.sketches.length, 3, 'an empty stroke is dropped');
  const thin = body.sketches[2];
  assert.ok(thin.length <= A.MAX_SKETCH_POINTS);
  assert.deepStrictEqual(thin[0], [0, 0]);
  assert.deepStrictEqual(thin.at(-1), [19.99, Number(Math.sin(19.99).toPrecision(6))], 'the stroke keeps its end');
});

test('ask keeps every stroke of a many-stroke drawing within one point budget', async () => {
  const f = fakeFetch(200, { steps: [{ type: 'expression', content: 'a=1' }] });
  const strokes = Array.from({ length: 30 }, (_, k) => Array.from({ length: 200 }, (_, i) => [k, i]));
  await A.ask('what does this say', [], f, strokes);
  const sent = JSON.parse(f.calls[0].opts.body).sketches;
  assert.strictEqual(sent.length, 30);
  assert.deepStrictEqual(sent[0][0], [0, 0], 'the first stroke is kept');
  assert.ok(sent.flat().length <= A.MAX_SKETCH_POINTS);
});

test('ask leaves sketches out when nothing was drawn', async () => {
  const f = fakeFetch(200, { steps: [{ type: 'expression', content: 'a=1' }] });
  await A.ask('q', [], f, []);
  assert.strictEqual(JSON.parse(f.calls[0].opts.body).sketches, undefined);
});
