import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from '../src/optimizer.js';
import { solveWith } from '../src/exact.js';
import { DEFAULT_SHIPPING } from '../src/constants.js';
import { highs, realisticInstance } from './exact.js';

// Realistic carts (big stores at a mark-up, many small cheap sellers, tiered
// Swiss shipping): the heuristic must land close to the proven optimum and
// never above cheapest-per-card.
test('heuristic is within a fraction of a percent of the exact optimum', async () => {
  const h = await highs();
  const gaps = [];
  for (let seed = 1; seed <= 10; seed++) {
    const inst = realisticInstance(seed * 31, { wants: 30, small: 16, big: 4 });
    const ex = solveWith(h, inst, { shipping: DEFAULT_SHIPPING, timeLimitMs: 30000 });
    assert.equal(ex.status, 'Optimal');
    const r = optimize(inst, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 800, seed });
    assert.ok(r.total >= ex.objective - 0.01, 'cannot beat a proven optimum');
    assert.ok(r.total <= r.baseline.total + 1e-9, 'never worse than cheapest-per-card');
    gaps.push((r.total - ex.objective) / ex.objective);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(mean < 0.002, `mean gap ${(mean * 100).toFixed(3)}%`);
  assert.ok(Math.max(...gaps) < 0.01, `max gap ${(Math.max(...gaps) * 100).toFixed(3)}%`);
});

test('exact mode: warm-starting from the solver gives its optimum', async () => {
  const h = await highs();
  for (let seed = 1; seed <= 4; seed++) {
    const inst = realisticInstance(seed * 7919, { wants: 40, small: 20, big: 4, countries: ['CH', 'DE'] });
    const ex = solveWith(h, inst, { shipping: DEFAULT_SHIPPING, timeLimitMs: 30000 });
    const r = optimize(inst, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 200, warmStart: ex.picks });
    assert.ok(Math.abs(r.total - Math.round(ex.objective * 100) / 100) < 0.011, `${r.total} vs ${ex.objective}`);
  }
});

test('exact model handles shared articles and unfillable copies', async () => {
  const h = await highs();
  // The same article listed under two wants has only 1 copy in total.
  const wants = [
    { key: 'a', quantity: 1, offers: [{ id: 'X', seller: 'S', price: 1, available: 1 }, { id: 'Y', seller: 'T', price: 5, available: 1 }] },
    { key: 'b', quantity: 1, offers: [{ id: 'X', seller: 'S', price: 1, available: 1 }] },
    { key: 'c', quantity: 2, offers: [{ id: 'Z', seller: 'S', price: 2, available: 1 }] },
  ];
  const ex = solveWith(h, wants, { shipping: { default: [{ maxCards: 100, maxValue: 1e6, price: 1 }] } });
  const r = optimize(wants, { shipping: { default: [{ maxCards: 100, maxValue: 1e6, price: 1 }] }, warmStart: ex.picks, timeBudgetMs: 50 });
  assert.equal(r.missing.reduce((n, m) => n + m.count, 0), 1);
  assert.equal(r.total, 1 + 2 + 5 + 2); // X + Z from S, Y from T, two parcels
});

test('exact model applies the printing preference too', async () => {
  const h = await highs();
  const flat = { default: [{ maxCards: 1000, maxValue: 1e6, price: 0 }] };
  const wants = [{ key: 'a', quantity: 1, offers: [
    { id: 'orig', seller: 'A', price: 1.0, available: 1 },
    { id: 'other', seller: 'B', price: 0.7, available: 1, otherPrinting: true }] }];
  const ex = solveWith(h, wants, { shipping: flat, printingPremium: 0.5 });
  assert.deepEqual(ex.picks[0], [{ id: 'orig', count: 1 }]);
  const ex0 = solveWith(h, wants, { shipping: flat, printingPremium: 0 });
  assert.deepEqual(ex0.picks[0], [{ id: 'other', count: 1 }]);
});

// Cardmarket's published tiers to Switzerland, with sellers from four
// countries (letters from Germany stop at 4 cards, then parcels) and Swiss
// VAT on the stores: still close to the proven optimum, and no single-card
// parcel whose seller dropping would save more than a fraction of a percent
// (the exact solver, when on, closes that last gap).
test('published shipping tiers: near the optimum, no single-card parcel worth dropping', async () => {
  const { shippingFor } = await import('../src/shipping.js');
  const shipping = shippingFor('CH');
  const h = await highs();
  const gaps = [];
  for (let seed = 1; seed <= 4; seed++) {
    const inst = realisticInstance(seed * 977, { wants: 25, small: 16, big: 4, countries: ['CH', 'DE', 'FR', 'AT'] });
    for (const w of inst) for (const o of w.offers) if (o.seller.startsWith('store')) { o.vat = 8.1; o.listedPrice = Math.round((o.price / 1.081) * 100) / 100; }
    const ex = solveWith(h, inst, { shipping, timeLimitMs: 30000 });
    assert.equal(ex.status, 'Optimal');
    const r = optimize(inst, { shipping, timeBudgetMs: 800, seed });
    const opt = Math.round(ex.objective * 100) / 100;
    assert.ok(r.total >= opt - 0.01, 'cannot beat a proven optimum');
    gaps.push((r.total - opt) / opt);
    for (const g of r.groups.filter((x) => x.cards === 1)) {
      const without = inst.map((w) => ({ ...w, offers: w.offers.filter((o) => o.seller !== g.seller) }));
      const ex2 = solveWith(h, without, { shipping, timeLimitMs: 30000 });
      const complete = ex2.picks.every((p, wi) => p.reduce((n, x) => n + x.count, 0) === inst[wi].quantity);
      if (complete) assert.ok(ex2.objective >= r.total * 0.995, `dropping ${g.seller} would save ${(r.total - ex2.objective).toFixed(2)}`);
    }
  }
  assert.ok(Math.max(...gaps) < 0.005, `max gap ${(Math.max(...gaps) * 100).toFixed(3)}%`);
});
