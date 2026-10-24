// End-to-end check in headless Chromium at phone size: cardmarket.com is
// mocked with fixture pages (one filter deliberately "fails open" and serves
// sellers from other countries), the built bookmarklet is run on a wants
// page, and the result and the add-to-cart replay are checked.
//
// Two runs, both with the seller scan on Auto. In the first, every card page
// shows all its offers, so the scan is skipped and the best cart is 76,53 €
// (bigstore_ch only shows up on the Counterspell page). In the second, the
// Counterspell page holds offers back ("Show more results"), so the scan
// runs: bigstore_ch's own stock (filtered by the wants list, over two pages)
// also holds Sheoldred and the Bolts, and one parcel from it costs 73,60 € —
// the bundle the card pages alone did not reveal. The second run also uses
// the exact solver, served from a mocked CDN.
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
    offerRow({ id: 10, seller: 'zurich_cards', price: '0,60 €', count: 3 }),
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
  // For "Add a card": Tinder Wall's all-printings page.
  '/en/Magic/Cards/Tinder-Wall': productPage({ title: 'Tinder Wall', expansion: '', rows: [
    offerRow({ id: 50, seller: 'newseller', price: '0,10 €', count: 4, expansion: 'Stronghold', productUrl: `${P}/Stronghold/Tinder-Wall` }),
    offerRow({ id: 51, seller: 'zurich_cards', price: '0,30 €', count: 4, expansion: 'Stronghold', productUrl: `${P}/Stronghold/Tinder-Wall` }),
    offerRow({ id: 52, seller: 'geneva_tcg', price: '0,35 €', count: 4, expansion: 'Stronghold', productUrl: `${P}/Stronghold/Tinder-Wall` }),
  ] }),
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

// Stand-in for Cardmarket's cart. Like the real site, a product page's own
// script sends the add-to-cart request when its button is pressed (here to
// a mock AJAX endpoint); posting the form anywhere else does nothing.
const cart = new Map();
const fieldsOf = (body) => Object.fromEntries([...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map((m) => [m[1], m[2]]));
// Like Cardmarket's jcp(): one XMLHttpRequest at a time, further presses
// wait in jcpStack, and the server answers slowly. Closing the page while
// something is queued loses it, as happened live before the fix.
const pageScript = `<script>
  window.jcp = function () {}; window.jcpStack = []; window.doingJCPCall = false;
  function send(body) {
    window.doingJCPCall = true;
    const x = new XMLHttpRequest();
    x.open('POST', '/en/Magic/AjaxAction/ShoppingCart_Add');
    x.onloadend = () => { window.doingJCPCall = false; const next = window.jcpStack.shift(); if (next) send(next); };
    x.send(body);
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-ajax-action]');
    if (!f) return;
    e.preventDefault();
    const body = new FormData(f);
    if (window.doingJCPCall) window.jcpStack.push(body); else send(body);
  });
</script>`;
function cartRoute(u, req) {
  if (req.method() === 'POST' && u.pathname.startsWith('/en/Magic/AjaxAction/ShoppingCart_Add')) {
    const f = fieldsOf(req.postData() || '');
    if (f.__cmtkn !== 'tok123') return '{"error":"token"}';
    for (const k of Object.keys(f)) {
      const m = k.match(/^idArticle\[(\d+)\]$/);
      if (m) cart.set(m[1], Number(f[`amount[${m[1]}]`]));
    }
    return '{"ok":true}';
  }
  if (req.method() === 'POST') return '<html><body>home</body></html>'; // what PostGetAction did live
  if (u.pathname === '/en/Magic/ShoppingCart') return `<html><body>${[...cart].map(([id, n]) => `<div id="articleRow${id}">${n}</div>`).join('')}</body></html>`;
  return null;
}

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => pw.chromium.launch());
const highsDir = `${process.cwd()}/node_modules/highs/build/`;
await mkdir('e2e-out', { recursive: true });
const bm = await readFile('dist/bookmarklet.txt', 'utf8');

const requestedCount = { ajax: 0 };
let checkPages = false; // serve Cloudflare's "Just a moment..." for card pages
async function scenario(name, settings, expectTotal, extraChecks, cutOff = []) {
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'] });
  const page = await ctx.newPage();
  const requested = [];
  await page.route('https://www.cardmarket.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/en/Magic/AjaxAction/')) { requestedCount.ajax++; await new Promise((r) => setTimeout(r, 4000)); } // a slow answer
    requested.push(u.pathname + u.search);
    const m = u.pathname.match(/^\/en\/Magic\/Users\/([^/]+)\/Offers\/Singles$/);
    let html = cartRoute(u, route.request()) ?? (m ? sellerPage(m[1], u.searchParams) : pages[u.pathname]);
    if (!html) return route.fulfill({ status: 404, body: 'not found' });
    if (checkPages && html.includes('article-row')) html = '<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>';
    if (html.includes('article-row')) html = html.replace('</body>', `${pageScript}</body>`);
    if (cutOff.includes(u.pathname)) html = html.replace('</body>', '<button class="btn btn-primary">Show more results</button></body>');
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
  const deck = settings.source === 'deck';
  await page.waitForSelector(deck ? '#cmopt-root textarea[data-k="deckText"]' : '#cmopt-root option:has-text("Mono Red")', { state: 'attached' });
  await page.screenshot({ path: `e2e-out/${name}-1-setup.png` });
  await page.click('#cmopt-root >> text=Fetch offers & optimize');
  await page.waitForSelector('#cmopt-root >> text=Total (estimated)', { timeout: 90000 });
  await page.screenshot({ path: `e2e-out/${name}-2-results.png` });

  const text = await page.locator('#cmopt-root main').innerText();
  const fail = (msg) => { console.error(`FAIL [${name}]:`, msg, '\n', text); process.exitCode = 1; };
  if (/cheap_de/.test(text)) fail('a German seller got through the Switzerland-only filter');
  if (!text.includes(expectTotal)) fail(`expected the optimal total of ${expectTotal}`);
  if (!deck && !/Black Lotus/.test(text)) fail('missing card not reported');
  const log = await page.locator('#cmopt-root .log').innerText().catch(() => '');
  if (!deck && log && !/Black Lotus: 0 offer\(s\) \(1 page\(s\), 0 offer rows, 0 read\)/.test(log)) fail('no diagnostics for a card without offers');
  if (!requested.some((r) => r.includes('sellerCountry=4'))) fail('country filter not sent');
  await extraChecks?.({ page, text, log, requested, fail });
  console.log(`--- ${name}: ${requested.length} requests ---\n${requested.join('\n')}\n--- results ---\n${text}\n`);
  await ctx.close();
}

// Hand-computed from the CH tiers (letter 1,83 €, up to 17 cards 2,60 €,
// tracked above 25 € 8,50 €): Sheoldred + 2 Counterspell + 1 Bolt from
// geneva_tcg (61 + 2,60 + 0,80 + 8,50 = 72,90) and 3 Bolts from zurich_cards
// (1,80 + 1,83) = 76,53 €. Next best: geneva also taking its 2nd Bolt
// (73,70 + 3,03 = 76,73), or Sheoldred alone from basel_magic (78,39).
// Two of the cart items (Bolts from zurich_cards and geneva_tcg) sit on the
// same page, so the second press is queued behind a slow first answer.
await scenario('complete-pages', { scanMode: 'auto' }, '76,53 €', async ({ page, text, requested, fail }) => {
  if (requested.some((r) => r.includes('/Users/'))) fail('seller scan ran although every card page was complete');
  // Other options: no smaller set of sellers stocks every card here.
  await page.waitForSelector('#cmopt-root >> text=Other options', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !/Working out/.test(document.querySelector('#cmopt-root').shadowRoot?.getElementById('cmopt-options')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  const opts = await page.locator('#cmopt-root #cmopt-options').innerText();
  if (!/No cart with fewer parcels can supply every card/.test(opts)) fail(`options: ${opts}`);
  await page.click('#cmopt-root >> text=Add all to cart');
  await page.waitForSelector('#cmopt-root >> text=added to your cart', { timeout: 90000 }).catch(() => {});
  const got = [...cart].map(([id, n]) => `${id}x${n}`).sort().join(' ');
  if (got !== '10x3 12x1 21x1 31x2') fail(`cart holds: ${got}`);
  const after = await page.locator('#cmopt-root main').innerText();
  if (!/All 4 added to your cart/.test(after)) fail('cart result not reported');
  if ((after.match(/In cart ✓/g) || []).length !== 4) fail('items not marked as in the cart');
  await page.screenshot({ path: 'e2e-out/complete-pages-3-cart.png' });

  // Running it again sends nothing: everything is already in the cart.
  const posts = () => requestedCount.ajax;
  const sentBefore = posts();
  const idle = () => page.waitForSelector('#cmopt-root button[data-act="addAll"]:not([disabled])', { timeout: 90000 });
  const t0 = Date.now();
  await page.click('#cmopt-root >> text=Add all to cart');
  await page.waitForTimeout(300);
  await idle();
  if (posts() !== sentBefore) fail('a second "Add all" pressed items already in the cart');
  if (Date.now() - t0 > 15000) fail(`a second "Add all" with nothing to add took ${Date.now() - t0} ms`);

  // A browser check on the card pages stops it with an explanation.
  cart.delete('12');
  checkPages = true;
  await page.click('#cmopt-root >> text=Add all to cart');
  await page.waitForTimeout(300);
  await idle();
  if (!/Cardmarket is showing its browser check/.test(await page.locator('#cmopt-root main').innerText())) fail('browser check not reported');
  checkPages = false;

  // Add a card: 4 Tinder Walls. geneva_tcg's parcel is already tracked, so
  // copies join it for no extra shipping (0,35 each); zurich_cards has 3
  // cards, so 1 copy (0,30) fits its 4-card letter too, a 2nd would go up a
  // step. Best: 3 × 0,35 + 1 × 0,30 = +1,35 € (a new seller: 0,40 + 1,83).
  await page.fill('#cmopt-root #cmopt-extra-q', 'Tinder Wall');
  await page.fill('#cmopt-root #cmopt-extra-n', '4');
  await page.click('#cmopt-root >> text=Find the best way');
  await page.waitForSelector('#cmopt-root >> text=Add to this cart', { timeout: 30000 }).catch(() => {});
  const extraText = await page.locator('#cmopt-root main').innerText();
  if (!/Add to this cart: \+1,35 €/.test(extraText)) fail('add a card: expected +1,35 €');
  if (!/3× Tinder Wall[\s\S]*geneva_tcg: joins their parcel \(no extra shipping\)/.test(extraText)) fail('add a card: expected 3 to join geneva_tcg');
  if (!/1× Tinder Wall[\s\S]*zurich_cards: joins their parcel \(no extra shipping\)/.test(extraText)) fail('add a card: expected 1 to join zurich_cards');
  await page.screenshot({ path: 'e2e-out/complete-pages-4-add-card.png' });
});

// Everything from bigstore_ch in one tracked parcel: 60,50 + 2,00 + 2,60 + 8,50.
await scenario('cut-off+exact', { scanMode: 'auto', exact: true }, '73,60 €', async ({ text, requested, fail }) => {
  if (!requested.some((r) => r.includes('/Users/bigstore_ch/Offers/Singles?idWantsList=123&site=2'))) fail('second page of the seller scan not read');
  if (!requested.includes('CDN highs.wasm')) fail('exact solver not loaded');
  if (!/Proven optimal by the exact solver/.test(text)) fail('exact solver result not used');
  if (!/Cheaper: 0,60 € at zurich_cards. Taking 3 copies there/.test(text)) fail('bundling explanation missing');
}, [`${P}/Ice-Age/Counterspell`]);
// A pasted decklist instead of a wants list: set codes and basics dropped,
// any printing of each card. 3 Bolts and a Tinder Wall from zurich_cards
// (2,10 + 1,83) and 1 Bolt from geneva_tcg (0,80 + 1,83) = 6,56 €; an
// unknown card is looked up with the search and reported as not found.
await scenario('decklist', {
  source: 'deck', scanMode: 'auto',
  deckText: '4 Lightning Bolt (M10) 146\n1 Tinder Wall\n20 Mountain\n\n1 Made Up Card',
}, '6,56 €', async ({ page, text, log, requested, fail }) => {
  if (!requested.some((r) => r.startsWith('/en/Magic/Cards/Lightning-Bolt'))) fail('deck card page not read');
  if (requested.some((r) => r.includes('Mountain'))) fail('basic land not skipped');
  if (requested.some((r) => r.includes('/Users/'))) fail('seller scan ran for a decklist');
  if (!/Made Up Card/.test(text)) fail('unknown card not reported as missing');
  if (!requested.some((r) => r.includes('Products/Search?searchString=Made%20Up%20Card'))) fail('unknown card not searched for');
  if (log && !/Made Up Card: not found on Cardmarket/.test(log)) fail('unknown card not logged');
  const bolts = [...text.matchAll(/(\d+)× Lightning Bolt/g)].reduce((n, m) => n + Number(m[1]), 0);
  if (bolts !== 4) fail(`expected 4 Bolts, got ${bolts}`);
  if (!/Tinder Wall/.test(text)) fail('Tinder Wall not bought');
  // Other options: zurich_cards alone, with an Alpha Bolt as the 4th copy:
  // 3 × 0,60 + 150,00 + 0,30 + tracked 8,50 = 160,60 € (+154,04 €).
  await page.waitForSelector('#cmopt-root [data-option="1"]', { timeout: 30000 }).catch(() => {});
  const opts = await page.locator('#cmopt-root #cmopt-options').innerText();
  if (!/1\s+160,60 €\s+\+154,04 €/.test(opts)) fail(`options: expected 1 parcel at 160,60 €: ${opts}`);
  if (!/1 card\(s\) in mixed printings/.test(opts)) fail('options: mixed printings not noted');
  await page.click('#cmopt-root [data-option="1"]');
  const one = await page.locator('#cmopt-root main').innerText();
  if (!/Sellers \/ parcels\s*1\b/.test(one) || !/Mixed printings: Lightning Bolt \(Magic 2010, Alpha\)/.test(one)) fail(`switching to the 1-parcel cart: ${one.slice(0, 600)}`);
  await page.screenshot({ path: 'e2e-out/decklist-3-options.png' });
  await page.click('#cmopt-root [data-option="0"]');
  if (!(await page.locator('#cmopt-root main').innerText()).includes('6,56 €')) fail('could not switch back to the cheapest cart');
});
await browser.close();
