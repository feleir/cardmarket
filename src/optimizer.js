// Cart optimizer: choose one offer per wanted copy so that
//   sum(item prices) + sum over used sellers of (shipping + sellerPenalty)
// is as low as possible, respecting each article's available quantity and an
// optional cap on the number of sellers.
//
// This is a facility-location style problem (NP-hard in general), so it is
// solved with a greedy construction followed by local search: move single
// copies, close a seller and redistribute its copies, pull copies to a
// seller; then iterated local search (shake the best cart, search again)
// within a time budget. The
// cheapest-copy-everywhere baseline is reported alongside for comparison.
import { tierCost, sellerTiers } from './shipping.js';

const EPS = 1e-7;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// wants: [{ key, name, quantity, offers: [{ id, seller, countryCode, price, available, ... }] }]
// opts: { shipping, sellerPenalty, maxSellers, timeBudgetMs, seed,
//         warmStart: picks[wantIndex] = [{ id, count }] e.g. from the exact solver }
export function optimize(wants, opts = {}) {
  const shipping = opts.shipping || {};
  const penalty = Number(opts.sellerPenalty) || 0;
  const maxSellers = Number(opts.maxSellers) || 0;
  const budget = opts.timeBudgetMs ?? 2000;
  const rand = mulberry32(opts.seed ?? 12345);

  // Flatten into indexed arrays so the hot loops avoid object lookups.
  const sellerIdx = new Map();
  const sellers = [];
  const artIdx = new Map();
  const arts = [];
  const offers = []; // { s, a, price, ref }
  const wantOffers = [];
  wants.forEach((w, wi) => {
    const list = [];
    for (const o of w.offers || []) {
      if (!(o.price > 0)) continue;
      if (!sellerIdx.has(o.seller)) {
        sellerIdx.set(o.seller, sellers.length);
        sellers.push({ name: o.seller, tiers: sellerTiers(shipping, o), ref: o });
      } else if (o.trackedOnly && !sellers[sellerIdx.get(o.seller)].ref.trackedOnly) {
        // Tracked-only is the seller's setting; any offer showing it counts.
        const sl = sellers[sellerIdx.get(o.seller)];
        sl.tiers = sellerTiers(shipping, o);
        sl.ref = o;
      }
      if (!artIdx.has(o.id)) {
        artIdx.set(o.id, arts.length);
        arts.push(Math.max(1, o.available | 0));
      }
      list.push(offers.length);
      offers.push({ s: sellerIdx.get(o.seller), a: artIdx.get(o.id), price: o.price, ref: o, w: wi });
    }
    list.sort((x, y) => offers[x].price - offers[y].price);
    wantOffers[wi] = list;
  });
  const units = [];
  wants.forEach((w, wi) => {
    for (let k = 0; k < Math.max(0, w.quantity | 0); k++) units.push(wi);
  });

  const S = sellers.length;
  const ship = (s, n, v) => (n > 0 ? tierCost(sellers[s].tiers, n, v) + penalty : 0);

  // ---- mutable state ----
  let assign = new Int32Array(units.length).fill(-1);
  let sN = new Int32Array(S);
  let sV = new Float64Array(S);
  let used = new Int32Array(arts.length);
  let open = 0;

  const save = () => ({ assign: assign.slice(), sN: sN.slice(), sV: sV.slice(), used: used.slice(), open });
  const load = (st) => { assign = st.assign.slice(); sN = st.sN.slice(); sV = st.sV.slice(); used = st.used.slice(); open = st.open; };

  const put = (u, oi) => {
    const o = offers[oi];
    assign[u] = oi;
    if (sN[o.s]++ === 0) open++;
    sV[o.s] += o.price;
    used[o.a]++;
  };
  const take = (u) => {
    const oi = assign[u];
    if (oi < 0) return;
    const o = offers[oi];
    assign[u] = -1;
    if (--sN[o.s] === 0) { open--; sV[o.s] = 0; } else sV[o.s] -= o.price;
    used[o.a]--;
  };

  let limitOn = false;
  const delta = (oi, forbid) => {
    const o = offers[oi];
    if (used[o.a] >= arts[o.a]) return Infinity;
    const n = sN[o.s];
    if (n === 0) {
      if (forbid && forbid.has(o.s)) return Infinity;
      if (limitOn && maxSellers && open >= maxSellers) return Infinity;
    }
    return o.price + ship(o.s, n + 1, sV[o.s] + o.price) - ship(o.s, n, sV[o.s]);
  };
  const bestFor = (u, forbid, noise = 0) => {
    let best = -1;
    let bestD = Infinity;
    for (const oi of wantOffers[units[u]]) {
      let d = delta(oi, forbid);
      if (d === Infinity) continue;
      if (noise) d *= 1 + noise * (rand() - 0.5);
      if (d < bestD - EPS) { bestD = d; best = oi; }
    }
    return best;
  };

  const total = () => {
    let t = 0;
    for (let u = 0; u < units.length; u++) if (assign[u] >= 0) t += offers[assign[u]].price;
    for (let s = 0; s < S; s++) t += ship(s, sN[s], sV[s]);
    return t;
  };
  const missing = () => { let m = 0; for (let u = 0; u < units.length; u++) if (assign[u] < 0) m++; return m; };
  // Unfilled copies dominate everything else: a cheaper cart missing a card is not better.
  const score = () => missing() * 1e9 + total();

  const reassignPass = (forbid) => {
    let any = false;
    for (let round = 0; round < 50; round++) {
      let improved = false;
      for (let u = 0; u < units.length; u++) {
        const cur = assign[u];
        if (cur < 0) {
          const b = bestFor(u, forbid);
          if (b >= 0) { put(u, b); improved = true; }
          continue;
        }
        take(u);
        const curD = delta(cur, null);
        const b = bestFor(u, forbid);
        if (b >= 0 && b !== cur && delta(b, forbid) < curD - EPS) { put(u, b); improved = true; } else put(u, cur);
      }
      if (!improved) break;
      any = true;
    }
    return any;
  };

  // Two linked moves: copy u goes to seller t, and one of t's copies moves
  // out to wherever is best. This gets past shipping thresholds a single
  // move cannot (a parcel at 4 cards / 24.99 rejects any one extra card).
  const chainPass = (deadline) => {
    let any = false;
    let cur = score();
    for (let u = 0; u < units.length && now() < deadline; u++) {
      const cu = assign[u];
      if (cu < 0) continue;
      const s = offers[cu].s;
      let done = false;
      for (const oi of wantOffers[units[u]]) {
        const t = offers[oi].s;
        if (done || t === s || sN[t] === 0) continue;
        const atT = unitsOf(t);
        for (const v of atT) {
          const cv = assign[v];
          take(u);
          if (used[offers[oi].a] >= arts[offers[oi].a]) { put(u, cu); break; }
          put(u, oi);
          take(v);
          const b = bestFor(v, null);
          if (b >= 0 && b !== cv) {
            put(v, b);
            const sc = score();
            if (sc < cur - EPS) { cur = sc; any = true; done = true; break; }
            take(v);
          }
          put(v, cv);
          take(u);
          put(u, cu);
        }
      }
    }
    return any;
  };

  const unitsOf = (s) => {
    const r = [];
    for (let u = 0; u < units.length; u++) if (assign[u] >= 0 && offers[assign[u]].s === s) r.push(u);
    return r;
  };

  // Close seller s: move its copies elsewhere. Returns false if impossible.
  const closeSeller = (s, also) => {
    const us = unitsOf(s);
    const forbid = new Set(also || []);
    forbid.add(s);
    us.forEach(take);
    for (const u of us) {
      const b = bestFor(u, forbid);
      if (b < 0) return false;
      put(u, b);
    }
    reassignPass(forbid);
    return true;
  };

  // Pull copies to seller s (already in the cart or not): every copy it can
  // supply for at most maxExtra more than that copy costs now, then let the
  // rest settle. maxExtra = Infinity pulls everything it stocks.
  const pullSeller = (s, maxExtra = Infinity) => {
    if (limitOn && maxSellers && open >= maxSellers && sN[s] === 0) return false;
    let moved = 0;
    for (let u = 0; u < units.length; u++) {
      const cur = assign[u];
      if (cur >= 0 && offers[cur].s === s) continue;
      for (const oi of wantOffers[units[u]]) {
        const o = offers[oi];
        if (o.s !== s) continue;
        if (cur >= 0 && o.price - offers[cur].price > maxExtra) break;
        if (cur >= 0) take(u);
        if (used[o.a] < arts[o.a]) { put(u, oi); moved++; break; }
        if (cur >= 0) put(u, cur);
      }
    }
    if (!moved) return false;
    reassignPass(null);
    return true;
  };

  const localSearch = (deadline) => {
    let cur = score();
    const tryMove = (fn) => {
      const snap = save();
      if (fn() && score() < cur - EPS) { cur = score(); return true; }
      load(snap);
      return false;
    };
    for (let iter = 0; iter < 100 && now() < deadline; iter++) {
      let improved = false;
      reassignPass(null);
      if (chainPass(deadline)) reassignPass(null);
      cur = score();
      // Close sellers with the fewest copies first; those parcels are the
      // likeliest to be worth merging into others.
      const openList = [];
      for (let s = 0; s < S; s++) if (sN[s] > 0) openList.push(s);
      openList.sort((a, b) => sN[a] - sN[b]);
      for (const s of openList) {
        if (now() > deadline) break;
        if (sN[s] > 0 && tryMove(() => closeSeller(s))) improved = true;
      }
      // Pull copies to every seller, in and out of the cart: first only
      // copies that cost little more there, then everything it stocks.
      for (let s = 0; s < S; s++) {
        if (now() > deadline) break;
        if (tryMove(() => pullSeller(s, 0.5)) | tryMove(() => pullSeller(s))) improved = true;
      }
      if (!improved) break;
    }
    return cur;
  };

  const construct = (noise) => {
    assign.fill(-1); sN.fill(0); sV.fill(0); used.fill(0); open = 0;
    // Scarce, expensive copies first: they constrain the rest the most.
    const order = units.map((_, u) => u);
    const key = order.map((u) => {
      const l = wantOffers[units[u]];
      return (l.length ? offers[l[0]].price : 0) + (noise ? rand() * noise * 5 : 0) - l.length * 0.01;
    });
    order.sort((a, b) => key[b] - key[a]);
    for (const u of order) {
      const b = bestFor(u, null, noise);
      if (b >= 0) put(u, b);
    }
  };

  // Close sellers one at a time, cheapest closure first, until under the cap.
  // Closed sellers stay forbidden so redistribution cannot reopen them.
  const enforceLimit = () => {
    if (!maxSellers) return;
    const closedSet = new Set();
    while (open > maxSellers) {
      let bestSnap = null;
      let bestS = -1;
      let bestScore = Infinity;
      const base = save();
      for (let s = 0; s < S; s++) {
        load(base);
        if (sN[s] === 0) continue;
        if (closeSeller(s, closedSet) && score() < bestScore) { bestScore = score(); bestSnap = save(); bestS = s; }
      }
      if (!bestSnap) { load(base); break; }
      load(bestSnap);
      closedSet.add(bestS);
    }
  };

  // Cheapest copy of every card, ignoring shipping. Searching from here
  // guarantees the result is never worse than buying cheapest-per-card.
  const fromCheapest = () => {
    assign.fill(-1); sN.fill(0); sV.fill(0); used.fill(0); open = 0;
    for (let u = 0; u < units.length; u++) {
      for (const oi of wantOffers[units[u]]) {
        if (used[offers[oi].a] < arts[offers[oi].a]) { put(u, oi); break; }
      }
    }
  };

  // Shake the best cart so the search can leave its local optimum: drop a
  // few random sellers, re-pick some random copies, or pull to a random seller.
  const perturb = () => {
    const kind = rand();
    if (kind < 0.45) {
      const openList = [];
      for (let s = 0; s < S; s++) if (sN[s] > 0) openList.push(s);
      const forbid = new Set();
      const k = 1 + Math.floor(rand() * Math.min(3, openList.length));
      for (let i = 0; i < k; i++) {
        const s = openList[Math.floor(rand() * openList.length)];
        if (sN[s] > 0) { forbid.add(s); const snap = save(); if (!closeSeller(s, forbid)) load(snap); }
      }
    } else if (kind < 0.8) {
      for (let u = 0; u < units.length; u++) {
        if (rand() > 0.15) continue;
        const list = wantOffers[units[u]];
        const pick = list[Math.floor(rand() * Math.min(6, list.length))];
        if (pick == null || pick === assign[u]) continue;
        const cur = assign[u];
        if (cur >= 0) take(u);
        if (delta(pick, null) < Infinity) put(u, pick); else if (cur >= 0) put(u, cur);
      }
    } else if (S) {
      pullSeller(Math.floor(rand() * S));
    }
  };

  // A given solution (the exact solver's) as a start.
  const fromPicks = () => {
    assign.fill(-1); sN.fill(0); sV.fill(0); used.fill(0); open = 0;
    const left = new Map();
    opts.warmStart.forEach((list, wi) => (list || []).forEach((p) => left.set(`${wi}|${p.id}`, p.count)));
    for (let u = 0; u < units.length; u++) {
      for (const oi of wantOffers[units[u]]) {
        const k = `${units[u]}|${offers[oi].ref.id}`;
        if ((left.get(k) || 0) > 0 && used[offers[oi].a] < arts[offers[oi].a]) { left.set(k, left.get(k) - 1); put(u, oi); break; }
      }
    }
  };

  const start = now();
  const deadline = start + budget;
  let best = null;
  let bestScore = Infinity;
  let restarts = 0;
  const consider = () => {
    restarts++;
    const sc = score();
    if (sc < bestScore - EPS) { bestScore = sc; best = save(); return true; }
    return false;
  };
  // Two deterministic starts always get to finish their search.
  const inits = [() => construct(0), fromCheapest];
  if (opts.warmStart) inits.unshift(fromPicks);
  for (const init of inits) {
    limitOn = false;
    init();
    enforceLimit();
    limitOn = true;
    localSearch(start + budget * 3);
    consider();
  }
  // Then iterated local search from the best cart, with a fresh randomized
  // start now and then for diversity.
  // Stops early once many shakes in a row found nothing better.
  for (let r = 0, stale = 0, sinceBest = 0; now() < deadline && r < 5000 && sinceBest < 300; r++, sinceBest++) {
    if (stale >= 15) {
      limitOn = false;
      construct(0.6);
      enforceLimit();
      limitOn = true;
      stale = 0;
    } else {
      load(best);
      perturb();
    }
    localSearch(deadline);
    if (consider()) { stale = 0; sinceBest = 0; } else stale++;
  }
  load(best);

  return {
    ...summarize(),
    baseline: baseline(wants, shipping),
    stats: { restarts, ms: Math.round(now() - start), sellersConsidered: S, offersConsidered: offers.length },
  };

  function summarize() {
    const bySeller = new Map();
    const missingByWant = new Map();
    let itemsCost = 0;
    for (let u = 0; u < units.length; u++) {
      const oi = assign[u];
      if (oi < 0) {
        const w = wants[units[u]];
        missingByWant.set(units[u], { want: w, count: (missingByWant.get(units[u])?.count || 0) + 1 });
        continue;
      }
      const o = offers[oi];
      if (!bySeller.has(o.s)) bySeller.set(o.s, { seller: sellers[o.s].name, info: sellers[o.s].ref, items: new Map(), cards: 0, value: 0 });
      const g = bySeller.get(o.s);
      const k = o.ref.id;
      if (!g.items.has(k)) {
        // The cheapest copy elsewhere, to show what bundling traded away.
        let cheapest = null;
        for (const x of wants[o.w].offers || []) {
          if (x.price > 0 && x.price < o.price - EPS && x.seller !== o.ref.seller && (!cheapest || x.price < cheapest.price)) cheapest = x;
        }
        g.items.set(k, { offer: o.ref, want: wants[o.w], quantity: 0, cheapest: cheapest && { price: cheapest.price, seller: cheapest.seller } });
      }
      g.items.get(k).quantity++;
      g.cards++;
      g.value += o.price;
      itemsCost += o.price;
    }
    let shippingCost = 0;
    const groups = [...bySeller.entries()].map(([s, g]) => {
      const sh = ship(s, g.cards, g.value);
      shippingCost += sh;
      return { ...g, items: [...g.items.values()], shipping: sh - penalty, value: round(g.value) };
    }).sort((a, b) => b.value - a.value);
    return {
      groups,
      missing: [...missingByWant.values()],
      itemsCost: round(itemsCost),
      shippingCost: round(shippingCost - penalty * groups.length),
      total: round(itemsCost + shippingCost - penalty * groups.length),
    };
  }
}

// Every copy from its cheapest available offer, ignoring shipping when
// choosing - roughly what picking "cheapest" per card by hand gives you.
export function baseline(wants, shipping) {
  const used = new Map();
  const per = new Map();
  let items = 0;
  let missing = 0;
  for (const w of wants) {
    const list = [...(w.offers || [])].filter((o) => o.price > 0).sort((a, b) => a.price - b.price);
    for (let k = 0; k < (w.quantity | 0); k++) {
      const o = list.find((x) => (used.get(x.id) || 0) < Math.max(1, x.available | 0));
      if (!o) { missing++; continue; }
      used.set(o.id, (used.get(o.id) || 0) + 1);
      items += o.price;
      const g = per.get(o.seller) || { n: 0, v: 0, ref: o };
      g.n++; g.v += o.price;
      if (o.trackedOnly) g.ref = o;
      per.set(o.seller, g);
    }
  }
  let ship = 0;
  for (const g of per.values()) ship += tierCost(sellerTiers(shipping, g.ref), g.n, g.v);
  return { total: round(items + ship), itemsCost: round(items), shippingCost: round(ship), sellers: per.size, missing };
}

const round = (x) => Math.round(x * 100) / 100;
