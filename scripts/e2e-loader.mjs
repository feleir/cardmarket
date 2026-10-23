// The short loader bookmarklet in headless Chromium against a mocked
// cardmarket.com and a mocked public host: it loads and opens the optimizer,
// falls back to its saved copy when the host fails, and shows a message
// (instead of doing nothing) when there is nothing to run.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { loaderBookmarklet } from './loader.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }

const HOST = 'https://raw.githubusercontent.com/example/cmopt/main/dist/cm-optimizer.js';
const code = await readFile('dist/cm-optimizer.js', 'utf8');
const bm = loaderBookmarklet(HOST);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => pw.chromium.launch());
const ctx = await browser.newContext({ ...pw.devices['Pixel 7'] });
const page = await ctx.newPage();
let hostUp = true;
await page.route('https://www.cardmarket.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><h1>Wants</h1></body></html>' }));
// Served the way raw.githubusercontent.com serves files: plain text, nosniff, CORS *.
await page.route(HOST, (r) => (hostUp
  ? r.fulfill({ status: 200, body: code, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' } })
  : r.fulfill({ status: 503, body: 'down', headers: { 'access-control-allow-origin': '*' } })));

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
// Run it the way the browser runs a javascript: URL: percent-decode, then execute.
const run = () => page.addScriptTag({ content: decodeURIComponent(bm.replace(/^javascript:/, '')) });
const panelOpen = () => page.waitForSelector('#cmopt-root >> text=Cardmarket Optimizer', { timeout: 8000 }).then(() => true, () => false);

check(bm.length < 1500, `loader is short (${bm.length} chars)`);
await page.goto('https://www.cardmarket.com/en/Magic/Wants/1');
await run();
check(await panelOpen(), 'loads from the host and opens the panel');

hostUp = false;
await page.reload();
await run();
check(await panelOpen(), 'host down: opens the saved copy');
check(/saved copy/.test(await page.textContent('#cmopt-toast').catch(() => '')), 'says it used the saved copy');

await page.evaluate(() => localStorage.clear());
await page.reload();
await run();
await page.waitForTimeout(1000);
check(/could not load/.test(await page.textContent('#cmopt-toast').catch(() => '')), 'nothing saved and host down: shows an error message');

await browser.close();
process.exitCode = failed ? 1 : 0;
