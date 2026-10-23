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
