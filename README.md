<img src="assets/logo.svg" width="64" height="64" alt="">

# Gridline

A graphing calculator that runs in the browser with no build step. Open `index.html` to use it.

It handles:

- Functions (`y=x^2`, `x=\sin y`), equations of x and y (`x^2+y^2=25`), and inequalities, which are shaded, with dashed edges when strict.
- Polar (`r=1+\cos\theta`) and parametric (`(\cos t,\sin t)`) curves, with editable domains.
- Definitions: `a=2` makes a slider you can play, `f(x)=...` defines a function, and `f'(x)` is its derivative. Undefined letters get "add slider" buttons.
- Points, lists, ranges (`[1...10]`), piecewise (`\{x<0:-x,x\}`) and restrictions (`y=x\{x>0\}`), sums, products, integrals and `d/dx`.
- Tables, and regressions such as `y_1 ~ mx_1+b`, which report fitted parameters and R².
- Clicking a curve to trace it. Selecting a curve shows its roots, extrema, y-intercept and intersections.
- Pan, scroll to zoom, pinch, zoom buttons and a home button. The wrench menu sets the grid, axes, bounds, axis labels, and radians or degrees.
- An on-screen keypad, undo and redo, notes, line and point styles, a resizable list, and saving to local storage.

Ctrl+Shift+` opens the Appearance panel, which sets the top bar's colours, logo, name and text. These settings are shared by every device: the page keeps them in a small Cloudflare Worker (`worker/`, deployed as `gridline-settings`), and changes reach other devices the next time they load the page or come back to the tab. Deploy the worker with `npx wrangler deploy` from `worker/`.

## Asking Claude

Type a question into any row and press Shift+Enter. The row disappears to show the question was sent, and a moment later Claude's answer appears in its place, step by step: expressions you can see and graph, with short notes between them. There is no waiting indicator. If the request fails, the question comes back so you can try again.

Questions go to a second Cloudflare Worker (`claude/worker.js`, deployed as `gridline-claude`), which asks Claude Opus 5.5 through the Claude API. It runs entirely in the cloud; nothing needs to be running on anyone's computer. Asking is open to anyone who has the page, and each question is billed to the API key stored as the worker's `ANTHROPIC_API_KEY` secret. Set the key with `npx wrangler secret put ANTHROPIC_API_KEY` and deploy with `npx wrangler deploy`, both from `claude/`.

Install dependencies with `npm install` before running the tests or deploying.

Math input uses [MathQuill](http://mathquill.com) (MPL-2.0) and jQuery (MIT), both in `vendor/`.

Run the tests with `npm test`.
