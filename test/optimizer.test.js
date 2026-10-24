import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize, baseline } from '../src/optimizer.js';
import { tierCost } from '../src/shipping.js';

const flatShip = (p) => ({ default: [{ maxCards: 1000, maxValue: 1e6, price: p }] });

test('prefers one seller when shipping outweighs small price differences', () => {
  const wants = [
    { key: 'a', quantity: 1, offers: [{ id: '1', seller: 'A', price: 1.0 }, { id: '2', seller: 'B', price: 1.2 }] },
    { key: 'b', quantity: 1, offers: [{ id: '3', seller: 'C', price: 1.0 }, { id: '4', seller: 'B', price: 1.2 }] },
  ];
  const r = optimize(wants, { shipping: flatShip(2), timeBudgetMs: 50 });
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].seller, 'B');
  assert.equal(r.total, 4.4);
  assert.equal(r.baseline.total, 6);
});

test('respects available quantity per article', () => {
  const wants = [{ key: 'a', quantity: 3, offers: [{ id: '1', seller: 'A', price: 1, available: 2 }, { id: '2', seller: 'B', price: 5, available: 4 }] }];
  const r = optimize(wants, { shipping: flatShip(0), timeBudgetMs: 50 });
  assert.equal(r.total, 7);
  assert.equal(r.missing.length, 0);
});

test('reports copies no seller can supply', () => {
  const wants = [{ key: 'a', quantity: 2, offers: [{ id: '1', seller: 'A', price: 1, available: 1 }] }, { key: 'b', quantity: 1, offers: [] }];
  const r = optimize(wants, { shipping: flatShip(1), timeBudgetMs: 50 });
  assert.equal(r.missing.length, 2);
  assert.equal(r.total, 2);
});

test('honours the seller cap', () => {
  const wants = ['a', 'b', 'c'].map((k, i) => ({
    key: k, quantity: 1,
    offers: [{ id: `${k}1`, seller: `S${i}`, price: 1 }, { id: `${k}2`, seller: 'Big', price: 3 }],
  }));
  const r = optimize(wants, { shipping: flatShip(0), maxSellers: 1, timeBudgetMs: 50 });
  assert.equal(r.groups.length, 1);
  assert.equal(r.total, 9);
});

// Exhaustive search over tiny random instances, to check the heuristic finds
// the true optimum where it can be enumerated.
function bruteForce(wants, shipping) {
  const units = wants.flatMap((w) => Array(w.quantity).fill(w));
  let best = Infinity;
  const used = new Map();
  const pick = [];
  const rec = (i) => {
    if (i === units.length) {
      const per = new Map();
      let t = 0;
      for (const o of pick) {
        t += o.price;
        const g = per.get(o.seller) || { n: 0, v: 0 };
        g.n++; g.v += o.price; per.set(o.seller, g);
      }
      for (const g of per.values()) t += tierCost(shipping.default, g.n, g.v);
      best = Math.min(best, t);
      return;
    }
    for (const o of units[i].offers) {
      if ((used.get(o.id) || 0) >= o.available) continue;
      used.set(o.id, (used.get(o.id) || 0) + 1);
      pick.push(o);
      rec(i + 1);
      pick.pop();
      used.set(o.id, used.get(o.id) - 1);
    }
  };
  rec(0);
  return Math.round(best * 100) / 100;
}

test('matches brute force on random small instances', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const shipping = { default: [
    { maxCards: 2, maxValue: 25, price: 1.5 }, { maxCards: 5, maxValue: 25, price: 2.5 },
    { maxCards: 100, maxValue: 1000, price: 6 },
  ] };
  let worse = 0;
  for (let trial = 0; trial < 40; trial++) {
    const nSellers = 3 + Math.floor(rnd() * 4);
    const wants = [];
    for (let w = 0; w < 4; w++) {
      const offers = [];
      for (let s = 0; s < nSellers; s++) {
        if (rnd() < 0.55) offers.push({ id: `${w}-${s}`, seller: `S${s}`, price: Math.round((0.2 + rnd() * 8) * 100) / 100, available: 1 + Math.floor(rnd() * 2) });
      }
      if (!offers.length) offers.push({ id: `${w}-x`, seller: 'S0', price: 3, available: 2 });
      wants.push({ key: `w${w}`, quantity: 1 + Math.floor(rnd() * 2), offers });
    }
    const exact = bruteForce(wants, shipping);
    if (exact === Infinity) continue;
    const r = optimize(wants, { shipping, timeBudgetMs: 30, seed: trial });
    if (r.missing.length) continue;
    assert.ok(r.total >= exact - 1e-6, 'heuristic cannot beat the optimum');
    if (r.total > exact + 1e-6) worse++;
    assert.ok(r.total <= baseline(wants, shipping).total + 1e-6);
  }
  assert.ok(worse <= 2, `heuristic missed the optimum on ${worse} instances`);
});

test('explains what taking the cheaper copies elsewhere would cost', async () => {
  const { DEFAULT_SHIPPING } = await import('../src/constants.js');
  // A sells Q (19 €) and P at 7,00; B sells P at 7,10 and X. Taking P from A
  // would push A's parcel over 25 € into tracked shipping.
  const wants = [
    { key: 'q', name: 'Q', quantity: 1, offers: [{ id: 'q', seller: 'A', countryCode: 'CH', price: 19, available: 1 }] },
    { key: 'p', name: 'P', quantity: 2, offers: [
      { id: 'pa', seller: 'A', countryCode: 'CH', price: 7, available: 2 },
      { id: 'pb', seller: 'B', countryCode: 'CH', price: 7.1, available: 2 }] },
    { key: 'x', name: 'X', quantity: 1, offers: [{ id: 'x', seller: 'B', countryCode: 'CH', price: 0.5, available: 1 }] },
  ];
  const r = optimize(wants, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 100 });
  assert.equal(r.total, 37.36); // A: 19 + 1,83; B: 14,20 + 0,50 + 1,83
  const p = r.groups.find((g) => g.seller === 'B').items.find((it) => it.want.name === 'P');
  assert.deepEqual(
    { moved: p.switch.moved, seller: p.switch.seller, cards: p.switch.cardsSaved, there: p.switch.shippingThere, here: p.switch.shippingHere, delta: p.switch.delta },
    { moved: 2, seller: 'A', cards: 0.2, there: 6.67, here: 0, delta: 6.47 },
  );
});

test('printing preference: another printing must save more than the premium', () => {
  const flat = { default: [{ maxCards: 1000, maxValue: 1e6, price: 0 }] };
  const want = (otherPrice) => [{ key: 'a', quantity: 1, offers: [
    { id: 'orig', seller: 'A', price: 1.0, available: 1 },
    { id: 'other', seller: 'B', price: otherPrice, available: 1, otherPrinting: true }] }];
  const pick = (r) => r.groups[0].items[0].offer.id;
  // Saves 0,30 < 0,50: keep the printing on the list.
  let r = optimize(want(0.7), { shipping: flat, printingPremium: 0.5, timeBudgetMs: 20 });
  assert.equal(pick(r), 'orig');
  assert.equal(r.total, 1);
  // Saves 0,60 > 0,50: take the other printing; the total is the real price.
  r = optimize(want(0.4), { shipping: flat, printingPremium: 0.5, timeBudgetMs: 20 });
  assert.equal(pick(r), 'other');
  assert.equal(r.total, 0.4);
  // No preference: plain cheapest.
  r = optimize(want(0.7), { shipping: flat, printingPremium: 0, timeBudgetMs: 20 });
  assert.equal(pick(r), 'other');
});

test('add a card: fills existing parcels first, and compares with a full re-plan', async () => {
  const { planExtra } = await import('../src/extra.js');
  const { DEFAULT_SHIPPING } = await import('../src/constants.js');
  const wants = [
    { key: 'a', name: 'A', quantity: 2, offers: [{ id: 'a1', seller: 'S1', countryCode: 'CH', price: 1, available: 2 }] },
    { key: 'b', name: 'B', quantity: 1, offers: [{ id: 'b1', seller: 'S2', countryCode: 'CH', price: 2, available: 1 }] },
  ];
  const opts = { shipping: DEFAULT_SHIPPING, timeBudgetMs: 100 };
  const result = optimize(wants, opts);
  assert.equal(result.total, 4 + 2 * 1.83);
  // Tinder Wall: 0,30 at S1 (in the cart, 2 cards there) vs 0,10 at a new seller.
  const extra = { key: 'tw', name: 'Tinder Wall', quantity: 2, offers: [
    { id: 't1', seller: 'S1', countryCode: 'CH', price: 0.3, available: 4 },
    { id: 't2', seller: 'S3', countryCode: 'CH', price: 0.1, available: 4 }] };
  const plan = planExtra(result, wants, extra, opts);
  // Joining S1's parcel: 2 → 4 cards stays in the 1,83 € letter.
  assert.deepEqual(plan.fit.items.map((i) => [i.seller, i.quantity, i.joins, i.shippingDelta]), [['S1', 2, true, 0]]);
  assert.equal(plan.fit.cost, 0.6);
  assert.equal(plan.replan.cost, 0.6);
});
