// Stands in for a Cloudflare KV namespace, with the limits that matter here: values
// up to 25 MiB (in bytes) and one write a second to the same key.
const MAX_VALUE = 25 * 1024 * 1024;

module.exports = function fakeKV() {
  const m = new Map();
  const written = new Set(); // keys written "this second"
  return {
    m,
    get: async k => m.has(k) ? m.get(k).value : null,
    put: async (k, v, opts) => {
      if (written.has(k)) throw new Error('KV PUT failed: 429 Too Many Requests');
      if (Buffer.byteLength(v) > MAX_VALUE) throw new Error('KV PUT failed: value too large');
      written.add(k);
      m.set(k, { value: v, metadata: opts && opts.metadata });
    },
    delete: async k => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({
      keys: [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name, metadata: m.get(name).metadata })),
      list_complete: true
    })
  };
};
