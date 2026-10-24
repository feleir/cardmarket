// Renders the extension icons (extension/icons/*.png) from one SVG with
// headless Chromium. Run once after changing the design: node scripts/icons.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }

// A card with a lightning bolt, on the panel's blue.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#0a6cff"/>
  <rect x="34" y="20" width="60" height="88" rx="9" fill="#ffffff" opacity="0.18"/>
  <rect x="34" y="20" width="60" height="88" rx="9" fill="none" stroke="#ffffff" stroke-width="5"/>
  <path d="M70 30 L46 70 H62 L56 98 L82 56 H66 Z" fill="#ffd23f" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

await mkdir('extension/icons', { recursive: true });
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `extension/icons/${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
