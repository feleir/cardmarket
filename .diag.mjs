import { optimize } from './src/optimizer.js';
import { DEFAULT_SHIPPING } from './src/constants.js';
import { exactOptimum, realisticInstance } from './test/exact.js';
import { tierCost } from './src/shipping.js';
for (let seed = 1; seed <= 12; seed++) {
  const inst = realisticInstance(seed * 97 + 20, { wants: 20, small: 12, big: 3 });
  const ex = await exactOptimum(inst, DEFAULT_SHIPPING);
  const r = optimize(inst, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 1500, seed });
  if (r.total - ex > 0.5) {
    console.log('seed', seed, 'exact', ex, 'heur', r.total);
    for (const g of r.groups) console.log('  H', g.seller, g.cards, g.value.toFixed(2), 'ship', g.shipping);
    globalThis.__dump = true;
  }
}
