const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/references.js');

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok: status < 400, status, json: async () => body, text: async () => String(body) }; };
  fn.calls = calls;
  return fn;
};

test('kindOf sorts files into PDFs, text and images, and turns the rest away', () => {
  assert.strictEqual(R.kindOf({ name: 'unit3.pdf', type: 'application/pdf' }), 'pdf');
  assert.strictEqual(R.kindOf({ name: 'notes.md', type: '' }), 'text');
  assert.strictEqual(R.kindOf({ name: 'data.csv', type: 'text/csv' }), 'text');
  assert.strictEqual(R.kindOf({ name: 'Steps.TXT', type: 'text/plain' }), 'text');
  assert.strictEqual(R.kindOf({ name: 'board.jpg', type: 'image/jpeg' }), 'image');
  assert.strictEqual(R.kindOf({ name: 'logo.svg', type: 'image/svg+xml' }), null);
  assert.strictEqual(R.kindOf({ name: 'essay.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), null);
});

test('list, add and remove talk to the settings worker', async () => {
  let f = fakeFetch(200, [{ id: 'a', name: 'm.pdf', kind: 'pdf', size: 10 }]);
  assert.deepStrictEqual(await R.list(f), [{ id: 'a', name: 'm.pdf', kind: 'pdf', size: 10 }]);
  assert.strictEqual(f.calls[0].url, R.URL);

  f = fakeFetch(201, { id: 'b', name: 'm.txt', kind: 'text', size: 3 });
  const added = await R.add({ name: 'm.txt', kind: 'text', mediaType: 'text/plain', data: 'abc' }, f);
  assert.strictEqual(added.id, 'b');
  assert.strictEqual(f.calls[0].opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(f.calls[0].opts.body), { name: 'm.txt', kind: 'text', mediaType: 'text/plain', data: 'abc' });

  f = fakeFetch(204, null);
  await R.remove('b', f);
  assert.strictEqual(f.calls[0].url, R.URL + '/b');
  assert.strictEqual(f.calls[0].opts.method, 'DELETE');
});

test('add passes on the reason the worker gives for turning a file away', async () => {
  await assert.rejects(R.add({ name: 'x.pdf', kind: 'pdf', mediaType: 'application/pdf', data: 'x' }, fakeFetch(413, 'The reference material is full (20 MB). Remove a file first.')), /full/);
  await assert.rejects(R.list(async () => { throw new TypeError('Failed to fetch'); }), /could not reach/i);
});
