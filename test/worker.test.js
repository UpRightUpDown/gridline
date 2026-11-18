const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'worker', 'index.js')).href).then(m => m.default);
const fakeKV = () => { const m = new Map(); return { get: async k => m.has(k) ? m.get(k) : null, put: async (k, v) => { m.set(k, v); } }; };
const url = 'https://example.test/branding';

test('worker returns {} before anything is saved, then what was saved', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  let res = await worker.fetch(new Request(url), env);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), {});
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  res = await worker.fetch(new Request(url, { method: 'PUT', body: JSON.stringify({ barColor: '#123456' }) }), env);
  assert.strictEqual(res.status, 204);
  res = await worker.fetch(new Request(url), env);
  assert.deepStrictEqual(await res.json(), { barColor: '#123456' });
});

test('worker rejects bad bodies and unknown paths', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  const put = body => worker.fetch(new Request(url, { method: 'PUT', body }), env);
  assert.strictEqual((await put('nope')).status, 400);
  assert.strictEqual((await put('[1,2]')).status, 400);
  assert.strictEqual((await put('x'.repeat(4 * 1024 * 1024 + 1))).status, 413);
  assert.strictEqual((await worker.fetch(new Request('https://example.test/other'), env)).status, 404);
  assert.deepStrictEqual(await (await worker.fetch(new Request(url), env)).json(), {});
});
