// Runs on the owner's computer. Keeps a WebSocket open to the gridline-claude
// worker and answers each question with Claude Code (`claude -p`), so questions
// use the owner's Claude subscription. Start it with `npm run relay`.
// The relay token comes from RELAY_TOKEN or relay/.token.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELAY_URL = 'wss://gridline-claude.uprightupdown.workers.dev/relay';
const RUN_TIMEOUT_MS = 140000;

const SYSTEM = String.raw`You answer questions inside Gridline, a Desmos-style graphing calculator. Your answer appears as rows in its expression list, in order, right under the question. Work the problem out step by step, one row per step.

Each row is one of:
- "expression": a single LaTeX expression the calculator evaluates or graphs, written the way Desmos stores it. Examples: f(x)=x^{2}\sin(x), f'(x), \frac{d}{dx}\left(x^{3}\right), a=5, 3\cdot4+2, (2,4), y=2x+1, x^{2}+y^{2}=25, \int_{0}^{1}x^{2}dx, \sum_{n=1}^{10}n^{2}. A row that is a plain calculation shows its value, and a row with x or y is graphed.
- "note": one or two short sentences of plain text (no LaTeX, no markdown) saying what the next step does or what a result means.

Rules:
- One equation or expression per expression row. Never put words, \text, \pm, \approx, \neq, \Rightarrow, "=>" or commas joining separate statements in an expression row. Write two rows instead of using \pm.
- Each function or variable name may be defined only once across all rows, including the rows already in the calculator. Never define x, y, r, t or \theta, since the calculator uses them. Use new names such as g, h, a_{1} for intermediate results.
- Show the working as expressions where possible, so a person can see each step and its graph. End with the final answer as an expression row.
- Keep it to at most 12 rows.
- If the question is not about maths, answer it in notes.

The question may have been typed into a maths field, so words can run together without spaces and may appear as LaTeX.`;

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { enum: ['expression', 'note'] }, content: { type: 'string' } },
        required: ['type', 'content']
      }
    }
  },
  required: ['steps']
});

function prompt(question, context) {
  const rows = (context || []).filter(Boolean);
  return (rows.length ? 'Rows already in the calculator:\n' + rows.join('\n') + '\n\n' : '') + 'Question:\n' + question;
}

function runClaude(input) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'sonnet', '--tools', '', '--no-session-persistence', '--strict-mcp-config',
      '--setting-sources', '', '--output-format', 'json', '--system-prompt', SYSTEM, '--json-schema', SCHEMA];
    const child = spawn('claude', args, { cwd: __dirname, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude took too long to answer.')); }, RUN_TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 || out) resolve(out);
      else reject(new Error('Claude Code exited with code ' + code + ': ' + err.slice(-300)));
    });
    child.stdin.end(input);
  });
}

async function answer(msg, run) {
  const out = await (run || runClaude)(prompt(msg.question, msg.context));
  const result = JSON.parse(out);
  if (result.is_error) throw new Error(result.result || 'Claude returned an error.');
  const steps = result.structured_output && result.structured_output.steps;
  if (!Array.isArray(steps)) throw new Error('Claude sent back no steps.');
  return steps;
}

function readToken() {
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN.trim();
  try { return fs.readFileSync(path.join(__dirname, '.token'), 'utf8').trim(); } catch (e) { return ''; }
}

function connect(token) {
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const ws = new WebSocket(RELAY_URL + '?token=' + encodeURIComponent(token));
  let ping;
  ws.addEventListener('open', () => {
    log('Connected. Waiting for questions.');
    ping = setInterval(() => ws.send('ping'), 30000);
  });
  ws.addEventListener('message', async e => {
    if (e.data === 'pong') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    log('Question:', String(msg.question).slice(0, 120));
    try {
      const steps = await answer(msg);
      ws.send(JSON.stringify({ id: msg.id, steps }));
      log('Answered with', steps.length, 'rows.');
    } catch (err) {
      log('Failed:', err.message);
      ws.send(JSON.stringify({ id: msg.id, error: 'Claude could not answer: ' + err.message }));
    }
  });
  ws.addEventListener('close', e => {
    clearInterval(ping);
    log('Disconnected (' + e.code + ' ' + e.reason + '). Reconnecting in 5 s.');
    setTimeout(() => connect(token), 5000);
  });
  ws.addEventListener('error', () => { /* close follows */ });
}

if (require.main === module) {
  const token = readToken();
  if (!token) { console.error('No relay token. Put it in relay/.token or set RELAY_TOKEN.'); process.exit(1); }
  connect(token);
}

module.exports = { answer, prompt, SYSTEM };
