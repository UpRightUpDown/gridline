// Answers Gridline questions with the Claude API, entirely in the cloud.
// A page POSTs {question, context} to /ask and gets back {steps} or {error}.
// Asking is open to anyone by design: only trusted people use the calculator.
// The API key is the worker secret ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_QUESTION = 5000;
const MAX_CONTEXT = 20000;

export const SYSTEM = String.raw`You answer questions inside Gridline, a Desmos-style graphing calculator. Your answer appears as rows in its expression list, in order, right under the question. Work the problem out step by step, one row per step.

Each row is one of:
- "expression": a single LaTeX expression the calculator evaluates or graphs, written the way Desmos stores it. Examples: f(x)=x^{2}\sin(x), f'(x), \frac{d}{dx}\left(x^{3}\right), a=5, 3\cdot4+2, (2,4), y=2x+1, x^{2}+y^{2}=25, \int_{0}^{1}x^{2}dx, \sum_{n=1}^{10}n^{2}. A row that is a plain calculation shows its value, and a row with x or y is graphed.
- "note": one or two short sentences of plain text (no LaTeX, no markdown) saying what the next step does or what a result means.

Rules:
- One equation or expression per expression row. Never put words, \text, \pm, \approx, \neq, \Rightarrow, "=>" or commas joining separate statements in an expression row. Write two rows instead of using \pm. Write several points as a list in square brackets, such as [(2,0),(3,0)].
- Each function or variable name may be defined only once across all rows, including the rows already in the calculator. Never define x, y, r, t or \theta, since the calculator uses them. Use new names such as g, h, a_{1} for intermediate results.
- Show the working as expressions where possible, so a person can see each step and its graph. End with the final answer as an expression row.
- Keep it to at most 12 rows.
- If the question is not about maths, answer it in notes.

The question may have been typed into a maths field, so words can run together without spaces and may appear as LaTeX.`;

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

export async function handle(request, client) {
  const { pathname } = new URL(request.url);
  if (request.method === 'OPTIONS') return reply(null, 204);
  if (pathname !== '/ask') return reply('Not found', 404);
  if (request.method !== 'POST') return reply('Method not allowed', 405);

  const text = await request.text();
  if (text.length > MAX_QUESTION + MAX_CONTEXT) return json({ error: 'That question is too long.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'Not JSON' }, 400); }
  const question = body && typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return json({ error: 'Type a question first.' }, 400);
  if (question.length > MAX_QUESTION) return json({ error: 'That question is too long.' }, 413);
  const context = Array.isArray(body.context) ? body.context.filter(c => typeof c === 'string').slice(0, 100) : [];
  const prompt = (context.length ? 'Rows already in the calculator:\n' + context.join('\n') + '\n\n' : '') + 'Question:\n' + question;

  let message;
  try {
    message = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'Claude could not answer right now. Try again in a moment.' }, 502);
  }
  if (message.stop_reason === 'refusal') return json({ error: 'Claude declined to answer that.' }, 502);
  const out = message.content.find(b => b.type === 'text');
  try {
    return json({ steps: JSON.parse(out.text).steps }, 200);
  } catch (e) {
    console.error('Unreadable answer', message.stop_reason);
    return json({ error: 'Claude could not answer right now. Try again in a moment.' }, 502);
  }
}

export default {
  fetch(request, env) {
    return handle(request, new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
  }
};
