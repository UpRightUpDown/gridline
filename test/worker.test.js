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

const refs = 'https://example.test/references';
const post = (worker, env, body) => worker.fetch(new Request(refs, { method: 'POST', body: JSON.stringify(body) }), env);

test('worker adds, lists and removes reference files', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  const list = async () => (await worker.fetch(new Request(refs), env)).json();
  assert.deepStrictEqual(await list(), []);
  let res = await post(worker, env, { name: 'notes.pdf', kind: 'pdf', mediaType: 'application/pdf', data: 'JVBERi0=' });
  assert.strictEqual(res.status, 201);
  const { id } = await res.json();
  await post(worker, env, { name: 'steps.txt', kind: 'text', mediaType: 'text/plain', data: 'Complete the square.' });
  const listed = await list();
  assert.deepStrictEqual(listed.map(r => r.name), ['notes.pdf', 'steps.txt']);
  assert.strictEqual(listed[0].data, undefined, 'the list leaves out file contents');
  const stored = JSON.parse(await env.SETTINGS.get('references'));
  assert.strictEqual(stored[1].data, 'Complete the square.');
  res = await worker.fetch(new Request(refs + '/' + id, { method: 'DELETE' }), env);
  assert.strictEqual(res.status, 204);
  assert.deepStrictEqual((await list()).map(r => r.name), ['steps.txt']);
});

test('worker rejects bad reference files and a full store', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  assert.strictEqual((await post(worker, env, { name: 'a', kind: 'video', mediaType: 'video/mp4', data: 'x' })).status, 400);
  assert.strictEqual((await post(worker, env, { name: 'a.png', kind: 'image', mediaType: 'image/bmp', data: 'x' })).status, 400);
  assert.strictEqual((await post(worker, env, { name: 'a.txt', kind: 'text', mediaType: 'text/plain', data: '' })).status, 400);
  const big = 'x'.repeat(12 * 1024 * 1024);
  assert.strictEqual((await post(worker, env, { name: 'a.pdf', kind: 'pdf', mediaType: 'application/pdf', data: big })).status, 201);
  const res = await post(worker, env, { name: 'b.pdf', kind: 'pdf', mediaType: 'application/pdf', data: big });
  assert.strictEqual(res.status, 413);
  assert.match(await res.text(), /full/i);
  assert.deepStrictEqual((await (await worker.fetch(new Request(refs), env)).json()).map(r => r.name), ['a.pdf']);
});
