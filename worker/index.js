// Stores Gridline's shared settings so every device sees the same ones.
// GET /branding returns the saved appearance (or {}); PUT /branding replaces it.
// GET /references lists the reference files Ask Claude reads (names only), POST /references
// adds one, and DELETE /references/<id> removes one. The gridline-claude worker reads the
// files straight from the same store.
// Writes are open to anyone by design: only trusted people know about the panel.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BYTES = 4 * 1024 * 1024; // two 1 MB images, base64-encoded, plus text
export const MAX_REFERENCES = 20 * 1024 * 1024; // all reference files together; KV allows 25 MiB, the Claude API 32 MB a request
const KINDS = {
  pdf: /^application\/pdf$/,
  text: /^text\/plain$/,
  image: /^image\/(png|jpeg|gif|webp)$/
};

const reply = (body, status, extra) => new Response(body, { status, headers: { ...CORS, ...extra } });
const json = (data, status) => reply(JSON.stringify(data), status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

async function loadReferences(env) {
  try { return JSON.parse(await env.SETTINGS.get('references')) || []; } catch (e) { return []; }
}
const summary = r => ({ id: r.id, name: r.name, kind: r.kind, size: r.data.length });

async function references(request, env, id) {
  const list = await loadReferences(env);
  if (request.method === 'GET' && !id) return json(list.map(summary), 200);
  if (request.method === 'DELETE' && id) {
    await env.SETTINGS.put('references', JSON.stringify(list.filter(r => r.id !== id)));
    return reply(null, 204);
  }
  if (request.method === 'POST' && !id) {
    const text = await request.text();
    if (text.length > MAX_REFERENCES + 1024) return reply('That file is too large. The reference files can add up to 20 MB.', 413);
    let f;
    try { f = JSON.parse(text); } catch (e) { return reply('Not JSON', 400); }
    if (!f || !KINDS[f.kind] || !KINDS[f.kind].test(f.mediaType) || typeof f.data !== 'string' || !f.data
      || typeof f.name !== 'string' || !f.name.trim()) return reply('Expected a PDF, text file or image', 400);
    const used = list.reduce((n, r) => n + r.data.length, 0);
    if (used + f.data.length > MAX_REFERENCES) return reply('The reference material is full (20 MB). Remove a file first.', 413);
    const item = { id: crypto.randomUUID(), name: f.name.trim().slice(0, 200), kind: f.kind, mediaType: f.mediaType, data: f.data };
    list.push(item);
    await env.SETTINGS.put('references', JSON.stringify(list));
    return json(summary(item), 201);
  }
  return reply('Method not allowed', 405);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204);
    const ref = pathname.match(/^\/references(?:\/([\w-]+))?$/);
    if (ref) return references(request, env, ref[1]);
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
