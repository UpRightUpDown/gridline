// Answers Gridline questions with the Claude API, entirely in the cloud.
// A page POSTs {question, context} to /ask and gets back {steps} or {error}.
// Reference files uploaded in the panel (stored by worker/ in the shared KV) go along with
// every question, so Claude solves it the way they show.
// Asking is open to anyone by design: only trusted people use the calculator.
// The API key is the worker secret ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_QUESTION = 5000;
const MAX_CONTEXT = 200000; // room for the calculator's rows, tables included, as they arrive in the JSON body
const MAX_SKETCH = 30000; // characters of hand-drawn strokes in the request body
const DEADLINE_MS = 150000;

export const SYSTEM = String.raw`You answer questions inside Gridline, a Desmos-style graphing calculator. Your answer appears as rows in its expression list, in order, right under the question. Work the problem out step by step, one row per step.

Each row is one of:
- "expression": a single LaTeX expression the calculator evaluates or graphs, written the way Desmos stores it. Examples: f(x)=x^{2}\sin(x), f'(x), \frac{d}{dx}\left(x^{3}\right), a=5, 3\cdot4+2, (2,4), y=2x+1, x^{2}+y^{2}=25, \int_{0}^{1}x^{2}dx, \sum_{n=1}^{10}n^{2}. A row that is a plain calculation shows its value, and a row with x or y is graphed.
- "note": one short sentence of plain text (no LaTeX, no markdown). Use a note only when the maths alone would leave the reader lost, such as naming a method that is not obvious from the expressions or stating a conclusion the rows do not show. Most answers need no notes at all.

Rules:
- One equation or expression per expression row. Never put words, \text, \pm, \approx, \neq, \Rightarrow, "=>" or commas joining separate statements in an expression row. Write two rows instead of using \pm. Write several points as a list in square brackets, such as [(2,0),(3,0)].
- Each function or variable name may be defined only once across all rows, including the rows already in the calculator. Never define x, y, r, t or \theta, since the calculator uses them. Use new names such as g, h, a_{1} for intermediate results.
- Let the maths speak for itself. Show the working as expression rows, so a person can see each step and its graph. Do not add a note that restates, announces or labels what an expression row already makes clear (no "First, define f", "Now take the derivative", "This is the answer"). End with the final answer as an expression row.
- Keep it to at most 12 rows.
- If the question is not about maths, answer it in notes.

The person may have hand-drawn strokes on the graph. They come as lists of (x, y) points in graph coordinates, in drawing order. Read them as a sketch: the shape of a curve, a region, a point or an arrow the question refers to. When the question asks what a drawing is, fit it with the simplest expression that matches its shape.

The question may have been typed into a maths field, so words can run together without spaces and may appear as LaTeX.

Reference material (documents or images) may come before the question. It shows the methods the person has been taught. When it covers the kind of problem asked, solve it with the method it shows, following its notation and order of steps. When it does not, ignore it. Never mention, quote or point to the reference material, and never say where a method came from: the answer should read as if you chose the method yourself.`;

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
export async function loadReferences(env) {
  try { return JSON.parse(await env.SETTINGS.get('references')) || []; }
  catch (e) { console.error('Could not read reference files', e); return []; }
}

// Reference files as content blocks. The last one carries the cache breakpoint, so repeat
// questions read the files from the cache.
function referenceBlocks(references) {
  const blocks = references.map(r =>
    r.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: r.data } }
    : r.kind === 'text' ? { type: 'document', source: { type: 'text', media_type: 'text/plain', data: r.data } }
    : r.kind === 'image' ? { type: 'image', source: { type: 'base64', media_type: r.mediaType, data: r.data } }
    : null).filter(Boolean);
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
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }]
    }, { signal: AbortSignal.timeout(DEADLINE_MS) }); // one deadline across the SDK's retries
  } catch (e) {
    console.error(e);
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
