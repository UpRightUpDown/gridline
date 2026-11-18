const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The browser scripts in js/ load with plain <script> tags, and most have no unit
// tests, so a syntax error in one would otherwise only show up in the browser.
test('every browser script parses', () => {
  const dir = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), f);
  }
});
