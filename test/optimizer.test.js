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
