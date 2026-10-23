// End-to-end check in headless Chromium at phone size: cardmarket.com is
// mocked with fixture pages (one filter deliberately "fails open" and serves
// sellers from other countries), the built bookmarklet is run on a wants
// page, and the result and the add-to-cart replay are checked.
//
// Two runs. Without the seller scan, bigstore_ch only shows up on the
// Counterspell page and the best cart is 75,90 €. With the scan, its own
// stock (filtered by the wants list, over two pages) turns out to hold
// Sheoldred and the Bolts too, and one parcel from it costs 73,60 € — the
// bundle the card pages alone cannot reveal. The second run also uses the
// exact solver, served from a mocked CDN.
//   node scripts/e2e.mjs   (needs Playwright; screenshots go to e2e-out/)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { offerRow, productPage, wantsListPage, cardPage, wantsOverview, userOfferRow, userOffersPage } from '../test/fixtures.js';

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
    offerRow({ id: 33, seller: 'bigstore_ch', price: '1,00 €', count: 2 }),
  ] }),
  [`${P}/Alpha/Black-Lotus`]: productPage({ title: 'Black Lotus', expansion: 'Alpha', rows: [] }),
};

// bigstore_ch's own offers page; with the wants filter it lists only
// matching cards, across two pages.
const bigRows = {
  1: [
    userOfferRow({ id: 33, name: 'Counterspell', productUrl: `${P}/Ice-Age/Counterspell`, price: '1,00 €', count: 2 }),
    userOfferRow({ id: 40, name: 'Sheoldred, the Apocalypse', productUrl: `${P}/Dominaria-United/Sheoldred-the-Apocalypse`, price: '60,50 €' }),
  ],
  2: [userOfferRow({ id: 41, name: 'Lightning Bolt', productUrl: `${P}/Magic-2010/Lightning-Bolt`, price: '0,65 €', count: 4 })],
};
function sellerPage(seller, q) {
  const list = q.get('idWantsList');
  const listOptions = [{ id: 123, name: 'Mono Red' }];
  if (seller !== 'bigstore_ch') return userOffersPage({ seller, listOptions, selected: list });
  if (list !== '123') return userOffersPage({ seller, listOptions, rows: [userOfferRow({ id: 99, name: 'Island', productUrl: `${P}/Alpha/Island`, price: '0,10 €' })] });
  return userOffersPage({ seller, listOptions, selected: list, pages: 2, rows: bigRows[q.get('site') || '1'] || [] });
}

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
const highsDir = `${process.cwd()}/node_modules/highs/build/`;
await mkdir('e2e-out', { recursive: true });
const bm = await readFile('dist/bookmarklet.txt', 'utf8');

async function scenario(name, settings, expectTotal, extraChecks) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'] });
  const page = await ctx.newPage();
  const requested = [];
  await page.route('https://www.cardmarket.com/**', (route) => {
    const u = new URL(route.request().url());
    requested.push(u.pathname + u.search);
    const m = u.pathname.match(/^\/en\/Magic\/Users\/([^/]+)\/Offers\/Singles$/);
    let html = m ? sellerPage(m[1], u.searchParams) : pages[u.pathname];
    if (!html) return route.fulfill({ status: 404, body: 'not found' });
    if (u.pathname === '/en/Magic/Wants/123') html = html.replace('<body>', `<body>${siteScript}`);
    return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.route('https://cdn.jsdelivr.net/npm/highs@*/build/*', async (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    requested.push('CDN ' + file);
    return route.fulfill({
      status: 200, body: await readFile(highsDir + file),
      headers: { 'content-type': file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', 'access-control-allow-origin': '*' },
    });
  });

  await page.goto('https://www.cardmarket.com/en/Magic/Wants/123');
  await page.evaluate((s) => localStorage.setItem('cmopt:settings', JSON.stringify(s)), { sellerCountries: [4], delayMs: 200, timeBudgetMs: 500, excludeExpansions: '', ...settings });
  // Run exactly what a user pastes: decode the javascript: URL the way the browser does.
  await page.addScriptTag({ content: decodeURIComponent(bm.replace(/^javascript:/, '')) });
  await page.waitForSelector('#cmopt-root option:has-text("Mono Red")', { state: 'attached' });
  await page.screenshot({ path: `e2e-out/${name}-1-setup.png` });
  await page.click('#cmopt-root >> text=Fetch offers & optimize');
  await page.waitForSelector('#cmopt-root >> text=Total (estimated)', { timeout: 90000 });
  await page.screenshot({ path: `e2e-out/${name}-2-results.png` });

  const text = await page.locator('#cmopt-root main').innerText();
  const fail = (msg) => { console.error(`FAIL [${name}]:`, msg, '\n', text); process.exitCode = 1; };
  if (/cheap_de/.test(text)) fail('a German seller got through the Switzerland-only filter');
  if (!text.includes(expectTotal)) fail(`expected the optimal total of ${expectTotal}`);
  if (!/Black Lotus/.test(text)) fail('missing card not reported');
  if (!requested.some((r) => r.includes('sellerCountry=4'))) fail('country filter not sent');
  await extraChecks?.({ page, text, requested, fail });
  console.log(`--- ${name}: ${requested.length} requests ---\n${requested.join('\n')}\n--- results ---\n${text}\n`);
  await ctx.close();
}

// Hand-computed from the CH tiers: Sheoldred alone from basel_magic (60 + 8,50),
// 2 Counterspell from lugano (1,80 + 1,60), 4 Bolts from zurich_cards (2,40 + 1,60).
await scenario('no-scan', { scanSellers: 0 }, '75,90 €', async ({ page, fail }) => {
  await page.click('#cmopt-root >> text=Add all to cart');
  await page.waitForFunction(() => window.__cartPosts.length >= 3, null, { timeout: 15000 }).catch(() => {});
  const posts = await page.evaluate(() => window.__cartPosts);
  const got = posts.map((p) => Object.entries(p).filter(([k]) => k.startsWith('amount')).map(([k, v]) => `${k}=${v}`).join()).sort().join(' ');
  if (got !== 'amount[10]=4 amount[20]=1 amount[32]=2') fail(`cart posts: ${got}`);
});

// Everything from bigstore_ch in one tracked parcel: 60,50 + 2,00 + 2,60 + 8,50.
await scenario('scan+exact', { scanSellers: 10, exact: true }, '73,60 €', async ({ text, requested, fail }) => {
  if (!requested.some((r) => r.includes('/Users/bigstore_ch/Offers/Singles?idWantsList=123&site=2'))) fail('second page of the seller scan not read');
  if (!requested.includes('CDN highs.wasm')) fail('exact solver not loaded');
  if (!/Checked with the exact solver/.test(text)) fail('exact solver result not used');
  if (!/Cheapest: 0,60 € at zurich_cards/.test(text)) fail('bundling explanation missing');
});
await browser.close();
