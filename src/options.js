// Other carts to choose from next to the cheapest one: the best cart for
// fewer and fewer parcels, and one with every card's copies in one printing.
// solve(wants, opts) -> an optimize() result (may also use the exact solver).

const missingOf = (r) => r.missing.reduce((n, m) => n + m.count, 0);

// At most n of the caps: the first steps down from the cheapest cart (where
// the trade-offs are), then an even spread down to a single seller.
function spread(caps, n) {
  if (caps.length <= n) return caps;
  const head = caps.slice(0, Math.ceil(n / 2));
  const rest = caps.slice(head.length);
  const m = n - head.length;
  const picked = new Set(head);
  for (let j = 0; j < m; j++) picked.add(rest[Math.round((j * (rest.length - 1)) / Math.max(1, m - 1))]);
  return [...picked];
}

export async function planOptions(wants, opts, best, solve, { maxRuns = 8, stopped = () => false } = {}) {
  const rows = [{ kind: 'best', result: best }];
  const need = missingOf(best);
  const k = best.groups.length;
  const caps = [];
  for (let c = k - 1; c >= 1; c--) caps.push(c);
  for (const cap of spread(caps, maxRuns)) {
    if (stopped()) return null;
    const r = await solve(wants, { ...opts, maxSellers: cap });
    // Fewer sellers cannot supply every card any more: fewer still won't either.
    if (missingOf(r) > need) break;
    rows.push({ kind: 'fewer', result: r });
  }
  if (best.mixed?.length && !(opts.mixPenalty > 0)) {
    if (stopped()) return null;
    // A large penalty: mix printings only where one printing cannot supply all copies.
    const r = await solve(wants, { ...opts, mixPenalty: 1000 });
    if (missingOf(r) <= need) rows.push({ kind: 'matched', result: r });
  }
  return prune(rows);
}

// Keep the cheapest cart per parcel count, and drop a cart when another one
// has no more parcels and costs no more. The cheapest cart always stays.
export function prune(rows) {
  const [best, ...rest] = rows;
  const fewer = rest.filter((r) => r.kind === 'fewer');
  const kept = [best];
  for (const r of fewer.sort((a, b) => a.result.groups.length - b.result.groups.length || a.result.total - b.result.total)) {
    const n = r.result.groups.length;
    const beaten = [...kept, ...fewer].some((o) => o !== r && o.result.groups.length <= n && o.result.total <= r.result.total - 0.005);
    const same = kept.some((o) => o.result.groups.length === n);
    if (!beaten && !same) kept.push(r);
  }
  kept.sort((a, b) => b.result.groups.length - a.result.groups.length);
  const matched = rest.find((r) => r.kind === 'matched');
  if (matched && !(matched.result.groups.length === best.result.groups.length && Math.abs(matched.result.total - best.result.total) < 0.005)) kept.push(matched);
  return kept;
}
