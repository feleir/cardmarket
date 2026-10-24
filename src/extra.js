// "Add a card": the cheapest way to add N copies of one more card, given a
// cart already chosen, and a full re-plan for comparison.
import { optimize } from './optimizer.js';

// result: the current optimize() result; wants: the wants it was made from;
// extra: a want ({ name, quantity, offers }) for the new card.
export function planExtra(result, wants, extra, opts) {
  // 1. Keep every chosen copy where it is: each becomes a want with only
  //    that offer, so the optimizer can only decide where the new copies go.
  const fixed = [];
  for (const g of result.groups) {
    for (const it of g.items) fixed.push({ key: `fix:${it.offer.id}`, name: it.want.name, quantity: it.quantity, offers: [it.offer] });
  }
  const before = new Map(result.groups.map((g) => [g.seller, g]));
  const fit = optimize([...fixed, extra], { ...opts, timeBudgetMs: Math.min(opts.timeBudgetMs || 1000, 1500) });
  const items = [];
  for (const g of fit.groups) {
    for (const it of g.items) {
      if (it.want !== extra) continue;
      const old = before.get(g.seller);
      items.push({
        offer: it.offer, want: extra, quantity: it.quantity, seller: g.seller,
        joins: !!old, // the seller already has a parcel in the cart
        shippingDelta: Math.round(((g.shipping || 0) - (old ? old.shipping : 0)) * 100) / 100,
      });
    }
  }
  const missing = fit.missing.filter((m) => m.want === extra).reduce((n, m) => n + m.count, 0);

  // 2. Re-plan the whole cart with the new card in it.
  const replan = optimize([...wants, extra], opts);
  return {
    fit: { result: fit, items, missing, cost: Math.round((fit.total - result.total) * 100) / 100, total: fit.total },
    replan: { result: replan, total: replan.total, cost: Math.round((replan.total - result.total) * 100) / 100 },
  };
}
