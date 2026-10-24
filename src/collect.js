// Turns a wants list into candidate offers per want: builds Cardmarket's
// filter URLs from the want and the user's settings, fetches the pages, and
// re-checks every offer against the same rules client-side.
import { parseOffers, parseVersionLinks, parseWantsList, pageCount, isLoggedOut, wantsFilterParam, isWantsFilterApplied, isTruncated } from './parse.js';

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

// Why an offer is rejected, or '' if it is allowed. The reasons are counted
// per card so a card with no offers says what removed them.
export function offerVerdict(o, want, f, settings) {
  if (f.countries.length && !f.countries.includes(o.countryId)) return 'country';
  if (f.languages.length && o.language && !f.languages.includes(o.language)) return 'language';
  if (f.minCondition && o.condition && o.condition > f.minCondition) return 'condition';
  if (f.foil === 'Y' && !o.isFoil) return 'foil';
  if (f.foil === 'N' && o.isFoil) return 'foil';
  if (f.signed === 'N' && o.isSigned) return 'signed';
  if (f.altered === 'N' && o.isAltered) return 'altered';
  if (want.maxPrice && o.price > want.maxPrice + 1e-9) return 'max price';
  if (o.rating === 0 ? !settings.allowUnrated : o.rating < (settings.minRating || 0)) return 'rating';
  if (keywordList(settings.excludeSellers).includes(o.seller.toLowerCase())) return 'blocked seller';
  if (want.kind === 'card' || want.anyPrinting) {
    const exp = (o.expansion || '').toLowerCase();
    if (keywordList(settings.excludeExpansions).some((k) => exp.includes(k))) return 'expansion';
  }
  return '';
}

export const offerAllowed = (o, want, f, settings) => !offerVerdict(o, want, f, settings);

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

const unreadRow = (r) => (r ? {
  unread: r.outerHTML.replace(/\s+/g, ' ').slice(0, 1500),
  unreadOffer: (r.querySelector('.col-offer')?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 1500),
} : {});

// What a fetched page looked like, kept small: enough to tell "the page had
// no offers" from "the page had offers we could not read".
function pageDiag(doc, url, offers) {
  if (!doc) return { url, missing: true };
  const rows = doc.querySelectorAll('.article-row');
  const sample = rows[0] || doc.querySelector('#table, .table-body, main') || doc.body;
  return {
    url,
    title: (doc.title || '').trim().slice(0, 120),
    rows: rows.length,
    sellerRows: [...rows].filter((r) => r.querySelector('.seller-name a[href*="/Users/"]')).length,
    parsed: offers.length,
    sample: (sample?.outerHTML || '').replace(/\s+/g, ' ').slice(0, 2500),
    // A row that was on the page but could not be read, if any.
    ...unreadRow([...rows].find((r) => !offers.some((o) => r.id.endsWith(o.id)))),
  };
}

const cardLinkOf = (doc) => [...doc.querySelectorAll('a[href*="/Cards/"]')]
  .map((a) => (a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, ''))
  .find((h) => /^\/[a-z]{2}\/[^/]+\/Cards\/[^/]+$/.test(h)) || null;

// The all-printings page for a want that names one printing: the link on
// its page, or else the printing's own slug (minus a version suffix) under
// /Cards/, which is how Cardmarket names them.
function cardUrlFor(want, page) {
  if (page.cardUrl) return toEnglish(page.cardUrl);
  const m = toEnglish(want.url).replace(/[?#].*$/, '').match(/^(\/en\/[^/]+)\/Products\/Singles\/[^/]+\/([^/]+)$/);
  return m ? `${m[1]}/Cards/${m[2].replace(/-V-?\d+$/i, '')}` : null;
}

async function offersAt(fetcher, url) {
  const hit = fetcher.cached(url);
  if (hit) return hit;
  const doc = await fetcher.doc(url);
  const offers = doc ? parseOffers(doc, url) : [];
  const v = {
    offers,
    versions: doc && /\/Cards\//.test(url) ? parseVersionLinks(doc, url) : [],
    // A printing's page links to the card's all-printings page.
    cardUrl: doc && /\/Products\//.test(url) ? cardLinkOf(doc) : undefined,
    truncated: doc ? isTruncated(doc) : false,
    diag: pageDiag(doc, url, offers),
  };
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
    let truncated = !!page.truncated;
    const diag = { pages: [page.diag], versions: page.versions.length, rejected: {} };
    // "Any printing" for a want that names one: add the card's
    // all-printings page (its offers come with their expansion).
    want.anyPrinting = !!settings.anyPrinting && want.kind === 'product';
    let cardPage = want.kind === 'card' ? page : null;
    if (want.anyPrinting) {
      const cardPath = cardUrlFor(want, page);
      if (cardPath) {
        cardPage = await offersAt(fetcher, `${cardPath}?${qs}`);
        found.push(...cardPage.offers);
        truncated ||= !!cardPage.truncated;
        diag.pages.push(cardPage.diag);
      }
    }
    // A card page that lists printings but no offers: visit the cheapest
    // printings one by one.
    if (cardPage && !cardPage.offers.length && cardPage.versions?.length) {
      const versions = cardPage.versions
        .filter((v) => !keywordList(settings.excludeExpansions).some((k) => (v.expansion || '').toLowerCase().includes(k)))
        .sort((a, b) => a.fromPrice - b.fromPrice)
        .slice(0, settings.maxVersions || 12);
      for (const v of versions) {
        const r = await offersAt(fetcher, `${toEnglish(v.url)}?${qs}`);
        found.push(...r.offers.map((o) => ({ ...o, expansion: o.expansion || v.expansion })));
        truncated ||= !!r.truncated;
        diag.pages.push(r.diag);
      }
    }
    const seen = new Set();
    found = found.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      const why = offerVerdict(o, want, f, settings);
      if (why) diag.rejected[why] = (diag.rejected[why] || 0) + 1;
      return !why;
    });
    // With "any printing", mark copies of other printings than the one the
    // wants list names, for the optimizer's printing preference.
    if (want.anyPrinting) {
      const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const own = cleanPath(want.url);
      for (const o of found) o.otherPrinting = cleanPath(o.productUrl) !== own && norm(o.expansion) !== norm(want.expansion);
    }
    want.offers = found;
    want.diag = diag;
    want.truncated = truncated;
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
  const name = baseName(offer.name);
  return wants.filter((w) => (w.kind === 'product' && !w.anyPrinting
    ? cleanPath(w.url) === path
    : !!name && baseName(w.name) === name));
}

// Should the seller scan run? 'auto' runs it only when some card page held
// back offers; when every page showed everything, the card scan is already
// the complete picture and the scan would add nothing.
export function shouldScanSellers(wants, mode) {
  if (mode === 'off') return { run: false, reason: 'off' };
  const cut = wants.filter((w) => w.truncated).length;
  if (mode === 'always') return { run: true, reason: 'always', cut };
  return cut ? { run: true, reason: 'truncated', cut } : { run: false, reason: 'complete', cut };
}

// Sellers worth a full look: those offering the most different wanted cards
// so far (cards whose page was cut off count double, since that is where
// sellers can be hidden), plus everyone already in the cart.
export function pickSellersToScan(wants, chosen, limit) {
  const count = new Map();
  const info = new Map();
  for (const w of wants) {
    for (const s of new Set((w.offers || []).map((o) => o.seller))) count.set(s, (count.get(s) || 0) + (w.truncated ? 2 : 1));
    for (const o of w.offers || []) if (!info.has(o.seller)) info.set(o.seller, o);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const out = [...new Set([...(chosen || []), ...ranked])].slice(0, Math.max(limit, (chosen || []).length));
  return out.map((s) => info.get(s)).filter(Boolean);
}

export async function scanSellers(fetcher, wants, listId, sellers, settings, log) {
  if (!sellers.length || !listId) return { added: 0, param: null };
  const userUrl = (o) => `${toEnglish(o.sellerUrl).replace(/[?#].*$/, '').replace(/\/$/, '')}/Offers/Singles`;
  const firstUrl = userUrl(sellers[0]);
  const firstDoc = await fetcher.doc(firstUrl);
  const found = firstDoc && await discoverWantsFilter(fetcher, firstDoc, firstUrl, listId);
  if (!found) {
    log?.('Seller scan skipped: could not find the wants-list filter on seller pages.');
    return { added: 0, param: null, diag: firstDoc && sellerPageDiag(firstDoc, firstUrl, listId) };
  }
  log?.(`Seller pages filter your wants list with: ${found.template}`);
  // The filtered address for another seller: same query, that seller's path.
  const firstPath = firstUrl.replace(/\/Offers\/Singles$/, '');
  const filteredUrl = (o) => found.template.replace(firstPath, userUrl(o).replace(/\/Offers\/Singles$/, ''));
  let added = 0;
  for (const seller of sellers) {
    const base = filteredUrl(seller);
    const pages = [];
    const first = fetcher.cached(base) || await (async () => {
      const d = await fetcher.doc(base);
      const v = d ? { offers: parseOffers(d, base, seller), pages: pageCount(d) } : { offers: [], pages: 1 };
      fetcher.store(base, v);
      return v;
    })();
    pages.push(first);
    for (let p = 2; p <= Math.min(first.pages || 1, 20); p++) {
      const url = `${base}${base.includes('?') ? '&' : '?'}site=${p}`;
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
  return { added, param: found.template };
}

// How a seller page filters by wants list. Tried in order:
//  1. a <select> whose option is the list id, as a GET parameter;
//  2. any element carrying the list id (checkbox, radio, option, link) in
//     a form: the form is submitted the way the browser would, and the
//     address Cardmarket redirects to is the filtered page (its filter forms
//     post to PostGetAction/... and redirect to a GET address);
//  3. a link whose address contains the list id.
// Returns { template } (the first seller's filtered address) or null.
export async function discoverWantsFilter(fetcher, doc, sellerUrl, listId) {
  const id = String(listId);
  const confirm = async (url) => {
    const d = await fetcher.doc(url);
    return d && (isWantsFilterApplied(d, url.match(/[?&]([^=&]+)=\d+/)?.[1] || '', id) || url.includes(id)) ? url : null;
  };
  const param = wantsFilterParam(doc, id);
  if (param) {
    const url = `${sellerUrl}?${param}=${id}`;
    if (await confirm(url)) return { template: url };
  }
  // Cardmarket's filters are script components configured in data-props,
  // e.g. CategoryOffersFilterComponent with
  //   { action: '/en/Magic/PostGetAction/User_Account_Filter_FilterUserInventory',
  //     inputs: [{ name: 'idWantslist', value: '' }, { name: 'sortBy', ... }, ...] }
  // Submit it as the component would (all its inputs, the wants list set);
  // the address it redirects to is the filtered page.
  for (const el of doc.querySelectorAll('[data-component-name][data-props]')) {
    let props;
    try { props = JSON.parse(el.getAttribute('data-props')); } catch { continue; }
    const inputs = Array.isArray(props?.inputs) ? props.inputs : [];
    const wantsInput = inputs.find((i) => /wants/i.test(i?.name || ''));
    if (!wantsInput || !props.action) continue;
    const token = doc.querySelector('input[name="__cmtkn"]')?.getAttribute('value');
    try {
      const body = new FormData();
      if (token) body.append('__cmtkn', token);
      for (const i of inputs) {
        if (!i?.name) continue;
        const v = i === wantsInput ? id : i.value ?? '';
        (Array.isArray(v) ? v : [v]).forEach((x) => body.append(i.isMultiSelect ? `${i.name}[]` : i.name, x == null ? '' : String(x)));
      }
      const r = await fetch(props.action, { method: 'POST', body, credentials: 'include' });
      const url = r.url.replace(/^https?:\/\/[^/]+/, '');
      if (url.includes(id)) return { template: url.replace(/[?&]site=\d+/, ''), via: el.getAttribute('data-component-name') };
    } catch { /* fall back to the plain parameter */ }
    // The same parameter as a plain address, accepted if it changes the offers.
    const url = `${sellerUrl}?${wantsInput.name}=${id}`;
    const filtered = await fetcher.doc(url);
    const ids = (d) => [...(d?.querySelectorAll('.article-row') || [])].map((r) => r.id).join();
    if (filtered && ids(filtered) !== ids(doc)) return { template: url, via: `${wantsInput.name} parameter` };
  }
  const carriers = [...doc.querySelectorAll('input, option, button, a[href]')].filter((el) =>
    el.getAttribute('value') === id || (el.tagName === 'A' && new RegExp(`[?&][^=]+=${id}(&|$)`).test(el.getAttribute('href') || '')));
  for (const el of carriers) {
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      return { template: href.startsWith('/') ? href : `${sellerUrl}${href.startsWith('?') ? '' : '?'}${href.replace(/^.*\?/, '')}` };
    }
    const form = el.closest('form');
    if (!form) continue;
    const fields = [];
    for (const f of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      const name = f.getAttribute('name');
      if (f.tagName === 'SELECT') {
        const opt = f.contains(el) ? el : f.querySelector('option[selected]') || f.querySelector('option');
        if (opt) fields.push([name, opt.getAttribute('value') || '']);
      } else if (/^(checkbox|radio)$/i.test(f.getAttribute('type') || '')) {
        if (f === el || (f.hasAttribute('checked') && f.getAttribute('name') !== el.getAttribute('name'))) fields.push([name, f.getAttribute('value') || 'on']);
      } else if (!/^(submit|button|file)$/i.test(f.getAttribute('type') || '')) {
        fields.push([name, f.getAttribute('value') || '']);
      }
    }
    if (el.tagName === 'BUTTON' && el.getAttribute('name')) fields.push([el.getAttribute('name'), id]);
    const method = (form.getAttribute('method') || 'GET').toUpperCase();
    const action = form.getAttribute('action') || sellerUrl;
    if (method === 'GET') {
      const url = `${action.split('?')[0]}?${new URLSearchParams(fields).toString()}`;
      if (await confirm(url)) return { template: url };
      continue;
    }
    try {
      const body = new FormData();
      fields.forEach(([n, v]) => body.append(n, v));
      const r = await fetch(action, { method: 'POST', body, credentials: 'include' });
      const url = r.url.replace(/^https?:\/\/[^/]+/, '');
      if (url.includes(id) || (url.startsWith(sellerUrl) && url.includes('?'))) return { template: url.replace(/[?&]site=\d+/, '') };
    } catch { /* try the next carrier */ }
  }
  return null;
}

// What a seller's offers page offers as filters, for the debug report when
// the wants-list filter cannot be found.
function sellerPageDiag(doc, url, listId) {
  const flat = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  return {
    url,
    title: flat(doc.title).slice(0, 120),
    selects: [...doc.querySelectorAll('select[name]')].map((el) => ({
      name: el.getAttribute('name'),
      options: [...el.querySelectorAll('option')].slice(0, 8).map((o) => `${o.getAttribute('value')}=${flat(o.textContent).slice(0, 30)}`),
    })).slice(0, 25),
    inputs: [...doc.querySelectorAll('form input[name]')].map((el) => `${el.getAttribute('name')}:${el.getAttribute('type') || ''}`).slice(0, 40),
    forms: [...doc.querySelectorAll('form')].map((f) => flat(`${f.id} ${f.getAttribute('action') || ''} ${f.getAttribute('data-ajax-action') || ''}`)).slice(0, 10),
    wantsLinks: [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /want/i.test(h) || h.includes(String(listId))).slice(0, 15),
    mentionsList: doc.body?.innerHTML.includes(String(listId)) || false,
    // Every element whose attributes mention the list id, with its form.
    carriers: [...doc.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.value.includes(String(listId)))).slice(0, 6).map((el) => ({
      el: el.outerHTML.replace(/\s+/g, ' ').slice(0, 2500),
      form: el.closest('form') ? el.closest('form').outerHTML.replace(/\s+/g, ' ').slice(0, 1500) : null,
    })),
  };
}

// ---- Looking up one card by name (for "Add a card") ----

const slugOf = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’,.:!?]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A name or a pasted Cardmarket link -> { name, url } of the card's
// all-printings page (or one printing's page if that is all there is).
export async function findCard(fetcher, query, game = 'Magic') {
  const q = String(query || '').trim();
  if (!q) return null;
  const asPath = q.match(/cardmarket\.com(\/[^\s?#]+)/)?.[1] || (q.startsWith('/') ? q : '');
  const titleOf = (doc) => (doc.querySelector('h1')?.childNodes?.[0]?.textContent || doc.querySelector('h1')?.textContent || '').trim();
  if (asPath) {
    const url = toEnglish(asPath);
    const doc = await fetcher.doc(url);
    if (!doc) return null;
    const card = /\/Products\//.test(url) ? cardLinkOf(doc) : null;
    return { name: titleOf(doc) || q, url: card ? toEnglish(card) : url };
  }
  // Cardmarket names card pages after the card: /<lang>/<game>/Cards/Tinder-Wall.
  const direct = `/en/${game}/Cards/${slugOf(q)}`;
  const doc = await fetcher.doc(direct);
  if (doc && (doc.querySelector('.article-row') || doc.querySelector('a[href*="/Products/Singles/"]'))) {
    return { name: titleOf(doc) || q, url: direct };
  }
  // Otherwise the site search: the first single whose name matches.
  const search = await fetcher.doc(`/en/${game}/Products/Search?searchString=${encodeURIComponent(q)}`);
  if (!search) return null;
  const want = baseName(q);
  const hit = [...search.querySelectorAll('a[href*="/Products/Singles/"], a[href*="/Cards/"]')]
    .find((a) => baseName(a.textContent) === want);
  if (!hit) return null;
  const href = toEnglish(hit.getAttribute('href').replace(/[?#].*$/, ''));
  if (/\/Cards\//.test(href)) return { name: hit.textContent.trim(), url: href };
  const product = await fetcher.doc(href);
  const card = product && cardLinkOf(product);
  return { name: hit.textContent.trim(), url: card ? toEnglish(card) : href };
}
