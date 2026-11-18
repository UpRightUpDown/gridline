# Agents

- Checks: `npm install`, then `npm test` (Node's built-in test runner; there is no build, lint or type step).
- Run the app: serve the folder (for example `python -m http.server`) and open `index.html`. Opening the file directly also works.
- Ask Claude (Shift+Enter in a row) calls the `claude/` worker, which uses the Claude API key in its `ANTHROPIC_API_KEY` secret. See the README.
- Workers: `worker/` (appearance settings, `gridline-settings`) and `claude/` (Ask Claude, `gridline-claude`). Deploy each with `npx wrangler deploy` from its folder.
