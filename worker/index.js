// Stores Gridline's shared settings so every device sees the same ones.
// GET /branding returns the saved appearance (or {}); PUT /branding replaces it.
// GET /references lists the reference files Ask Claude reads (names only), POST /references
// adds one, and DELETE /references/<id> removes one. The gridline-claude worker reads the
// files straight from the same store (keys starting ref:).
// Writes are open to anyone by design: only trusted people know about the panel.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BYTES = 4 * 1024 * 1024; // two 1 MB images, base64-encoded, plus text
// All reference files together, in bytes. Every question loads and re-sends them all, so this
// stays small enough for several questions at once in a worker's 128 MB of memory.
const MAX_REFERENCES = 5 * 1000 * 1000;
const PREFIX = 'ref:'; // one KV key per file, so uploads never rewrite each other
const KINDS = {
  pdf: /^application\/pdf$/,
  text: /^text\/plain$/,
  image: /^image\/(png|jpeg|gif|webp)$/
};

const reply = (body, status, extra) => new Response(body, { status, headers: { ...CORS, ...extra } });
const json = (data, status) => reply(JSON.stringify(data), status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

// Each file is stored at ref:<id> with {name, kind, mediaType, size} as metadata, so the list
// needs no file contents. Ids start with the upload time, so keys list in upload order.
async function listReferences(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SETTINGS.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) if (k.metadata) out.push({ id: k.name.slice(PREFIX.length), ...k.metadata });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

let seq = 0;

// The cap is checked against the store's list, so uploads that overlap can pass it together;
// the gridline-claude worker stops loading files at the cap, which bounds what each question sends.
async function references(request, env, id) {
  if (request.method === 'GET' && !id) {
    return json((await listReferences(env)).map(r => ({ id: r.id, name: r.name, kind: r.kind, size: r.size })), 200);
  }
  if (request.method === 'DELETE' && id) {
    await env.SETTINGS.delete(PREFIX + id);
    return reply(null, 204);
  }
  if (request.method === 'POST' && !id) {
    const text = await request.text();
    if (text.length > MAX_REFERENCES * 2) return reply('That file is too large. The reference files can add up to 5 MB.', 413);
    let f;
    try { f = JSON.parse(text); } catch (e) { return reply('Not JSON', 400); }
    if (!f || !KINDS[f.kind] || !KINDS[f.kind].test(f.mediaType) || typeof f.data !== 'string' || !f.data.trim()
      || typeof f.name !== 'string' || !f.name.trim()) return reply('Expected a PDF, text file or image', 400);
    const size = new TextEncoder().encode(f.data).length;
    const used = (await listReferences(env)).reduce((n, r) => n + r.size, 0);
    if (used + size > MAX_REFERENCES) return reply('The reference material is full (5 MB in all). Remove a file or choose a smaller one.', 413);
    // KV metadata holds 1024 bytes, so the name is cut to 100 characters
    const meta = { name: f.name.trim().slice(0, 100), kind: f.kind, mediaType: f.mediaType, size };
    // time, then a counter so uploads in the same millisecond keep their order, then a uuid
    const newId = Date.now().toString(36).padStart(9, '0') + '-' + (seq++ % 1679616).toString(36).padStart(4, '0') + '-' + crypto.randomUUID();
    await env.SETTINGS.put(PREFIX + newId, f.data, { metadata: meta });
    return json({ id: newId, name: meta.name, kind: meta.kind, size }, 201);
  }
  return reply('Method not allowed', 405);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204);
    const ref = pathname.match(/^\/references(?:\/([\w-]+))?$/);
    if (ref) {
      try { return await references(request, env, ref[1]); }
      catch (e) { console.error(e); return reply('The settings store is not working right now. Try again in a moment.', 500); }
    }
    if (pathname !== '/branding') return reply('Not found', 404);
    if (request.method === 'GET') {
      const saved = await env.SETTINGS.get('branding');
      return reply(saved || '{}', 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    }
    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return reply('Too large', 413);
      let data;
      try { data = JSON.parse(text); } catch (e) { return reply('Not JSON', 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reply('Expected an object', 400);
      await env.SETTINGS.put('branding', JSON.stringify(data));
      return reply(null, 204);
    }
    return reply('Method not allowed', 405);
  }
};
