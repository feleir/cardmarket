// Exact cart optimization as a mixed-integer program, solved with HiGHS
// (WebAssembly). Optional: the solver is ~3.5 MB, so the bookmarklet loads it
// from a CDN only when "exact mode" is on, and the heuristic still runs on
// its answer (and is the fallback if loading is blocked).
//
//   x_o      copies bought from offer o            0..available
//   m_w      copies of want w left unfilled        (heavily penalised)
//   z_{s,t}  seller s ships with tier t            binary, at most one per seller
//   min  Σ (p_o + pref_o) x_o + Σ (tierPrice_t + penalty) z_{s,t} + BIG Σ m_w
//        (pref_o: the printing premium for copies of another printing)
//   s.t. Σ_{o∈w} x_o + m_w = quantity_w
//        Σ_{o: same article} x_o <= available          (an article can serve two wants)
//        Σ_{o∈s} x_o     <= Σ_t maxCards_t z_{s,t}
//        Σ_{o∈s} p_o x_o <= Σ_t maxValue_t z_{s,t}
//        Σ_t z_{s,t} <= 1
import { sellerTiers, shippingVat } from './shipping.js';

const BIG = 10000;
export const HIGHS_VERSION = '1.15.4';

export function buildModel(wants, { shipping, sellerPenalty = 0, printingPremium = 0, vatInParcelValue = false } = {}) {
  const vars = [];
  const sellers = new Map();
  const articles = new Map();
  wants.forEach((w, wi) => (w.offers || []).forEach((o, oi) => {
    if (!(o.price > 0)) return;
    const v = `x${vars.length}`;
    vars.push({ v, wi, oi, o });
    if (!sellers.has(o.seller)) sellers.set(o.seller, { idx: sellers.size, tiers: sellerTiers(shipping, o), vat: shippingVat(o), xs: [] });
    else if (o.trackedOnly) sellers.get(o.seller).tiers = sellerTiers(shipping, o);
    sellers.get(o.seller).vat = Math.max(sellers.get(o.seller).vat, shippingVat(o));
    // Parcel value for the shipping steps: before VAT unless asked otherwise.
    sellers.get(o.seller).xs.push({ v, p: vatInParcelValue || !(o.listedPrice > 0) ? o.price : o.listedPrice });
    if (!articles.has(o.id)) articles.set(o.id, { cap: Math.max(1, o.available | 0), vs: [] });
    articles.get(o.id).vs.push(v);
  }));
  const obj = [];
  const cons = [];
  const bounds = [];
  const ints = [];
  const bins = [];
  for (const { v, o } of vars) {
    obj.push(`${o.price + (o.otherPrinting ? Number(printingPremium) || 0 : 0)} ${v}`);
    bounds.push(` 0 <= ${v} <= ${Math.max(1, o.available | 0)}`);
    ints.push(v);
  }
  wants.forEach((w, wi) => {
    const vs = vars.filter((x) => x.wi === wi).map((x) => x.v);
    obj.push(`${BIG} m${wi}`);
    cons.push(` w${wi}: ${[...vs, `m${wi}`].join(' + ')} = ${Math.max(0, w.quantity | 0)}`);
  });
  let ai = 0;
  for (const a of articles.values()) {
    if (a.vs.length > 1) cons.push(` a${ai++}: ${a.vs.join(' + ')} <= ${a.cap}`);
  }
  for (const s of sellers.values()) {
    const zs = s.tiers.map((t, ti) => ({ t, z: `z${s.idx}_${ti}` }));
    zs.forEach(({ t, z }) => { obj.push(`${Math.round(t.price * s.vat * 100) / 100 + sellerPenalty} ${z}`); bins.push(z); });
    cons.push(` n${s.idx}: ${s.xs.map((x) => x.v).join(' + ')} ${zs.map(({ t, z }) => `- ${t.maxCards} ${z}`).join(' ')} <= 0`);
    cons.push(` v${s.idx}: ${s.xs.map((x) => `${x.p} ${x.v}`).join(' + ')} ${zs.map(({ t, z }) => `- ${t.maxValue} ${z}`).join(' ')} <= 0`);
    cons.push(` o${s.idx}: ${zs.map(({ z }) => z).join(' + ')} <= 1`);
  }
  const lp = `Minimize\n obj: ${obj.join(' + ')}\nSubject To\n${cons.join('\n')}\nBounds\n${bounds.join('\n')}\nGeneral\n ${ints.join(' ')}\nBinary\n ${bins.join(' ')}\nEnd\n`;
  return { lp, vars };
}

// Returns { status, objective, picks } where picks[wi] = [{ id, count }], or
// null when the solver produced no usable solution.
export function solveWith(highs, wants, opts = {}) {
  const { lp, vars } = buildModel(wants, opts);
  const r = highs.solve(lp, { time_limit: (opts.timeLimitMs || 15000) / 1000, mip_rel_gap: 1e-6 });
  if (!r.Columns || !['Optimal', 'Time limit reached'].includes(r.Status)) return null;
  const picks = wants.map(() => []);
  for (const { v, wi, o } of vars) {
    const n = Math.round(r.Columns[v]?.Primal || 0);
    if (n > 0) picks[wi].push({ id: o.id, count: n });
  }
  return { status: r.Status, objective: r.ObjectiveValue, picks };
}

let loading;
// Where the solver comes from. The bookmarklet loads it from jsDelivr. The
// Chrome extension ships it in its package (the Web Store forbids remotely
// loaded code): its build sets globalThis.__CMOPT_EXT__, and a script in the
// extension's own world publishes the package URL on <html data-cmopt-ext>.
export function loadHighs() {
  loading ||= (async () => {
    // Written inline so the build drops the branch it does not use.
    const base = globalThis.__CMOPT_EXT__
      ? document.documentElement.dataset.cmoptExt
      : `https://cdn.jsdelivr.net/npm/highs@${HIGHS_VERSION}/build/`;
    if (!base) throw new Error('solver files not found in the extension');
    const mod = await import(/* @vite-ignore */ `${base}highs.mjs`);
    return mod.default({ locateFile: (f) => base + f });
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
