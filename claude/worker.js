// Answers Gridline questions with the Claude API, entirely in the cloud.
// A page POSTs {question, context} to /ask and gets back {steps} or {error}.
// Reference files uploaded in the panel (stored by worker/ in the shared KV) go along with
// every question, so Claude solves it the way they show.
// Asking is open to anyone by design: only trusted people use the calculator.
// The API key is the worker secret ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, REFERENCE_RULES } from './prompt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_QUESTION = 5000;
const MAX_CONTEXT = 200000; // room for the calculator's rows, tables included, as they arrive in the JSON body
const MAX_SKETCH = 30000; // characters of hand-drawn strokes in the request body
const DEADLINE_MS = 150000;
const MAX_REFERENCES = 5 * 1000 * 1000; // bytes of reference files, as worker/index.js caps them

const SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['expression', 'note'] }, content: { type: 'string' } },
        required: ['type', 'content'],
        additionalProperties: false
      }
    }
  },
  required: ['steps'],
  additionalProperties: false
};

const reply = (body, status) => new Response(body, { status, headers: CORS });
const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// The reference files saved from the panel, kept by the gridline-settings worker in the
// same KV namespace. Asking still works without them if the store can't be read.
// Each file is at ref:<id> with {name, kind, mediaType, size} as metadata; ids sort in upload order.
export async function loadReferences(env) {
  try {
    const keys = [];
    let cursor;
    do {
      const page = await env.SETTINGS.list({ prefix: 'ref:', cursor });
      keys.push(...page.keys.filter(k => k.metadata));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    // the settings worker caps uploads at 5 MB, but overlapping uploads can pass it together,
    // so stop here too: every question holds all of these in memory
    let total = 0;
    const wanted = keys.filter(k => {
      const size = k.metadata.size || 0;
      if (total + size > MAX_REFERENCES) return false;
      total += size;
      return true;
    });
    const files = await Promise.all(wanted.map(async k => ({ ...k.metadata, data: await env.SETTINGS.get(k.name) })));
    return files.filter(f => f.data); // a file removed since the list was read
  } catch (e) { console.error('Could not read reference files', e); return []; }
}

// Reference files as content blocks. The last one carries the cache breakpoint, so repeat
// questions read the files from the cache.
function referenceBlocks(references) {
  const blocks = references.map(r =>
    r.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: r.data } }
    : r.kind === 'text' ? { type: 'document', source: { type: 'text', media_type: 'text/plain', data: r.data } }
    : { type: 'image', source: { type: 'base64', media_type: r.mediaType, data: r.data } });
  if (blocks.length) blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  return blocks;
}

export async function handle(request, client, references = []) {
  const { pathname } = new URL(request.url);
  if (request.method === 'OPTIONS') return reply(null, 204);
  if (pathname !== '/ask') return reply('Not found', 404);
  if (request.method !== 'POST') return reply('Method not allowed', 405);

  const text = await request.text();
  if (text.length > MAX_QUESTION + MAX_CONTEXT + MAX_SKETCH) return json({ error: 'There is too much in the calculator to send with the question.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not JSON' }, 400); }
  const question = body && typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return json({ error: 'Type a question first.' }, 400);
  if (question.length > MAX_QUESTION) return json({ error: 'That question is too long.' }, 413);
  const context = Array.isArray(body.context) ? body.context.filter(c => typeof c === 'string') : [];
  const sketches = (Array.isArray(body.sketches) ? body.sketches : [])
    .filter(s => Array.isArray(s) && s.length && s.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
    .slice(0, 40);
  const drawing = sketches.map((s, i) => 'Stroke ' + (i + 1) + ': ' + s.map(([x, y]) => '(' + x + ', ' + y + ')').join(' ')).join('\n');
  const prompt = (context.length ? 'Rows already in the calculator:\n' + context.join('\n') + '\n\n' : '')
    + (drawing ? 'Strokes the person drew on the graph:\n' + drawing + '\n\n' : '')
    + 'Question:\n' + question;
  const refs = referenceBlocks(references);
  const content = refs.length ? [...refs, { type: 'text', text: prompt }] : prompt;

  let message;
  try {
    message = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: refs.length ? SYSTEM + '\n\n' + REFERENCE_RULES : SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }]
    }, { signal: AbortSignal.timeout(DEADLINE_MS) }); // one deadline across the SDK's retries
  } catch (e) {
    console.error(e);
    // a file the API can't read (damaged, or too long) would otherwise fail every question
    // with no hint; the files are the likely cause, but the API's reason isn't parsed
    if (refs.length && e.status === 400) return json({ error: 'Claude could not answer with the reference files attached. If this keeps happening, one may be damaged or too long: remove it in the settings panel (Ctrl+Shift+`).' }, 502);
    return json({ error: 'Claude could not answer right now. Try again in a moment.' }, 502);
  }
  if (message.stop_reason === 'refusal') return json({ error: 'Claude declined to answer that.' }, 502);
  // the last text block is the final answer, even if a refusal fallback ran mid-answer
  const out = message.content.filter(b => b.type === 'text').at(-1);
  try {
    const steps = JSON.parse(out.text).steps.map(s => ({ type: String(s.type).toLowerCase(), content: s.content }));
    return json({ steps }, 200);
  } catch (e) {
    console.error('Unreadable answer', message.stop_reason);
    return json({ error: 'Claude could not answer right now. Try again in a moment.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const references = new URL(request.url).pathname === '/ask' && request.method === 'POST' ? await loadReferences(env) : [];
    return handle(request, new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), references);
  }
};
