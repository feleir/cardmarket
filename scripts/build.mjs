// Builds the ways to run the optimizer:
//   dist/cm-optimizer.js        plain bundle (for a loader or the console)
//   dist/bookmarklet.txt        the whole tool as one javascript: URL
//   dist/cm-optimizer.user.js   Tampermonkey / Violentmonkey userscript
//   extension/                  Chrome (MV3) extension, unpacked
//   dist/cardmarket-optimizer-extension.zip   the same, for the Chrome Web Store
// and docs/index.html, the install page with the bookmarklet embedded.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loaderBookmarklet } from './loader.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const common = { bundle: true, minify: true, format: 'iife', target: ['chrome100', 'firefox100', 'safari15'], write: false, legalComments: 'none', define: { 'globalThis.__CMOPT_EXT__': 'false' } };

const main = await build({ ...common, entryPoints: ['src/main.js'] });
const code = main.outputFiles[0].text.trim();

const us = await build({ ...common, entryPoints: ['src/userscript.js'] });
const userscript = `// ==UserScript==
// @name         Cardmarket Optimizer
// @namespace    https://github.com/feleir/cardmarket
// @version      ${pkg.version}
// @description  Wants-list cart optimizer: cheapest cards + shipping across sellers, with a seller-country allow list.
// @match        https://www.cardmarket.com/*
// @updateURL    ${pkg.config.cmoptUrl.replace(/cm-optimizer\.js$/, 'cm-optimizer.user.js')}
// @downloadURL  ${pkg.config.cmoptUrl.replace(/cm-optimizer\.js$/, 'cm-optimizer.user.js')}
// @grant        none
// @inject-into  page
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
// The short loader bookmarklet, pointing at the public copy of
// dist/cm-optimizer.js (package.json config.cmoptUrl, or CMOPT_URL).
const loaderUrl = process.env.CMOPT_URL || pkg.config?.cmoptUrl;
const loader = loaderBookmarklet(loaderUrl);
await writeFile('dist/loader-bookmarklet.txt', loader);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const template = await readFile('scripts/install.html', 'utf8');
await writeFile('docs/index.html', template
  .replaceAll('{{VERSION}}', pkg.version)
  .replaceAll('{{SIZE}}', `${(loader.length / 1024).toFixed(1)} KB`)
  .replaceAll('{{BOOKMARKLET}}', esc(loader)));

// Chrome extension (Manifest V3). The tool runs in the page's own world, so
// it behaves exactly like the bookmarklet; all code ships in the package
// (the Web Store does not allow remotely loaded code).
const ext = await build({ ...common, entryPoints: ['src/extension.js'], define: { 'globalThis.__CMOPT_EXT__': 'true' } });
await mkdir('extension/icons', { recursive: true });
await mkdir('extension/highs', { recursive: true });
await writeFile('extension/content.js', ext.outputFiles[0].text);
// The exact solver, shipped in the package.
for (const f of ['highs.mjs', 'highs.wasm']) await writeFile(`extension/highs/${f}`, await readFile(`node_modules/highs/build/${f}`));
// Runs in the extension's own world (where chrome.runtime exists) and tells
// the page-world script where the packaged solver is.
await writeFile('extension/bridge.js', "document.documentElement.dataset.cmoptExt = chrome.runtime.getURL('highs/');\n");
await writeFile('extension/manifest.json', JSON.stringify({
  manifest_version: 3,
  // "for Cardmarket": the Web Store rejects names that read as the brand's own.
  name: 'Wants Optimizer for Cardmarket',
  short_name: 'Wants Optimizer',
  version: pkg.version,
  description: 'Cheapest cart for a Cardmarket wants list: card prices plus shipping across sellers. Not affiliated with Cardmarket.',
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  action: { default_title: 'Optimize this wants list', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
  background: { service_worker: 'background.js' },
  permissions: ['scripting'],
  host_permissions: ['https://www.cardmarket.com/*'],
  content_scripts: [
    { matches: ['https://www.cardmarket.com/*'], js: ['bridge.js'], run_at: 'document_start' },
    { matches: ['https://www.cardmarket.com/*'], js: ['content.js'], run_at: 'document_idle', world: 'MAIN' },
  ],
  web_accessible_resources: [{ resources: ['highs/*'], matches: ['https://www.cardmarket.com/*'] }],
  minimum_chrome_version: '111',
}, null, 2) + '\n');
await rm('dist/cardmarket-optimizer-extension.zip', { force: true });
execFileSync('zip', ['-qr', '../dist/cardmarket-optimizer-extension.zip', '.'], { cwd: 'extension' });

console.log(`loader: ${loader.length} chars; full bookmarklet: ${bookmarklet.length} chars; userscript: ${userscript.length} chars`);
