/* Ask Claude: sends a question to the relay worker and returns the answer as
 * expression-list rows. Works in the browser (window.GAsk) and in Node. */
(function (root) {
  'use strict';
  const ASK_URL = 'https://gridline-claude.uprightupdown.workers.dev/ask';
  const MAX_STEPS = 40;
  const MAX_LEN = 2000;

  // Keep only rows the expression list can show.
  function cleanSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps
      .filter(s => s && (s.type === 'expression' || s.type === 'note') && typeof s.content === 'string')
      .map(s => ({ type: s.type, content: s.content.trim().slice(0, MAX_LEN) }))
      .filter(s => s.content)
      .slice(0, MAX_STEPS);
  }

  async function ask(question, context, fetchImpl) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    let res, data = {};
    try {
      res = await doFetch(ASK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, context }) });
    } catch (e) {
      throw new Error('Could not reach Claude. Check the connection and try again.');
    }
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || data.error) throw new Error(data.error || 'Claude could not answer (error ' + res.status + ').');
    const steps = cleanSteps(data.steps);
    if (!steps.length) throw new Error('Claude sent back no steps.');
    return steps;
  }

  const api = { ASK_URL, ask, cleanSteps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GAsk = api;
})(typeof window !== 'undefined' ? window : globalThis);
