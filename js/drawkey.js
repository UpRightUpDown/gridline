/* Z turns on drawing on the graph. With the pointer over the graph, a tap of Z turns
 * drawing on and leaves it on, so a touchpad can draw: Windows ignores the touchpad while
 * a key is held. Tap Z again or press Esc to turn it off. Holding Z while dragging with a
 * mouse also works, and turns off when Z comes up. Z over the graph never types a "z". */
(function (root) {
  'use strict';

  function createDrawKey(onChange) {
    let on = false;
    let zDown = false;  // a Z pressed over the graph is still down
    let drew = false;   // a stroke started during this Z press
    const set = v => { if (v !== on) { on = v; if (onChange) onChange(v); } };
    const stop = () => { zDown = false; set(false); };
    return {
      get on() { return on; },
      // Returns whether the key should be kept from the page.
      keydown(e, hovering) {
        if (e.key === 'Escape' && on) { stop(); return { swallow: false }; }
        const plainZ = String(e.key).toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (!plainZ) return { swallow: false };
        if (e.repeat) return { swallow: zDown };
        if (!hovering) return { swallow: false };
        if (on) { stop(); return { swallow: true }; }
        zDown = true; drew = false;
        set(true);
        return { swallow: true };
      },
      keyup(e) {
        if (String(e.key).toLowerCase() !== 'z' || !zDown) return;
        zDown = false;
        if (drew) set(false); // held while drawing: letting go ends it
      },
      sketchStart() { drew = true; },
      blur() { if (zDown) stop(); },
      stop,
    };
  }

  const api = { createDrawKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GDrawKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
