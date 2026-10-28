import test from 'node:test';
import assert from 'node:assert/strict';
import { tiersOf, cardsFor } from '../scripts/shipping-table.mjs';
import { publishedShipping, shippingFor, sellerTiers, parseTiers, formatTiers, tierCost } from '../src/shipping.js';

// Switzerland -> Switzerland as help.cardmarket.com/api/shippingCosts returned it (abridged).
const CH_CH = [
  { name: 'Priority Letter (A-Post)', isTracked: false, maxValue: '25,00 €', maxWeight: 100, price: '1,87 €', isLetter: true, isVirtual: false },
  { name: 'Priority Letter (A-Post)', isTracked: false, maxValue: '25,00 €', maxWeight: 500, price: '2,43 €', isLetter: true, isVirtual: false },
  { name: 'Tracked Letter (A-Post Plus)', isTracked: true, maxValue: '100,00 €', maxWeight: 500, price: '4,88 €', isLetter: true, isVirtual: false },
  { name: 'Registered Priority Letter', isTracked: true, maxValue: '500,00 €', maxWeight: 500, price: '8,12 €', isLetter: true, isVirtual: false },
  { name: 'PostPac Priority Signature', isTracked: true, maxValue: '1.250,00 €', maxWeight: 2000, price: '14,43 €', isLetter: false, isVirtual: false },
  { name: 'Courier', isTracked: true, maxValue: '2.500,00 €', maxWeight: 20000, price: '167,30 €', isLetter: false, isVirtual: false },
  { name: 'Courier', isTracked: true, maxValue: '150.000,00 €', maxWeight: 20000, price: '167,30 €', isLetter: false, isVirtual: false },
];

test('published methods become tiers: cards from weight, dominated ones dropped', () => {
  assert.deepEqual([20, 50, 100, 500].map(cardsFor), [4, 17, 40, 224]);
  const t = tiersOf(CH_CH);
  assert.deepEqual(t.map((x) => [x.maxCards, x.maxValue, x.price, x.tracked]), [
    [40, 25, 1.87, false], [224, 25, 2.43, false], [224, 100, 4.88, true], [224, 500, 8.12, true],
    [915, 1250, 14.43, true], [9210, 150000, 167.3, true],
  ]);
});

test('published tiers per home country, user edits on top, tracked-only sellers', () => {
  const ch = publishedShipping('CH');
  assert.ok(ch.CH?.length && ch.DE?.length && ch.default?.length, 'tiers to Switzerland from Switzerland and Germany');
  // Germany -> Switzerland: a 20 g letter, then parcels (customs).
  assert.equal(tierCost(ch.DE, 4, 10), 1.55);
  assert.ok(tierCost(ch.DE, 10, 10) > 20, 'more than 4 cards from Germany go as a parcel');
  assert.equal(tierCost(ch.CH, 10, 10), 1.87);
  assert.ok(tierCost(ch.default, 17, 20) < 10, 'the fallback is a typical letter, not a courier');
  assert.equal(publishedShipping(''), null);
  const mine = [{ maxCards: 4, maxValue: 25, price: 1 }];
  assert.deepEqual(shippingFor('CH', { CH: mine }).CH, mine);
  assert.deepEqual(shippingFor('CH', {}).DE, ch.DE);
  const tracked = sellerTiers(shippingFor('CH'), { countryCode: 'CH', trackedOnly: true });
  assert.ok(tracked.length && tracked.every((x) => x.tracked));
  assert.deepEqual(parseTiers(formatTiers(ch.CH)), ch.CH);
});
