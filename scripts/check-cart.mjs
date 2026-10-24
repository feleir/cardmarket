// Reruns a pasted "Copy cart data" blob: the app's heuristic against the
// exact solver, and prints the cart and, per card, what switching to a
// cheaper copy would cost.
//   node scripts/check-cart.mjs cart.json
import { readFile } from 'node:fs/promises';
import { optimize } from '../src/optimizer.js';
import { solveWith } from '../src/exact.js';
import { highs } from '../test/exact.js';

const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (data.tool !== 'cmopt-cart2') throw new Error('expected a cmopt-cart2 blob');
const shipping = { CH: data.shipping.CH, default: data.shipping.default };
const wants = data.wants.map(([name, quantity, rows], wi) => ({
  key: `w${wi}`, name, quantity,
  offers: rows.map(([s, price, available], i) => {
    const [seller, countryCode, trackedOnly] = data.sellers[s];
    return { id: `${wi}:${i}`, seller, countryCode, trackedOnly: !!trackedOnly, price, available };
  }),
}));
const opts = { shipping, sellerPenalty: data.shipping.penalty || 0, maxSellers: data.shipping.maxSellers || 0 };

const heur = optimize(wants, { ...opts, timeBudgetMs: 3000 });
console.log(`app (as pasted): ${data.total}   heuristic here: ${heur.total}   cheapest-per-card: ${heur.baseline.total}`);
if (!opts.maxSellers) {
  const ex = solveWith(await highs(), wants, { ...opts, timeLimitMs: 60000 });
  console.log(`exact solver: ${Math.round(ex.objective * 100) / 100} (${ex.status})`);
  const polished = optimize(wants, { ...opts, timeBudgetMs: 500, warmStart: ex.picks });
  print(polished);
} else print(heur);

function print(r) {
  for (const g of r.groups) {
    console.log(`\n${g.seller}: ${g.cards} card(s) ${g.value.toFixed(2)} + ${g.shipping.toFixed(2)}`);
    for (const it of g.items) {
      const w = it.switch;
      console.log(`  ${it.quantity}x ${it.want.name} ${it.offer.price}${w ? `   [cheaper ${w.price} at ${w.seller}: ${w.delta >= 0 ? '+' : ''}${w.delta}]` : ''}`);
    }
  }
}
