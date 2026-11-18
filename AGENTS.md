# Agents

- Checks: `npm test` (Node's built-in test runner; there is no build, lint or type step).
- Run the app: serve the folder (for example `python -m http.server`) and open `index.html`. Opening the file directly also works.
- Ask Claude (Shift+Enter in a row) needs the relay running on the owner's computer: `npm run relay`. See the README.
- Workers: `worker/` (appearance settings, `gridline-settings`) and `relay/` (Ask Claude, `gridline-claude`). Deploy each with `npx wrangler deploy` from its folder.
