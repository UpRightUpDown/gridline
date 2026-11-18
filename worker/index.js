// Stores Gridline's appearance settings so every device shows the same top bar.
// GET /branding returns the saved settings (or {}); PUT /branding replaces them.
// Writes are open to anyone by design: only trusted people know about the panel.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BYTES = 4 * 1024 * 1024; // two 1 MB images, base64-encoded, plus text

const reply = (body, status, extra) => new Response(body, { status, headers: { ...CORS, ...extra } });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204);
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
