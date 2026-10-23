// End-to-end check in headless Chromium at phone size: cardmarket.com is
// mocked with fixture pages (one filter deliberately "fails open" and serves
// sellers from other countries), the built bookmarklet is run on a wants
// page, and the result and the add-to-cart replay are checked.
//   node scripts/e2e.mjs   (needs Playwright; screenshots go to e2e-out/)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { offerRow, productPage, wantsListPage, cardPage, wantsOverview } from '../test/fixtures.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }

const P = '/en/Magic/Products/Singles';
const pages = {
  '/en/Magic/Wants': wantsOverview([{ id: 123, name: 'Mono Red' }]),
  '/en/Magic/Wants/123': wantsListPage([
    { id: 1, amount: 4, name: 'Lightning Bolt', url: '/en/Magic/Cards/Lightning-Bolt', languages: ['English'], cond: 'EX' },
    { id: 2, amount: 1, name: 'Sheoldred, the Apocalypse', url: `${P}/Dominaria-United/Sheoldred-the-Apocalypse`, expansion: 'Dominaria United' },
    { id: 3, amount: 2, name: 'Counterspell', url: `${P}/Ice-Age/Counterspell` },
    { id: 4, amount: 1, name: 'Black Lotus', url: `${P}/Alpha/Black-Lotus` },
  ]),
  '/en/Magic/Cards/Lightning-Bolt': cardPage({ title: 'Lightning Bolt', versions: [
    { url: `${P}/Magic-2010/Lightning-Bolt`, from: '0,50 €' }, { url: `${P}/Alpha/Lightning-Bolt`, from: '150,00 €' },
  ] }),
  [`${P}/Magic-2010/Lightning-Bolt`]: productPage({ title: 'Lightning Bolt', expansion: 'Magic 2010', rows: [
    offerRow({ id: 10, seller: 'zurich_cards', price: '0,60 €', count: 4 }),
    offerRow({ id: 11, seller: 'cheap_de', country: 'Germany', price: '0,10 €', count: 8 }),
    offerRow({ id: 12, seller: 'geneva_tcg', price: '0,80 €', count: 2 }),
  ] }),
  [`${P}/Alpha/Lightning-Bolt`]: productPage({ title: 'Lightning Bolt', expansion: 'Alpha', rows: [
    offerRow({ id: 13, seller: 'zurich_cards', price: '150,00 €' }),
  ] }),
  [`${P}/Dominaria-United/Sheoldred-the-Apocalypse`]: productPage({ title: 'Sheoldred, the Apocalypse', expansion: 'Dominaria United', rows: [
    offerRow({ id: 20, seller: 'basel_magic', price: '60,00 €' }),
    offerRow({ id: 21, seller: 'geneva_tcg', price: '61,00 €' }),
  ] }),
  [`${P}/Ice-Age/Counterspell`]: productPage({ title: 'Counterspell', expansion: 'Ice Age', rows: [
    offerRow({ id: 30, seller: 'basel_magic', price: '1,20 €', count: 1 }),
    offerRow({ id: 31, seller: 'geneva_tcg', price: '1,30 €', count: 3 }),
    offerRow({ id: 32, seller: 'lugano', price: '0,90 €', count: 2, cond: 'PL' }),
  ] }),
  [`${P}/Alpha/Black-Lotus`]: productPage({ title: 'Black Lotus', expansion: 'Alpha', rows: [] }),
};

// Stand-in for Cardmarket's delegated data-ajax-action submit handler.
const siteScript = `<script>
  window.__cartPosts = [];
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-ajax-action]');
    if (!f) return;
    e.preventDefault();
    window.__cartPosts.push(Object.fromEntries(new FormData(f)));
    const b = document.querySelector('.shopping-cart .badge'); b.textContent = String(Number(b.textContent) + 1);
  });
</script><a href="/en/Magic/ShoppingCart" class="shopping-cart"><span class="badge">0</span></a>`;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => pw.chromium.launch());
const ctx = await browser.newContext({ ...pw.devices['Pixel 7'] });
const page = await ctx.newPage();
const requested = [];
await page.route('https://www.cardmarket.com/**', (route) => {
  const u = new URL(route.request().url());
  requested.push(u.pathname + u.search);
  let html = pages[u.pathname];
  if (!html) return route.fulfill({ status: 404, body: 'not found' });
  if (u.pathname === '/en/Magic/Wants/123') html = html.replace('<body>', `<body>${siteScript}`);
  return route.fulfill({ status: 200, contentType: 'text/html', body: html });
});

await page.goto('https://www.cardmarket.com/en/Magic/Wants/123');
await page.evaluate(() => localStorage.setItem('cmopt:settings', JSON.stringify({ sellerCountries: [4], delayMs: 300, timeBudgetMs: 500, excludeExpansions: '' })));

// Run exactly what a user pastes: decode the javascript: URL the way the browser does.
const bm = await readFile('dist/bookmarklet.txt', 'utf8');
await page.addScriptTag({ content: decodeURIComponent(bm.replace(/^javascript:/, '')) });

await mkdir('e2e-out', { recursive: true });
await page.waitForSelector('#cmopt-root option:has-text("Mono Red")', { state: 'attached' });
await page.screenshot({ path: 'e2e-out/1-setup.png' });
await page.click('#cmopt-root >> text=Fetch offers & optimize');
await page.waitForSelector('#cmopt-root >> text=Total (estimated)', { timeout: 60000 });
await page.screenshot({ path: 'e2e-out/2-results.png', fullPage: false });

const text = await page.locator('#cmopt-root main').innerText();
const fail = (m) => { console.error('FAIL:', m, '\n', text); process.exitCode = 1; };
if (/cheap_de/.test(text)) fail('a German seller got through the Switzerland-only filter');
// Worked out by hand from the CH shipping tiers: Sheoldred alone from
// basel_magic, both Counterspells from lugano, the Bolts from zurich_cards.
if (!/75,90 €/.test(text)) fail('expected the optimal total of 75,90 €');
if (!/Black Lotus/.test(text)) fail('missing card not reported');
if (!requested.some((r) => r.includes('sellerCountry=4'))) fail('country filter not sent');

await page.click('#cmopt-root >> text=Add all to cart');
await page.waitForFunction(() => window.__cartPosts.length > 0, null, { timeout: 15000 });
await page.waitForTimeout(6000);
const posts = await page.evaluate(() => window.__cartPosts);
console.log('cart posts:', JSON.stringify(posts));
await page.screenshot({ path: 'e2e-out/3-after-cart.png' });
console.log('requests:', requested.length, '\n' + requested.join('\n'));
console.log('--- results ---\n' + text);
await browser.close();
