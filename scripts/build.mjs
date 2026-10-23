// Builds the three ways to run the optimizer:
//   dist/cm-optimizer.js        plain bundle (for a loader or the console)
//   dist/bookmarklet.txt        the whole tool as one javascript: URL
//   dist/cm-optimizer.user.js   Tampermonkey / Violentmonkey userscript
// and docs/index.html, the install page with the bookmarklet embedded.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const common = { bundle: true, minify: true, format: 'iife', target: ['chrome100', 'firefox100', 'safari15'], write: false, legalComments: 'none' };

const main = await build({ ...common, entryPoints: ['src/main.js'] });
const code = main.outputFiles[0].text.trim();

const us = await build({ ...common, entryPoints: ['src/userscript.js'] });
const userscript = `// ==UserScript==
// @name         Cardmarket Optimizer
// @namespace    https://github.com/feleir/cardmarket
// @version      ${pkg.version}
// @description  Wants-list cart optimizer: cheapest cards + shipping across sellers, with a seller-country allow list.
// @match        https://www.cardmarket.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
${us.outputFiles[0].text}`;

// In a javascript: URL the browser percent-decodes first, so literal % must
// be escaped; everything else in minified code is safe as-is.
const bookmarklet = `javascript:${code.replace(/%/g, '%25')}void 0`;

await mkdir('dist', { recursive: true });
await writeFile('dist/cm-optimizer.js', code + '\n');
await writeFile('dist/cm-optimizer.user.js', userscript);
await writeFile('docs/cm-optimizer.user.js', userscript);
await writeFile('dist/bookmarklet.txt', bookmarklet);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const template = await readFile('scripts/install.html', 'utf8');
await writeFile('docs/index.html', template
  .replaceAll('{{VERSION}}', pkg.version)
  .replaceAll('{{SIZE}}', `${Math.round(bookmarklet.length / 1024)} KB`)
  .replaceAll('{{BOOKMARKLET}}', esc(bookmarklet)));

console.log(`bookmarklet: ${bookmarklet.length} chars; userscript: ${userscript.length} chars`);
