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
