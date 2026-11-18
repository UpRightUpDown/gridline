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
