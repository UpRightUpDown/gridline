const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The browser scripts in js/ load with plain <script> tags, and most have no unit
// tests, so a syntax error in one would otherwise only show up in the browser.
// The Workers runtime refuses to start a worker whose entry module exports a plain value
// ("Incorrect type for map entry ... not of type 'function or ExportedHandler'").
test('worker entry modules export only functions and handlers', async () => {
  const { pathToFileURL } = require('node:url');
  for (const entry of ['worker/index.js', 'claude/worker.js']) {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', entry)).href);
    for (const [name, value] of Object.entries(mod)) {
      const ok = typeof value === 'function' || (value && typeof value === 'object' && typeof value.fetch === 'function');
      assert.ok(ok, entry + ' exports ' + name + ', which is not a function or handler');
    }
  }
});

test('every browser script parses', () => {
  const dir = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), f);
  }
});
