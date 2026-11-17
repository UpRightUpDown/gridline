'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function stripComments(code, css) {
  let out = '';
  let i = 0;
  let lastSignificant = '';
  const regexStarters = '(,=:[!&|?{};+-*%<>~^';
  const keywordBeforeRegex = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|delete|throw|new)\s*$/;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
      if (out && !/\s$/.test(out)) out += ' ';
      continue;
    }
    if (!css && c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'" || (!css && c === '`')) {
      let j = i + 1;
      while (j < code.length && code[j] !== c) {
        if (code[j] === '\\') j++;
        j++;
      }
      out += code.slice(i, j + 1);
      i = j + 1;
      lastSignificant = c;
      continue;
    }
    if (!css && c === '/' && (lastSignificant === '' || regexStarters.includes(lastSignificant) || keywordBeforeRegex.test(out.slice(-12)))) {
      let j = i + 1, inClass = false;
      while (j < code.length) {
        const d = code[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') break;
        j++;
      }
      j++;
      while (j < code.length && /[a-z]/i.test(code[j])) j++;
      out += code.slice(i, j);
      i = j;
      lastSignificant = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out.split('\n').map(l => l.replace(/[ \t]+$/, '')).filter((l, k, a) => l !== '' || (k > 0 && a[k - 1] !== '')).join('\n');
}

const logoUri = 'data:image/svg+xml;base64,' + Buffer.from(read('assets/logo.svg')).toString('base64');
const mqCss = stripComments(read('vendor/mathquill.css').replace(/@font-face\s*\{[^}]*\}/g, ''), true);
const safeScript = code => code.replace(/<\/script/gi, '<\\/script');
const safeStyle = code => code.replace(/<\/style/gi, '<\\/style');

let html = read('index.html');
const swaps = [
  ['<link rel="icon" href="assets/logo.svg">', `<link rel="icon" href="${logoUri}">`],
  ['<link rel="stylesheet" href="vendor/mathquill.css">', `<style>\n${safeStyle(mqCss)}\n</style>`],
  ['<link rel="stylesheet" href="css/app.css">', `<style>\n${safeStyle(stripComments(read('css/app.css'), true))}\n</style>`],
  ['src="assets/logo.svg"', `src="${logoUri}"`]
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error('index.html no longer contains: ' + from);
  html = html.replace(from, () => to);
}
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  let code = read(src);
  if (!src.startsWith('vendor/')) code = stripComments(code, false);
  if (src === 'js/branding.js') {
    const from = "const DEFAULT_LOGO = 'assets/logo.svg';";
    if (!code.includes(from)) throw new Error('branding.js no longer contains: ' + from);
    code = code.replace(from, () => `const DEFAULT_LOGO = '${logoUri}';`);
  }
  return `<script>\n${safeScript(code)}\n</script>`;
});
html = html.replace(/<!--[\s\S]*?-->/g, '');

const leftover = html.match(/(?:src|href)="(?!data:|#|https?:)[^"]+"/g);
if (leftover) throw new Error('Still references local files: ' + leftover.join(', '));

module.exports = { stripComments };
if (require.main === module) {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', 'gridline.html');
  fs.writeFileSync(out, html);
  console.log('Wrote ' + path.relative(root, out) + ' (' + Math.round(html.length / 1024) + ' KB)');
}
