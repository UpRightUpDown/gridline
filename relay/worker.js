// Passes questions from Gridline to Claude Code running on the owner's computer.
// The computer runs relay/run.js, which holds a WebSocket open to /relay. A page
// POSTs {question, context} to /ask; the worker sends it down that socket and
// waits for {id, steps} or {id, error}. Asking is open to anyone by design: only
// trusted people use the calculator. Connecting as the relay needs RELAY_TOKEN.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_QUESTION = 5000;
const MAX_CONTEXT = 20000;
const TIMEOUT_MS = 150000;

const reply = (body, status) => new Response(body, { status, headers: CORS });
const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204);
    if (pathname !== '/ask' && pathname !== '/relay') return reply('Not found', 404);
    return env.RELAY.get(env.RELAY.idFromName('relay')).fetch(request);
  }
};

export class Relay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = new Map();
    // Keep-alive pings from the relay are answered without waking this object.
    if (typeof WebSocketRequestResponsePair !== 'undefined') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/relay') return this.connect(request, url);
    if (request.method !== 'POST') return reply('Method not allowed', 405);
    const text = await request.text();
    if (text.length > MAX_QUESTION + MAX_CONTEXT) return json({ error: 'That question is too long.' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not JSON' }, 400); }
    const question = body && typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return json({ error: 'Type a question first.' }, 400);
    if (question.length > MAX_QUESTION) return json({ error: 'That question is too long.' }, 413);
    const context = Array.isArray(body.context) ? body.context.filter(c => typeof c === 'string').slice(0, 100) : [];

    const relay = this.ctx.getWebSockets().find(ws => ws.readyState === 1);
    if (!relay) return json({ error: 'Claude is offline right now. Try again later.' }, 503);
    const id = crypto.randomUUID();
    const answer = await new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ error: 'Claude took too long to answer.' }); }, TIMEOUT_MS);
      this.pending.set(id, a => { clearTimeout(timer); resolve(a); });
      relay.send(JSON.stringify({ id, question, context }));
    });
    return json(answer, answer.error ? 502 : 200);
  }

  connect(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return reply('Expected a WebSocket', 426);
    const token = this.env.RELAY_TOKEN;
    if (!token || url.searchParams.get('token') !== token) return reply('Forbidden', 403);
    for (const old of this.ctx.getWebSockets()) old.close(1000, 'Replaced by a newer relay');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    let m;
    try { m = JSON.parse(message); } catch (e) { return; }
    const done = m && this.pending.get(m.id);
    if (!done) return;
    this.pending.delete(m.id);
    done(m.error ? { error: String(m.error) } : { steps: m.steps });
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) { /* already closed */ }
    // Questions sent down this socket will never be answered.
    for (const done of this.pending.values()) done({ error: 'Claude went offline. Try again later.' });
    this.pending.clear();
  }
}
