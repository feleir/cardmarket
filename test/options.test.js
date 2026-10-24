import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from '../src/optimizer.js';
import { solveWith } from '../src/exact.js';
import { planOptions } from '../src/options.js';
import { DEFAULT_SHIPPING } from '../src/constants.js';
import { highs, realisticInstance } from './exact.js';

const shipping = DEFAULT_SHIPPING;
const offer = (id, seller, price, available, expansion) => ({ id, seller, countryCode: 'CH', price, available, expansion });
// 4 Bolts from one seller: 2 Magic 2010 at 0,50 and 4 Masters 25 at 0,55.
const bolts = () => [{ name: 'Lightning Bolt', quantity: 4, offers: [
  offer('a', 'zurich', 0.5, 2, 'Magic 2010'), offer('b', 'zurich', 0.55, 4, 'Masters 25'),
] }];
const picks = (r) => r.groups.flatMap((g) => g.items.map((it) => `${it.quantity}x${it.offer.expansion}`)).sort().join(' ');

test('same printing: mixes only when it saves more than the premium', async () => {
  const cheap = optimize(bolts(), { shipping, timeBudgetMs: 200 });
  assert.equal(picks(cheap), '2xMagic 2010 2xMasters 25');
  assert.deepEqual(cheap.mixed, [{ name: 'Lightning Bolt', printings: ['Magic 2010', 'Masters 25'] }]);
  // Mixing saves 0,10 €: with a 1 € premium all four come from Masters 25,
  // and the total stays the real price.
  const one = optimize(bolts(), { shipping, timeBudgetMs: 200, mixPenalty: 1 });
  assert.equal(picks(one), '4xMasters 25');
  assert.equal(one.mixed.length, 0);
  assert.equal(one.total, Math.round((2.2 + 1.83) * 100) / 100);
  // A premium below the saving keeps the cheaper mix.
  assert.equal(picks(optimize(bolts(), { shipping, timeBudgetMs: 200, mixPenalty: 0.05 })), '2xMagic 2010 2xMasters 25');
  const ex = solveWith(await highs(), bolts(), { shipping, mixPenalty: 1 });
  assert.deepEqual(ex.picks[0], [{ id: 'b', count: 4 }]);
});

test('exact model respects a seller cap, and the heuristic matches it', async () => {
  const h = await highs();
  for (let seed = 1; seed <= 3; seed++) {
    const inst = realisticInstance(seed * 101, { wants: 25, small: 14, big: 4 });
    const free = optimize(inst, { shipping, timeBudgetMs: 400, seed });
    const cap = Math.max(1, free.groups.length - 2);
    const ex = solveWith(h, inst, { shipping, maxSellers: cap, timeLimitMs: 30000 });
    assert.equal(ex.status, 'Optimal');
    const capped = optimize(inst, { shipping, maxSellers: cap, timeBudgetMs: 200, warmStart: ex.picks });
    assert.ok(capped.groups.length <= cap, `${capped.groups.length} sellers > cap ${cap}`);
    assert.ok(Math.abs(capped.total - Math.round(ex.objective * 100) / 100) < 0.011, `${capped.total} vs ${ex.objective}`);
    assert.ok(capped.total >= free.total - 0.01);
  }
});

test('options: fewer parcels cost more, one row per parcel count', async () => {
  const inst = realisticInstance(4242, { wants: 30, small: 16, big: 4 });
  const opts = { shipping, timeBudgetMs: 300 };
  const best = optimize(inst, opts);
  const rows = await planOptions(inst, opts, best, async (w, o) => optimize(w, o));
  assert.equal(rows[0].result, best);
  assert.ok(rows.length >= 2, 'expected at least one cart with fewer parcels');
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].result.groups.length < rows[i - 1].result.groups.length);
    assert.ok(rows[i].result.total >= rows[i - 1].result.total - 0.005);
    assert.equal(rows[i].result.missing.length, best.missing.length);
  }
});

test('options: offers a one-printing cart when the cheapest mixes printings', async () => {
  const best = optimize(bolts(), { shipping, timeBudgetMs: 200 });
  const rows = await planOptions(bolts(), { shipping, timeBudgetMs: 200 }, best, async (w, o) => optimize(w, o));
  const matched = rows.find((r) => r.kind === 'matched');
  assert.ok(matched);
  assert.equal(picks(matched.result), '4xMasters 25');
});

test('a card can keep one printing while others may mix', async () => {
  // Two cards with the same mixed offers; only the first must keep one printing.
  const wants = [{ ...bolts()[0], mixPenalty: 1000 }, { ...bolts()[0], name: 'Bolt again', offers: [
    offer('c', 'zurich', 0.5, 2, 'Magic 2010'), offer('d', 'zurich', 0.55, 4, 'Masters 25'),
  ] }];
  const r = optimize(wants, { shipping, timeBudgetMs: 200 });
  assert.deepEqual(r.mixed.map((m) => m.name), ['Bolt again']);
  const ex = solveWith(await highs(), wants, { shipping });
  assert.deepEqual(ex.picks[0], [{ id: 'b', count: 4 }]);
  assert.equal(ex.picks[1].length, 2);
  // And a per-card 0 overrides a global penalty.
  const r2 = optimize([{ ...bolts()[0], mixPenalty: 0 }], { shipping, timeBudgetMs: 200, mixPenalty: 1000 });
  assert.equal(r2.mixed.length, 1);
});
