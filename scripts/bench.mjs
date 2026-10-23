// Heuristic vs. exact optimum (HiGHS) on realistic random carts.
//   npm run bench
import { optimize } from '../src/optimizer.js';
import { DEFAULT_SHIPPING } from '../src/constants.js';
import { exactOptimum, realisticInstance } from '../test/exact.js';
const sizes = [[20, 12, 3], [35, 18, 4], [50, 25, 5]];
for (const [w, sm, bg] of sizes) {
  let gaps = [], wins = 0, n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const inst = realisticInstance(seed * 97 + w, { wants: w, small: sm, big: bg });
    const t0 = Date.now(); const ex = await exactOptimum(inst, DEFAULT_SHIPPING); const te = Date.now() - t0;
    if (ex == null) continue;
    const r = optimize(inst, { shipping: DEFAULT_SHIPPING, timeBudgetMs: 1500, seed });
    n++; const gap = (r.total - ex) / ex * 100; gaps.push(gap); if (gap < 0.005) wins++;
    if (seed <= 2) console.log(`  w=${w} seed=${seed} exact=${ex} (${te}ms) heur=${r.total} base=${r.baseline.total}`);
  }
  console.log(`wants=${w}: optimal ${wins}/${n}, mean gap ${(gaps.reduce((a,b)=>a+b,0)/n).toFixed(2)}%, max ${Math.max(...gaps).toFixed(2)}%`);
}
