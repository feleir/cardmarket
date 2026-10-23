// Turns a wants list into candidate offers per want: builds Cardmarket's
// filter URLs from the want and the user's settings, fetches the pages, and
// re-checks every offer against the same rules client-side.
import { parseOffers, parseVersionLinks, parseWantsList, pageCount, isLoggedOut, wantsFilterParam, isWantsFilterApplied } from './parse.js';

export const toEnglish = (href) => {
  const path = String(href || '').replace(/^https?:\/\/[^/]+/, '');
  return path.replace(/^\/[a-z]{2}\//, '/en/');
};

export function wantFilters(want, settings) {
  const langs = settings.languages?.length ? settings.languages : want.languages;
  const minCondition = settings.minCondition || want.minCondition || 0;
  let foil = want.flags?.isFoil || '';
  if (settings.foil === 'Y' || settings.foil === 'N') foil = settings.foil;
  if (settings.foil === 'any') foil = '';
  return {
    countries: [...(settings.sellerCountries || [])].sort((a, b) => a - b),
    languages: [...(langs || [])].sort((a, b) => a - b),
    minCondition,
    foil,
    // Signed and altered copies are excluded unless the want asks for them.
    signed: want.flags?.isSigned || 'N',
    altered: want.flags?.isAltered || 'N',
    sellerTypes: [...(settings.sellerTypes || [])].sort((a, b) => a - b),
  };
}

export function filterQuery(f) {
  const q = new URLSearchParams();
  if (f.countries.length) q.set('sellerCountry', f.countries.join(','));
  if (f.sellerTypes.length) q.set('sellerType', f.sellerTypes.join(','));
  if (f.languages.length) q.set('language', f.languages.join(','));
  if (f.minCondition) q.set('minCondition', String(f.minCondition));
  if (f.foil) q.set('isFoil', f.foil);
  if (f.signed) q.set('isSigned', f.signed);
  if (f.altered) q.set('isAltered', f.altered);
  return q.toString().replace(/%2C/g, ',');
}

const keywordList = (text) => String(text || '').split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export function offerAllowed(o, want, f, settings) {
  if (f.countries.length && !f.countries.includes(o.countryId)) return false;
  if (f.languages.length && o.language && !f.languages.includes(o.language)) return false;
  if (f.minCondition && o.condition && o.condition > f.minCondition) return false;
  if (f.foil === 'Y' && !o.isFoil) return false;
  if (f.foil === 'N' && o.isFoil) return false;
  if (f.signed === 'N' && o.isSigned) return false;
  if (f.altered === 'N' && o.isAltered) return false;
  if (want.maxPrice && o.price > want.maxPrice + 1e-9) return false;
  if (o.rating === 0 ? !settings.allowUnrated : o.rating < (settings.minRating || 0)) return false;
  const excluded = keywordList(settings.excludeSellers);
  if (excluded.includes(o.seller.toLowerCase())) return false;
  if (want.kind === 'card') {
    const exp = (o.expansion || '').toLowerCase();
    if (keywordList(settings.excludeExpansions).some((k) => exp.includes(k))) return false;
  }
  return true;
}

export async function loadWantsList(fetcher, listUrl, log) {
  const base = toEnglish(listUrl).replace(/[?#].*$/, '');
  const first = await fetcher.doc(base);
  if (!first) throw new Error('Wants list not found');
  if (isLoggedOut(first)) throw new Error('Please log in to Cardmarket first.');
  const wants = parseWantsList(first);
  const pages = pageCount(first);
  for (let p = 2; p <= pages; p++) {
    log?.(`Reading wants list page ${p}/${pages}…`);
    const d = await fetcher.doc(`${base}?site=${p}`);
    if (d) wants.push(...parseWantsList(d));
  }
  const seen = new Set();
  return wants.filter((w) => (seen.has(w.idWant) ? false : seen.add(w.idWant)));
}

async function offersAt(fetcher, url) {
  const hit = fetcher.cached(url);
  if (hit) return hit;
  const doc = await fetcher.doc(url);
  const v = doc ? { offers: parseOffers(doc, url), versions: /\/Cards\//.test(url) ? parseVersionLinks(doc, url) : [] } : { offers: [], versions: [] };
  fetcher.store(url, v);
  return v;
}

// Fills want.offers for every want. progress(i, n, want) is called per want.
export async function collectOffers(fetcher, wants, settings, progress) {
  for (let i = 0; i < wants.length; i++) {
    const want = wants[i];
    progress?.(i, wants.length, want);
    const f = wantFilters(want, settings);
    const qs = filterQuery(f);
    const path = toEnglish(want.url).replace(/[?#].*$/, '');
    let found = [];
    const page = await offersAt(fetcher, `${path}?${qs}`);
    found.push(...page.offers);
    // An any-printing want whose card page lists printings but no offers:
    // visit the cheapest printings one by one.
    if (want.kind === 'card' && !page.offers.length && page.versions.length) {
      const versions = page.versions
        .filter((v) => !keywordList(settings.excludeExpansions).some((k) => (v.expansion || '').toLowerCase().includes(k)))
        .sort((a, b) => a.fromPrice - b.fromPrice)
        .slice(0, settings.maxVersions || 12);
      for (const v of versions) {
        const r = await offersAt(fetcher, `${toEnglish(v.url)}?${qs}`);
        found.push(...r.offers.map((o) => ({ ...o, expansion: o.expansion || v.expansion })));
      }
    }
    const seen = new Set();
    found = found.filter((o) => !seen.has(o.id) && seen.add(o.id) && offerAllowed(o, want, f, settings));
    want.offers = found;
    want.filters = f;
    want.key = want.idWant;
  }
  progress?.(wants.length, wants.length, null);
  return wants;
}

// ---- Deep seller scan ----
// A product page only lists the cheapest offers for that card, so a seller
// who stocks many of your cards at slightly higher prices can be missing for
// most of them - and that seller is exactly where one parcel could replace
// several. Cardmarket can filter any seller's stock by your wants list, so
// the most promising sellers get their whole matching stock read.

const baseName = (s) => String(s || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
const cleanPath = (href) => toEnglish(href).replace(/[?#].*$/, '');

// Which want does an offer from a seller's page belong to?
export function matchWants(offer, wants) {
  const path = cleanPath(offer.productUrl);
  const byProduct = wants.filter((w) => w.kind === 'product' && cleanPath(w.url) === path);
  if (byProduct.length) return byProduct;
  const name = baseName(offer.name);
  return wants.filter((w) => w.kind === 'card' && name && baseName(w.name) === name);
}

// Sellers worth a full look: those offering the most different wanted cards
// so far, plus everyone already in the cart.
export function pickSellersToScan(wants, chosen, limit) {
  const count = new Map();
  const info = new Map();
  for (const w of wants) {
    for (const s of new Set((w.offers || []).map((o) => o.seller))) count.set(s, (count.get(s) || 0) + 1);
    for (const o of w.offers || []) if (!info.has(o.seller)) info.set(o.seller, o);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const out = [...new Set([...(chosen || []), ...ranked])].slice(0, Math.max(limit, (chosen || []).length));
  return out.map((s) => info.get(s)).filter(Boolean);
}

export async function scanSellers(fetcher, wants, listId, sellers, settings, log) {
  if (!sellers.length || !listId) return { added: 0, param: null };
  const userUrl = (o) => `${toEnglish(o.sellerUrl).replace(/[?#].*$/, '').replace(/\/$/, '')}/Offers/Singles`;
  // Discover the parameter name from the first seller's filter form.
  const firstDoc = await fetcher.doc(userUrl(sellers[0]));
  let param = firstDoc && wantsFilterParam(firstDoc, listId);
  const candidates = [param, 'idWantsList', 'idWantslist', 'wantsList'].filter(Boolean);
  param = null;
  for (const c of candidates) {
    const d = await fetcher.doc(`${userUrl(sellers[0])}?${c}=${listId}`);
    if (d && isWantsFilterApplied(d, c, listId)) { param = c; break; }
  }
  if (!param) {
    log?.('Seller scan skipped: could not find the wants-list filter on seller pages.');
    return { added: 0, param: null };
  }
  let added = 0;
  for (const seller of sellers) {
    const base = `${userUrl(seller)}?${param}=${listId}`;
    const pages = [];
    const first = fetcher.cached(base) || await (async () => {
      const d = await fetcher.doc(base);
      const v = d ? { offers: parseOffers(d, base, seller), pages: pageCount(d) } : { offers: [], pages: 1 };
      fetcher.store(base, v);
      return v;
    })();
    pages.push(first);
    for (let p = 2; p <= Math.min(first.pages || 1, 20); p++) {
      const url = `${base}&site=${p}`;
      const hit = fetcher.cached(url);
      if (hit) { pages.push(hit); continue; }
      const d = await fetcher.doc(url);
      const v = d ? { offers: parseOffers(d, url, seller), pages: 1 } : { offers: [], pages: 1 };
      fetcher.store(url, v);
      pages.push(v);
    }
    let n = 0;
    const cards = new Set();
    for (const o of pages.flatMap((p) => p.offers)) {
      for (const w of matchWants(o, wants)) {
        if (!w.filters || (w.offers || []).some((x) => x.id === o.id)) continue;
        if (!offerAllowed(o, w, w.filters, settings)) continue;
        w.offers.push(o);
        n++;
        cards.add(w.idWant);
      }
    }
    added += n;
    log?.(`${seller.seller}: ${n ? `+${n} offer(s) for ${cards.size} card(s)` : 'nothing new'}`);
  }
  return { added, param };
}
