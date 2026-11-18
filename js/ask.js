/* Ask Claude: sends a question to the gridline-claude worker and returns the answer as
 * expression-list rows. Works in the browser (window.GAsk) and in Node. */
(function (root) {
  'use strict';
  const ASK_URL = 'https://gridline-claude.uprightupdown.workers.dev/ask';
  const MAX_STEPS = 40;
  const MAX_LEN = 2000;
  const MAX_SKETCHES = 40;
  const MAX_SKETCH_POINTS = 800; // shared by all strokes

  // Hand-drawn strokes as [[x, y], ...] in graph coordinates: rounded, and each thinned to evenly
  // spaced points that keep both ends, so all strokes together fit in MAX_SKETCH_POINTS.
  // A one-point stroke is a dot and is kept.
  function cleanSketches(strokes) {
    if (!Array.isArray(strokes)) return [];
    const round = v => Number(v.toPrecision(6));
    const kept = strokes
      .map(s => Array.isArray(s) ? s.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [])
      .filter(s => s.length)
      .slice(0, MAX_SKETCHES);
    const each = Math.floor(MAX_SKETCH_POINTS / Math.max(kept.length, 1));
    return kept.map(s => {
      const n = Math.min(s.length, each);
      return Array.from({ length: n }, (_, i) => s[n === 1 ? 0 : Math.round(i * (s.length - 1) / (n - 1))]).map(p => [round(p[0]), round(p[1])]);
    });
  }

  // Keep only rows the expression list can show.
  function cleanSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps
      .filter(s => s && (s.type === 'expression' || s.type === 'note') && typeof s.content === 'string')
      .map(s => ({ type: s.type, content: s.content.trim().slice(0, MAX_LEN) }))
      .filter(s => s.content)
      .slice(0, MAX_STEPS);
  }

  // The rows already in the calculator, as text for Claude: expressions as LaTeX, notes in quotes,
  // and tables as a header line of column names followed by one line per row of values.
  function describeItems(items) {
    return items.map(i => {
      if (i.type === 'note') return i.text ? '"' + i.text + '"' : '';
      if (i.type !== 'table') return i.latex || '';
      const cols = i.columns || [];
      const n = Math.max(0, ...cols.map(c => c.values.length));
      let last = n;
      while (last > 0 && !cols.some(c => (c.values[last - 1] || '').trim())) last--;
      const lines = [cols.map(c => c.latex || '').join(' | ')];
      for (let r = 0; r < last; r++) lines.push(cols.map(c => (c.values[r] || '').trim()).join(' | '));
      return 'Table (each column is a list named by its header):\n' + lines.join('\n');
    }).filter(Boolean);
  }

  async function ask(question, context, fetchImpl, sketches) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    const body = { question, context };
    const drawn = cleanSketches(sketches);
    if (drawn.length) body.sketches = drawn;
    let res, data = {};
    try {
      res = await doFetch(ASK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Could not reach Claude. Check the connection and try again.');
    }
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || data.error) throw new Error(data.error || 'Claude could not answer (error ' + res.status + ').');
    const steps = cleanSteps(data.steps);
    if (!steps.length) throw new Error('Claude sent back no steps.');
    return steps;
  }

  const api = { ASK_URL, MAX_SKETCH_POINTS, ask, cleanSteps, cleanSketches, describeItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GAsk = api;
})(typeof window !== 'undefined' ? window : globalThis);
