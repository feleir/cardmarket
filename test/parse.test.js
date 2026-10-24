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

test('World Championship Deck printings are excluded for any-printing wants by default', () => {
  const want = { kind: 'card', languages: [], minCondition: 0, flags: {} };
  const f = wantFilters(want, DEFAULT_SETTINGS);
  const o = { seller: 'a', countryId: 4, price: 1, rating: 5 };
  assert.equal(offerAllowed({ ...o, expansion: 'WCD 1999: Matt Linde' }, want, f, DEFAULT_SETTINGS), false);
  assert.equal(offerAllowed({ ...o, expansion: 'Pro Tour Collector Set' }, want, f, DEFAULT_SETTINGS), false);
  assert.equal(offerAllowed({ ...o, expansion: 'Mystery Booster 2' }, want, f, DEFAULT_SETTINGS), true);
});

test('seller-page wants filter found through its form and the redirect', async () => {
  const { discoverWantsFilter } = await import('../src/collect.js');
  const seller = '/en/Magic/Users/MikoSellerCH/Offers/Singles';
  // No <select> for the list: a radio in a POST filter form, like the
  // product filter forms that post to PostGetAction and redirect.
  const page = doc(`<!doctype html><html><body><div id="tabContent-Wants"><form method="POST" action="/en/Magic/PostGetAction/User_Offers_FilterWants">
    <input type="hidden" name="__cmtkn" value="t"><input type="hidden" name="idUser" value="77">
    <input type="radio" name="idWantsList" value="0" checked><input type="radio" name="idWantsList" value="21758327">
    <button type="submit">Filter</button></form></div></body></html>`);
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push([url, [...init.body.entries()]]);
    return { url: `https://www.cardmarket.com${seller}?idWantsList=21758327&sortBy=price` };
  };
  try {
    const found = await discoverWantsFilter({ doc: async () => null }, page, seller, '21758327');
    assert.equal(found.template, `${seller}?idWantsList=21758327&sortBy=price`);
    assert.equal(posted[0][0], '/en/Magic/PostGetAction/User_Offers_FilterWants');
    assert.deepEqual(posted[0][1], [['__cmtkn', 't'], ['idUser', '77'], ['idWantsList', '21758327']]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('seller-page wants filter found through the data-props filter component', async () => {
  const { discoverWantsFilter } = await import('../src/collect.js');
  const seller = '/en/Magic/Users/MikoSellerCH/Offers/Singles';
  // As on the live page: no form, a script component configured in data-props.
  const props = { action: '/en/Magic/PostGetAction/User_Account_Filter_FilterUserInventory', currencySymbol: '',
    inputs: [{ name: 'idWantslist', value: '', isMultiSelect: false }, { name: 'sortBy', value: '', isMultiSelect: false }] };
  const page = doc(`<!doctype html><html><body><input type="hidden" name="__cmtkn" value="tk">
    <div data-component-name="CategoryOffersFilterComponent" data-props="${JSON.stringify(props).replace(/"/g, '&quot;')}"></div></body></html>`);
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push([url, [...init.body.entries()]]);
    return { url: `https://www.cardmarket.com${seller}?idWantslist=21758327` };
  };
  try {
    const found = await discoverWantsFilter({ doc: async () => null }, page, seller, '21758327');
    assert.equal(found.template, `${seller}?idWantslist=21758327`);
    assert.equal(posted[0][0], props.action);
    assert.deepEqual(posted[0][1], [['__cmtkn', 'tk'], ['idWantslist', '21758327'], ['sortBy', '']]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The price area of the row that could not be read (live debug report): an
// icon with the price's class comes first, the price excludes 8.1% Swiss VAT,
// and the seller ships only tracked.
const LIVE_OFFER_VAT = `<div class="col-offer col-auto"><div class="price-container d-none d-md-flex justify-content-end"><div class="d-flex flex-column"><div class="d-flex align-items-center justify-content-end"><span title="Only &lt;strong&gt;tracked shipping&lt;/strong&gt; to Switzerland." data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="fonticon-check-circle extra-small color-primary me-2 me-md-1"></span><span class="color-primary small text-end text-nowrap fw-bold ">0,84 €</span><sup title="You have to pay an additional 8.1% VAT. The final amount will be shown in your shopping cart." data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="bottom" class="vatWarning">&nbsp;1</sup></div></div></div><div class="amount-container d-none d-md-flex justify-content-end me-3"><span class="item-count small text-end">2</span></div></div>`;

test('live row with tracked-only shipping and VAT note', () => {
  const row = LIVE_ROW.replace(/<div class="col-offer col-auto">[\s\S]*$/, `${LIVE_OFFER_VAT}</div>`);
  const [o] = parseOffers(doc(productPage({ title: 'X', expansion: 'Y', rows: [row] })), '/en/Magic/Products/Singles/Y/X');
  assert.equal(o.listedPrice, 0.84);
  assert.equal(o.vat, 8.1);
  assert.equal(o.price, 0.91);
  assert.equal(o.trackedOnly, true);
  assert.equal(o.available, 2);
});

test('tracked-only sellers are charged the tracked rate', async () => {
  const { sellerTiers, tierCost } = await import('../src/shipping.js');
  const { DEFAULT_SHIPPING } = await import('../src/constants.js');
  assert.equal(tierCost(sellerTiers(DEFAULT_SHIPPING, { countryCode: 'CH' }), 1, 1), 1.83);
  assert.equal(tierCost(sellerTiers(DEFAULT_SHIPPING, { countryCode: 'CH', trackedOnly: true }), 1, 1), 8.5);
});

test('any printing: a want for one printing also gets offers for its other printings', async () => {
  const { collectOffers, matchWants } = await import('../src/collect.js');
  const P = '/en/Magic/Products/Singles';
  const pages = {
    [`${P}/Torment/Aquamoeba`]: productPage({ title: 'Aquamoeba', expansion: 'Torment', rows: [offerRow({ id: 1, seller: 'a', price: '0,90 €' })] })
      .replace('</body>', '<a href="/en/Magic/Cards/Aquamoeba">Show all versions</a></body>'),
    '/en/Magic/Cards/Aquamoeba': productPage({ title: 'Aquamoeba', expansion: '', rows: [
      offerRow({ id: 2, seller: 'b', price: '0,15 €', expansion: 'Dominaria Remastered', productUrl: `${P}/Dominaria-Remastered/Aquamoeba` }),
      offerRow({ id: 3, seller: 'c', price: '0,05 €', expansion: 'WCD 2002: Brian Kibler', productUrl: `${P}/WCD-2002-Brian-Kibler/Aquamoeba` }),
    ] }),
  };
  const fetched = [];
  const mem = new Map();
  const fetcher = {
    cached: (u) => mem.get(u), store: (u, v) => mem.set(u, v),
    doc: async (u) => { fetched.push(u); const html = pages[u.split('?')[0]]; return html ? doc(html) : null; },
  };
  const want = { idWant: '1', kind: 'product', name: 'Aquamoeba', url: `${P}/Torment/Aquamoeba?sellerCountry=4`, expansion: 'Torment', quantity: 4, languages: [], minCondition: 5, flags: {} };

  await collectOffers(fetcher, [want], { ...DEFAULT_SETTINGS, anyPrinting: false });
  assert.deepEqual(want.offers.map((o) => o.id), ['1']);

  await collectOffers(fetcher, [want], { ...DEFAULT_SETTINGS, anyPrinting: true });
  assert.deepEqual(want.offers.map((o) => [o.id, o.expansion, o.otherPrinting]), [['1', 'Torment', false], ['2', 'Dominaria Remastered', true]]);
  assert.ok(fetched.some((u) => u.startsWith('/en/Magic/Cards/Aquamoeba?sellerCountry=4')));
  // A seller-scan offer of another printing now matches too.
  assert.equal(matchWants({ productUrl: `${P}/Dominaria-Remastered/Aquamoeba`, name: 'Aquamoeba' }, [want]).length, 1);
});

test('a page that holds back offers is read again per seller type', async () => {
  const { collectOffers } = await import('../src/collect.js');
  const P = '/en/Magic/Products/Singles';
  const full = productPage({ title: 'Elvish Champion', expansion: 'Eighth Edition', rows: [offerRow({ id: 1, seller: 'a', price: '5,00 €' })] })
    .replace('</body>', '<button class="btn">Show more results</button></body>');
  const byType = { 0: [offerRow({ id: 2, seller: 'private1', price: '8,00 €', count: 3 })], 1: [offerRow({ id: 3, seller: 'pro1', price: '7,00 €' })], 2: [] };
  const fetched = [];
  const mem = new Map();
  const fetcher = {
    cached: (u) => mem.get(u), store: (u, v) => mem.set(u, v),
    doc: async (u) => {
      fetched.push(u);
      const t = u.match(/sellerType=(\d)/)?.[1];
      return doc(t == null ? full : productPage({ title: 'Elvish Champion', expansion: 'Eighth Edition', rows: byType[t] }));
    },
  };
  const want = { idWant: '1', kind: 'product', name: 'Elvish Champion', url: `${P}/Eighth-Edition/Elvish-Champion`, quantity: 3, languages: [], minCondition: 5, flags: {} };
  await collectOffers(fetcher, [want], { ...DEFAULT_SETTINGS });
  assert.deepEqual(fetched.map((u) => u.match(/sellerType=(\d)/)?.[1] ?? '-'), ['-', '0', '1', '2']);
  assert.deepEqual(want.offers.map((o) => o.seller).sort(), ['a', 'private1', 'pro1']);
  assert.equal(want.truncated, false); // every batch fit
  // With a seller type chosen in the settings, no extra reads.
  fetched.length = 0; mem.clear();
  await collectOffers(fetcher, [want], { ...DEFAULT_SETTINGS, sellerTypes: [1] });
  assert.equal(fetched.length, 1);
});

test('offers that cannot be bought are left out', async () => {
  const { collectOffers } = await import('../src/collect.js');
  const P = '/en/Magic/Products/Singles';
  const noButton = offerRow({ id: 2, seller: 'Christobye', price: '0,22 €' })
    .replace(/<div class="d-none d-md-flex ms-auto"><form[\s\S]*?<\/form><\/div>/, '')
    .replace(/<div class="d-md-none ms-auto"><a[\s\S]*?<\/a><\/div>/, '');
  const noShip = offerRow({ id: 3, seller: 'faraway', price: '0,20 €' })
    .replace('<div class="col-offer col-auto">', '<div class="col-offer col-auto"><span title="This seller does not ship to your country." class="fonticon-info"></span>');
  const html = productPage({ title: 'Wellwisher', expansion: 'Onslaught', rows: [offerRow({ id: 1, seller: 'ok', price: '0,30 €' }), noButton, noShip] });
  const [, b, c] = parseOffers(doc(html), `${P}/Onslaught/Wellwisher`);
  assert.equal(!!(b.cartForm || b.cartModal), false);
  assert.equal(c.noShip, true);
  const mem = new Map();
  const fetcher = { cached: (u) => mem.get(u), store: (u, v) => mem.set(u, v), doc: async () => doc(html) };
  const want = { idWant: '1', kind: 'product', name: 'Wellwisher', url: `${P}/Onslaught/Wellwisher`, quantity: 2, languages: [], minCondition: 0, flags: {} };
  await collectOffers(fetcher, [want], { ...DEFAULT_SETTINGS });
  assert.deepEqual(want.offers.map((o) => o.seller), ['ok']);
  assert.deepEqual(want.diag.rejected, { 'no cart button': 1, 'does not ship to you': 1 });
});
