// Builds the served index.html from src/index.html: precompile the JSX so
// browsers don't have to load and run Babel standalone (~2 MB) at page open.
// Output goes to the repo root because Pages deploys from the main branch
// (only the account owner can switch it to Actions-based deploys).
const esbuild = require('esbuild');
const fs = require('fs');

const html = fs.readFileSync('src/index.html', 'utf8');

const SCRIPT_RE = /<script type="text\/babel">([\s\S]*?)<\/script>/;
const m = html.match(SCRIPT_RE);
if (!m) {
  console.error('No <script type="text/babel"> block found in src/index.html');
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

fs.writeFileSync('index.html', out);

console.log(`Built index.html (${(out.length / 1024).toFixed(1)} kB)`);
