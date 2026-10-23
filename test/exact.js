// Test helpers: the exact solver run in Node as an oracle for how far the
// heuristic is from the true best cart, and realistic random instances.
import { createRequire } from 'node:module';
import { solveWith } from '../src/exact.js';

const require = createRequire(import.meta.url);
let highsP;
export const highs = () => (highsP ||= require('highs')());

export async function exactOptimum(wants, shipping, sellerPenalty = 0) {
  const r = solveWith(await highs(), wants, { shipping, sellerPenalty, timeLimitMs: 30000 });
  return r && r.status === 'Optimal' ? Math.round(r.objective * 100) / 100 : null;
}

// Instances shaped like a real wants list: a few big stores that stock most
// cards at a mark-up, many small sellers who are cheapest on a few cards.
export function realisticInstance(seed, { wants = 30, small = 18, big = 4, countries = ['CH'] } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const sellers = [
    ...Array.from({ length: big }, (_, i) => ({ name: `store${i}`, stock: 0.75, markup: 1.05 + rnd() * 0.25 })),
    ...Array.from({ length: small }, (_, i) => ({ name: `user${i}`, stock: 0.12 + rnd() * 0.15, markup: 0.75 + rnd() * 0.35 })),
  ].map((x) => ({ ...x, cc: countries[Math.floor(rnd() * countries.length)] }));
  const list = [];
  for (let w = 0; w < wants; w++) {
    const trend = 0.1 + rnd() ** 2.5 * 25;
    const offers = [];
    for (const sl of sellers) {
      if (rnd() > sl.stock) continue;
      offers.push({ id: `${w}:${sl.name}`, seller: sl.name, countryCode: sl.cc, price: Math.max(0.02, Math.round(trend * sl.markup * (0.9 + rnd() * 0.2) * 100) / 100), available: 1 + Math.floor(rnd() * 4) });
    }
    const quantity = 1 + Math.floor(rnd() ** 2 * 4);
    if (offers.reduce((n, o) => n + o.available, 0) < quantity) offers.push({ id: `${w}:store0b`, seller: 'store0', countryCode: sellers[0].cc, price: Math.round(trend * 1.3 * 100) / 100, available: 4 });
    list.push({ key: `w${w}`, name: `Card ${w}`, quantity, offers });
  }
  return list;
}
