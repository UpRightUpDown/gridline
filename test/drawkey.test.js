const test = require('node:test');
const assert = require('node:assert');
const { createDrawKey } = require('../js/drawkey.js');

const Z = { key: 'z' };
const over = true, away = false;

test('a tap of Z over the graph turns drawing on and leaves it on, for a touchpad', () => {
  const d = createDrawKey();
  assert.deepStrictEqual(d.keydown(Z, over), { swallow: true });
  assert.strictEqual(d.on, true);
  d.keyup(Z);
  assert.strictEqual(d.on, true, 'still on after Z comes up');
  d.sketchStart(); // first drag
  d.sketchStart(); // second drag, nothing held
  assert.strictEqual(d.on, true);
});

test('a second tap of Z or Esc turns drawing off', () => {
  const d = createDrawKey();
  d.keydown(Z, over); d.keyup(Z);
  d.keydown(Z, over); d.keyup(Z);
  assert.strictEqual(d.on, false);
  d.keydown(Z, over); d.keyup(Z);
  d.keydown({ key: 'Escape' }, over);
  assert.strictEqual(d.on, false);
});

test('holding Z while dragging with a mouse draws, and letting go ends it', () => {
  const d = createDrawKey();
  d.keydown(Z, over);
  d.sketchStart();
  assert.deepStrictEqual(d.keydown({ key: 'z', repeat: true }, over), { swallow: true }, 'no row of z\'s');
  d.keyup(Z);
  assert.strictEqual(d.on, false);
});

test('Z away from the graph, or with Ctrl, types or undoes as usual', () => {
  const d = createDrawKey();
  assert.deepStrictEqual(d.keydown(Z, away), { swallow: false });
  assert.deepStrictEqual(d.keydown({ key: 'z', ctrlKey: true }, over), { swallow: false });
  assert.strictEqual(d.on, false);
});

test('stop turns drawing off, as sending a question does', () => {
  const d = createDrawKey();
  d.keydown(Z, over); d.keyup(Z);
  d.stop();
  assert.strictEqual(d.on, false);
});

test('changes are reported, so the graph cursor follows', () => {
  const seen = [];
  const d = createDrawKey(on => seen.push(on));
  d.keydown(Z, over); d.keyup(Z); d.keydown(Z, over); d.keyup(Z);
  assert.deepStrictEqual(seen, [true, false]);
});

test('with drawing on, holding Z keeps its repeats out of the row, draws, and ends on release', () => {
  const d = createDrawKey();
  d.keydown(Z, over); d.keyup(Z); // tapped on
  assert.deepStrictEqual(d.keydown(Z, over), { swallow: true });
  assert.strictEqual(d.keydown({ key: 'z', repeat: true }, over).swallow, true);
  assert.strictEqual(d.on, true, 'a drag during this hold still draws');
  d.sketchStart();
  d.keyup(Z);
  assert.strictEqual(d.on, false);
});

test('Esc while Z is held still keeps the repeats out', () => {
  const d = createDrawKey();
  d.keydown(Z, over);
  d.keydown({ key: 'Escape' }, over);
  assert.strictEqual(d.on, false);
  assert.strictEqual(d.keydown({ key: 'z', repeat: true }, over).swallow, true);
});

test('typing a word with z while the pointer rests on the graph keeps the z', () => {
  const d = createDrawKey();
  const row = {};
  d.keydown(Z, over, row); d.keyup(Z);
  const r = d.keydown({ key: 'e' }, over);
  assert.deepStrictEqual(r, { swallow: false, typeHeld: { key: 'z', target: row } });
  assert.strictEqual(d.on, false);
});

test('once a stroke is drawn, or for Shift alone, no z is typed', () => {
  const d = createDrawKey();
  d.keydown(Z, over, {}); d.keyup(Z);
  assert.deepStrictEqual(d.keydown({ key: 'Shift' }, over), { swallow: false });
  d.sketchStart();
  assert.deepStrictEqual(d.keydown({ key: 'e' }, over), { swallow: false });
  assert.strictEqual(d.on, true);
});
