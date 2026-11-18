const test = require('node:test');
const assert = require('node:assert');
const D = require('../js/done.js');

test('elapsed counts whole minutes, with the right plural', () => {
  const start = new Date(2026, 10, 18, 10, 15, 35);
  const at = s => new Date(start.getTime() + s * 1000);
  assert.strictEqual(D.elapsed(start, at(0)), '0 minutes');
  assert.strictEqual(D.elapsed(start, at(119)), '1 minute');
  assert.strictEqual(D.elapsed(start, at(9 * 60 + 5)), '9 minutes');
  assert.strictEqual(D.elapsed(start, at(75 * 60)), '75 minutes');
});

test('startTime shows the clock time with seconds and AM/PM', () => {
  assert.strictEqual(D.startTime(new Date(2026, 10, 18, 10, 15, 35)), '10:15:35 AM');
  assert.strictEqual(D.startTime(new Date(2026, 10, 18, 0, 5, 9)), '12:05:09 AM');
  assert.strictEqual(D.startTime(new Date(2026, 10, 18, 13, 0, 0)), '1:00:00 PM');
});

test('paragraphs splits the message on blank lines and drops empty ones', () => {
  assert.deepStrictEqual(D.paragraphs('One line.\n\n  Two\nlines.  \n\n\n'), ['One line.', 'Two\nlines.']);
  assert.deepStrictEqual(D.paragraphs('   '), []);
  assert.deepStrictEqual(D.paragraphs(undefined), []);
});
