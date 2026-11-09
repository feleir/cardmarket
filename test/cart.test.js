import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { parseCart } from '../src/parse.js';
import { cartPage } from './fixtures.js';

const doc = (html) => parseHTML(html).document;
const P = '/en/Magic/Products/Singles';

test('cart page: items with article, seller, country, amount, unit price, language, condition', () => {
  const html = cartPage([
    { seller: 'zurich_cards', items: [
      { id: '2187021162', amount: 3, name: 'Lightning Bolt', productUrl: `${P}/Magic-2010/Lightning-Bolt`, expansion: 'Magic 2010', price: '0,60 €' },
      { id: '2187021163', amount: 1, name: 'Counterspell', productUrl: `${P}/Ice-Age/Counterspell`, expansion: 'Ice Age', price: '1,20 €', lang: 'German', cond: 'GD' },
    ] },
    { seller: 'cheap_de', country: 'Germany', items: [
      { id: '1777572891', amount: 2, name: 'Lightning Bolt', productUrl: `${P}/Magic-2010/Lightning-Bolt`, expansion: 'Magic 2010', price: '0,50 €' },
    ] },
  ]);
  const { items, sellers } = parseCart(doc(html));
  assert.deepEqual(items.map((i) => [i.articleId, i.seller, i.countryCode, i.quantity, i.price, i.name, i.expansion, i.language, i.condition]), [
    ['2187021162', 'zurich_cards', 'CH', 3, 0.6, 'Lightning Bolt', 'Magic 2010', 1, 2],
    ['2187021163', 'zurich_cards', 'CH', 1, 1.2, 'Counterspell', 'Ice Age', 3, 4],
    ['1777572891', 'cheap_de', 'DE', 2, 0.5, 'Lightning Bolt', 'Magic 2010', 1, 2],
  ]);
  assert.deepEqual(Object.keys(sellers), ['zurich_cards', 'cheap_de']);
});

test('cart page, another layout: divs, "2x" amounts, line totals next to unit prices', () => {
  const html = `<html><body>
    <div class="seller-block"><h3>Seller: <a href="/en/Magic/Users/geneva_tcg">geneva_tcg</a></h3>
      <div class="cart-item" data-id-article="555666777"><span>2x</span> <a href="${P}/Ice-Age/Counterspell">Counterspell</a>
        <span class="unit-price">1,30 €</span> <span class="line-price">2,60 €</span></div>
      <div class="cart-item"><input type="hidden" name="idArticle[888999000]" value="1"><span>1x</span> <a href="${P}/Alpha/Black-Lotus">Black Lotus</a>
        <span class="unit-price">9.999,00 €</span></div>
    </div></body></html>`;
  const { items } = parseCart(doc(html));
  assert.deepEqual(items.map((i) => [i.articleId, i.seller, i.quantity, i.price, i.name]), [
    ['555666777', 'geneva_tcg', 2, 1.3, 'Counterspell'],
    ['888999000', 'geneva_tcg', 1, 9999, 'Black Lotus'],
  ]);
});
