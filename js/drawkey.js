/* Z turns on drawing on the graph. With the pointer over the graph, a tap of Z turns
 * drawing on and leaves it on, so a touchpad can draw: Windows ignores the touchpad while
 * a key is held. Tap Z again or press Esc to turn it off. Holding Z while dragging with a
 * mouse also works, and turns off when Z comes up.
 * The Z that turned drawing on is held back. If a key that types a character comes before
 * any stroke, the user was typing, so the z is handed back to be typed and drawing turns off.
 * Other keys, like Enter or the arrows, drop the held z. */
(function (root) {
  'use strict';

  function createDrawKey(onChange) {
    let on = false;
    let zDown = false;        // a swallowed Z press is still down: keep its repeats out
    let offOnRelease = false; // this Z press ends drawing when it comes up
    let drew = false;         // a stroke started since drawing turned on
    let held = null;          // { key, target } of the Z that turned drawing on
    const set = v => { if (v !== on) { on = v; if (onChange) onChange(v); } };
    const stop = () => { offOnRelease = false; held = null; set(false); };
    return {
      get on() { return on; },
      // Returns whether the key should be kept from the page, and any z to type first.
      keydown(e, hovering, target) {
        if (e.key === 'Escape' && on) { stop(); return { swallow: false }; }
        const plainZ = String(e.key).toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (!plainZ) {
          if (!held || drew || String(e.key).length !== 1) {
            if (held && !/^(Shift|Control|Alt|AltGraph|Meta|CapsLock)$/.test(e.key)) held = null; // Enter, arrows: drop the z
            return { swallow: false };
          }
          const z = held; stop();
          return { swallow: false, typeHeld: z };
        }
        if (e.repeat) return { swallow: zDown };
        if (!hovering) return { swallow: false };
        zDown = true;
        if (on) { offOnRelease = true; return { swallow: true }; }
        drew = false; held = { key: e.key, target };
        set(true);
        return { swallow: true };
      },
      keyup(e) {
        if (String(e.key).toLowerCase() !== 'z' || !zDown) return;
        zDown = false;
        if (offOnRelease || drew) stop(); // a second tap, or held while drawing
      },
      sketchStart() { drew = true; held = null; },
      blur() { if (zDown) { zDown = false; stop(); } },
      stop,
    };
  }

  const api = { createDrawKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GDrawKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
