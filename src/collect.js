// Turns a wants list into candidate offers per want: builds Cardmarket's
// filter URLs from the want and the user's settings, fetches the pages, and
// re-checks every offer against the same rules client-side.
import { parseOffers, parseVersionLinks, parseWantsList, wantsListPageCount, isLoggedOut } from './parse.js';

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
  const pages = wantsListPageCount(first);
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
    want.key = want.idWant;
  }
  progress?.(wants.length, wants.length, null);
  return wants;
}
