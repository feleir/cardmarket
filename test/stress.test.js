import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from '../src/optimizer.js';
import { DEFAULT_SHIPPING } from '../src/constants.js';

test('large list: 150 wants, 80 sellers, finishes in budget and beats cheapest-per-card', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sellers = Array.from({ length: 80 }, (_, i) => ({ name: `s${i}`, big: rnd() < 0.15 }));
  const wants = Array.from({ length: 150 }, (_, w) => {
    const base = 0.1 + rnd() ** 3 * 30;
    const offers = sellers.filter((s) => rnd() < (s.big ? 0.8 : 0.15))
      .map((s, k) => ({ id: `${w}-${k}`, seller: s.name, countryCode: 'CH', price: Math.round(base * (0.85 + rnd() * 0.5) * 100) / 100, available: 1 + Math.floor(rnd() * 4) }));
    return { key: `w${w}`, quantity: 1 + Math.floor(rnd() * 3), offers };
  });
  const t = Date.now();
  const r = optimize(wants, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 2000 });
  const ms = Date.now() - t;
  console.log(`total ${r.total} vs baseline ${r.baseline.total} (${r.baseline.sellers} sellers -> ${r.groups.length}), ${ms} ms, ${r.stats.restarts} restarts`);
  assert.ok(ms < 8000);
  assert.ok(r.total < r.baseline.total);
});
