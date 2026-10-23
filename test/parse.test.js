import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { parseOffers, parsePrice, parseWantsList, parseVersionLinks, parseWantsOverview } from '../src/parse.js';
import { filterQuery, offerAllowed, wantFilters } from '../src/collect.js';
import { DEFAULT_SETTINGS } from '../src/constants.js';
import { offerRow, productPage, wantsListPage, cardPage, wantsOverview } from './fixtures.js';

const doc = (html) => parseHTML(html).document;

test('parsePrice handles both separators', () => {
  assert.equal(parsePrice('1.234,56 €'), 1234.56);
  assert.equal(parsePrice('€1,234.56'), 1234.56);
  assert.equal(parsePrice('0,02 €'), 0.02);
  assert.equal(parsePrice('12 €'), 12);
});

test('parseOffers reads seller, country, condition, language, price and cart form', () => {
  const html = productPage({ title: 'Sheoldred', expansion: 'Dominaria United', rows: [
    offerRow({ id: 111, seller: 'alpine', price: '64,90 €', count: 3, cond: 'EX', lang: 'German' }),
    offerRow({ id: 222, seller: 'bern', country: 'Germany', rating: 'none', price: '1.001,00 €', foil: true }),
  ] });
  const offers = parseOffers(doc(html), 'https://www.cardmarket.com/en/Magic/Products/Singles/Dominaria-United/Sheoldred?x=1');
  assert.equal(offers.length, 2);
  const [a, b] = offers;
  assert.equal(a.id, '111');
  assert.equal(a.seller, 'alpine');
  assert.equal(a.countryId, 4);
  assert.equal(a.countryCode, 'CH');
  assert.equal(a.condition, 3);
  assert.equal(a.language, 3);
  assert.equal(a.price, 64.9);
  assert.equal(a.available, 3);
  assert.equal(a.rating, 5);
  assert.equal(a.isFoil, false);
  assert.equal(a.expansion, 'Dominaria United');
  assert.equal(a.productUrl, '/en/Magic/Products/Singles/Dominaria-United/Sheoldred');
  assert.equal(a.cartForm.action, 'ShoppingCart_Add_AddArticlesFromProductPage');
  assert.deepEqual(a.cartForm.fields.map((f) => f[0]), ['__cmtkn', 'idArticle[111]', 'amount[111]']);
  assert.match(a.cartModal, /idArticle=111/);
  assert.equal(b.countryId, 7);
  assert.equal(b.rating, 0);
  assert.equal(b.price, 1001);
  assert.equal(b.isFoil, true);
});

test('parseWantsList reads amounts, kinds, languages, condition and ternary flags', () => {
  const html = wantsListPage([
    { id: 1, amount: 4, name: 'Lightning Bolt', url: '/de/Magic/Cards/Lightning-Bolt', languages: ['English', 'German'], cond: 'EX', foil: 'N' },
    { id: 2, amount: 1, name: 'Sheoldred, the Apocalypse', url: '/en/Magic/Products/Singles/Dominaria-United/Sheoldred-the-Apocalypse', expansion: 'Dominaria United', maxPrice: '70,00 €', signed: 'Y' },
  ]);
  const wants = parseWantsList(doc(html));
  assert.equal(wants.length, 2);
  assert.deepEqual(
    { kind: wants[0].kind, q: wants[0].quantity, langs: wants[0].languages, cond: wants[0].minCondition, flags: wants[0].flags },
    { kind: 'card', q: 4, langs: [1, 3], cond: 3, flags: { isFoil: 'N' } },
  );
  assert.equal(wants[1].kind, 'product');
  assert.equal(wants[1].maxPrice, 70);
  assert.equal(wants[1].expansion, 'Dominaria United');
  assert.deepEqual(wants[1].flags, { isSigned: 'Y' });
});

test('filters become Cardmarket query parameters', () => {
  const want = { languages: [3, 1], minCondition: 3, flags: { isFoil: 'N' } };
  const f = wantFilters(want, { ...DEFAULT_SETTINGS, sellerCountries: [7, 4] });
  assert.equal(filterQuery(f), 'sellerCountry=4,7&language=1,3&minCondition=3&isFoil=N&isSigned=N&isAltered=N');
  const g = wantFilters(want, { ...DEFAULT_SETTINGS, languages: [2], minCondition: 2, foil: 'any' });
  assert.equal(filterQuery(g), 'sellerCountry=4&language=2&minCondition=2&isSigned=N&isAltered=N');
});

test('offers are re-checked client-side because URL filters fail open', () => {
  const s = { ...DEFAULT_SETTINGS, sellerCountries: [4], minRating: 3, excludeSellers: 'BadGuy' };
  const want = { kind: 'card', languages: [1], minCondition: 2, flags: {}, maxPrice: 5 };
  const f = wantFilters(want, s);
  const ok = { seller: 'a', countryId: 4, language: 1, condition: 2, price: 4, rating: 4, expansion: 'Alpha' };
  assert.equal(offerAllowed(ok, want, f, s), true);
  assert.equal(offerAllowed({ ...ok, countryId: 7 }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, language: 3 }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, condition: 4 }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, price: 6 }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, rating: 2 }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, rating: 0 }, want, f, s), true);
  assert.equal(offerAllowed({ ...ok, seller: 'badguy' }, want, f, s), false);
  assert.equal(offerAllowed({ ...ok, expansion: 'World Championship Decks 1997' }, want, f, s), false);
});

test('parseVersionLinks keeps only printings of the card', () => {
  const html = cardPage({ title: 'Lightning Bolt', versions: [
    { url: '/en/Magic/Products/Singles/Alpha/Lightning-Bolt', from: '120,00 €' },
    { url: '/en/Magic/Products/Singles/Magic-2010/Lightning-Bolt', from: '0,80 €' },
  ] });
  const v = parseVersionLinks(doc(html), '/en/Magic/Cards/Lightning-Bolt');
  assert.deepEqual(v.map((x) => [x.expansion, x.fromPrice]), [['Alpha', 120], ['Magic 2010', 0.8]]);
});

test('parseWantsOverview finds lists', () => {
  const lists = parseWantsOverview(doc(wantsOverview([{ id: 9, name: 'Deck A' }, { id: 10, name: 'Deck B' }])));
  assert.deepEqual(lists.map((l) => [l.id, l.name]), [['9', 'Deck A'], ['10', 'Deck B']]);
});

test('seller-page offers are matched back to wants', async () => {
  const { matchWants, pickSellersToScan } = await import('../src/collect.js');
  const wants = [
    { idWant: '1', kind: 'product', name: 'Sheoldred, the Apocalypse', url: '/de/Magic/Products/Singles/Dominaria-United/Sheoldred-the-Apocalypse' },
    { idWant: '2', kind: 'card', name: 'Lightning Bolt', url: '/en/Magic/Cards/Lightning-Bolt' },
  ];
  assert.deepEqual(matchWants({ productUrl: '/en/Magic/Products/Singles/Dominaria-United/Sheoldred-the-Apocalypse', name: 'Sheoldred, the Apocalypse' }, wants).map((w) => w.idWant), ['1']);
  assert.deepEqual(matchWants({ productUrl: '/en/Magic/Products/Singles/Alpha/Lightning-Bolt', name: 'Lightning Bolt (V.2)' }, wants).map((w) => w.idWant), ['2']);
  assert.deepEqual(matchWants({ productUrl: '/en/Magic/Products/Singles/Alpha/Lightning-Dragon', name: 'Lightning Dragon' }, wants), []);

  const ws = [
    { offers: [{ seller: 'a' }, { seller: 'b' }] },
    { offers: [{ seller: 'a' }, { seller: 'c' }] },
    { offers: [{ seller: 'a' }, { seller: 'b' }, { seller: 'd' }] },
  ];
  assert.deepEqual(pickSellersToScan(ws, ['d'], 2).map((o) => o.seller), ['d', 'a']);
  assert.deepEqual(pickSellersToScan(ws, [], 3).map((o) => o.seller), ['a', 'b', 'c']);
});

test('detects card pages that hold back offers', async () => {
  const { isTruncated, FULL_BATCH } = await import('../src/parse.js');
  const { shouldScanSellers } = await import('../src/collect.js');
  const rows = (n) => Array.from({ length: n }, (_, i) => offerRow({ id: i + 1, seller: `s${i}` }));
  assert.equal(isTruncated(doc(productPage({ title: 'X', expansion: 'Y', rows: rows(3) }))), false);
  assert.equal(isTruncated(doc(productPage({ title: 'X', expansion: 'Y', rows: rows(FULL_BATCH) }))), true);
  assert.equal(isTruncated(doc(productPage({ title: 'X', expansion: 'Y', rows: rows(3) }).replace('</body>', '<button class="btn">Show more results</button></body>'))), true);
  assert.equal(isTruncated(doc(productPage({ title: 'X', expansion: 'Y', rows: rows(3) }).replace('</body>', '<div id="loadMoreButton"></div></body>'))), true);

  assert.deepEqual(shouldScanSellers([{ truncated: false }], 'auto'), { run: false, reason: 'complete', cut: 0 });
  assert.equal(shouldScanSellers([{ truncated: true }, {}], 'auto').run, true);
  assert.equal(shouldScanSellers([{}], 'always').run, true);
  assert.equal(shouldScanSellers([{ truncated: true }], 'off').run, false);
});

// A real offer row as Cardmarket serves it (from a live debug report): every
// tooltip is a plain title attribute. Reading the location from
// data-bs-original-title only made every seller "no country", and the
// Switzerland filter then removed all offers.
const LIVE_ROW = `<div id="articleRow1892661503" class="row g-0 article-row"><div class="d-none col"></div><div class="col-sellerProductInfo col"><div class="row g-0"><div class="col-seller col-12 col-lg-auto"><span class="seller-info d-flex align-items-center"><span class="seller-extended d-flex"><span class="d-flex has-content-centered me-1"><span title="Outstanding" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="fonticon-seller-rating-outstanding"><span class="path1"></span><span class="path2"></span></span></span><span title="750&nbsp;Sales&nbsp;|&nbsp;19500&nbsp;Available items" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="badge text-bg-faded d-none d-sm-inline-flex has-content-centered me-1 sell-count">750</span><span class="d-none d-sm-inline-flex has-content-centered me-1"><span title="&lt;div&gt;Estimated delivery time for LastTryTCG : 4 days&lt;/div&gt;&lt;span class=&quot;small fst-italic&quot;&gt;(Avg. delivery time from Switzerland to Spain : 4 days)&lt;/span&gt;" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="fonticon-calendar "><span class="shippingTime-info">4</span></span></span></span><span class="seller-name d-flex"><span title="Item location: Switzerland" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="icon d-flex has-content-centered me-1"><span style="display: inline-block; width: 16px; height: 16px;" class="icon"></span></span><span class="d-flex has-content-centered me-1"><a href="/en/Magic/Users/LastTryTCG">LastTryTCG</a></span><span class="d-flex text-nowrap ms-lg-auto"></span></span></span></div><div class="col-product col-12 col-lg"><div class="row g-0"><div class="product-attributes col"><a href="https://help.cardmarket.com/en/CardCondition" target="_blank" title="Near Mint" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="article-condition condition-nm me-1"><span class="badge ">NM</span></a><span style="display: inline-block; width: 16px; height: 16px;" title="English" data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="icon me-2"></span></div></div></div></div></div><div class="col-offer col-auto"><div class="price-container d-none d-md-flex justify-content-end"><div class="d-flex flex-column"><div class="d-flex align-items-center justify-content-end"><span class="color-primary small text-end text-nowrap fw-bold ">0,25 €</span></div></div></div><div class="amount-container d-none d-md-flex justify-content-end me-3"><span class="item-count small text-end">3</span></div></div></div>`;

test('live offer row: country, rating, condition and language from title attributes', () => {
  const html = productPage({ title: 'Acidic Sliver', expansion: 'Stronghold', rows: [LIVE_ROW] });
  const [o] = parseOffers(doc(html), '/en/Magic/Products/Singles/Stronghold/Acidic-Sliver?sellerCountry=4');
  assert.equal(o.seller, 'LastTryTCG');
  assert.equal(o.countryName, 'Switzerland');
  assert.equal(o.countryId, 4);
  assert.equal(o.rating, 5);
  assert.equal(o.sales, 750);
  assert.equal(o.condition, 2);
  assert.equal(o.language, 1);
  assert.equal(o.price, 0.25);
  assert.equal(o.available, 3);
  assert.equal(o.expansion, 'Stronghold');
  const want = { kind: 'product', languages: [], minCondition: 5, flags: {}, maxPrice: 0 };
  const f = wantFilters(want, { ...DEFAULT_SETTINGS, sellerCountries: [4] });
  assert.equal(offerAllowed(o, want, f, DEFAULT_SETTINGS), true);
});

// The live wants row from the same report.
const LIVE_WANT = `<table><tbody><tr><td class="select min-size p-2"><div class="form-check no-label"><input type="checkbox" name="checkWantsRow[]" data-id-want="6ada448e800ad0fe84026cad" class="form-check-input mb-1 me-2"></div></td><td class="preview min-size d-none d-sm-table-cell p-2"></td><td data-amount="3" class="amount min-size text-center p-2">3</td><td class="name min-size text-start p-2"><a href="/en/Magic/Products/Singles/Stronghold/Acidic-Sliver?sellerCountry=4">Acidic Sliver</a></td><td class="expansion d-none d-sm-table-cell p-2"><div class="d-flex flex-wrap has-content-centered"><span title="Stronghold" data-bs-toggle="tooltip" class="expansion-symbol is-magic icon is-24x24"></span><span class="visually-hidden">Stronghold</span></div></td><td class="languages min-size p-2"><span class="visually-hidden">Any</span></td><td class="condition min-size p-2"><div class="d-flex has-content-centered"><span class="me-1">≥</span><a href="https://help.cardmarket.com/en/CardCondition" target="_blank" title="Light Played" class="article-condition condition-lp"><span class="badge ">LP</span></a><span class="visually-hidden">Light Played</span></div></td><td class="min-size d-none d-lg-table-cell ternary-header p-2"><span class="visually-hidden">Any</span></td><td data-text="0" class="buyPrice min-size text-end p-2"></td></tr></tbody></table>`;

test('live wants row', () => {
  const [w] = parseWantsList(doc(`<!doctype html><html><body>${LIVE_WANT}</body></html>`));
  assert.deepEqual(
    { name: w.name, kind: w.kind, q: w.quantity, langs: w.languages, cond: w.minCondition, exp: w.expansion, max: w.maxPrice, flags: w.flags },
    { name: 'Acidic Sliver', kind: 'product', q: 3, langs: [], cond: 5, exp: 'Stronghold', max: 0, flags: {} },
  );
});
