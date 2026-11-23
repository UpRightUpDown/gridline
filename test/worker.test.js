const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'worker', 'index.js')).href).then(m => m.default);
const fakeKV = require('./kv.js');
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
const names = async (worker, env) => (await (await worker.fetch(new Request(refs), env)).json()).map(r => r.name);

test('worker adds, lists and removes reference files', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  assert.deepStrictEqual(await names(worker, env), []);
  let res = await post(worker, env, { name: 'notes.pdf', kind: 'pdf', mediaType: 'application/pdf', data: 'JVBERi0=' });
  assert.strictEqual(res.status, 201);
  const added = await res.json();
  assert.deepStrictEqual(Object.keys(added).sort(), ['id', 'kind', 'name', 'size']);
  // a second upload straight after the first: KV allows one write a second to a key
  res = await post(worker, env, { name: 'steps.txt', kind: 'text', mediaType: 'text/plain', data: 'Complete the square.' });
  assert.strictEqual(res.status, 201);
  const listed = await (await worker.fetch(new Request(refs), env)).json();
  assert.deepStrictEqual(listed.map(r => r.name), ['notes.pdf', 'steps.txt'], 'listed in upload order');
  assert.strictEqual(listed[0].data, undefined, 'the list leaves out file contents');
  res = await worker.fetch(new Request(refs + '/' + added.id, { method: 'DELETE' }), env);
  assert.strictEqual(res.status, 204);
  assert.deepStrictEqual(await names(worker, env), ['steps.txt']);
});

test('worker rejects bad reference files', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  assert.strictEqual((await post(worker, env, { name: 'a', kind: 'video', mediaType: 'video/mp4', data: 'x' })).status, 400);
  assert.strictEqual((await post(worker, env, { name: 'a.png', kind: 'image', mediaType: 'image/bmp', data: 'x' })).status, 400);
  assert.strictEqual((await post(worker, env, { name: 'a.txt', kind: 'text', mediaType: 'text/plain', data: '' })).status, 400);
  assert.strictEqual((await post(worker, env, { name: 'a.txt', kind: 'text', mediaType: 'text/plain', data: ' \n ' })).status, 400);
  assert.deepStrictEqual(await names(worker, env), []);
});

test('worker caps all reference files together at 5 MB, counted in bytes', async () => {
  const worker = await load();
  const env = { SETTINGS: fakeKV() };
  const three = 'x'.repeat(3 * 1000 * 1000);
  assert.strictEqual((await post(worker, env, { name: 'a.pdf', kind: 'pdf', mediaType: 'application/pdf', data: three })).status, 201);
  let res = await post(worker, env, { name: 'b.pdf', kind: 'pdf', mediaType: 'application/pdf', data: three });
  assert.strictEqual(res.status, 413);
  assert.match(await res.text(), /full/i);
  // 1 million characters, but 3 million bytes in UTF-8
  res = await post(worker, env, { name: 'c.txt', kind: 'text', mediaType: 'text/plain', data: '中'.repeat(1000 * 1000) });
  assert.strictEqual(res.status, 413);
  assert.deepStrictEqual(await names(worker, env), ['a.pdf']);
});

test('a store that fails leaves the saved files alone and says so', async () => {
  const worker = await load();
  const kv = fakeKV();
  const env = { SETTINGS: kv };
  await post(worker, env, { name: 'keep.txt', kind: 'text', mediaType: 'text/plain', data: 'Keep me.' });
  const list = kv.list;
  kv.list = async () => { throw new Error('KV down'); };
  const res = await post(worker, env, { name: 'new.txt', kind: 'text', mediaType: 'text/plain', data: 'New.' });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  kv.list = list;
  assert.deepStrictEqual(await names(worker, env), ['keep.txt']);
});
