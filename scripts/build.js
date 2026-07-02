// Builds dist/ for GitHub Pages: precompile the JSX in index.html so
// browsers don't have to load and run Babel standalone (~2 MB) at page open.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('index.html', 'utf8');

const SCRIPT_RE = /<script type="text\/babel">([\s\S]*?)<\/script>/;
const m = html.match(SCRIPT_RE);
if (!m) {
  console.error('No <script type="text/babel"> block found in index.html');
  process.exit(1);
}

const { code } = esbuild.transformSync(m[1], {
  loader: 'jsx',
  target: 'es2019',
  jsx: 'transform',
  minify: true,
});

const BABEL_CDN_RE = /\s*<script[^>]*@babel\/standalone[^>]*><\/script>/;
const out = html
  .replace(BABEL_CDN_RE, '')
  .replace(SCRIPT_RE, () => `<script>${code}</script>`);

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(path.join('dist', 'index.html'), out);

for (const f of ['results.json']) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join('dist', f));
}

console.log(`Built dist/index.html (${(out.length / 1024).toFixed(1)} kB)`);
