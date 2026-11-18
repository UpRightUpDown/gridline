const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'claude', 'worker.js')).href);
const askReq = body => new Request('https://example.test/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
// Stands in for the Anthropic SDK client at the network boundary.
const fakeClient = reply => {
  const calls = [];
  return { calls, beta: { messages: { create: async (params, opts) => { calls.push(params); calls.opts = opts; if (reply instanceof Error) throw reply; return reply; } } } };
};
const answer = steps => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ steps }) }] });

test('ask sends the question and rows to Claude and returns its steps', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  const res = await handle(askReq({ question: 'what is a', context: ['b=2'] }), client);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepStrictEqual(await res.json(), { steps: [{ type: 'expression', content: 'a=1' }] });
  const p = client.calls[0];
  assert.strictEqual(p.model, 'claude-opus-5-5');
  assert.strictEqual(p.output_config.format.type, 'json_schema');
  assert.match(p.messages[0].content, /what is a/);
  assert.match(p.messages[0].content, /b=2/);
  assert.ok(client.calls.opts.signal instanceof AbortSignal);
});

test('ask reports a refusal or an API failure as an error', async () => {
  const { handle } = await load();
  let res = await handle(askReq({ question: 'q' }), fakeClient({ stop_reason: 'refusal', content: [] }));
  assert.strictEqual(res.status, 502);
  assert.match((await res.json()).error, /declined/);
  res = await handle(askReq({ question: 'q' }), fakeClient(new Error('overloaded')));
  assert.strictEqual(res.status, 502);
  assert.match((await res.json()).error, /could not answer/i);
});

test('ask rejects bad bodies and unknown paths', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([]));
  assert.strictEqual((await handle(askReq('nope'), client)).status, 400);
  assert.strictEqual((await handle(askReq({ question: '' }), client)).status, 400);
  assert.strictEqual((await handle(askReq({ question: 'x'.repeat(5001) }), client)).status, 413);
  assert.strictEqual((await handle(new Request('https://example.test/other'), client)).status, 404);
  assert.strictEqual((await handle(new Request('https://example.test/ask', { method: 'OPTIONS' }), client)).status, 204);
  assert.strictEqual(client.calls.length, 0);
});

test('the system prompt keeps its LaTeX backslashes', async () => {
  const { SYSTEM } = await load();
  assert.ok(SYSTEM.includes(String.raw`\frac{d}{dx}`));
  assert.ok(SYSTEM.includes(String.raw`\theta`));
  assert.doesNotMatch(SYSTEM, /[\f\t\b\v]/);
});

test('ask reads the final answer after a fallback and lower-cases step types', async () => {
  const { handle } = await load();
  const client = fakeClient({ stop_reason: 'end_turn', content: [
    { type: 'text', text: '{"steps":[{"type":"note","content":"Let' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'text', text: JSON.stringify({ steps: [{ type: 'Expression', content: 'a=1' }] }) }
  ] });
  const res = await handle(askReq({ question: 'q' }), client);
  assert.deepStrictEqual(await res.json(), { steps: [{ type: 'expression', content: 'a=1' }] });
});

test('ask gives Claude the hand-drawn strokes as graph coordinates', async () => {
  const { handle, SYSTEM } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  const res = await handle(askReq({ question: 'what curve is this', sketches: [[[0, 0], [1, 1], [2, 4]], 'junk', [[1, 'x']]] }), client);
  assert.strictEqual(res.status, 200);
  const content = client.calls[0].messages[0].content;
  assert.match(content, /Stroke 1: \(0, 0\) \(1, 1\) \(2, 4\)/);
  assert.doesNotMatch(content, /Stroke 2/);
  assert.match(SYSTEM, /hand-drawn/i);
});

test('ask passes on a dot and up to 40 strokes', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  const strokes = [[[3, 4]], ...Array.from({ length: 45 }, (_, k) => [[k, 0], [k, 1]])];
  await handle(askReq({ question: 'q', sketches: strokes }), client);
  const content = client.calls[0].messages[0].content;
  assert.match(content, /Stroke 1: \(3, 4\)\n/);
  assert.match(content, /Stroke 40: /);
  assert.doesNotMatch(content, /Stroke 41: /);
});

test('ask leaves the drawing section out when nothing was drawn', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  await handle(askReq({ question: 'q', sketches: [] }), client);
  assert.doesNotMatch(client.calls[0].messages[0].content, /drew|Stroke/);
});

test('ask passes on every row, including a long table', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  const rows = Array.from({ length: 150 }, (_, i) => 'a_{' + i + '}=' + i);
  const table = 'Table (headers, then one row per line):\n["x_{1}","y_{1}"]\n' + Array.from({ length: 2000 }, (_, i) => JSON.stringify([String(i), String(i * i)])).join('\n');
  const res = await handle(askReq({ question: 'q', context: rows.concat(table) }), client);
  assert.strictEqual(res.status, 200);
  const prompt = client.calls[0].messages[0].content;
  assert.match(prompt, /a_\{149\}=149/);
  assert.match(prompt, /\["1999","3996001"\]/);
});

test('ask says when the rows are too much to send', async () => {
  const { handle } = await load();
  const client = fakeClient(answer([{ type: 'expression', content: 'a=1' }]));
  const res = await handle(askReq({ question: 'q', context: ['a=' + '1'.repeat(240000)] }), client);
  assert.strictEqual(res.status, 413);
  assert.match((await res.json()).error, /too much in the calculator/);
  assert.strictEqual(client.calls.length, 0);
});
