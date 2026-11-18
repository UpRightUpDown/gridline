const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const run = require('../relay/run.js');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'relay', 'worker.js')).href);
const fakeCtx = () => { const sockets = []; return { sockets, getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws) }; };
const askReq = body => new Request('https://example.test/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('ask says Claude is offline when no relay is connected', async () => {
  const { Relay } = await load();
  const res = await new Relay(fakeCtx(), { RELAY_TOKEN: 't' }).fetch(askReq({ question: 'hi', context: [] }));
  assert.strictEqual(res.status, 503);
  assert.match((await res.json()).error, /offline/);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('ask forwards the question to the relay and returns its answer', async () => {
  const { Relay } = await load();
  const ctx = fakeCtx();
  const relay = new Relay(ctx, { RELAY_TOKEN: 't' });
  const sent = [];
  const sock = { readyState: 1, send: m => { sent.push(JSON.parse(m)); setTimeout(() => relay.webSocketMessage(sock, JSON.stringify({ id: sent[0].id, steps: [{ type: 'expression', content: 'a=1' }] }))); } };
  ctx.sockets.push(sock);
  const res = await relay.fetch(askReq({ question: 'what is a', context: ['b=2'] }));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { steps: [{ type: 'expression', content: 'a=1' }] });
  assert.strictEqual(sent[0].question, 'what is a');
  assert.deepStrictEqual(sent[0].context, ['b=2']);
});

test('ask rejects bad bodies, and the relay socket needs the token', async () => {
  const { Relay } = await load();
  const relay = new Relay(fakeCtx(), { RELAY_TOKEN: 't' });
  assert.strictEqual((await relay.fetch(askReq('nope'))).status, 400);
  assert.strictEqual((await relay.fetch(askReq({ question: '' }))).status, 400);
  assert.strictEqual((await relay.fetch(askReq({ question: 'x'.repeat(5001) }))).status, 413);
  const ws = (q) => new Request('https://example.test/relay' + q, { headers: { Upgrade: 'websocket' } });
  assert.strictEqual((await relay.fetch(ws('?token=wrong'))).status, 403);
  assert.strictEqual((await new Relay(fakeCtx(), {}).fetch(ws('?token='))).status, 403);
});

test('the local relay turns Claude output into steps', async () => {
  const out = JSON.stringify({ is_error: false, structured_output: { steps: [{ type: 'note', content: 'n' }] } });
  let prompt;
  const steps = await run.answer({ question: 'q?', context: ['f(x)=x'] }, async p => { prompt = p; return out; });
  assert.deepStrictEqual(steps, [{ type: 'note', content: 'n' }]);
  assert.match(prompt, /q\?/);
  assert.match(prompt, /f\(x\)=x/);
  await assert.rejects(run.answer({ question: 'q' }, async () => JSON.stringify({ is_error: true, result: 'limit hit' })), /limit hit/);
});

test('the system prompt keeps its LaTeX backslashes', () => {
  assert.ok(run.SYSTEM.includes(String.raw`\frac{d}{dx}`));
  assert.ok(run.SYSTEM.includes(String.raw`\theta`));
  assert.doesNotMatch(run.SYSTEM, /[\f\t\b\v]/);
});

test('a question fails at once when the relay drops', async () => {
  const { Relay } = await load();
  const ctx = fakeCtx();
  const relay = new Relay(ctx, { RELAY_TOKEN: 't' });
  const sock = { readyState: 1, close() {}, send: () => setTimeout(() => relay.webSocketClose(sock, 1006, '')) };
  ctx.sockets.push(sock);
  const res = await relay.fetch(askReq({ question: 'q' }));
  assert.strictEqual(res.status, 502);
  assert.match((await res.json()).error, /offline/);
});
