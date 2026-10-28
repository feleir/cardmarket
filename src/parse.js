// Parsers for Cardmarket pages. Each takes a parsed Document (DOMParser in the
// browser, linkedom in tests) and returns plain data. Cardmarket has no public
// API for buyers, so the page markup is the contract; selectors are kept loose
// and every value is re-checked rather than trusted to the URL filters,
// which fail open (an unknown filter value just returns everything).
import { RATINGS, conditionByCode, countryByName, languageByName } from './constants.js';

const tipOf = (el) => (el && (el.getAttribute('aria-label') || el.getAttribute('data-bs-original-title')
  || el.getAttribute('data-original-title') || el.getAttribute('title') || '').trim()) || '';

// Tooltip text sits in a plain title attribute in the HTML Cardmarket
// serves; Bootstrap moves it to data-bs-original-title (and some pages use
// aria-label) only once its script runs in a live tab. Fetched pages never
// ran it, so every lookup must accept all of them.
const TIP = '[title],[aria-label],[data-bs-original-title],[data-original-title]';
const tipsIn = (root, scope = '') => [...root.querySelectorAll(TIP.split(',').map((t) => `${scope}${t}`).join(','))];

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// "1.234,56 €", "€1,234.56", "0,02 €" -> number. The decimal separator is
// whichever of . or , is followed by exactly two trailing digits.
export function parsePrice(text) {
  const s = String(text || '').replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  if (m) return Number(m[1].replace(/[.,]/g, '') + '.' + m[2]);
  return Number(s.replace(/[.,]/g, ''));
}

export const isChallengePage = (html) =>
  /cf-mitigated|cf-chl-|Just a moment\.\.\.|Checking your browser|Cloudflare Ray ID/i.test(html || '');

export const isLoggedOut = (doc) => !!doc.querySelector('#login-signup form, form[action*="Login"] input[name="userPassword"]');

// /en/Magic/Wants overview -> [{ id, name, url }]
export function parseWantsOverview(doc, base = '') {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/Wants/"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/Wants\/(\d+)(?:[/?#]|$)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    let name = flat(a.textContent);
    if (!name) {
      const h = a.closest('div, li, article')?.querySelector('h1,h2,h3,h4,h5,h6');
      name = flat(h?.textContent);
    }
    out.push({ id: m[1], name: name || `Wants list ${m[1]}`, url: base + href.replace(/[?#].*$/, '') });
  }
  return out;
}

// Ternary want attributes (foil, signed, altered...) sit in their own columns.
// Map column index -> attribute from the table header tooltips.
const TERNARY_WORDS = [
  ['isReverseHolo', /revers/i], ['isFirstEd', /first|1st/i], ['isFoil', /foil/i],
  ['isSigned', /sign/i], ['isAltered', /alter/i], ['isPlayset', /playset/i],
];

function headerColumns(table) {
  const cols = {};
  if (!table) return cols;
  const heads = [...table.querySelectorAll('thead th')];
  heads.forEach((th, i) => {
    const label = flat(tipOf(th.querySelector(TIP)) || th.textContent);
    for (const [name, re] of TERNARY_WORDS) {
      if (re.test(label) && !(name in cols)) { cols[name] = i; break; }
    }
  });
  return cols;
}

function ternaryOf(td) {
  if (!td) return 'any';
  const t = flat(td.textContent).toUpperCase();
  const tip = tipOf(td.querySelector(TIP)).toLowerCase();
  if (t === 'Y' || td.querySelector('[name="yes"], .fonticon-check') || tip === 'yes') return 'Y';
  if (t === 'N' || td.querySelector('[name="no"], .fonticon-cross, .fonticon-close') || tip === 'no') return 'N';
  return 'any';
}

// A wants list page -> [{ idWant, name, url, kind, quantity, languages, minCondition, isFoil, ..., maxPrice, expansion }]
// kind is 'product' when the want is one printing, 'card' when it is any printing.
export function parseWantsList(doc) {
  let rows = [...doc.querySelectorAll('input[data-id-want]')].map((cb) => cb.closest('tr')).filter(Boolean);
  if (!rows.length) rows = [...doc.querySelectorAll('#WantsListTable tbody tr, table.tablesorter tbody tr')];
  rows = [...new Set(rows)];
  const table = rows[0]?.closest('table');
  const cols = headerColumns(table);
  const wants = [];
  for (const tr of rows) {
    const link = tr.querySelector('td.name a[href]') || tr.querySelector('a[href*="/Products/"], a[href*="/Cards/"]');
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    const name = flat(link.textContent);
    const kind = /\/Products\//.test(href) ? 'product' : 'card';
    const idWant = tr.querySelector('input[data-id-want]')?.getAttribute('data-id-want')
      || (tr.id.match(/(\d+)/) || [])[1] || `${wants.length}`;

    const amountTd = tr.querySelector('td.amount');
    const quantity = parseInt(amountTd?.getAttribute('data-amount') || flat(amountTd?.textContent), 10) || 1;

    const langTd = tr.querySelector('td.languages');
    const languages = langTd
      ? [...new Set(tipsIn(langTd)
          .map((e) => languageByName(tipOf(e))?.id).filter(Boolean))]
      : [];

    const condBadge = tr.querySelector('td.condition .badge, .article-condition .badge');
    const minCondition = conditionByCode(flat(condBadge?.textContent))?.id || 0;

    const flags = {};
    const cells = [...tr.children];
    for (const [attr, idx] of Object.entries(cols)) {
      const v = ternaryOf(cells[idx]);
      if (v !== 'any') flags[attr] = v;
    }

    const priceTd = tr.querySelector('td.buyPrice, td.price');
    const priceInput = tr.querySelector('input[name*="rice"]');
    const maxPrice = parsePrice(priceInput?.value || priceTd?.textContent) || 0;

    const expEl = tr.querySelector('td.expansion [aria-label], td.expansion [data-bs-original-title], td.expansion .expansion-symbol');
    let expansion = tipOf(expEl) || flat(tr.querySelector('td.expansion')?.textContent);
    if (/^any$/i.test(expansion)) expansion = '';

    wants.push({ idWant, name, url: href, kind, quantity, languages, minCondition, flags, maxPrice, expansion,
      // The first row's markup, for the debug report.
      ...(wants.length ? {} : { rowHtml: tr.outerHTML.replace(/\s+/g, ' ').slice(0, 2500) }) });
  }
  return wants;
}

// Pagination (wants lists, seller offers): the highest ?site=N linked from the page.
export function pageCount(doc) {
  let max = 1;
  for (const a of doc.querySelectorAll('a[href*="site="]')) {
    const m = (a.getAttribute('href') || '').match(/[?&]site=(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

const expansionFromUrl = (href) => {
  const m = String(href || '').match(/\/Products\/Singles\/([^/?#]+)\//);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : '';
};

// A product page (one printing), card page (all printings) or a seller's
// offers page -> offers. pageUrl names the printing when rows do not carry
// it; seller fills in the seller on a seller's own page, whose rows have none.
export function parseOffers(doc, pageUrl = '', seller = null) {
  const offers = [];
  const pageExpansion = flat(tipOf(doc.querySelector('.product-attributes .expansion-symbol, a[href*="/Expansions/"].expansion-symbol')))
    || expansionFromUrl(pageUrl);
  const pageName = flat(doc.querySelector('h1')?.childNodes?.[0]?.textContent || doc.querySelector('h1')?.textContent);

  for (const row of doc.querySelectorAll('.article-row')) {
    const idMatch = (row.id || '').match(/(\d+)/);
    if (!idMatch) continue;
    const sellerLink = row.querySelector('.seller-name a[href*="/Users/"]');
    if (!sellerLink && !seller) continue; // own stock rows and table headers have no seller
    const sellerName = sellerLink ? flat(sellerLink.textContent) : seller.seller;

    const locEl = tipsIn(row, '.seller-name ').find((e) => /location/i.test(tipOf(e)));
    const countryName = locEl ? tipOf(locEl).replace(/^.*?:\s*/, '') : seller?.countryName || '';
    const country = countryByName(countryName);

    const ratingEl = row.querySelector('[class*="fonticon-seller-rating-"]');
    const ratingKey = ((ratingEl?.className || '').match(/fonticon-seller-rating-([a-z-]+)/) || [])[1] || 'none';
    const sellCountEl = row.querySelector('.sell-count');
    const sales = parseInt(flat(sellCountEl?.textContent).replace(/\D/g, ''), 10) || seller?.sales || 0;
    const rating = ratingEl || !seller ? RATINGS[ratingKey] ?? 0 : seller.rating;

    const attrs = row.querySelector('.product-attributes') || row;
    const condition = conditionByCode(flat(attrs.querySelector('.article-condition .badge, .article-condition')?.textContent))?.id || 0;
    const tips = tipsIn(attrs).map(tipOf);
    const language = tips.map(languageByName).find(Boolean)?.id || 0;
    const isFoil = tips.some((t) => /^(reverse holo|foil|holo)/i.test(t)) || tipsIn(attrs, '.st_SpecialIcon').some((e) => /foil/i.test(tipOf(e)));
    const isSigned = tips.some((t) => /^signed/i.test(t));
    const isAltered = tips.some((t) => /^altered/i.test(t));

    const expEl = attrs.querySelector('.expansion-symbol');
    const productLink = row.querySelector('a[href*="/Products/Singles/"]');
    const productUrl = productLink?.getAttribute('href') || pageUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
    const expansion = flat(tipOf(expEl)) || expansionFromUrl(productLink?.getAttribute('href')) || (seller ? '' : pageExpansion);
    const name = seller ? flat(productLink?.textContent) : pageName;

    // The price is the first .color-primary that holds digits: a row can
    // open with an icon carrying the same class (the "only tracked shipping"
    // check mark), which an earlier version read as the price.
    const priceBox = row.querySelector('.price-container') || row;
    const priceEl = [...priceBox.querySelectorAll('.color-primary')].find((e) => /\d/.test(e.textContent));
    const listed = parsePrice(priceEl?.textContent);
    // For buyers outside the EU, professional sellers' prices can exclude the
    // VAT Cardmarket adds, shown as a note ("You have to pay an additional
    // 8.1% VAT"); count it in, whatever the rate.
    const vatNote = tipsIn(priceBox).map(tipOf).find((t) => /VAT/i.test(t)) || '';
    const vat = Number((vatNote.match(/(\d+(?:[.,]\d+)?)\s*%/) || [])[1]?.replace(',', '.')) || 0;
    const price = Math.round(listed * (1 + vat / 100) * 100) / 100;
    const trackedOnly = tipsIn(priceBox).some((e) => /only.*tracked shipping/i.test(tipOf(e).replace(/<[^>]+>/g, '')));
    if (!(price > 0)) continue;
    const available = parseInt(flat(row.querySelector('.amount-container .item-count')?.textContent), 10) || 1;

    const comment = flat(row.querySelector('.product-comments, .d-block.text-truncate')?.textContent);

    // The add-to-cart form is replayed later, so keep its fields as-is.
    const form = row.querySelector('form[data-ajax-action*="ShoppingCart"]');
    const cartForm = form ? {
      action: form.getAttribute('data-ajax-action'),
      fields: [...form.querySelectorAll('input[name]')].map((i) => [i.getAttribute('name'), i.getAttribute('value') || '']),
    } : null;
    const cartModal = row.querySelector('a[data-modal*="ShoppingCart"]')?.getAttribute('data-modal') || '';
    // A seller who does not ship to the buyer's country: the row says so in a
    // tooltip or its own text (exact wording not seen live yet, so loose).
    const offerText = [flat(row.querySelector('.col-offer')?.textContent), ...tipsIn(row.querySelector('.col-offer') || row).map(tipOf)].join(' | ');
    const noShip = /(does ?n[o']t|not|no longer|cannot be) (ship|deliver)|not (available|shipp\w*) (to|in) your country|kein(en)? versand|versendet nicht|n'exp[ée]die pas/i.test(offerText);

    offers.push({
      id: idMatch[1], seller: sellerName, sellerUrl: sellerLink?.getAttribute('href') || seller?.sellerUrl || '',
      countryId: country?.id || 0, countryName, countryCode: country?.code || '',
      rating, sales,
      condition, language, isFoil, isSigned, isAltered,
      expansion, productUrl, name,
      price, listedPrice: listed, vat, trackedOnly, noShip, available, comment, cartForm, cartModal,
      pageUrl: pageUrl.replace(/^https?:\/\/[^/]+/, ''), // where the row (and its cart button) is
    });
  }
  return offers;
}

// On a card (any printing) page, the printings link to product pages. Keep
// only links whose slug starts with the card's own, so "related products"
// and navigation are left out, and pair each with its "from" price if shown.
export function parseVersionLinks(doc, cardUrl) {
  const slug = (String(cardUrl).match(/\/Cards\/([^/?#]+)/) || [])[1] || '';
  const out = new Map();
  for (const a of doc.querySelectorAll('a[href*="/Products/Singles/"]')) {
    const href = (a.getAttribute('href') || '').replace(/[?#].*$/, '');
    const last = href.split('/').pop() || '';
    if (slug && !last.toLowerCase().startsWith(slug.toLowerCase())) continue;
    if (out.has(href)) continue;
    const container = a.closest('tr, .row, li') || a.parentElement;
    const priceText = [...(container?.querySelectorAll('.color-primary, td, span') || [])]
      .map((e) => e.textContent).find((t) => /\d[.,]\d{2}\s*€|€\s*\d/.test(t || ''));
    out.set(href, { url: href, expansion: expansionFromUrl(href) || tipOf(container?.querySelector('.expansion-symbol')), fromPrice: parsePrice(priceText) || Infinity });
  }
  return [...out.values()];
}

// Did the page hold back offers? Cardmarket lists the cheapest batch and
// loads the rest on request. Its exact markup for that could not be checked
// live, so look for any "load / show more" control, and treat a page with a
// full-looking batch of rows as cut off too.
export const FULL_BATCH = 50;
export function isTruncated(doc) {
  const rows = doc.querySelectorAll('.article-row').length;
  if (rows >= FULL_BATCH) return true;
  if (doc.querySelector('#loadMore, #loadMoreButton, .load-more, [id*="loadMore" i], [class*="loadMore" i], [data-ajax-action*="LoadMore" i], [onclick*="loadMore" i]')) return true;
  return [...doc.querySelectorAll('button, a.btn, a[role="button"]')]
    .some((b) => /^(show|load)\s+more|more results|mehr (anzeigen|laden)|weitere (anzeigen|laden)/i.test(flat(b.textContent)));
}

export function cartCount(doc) {
  const el = doc.querySelector('#cart .badge, .shopping-cart .badge, a[href*="ShoppingCart"] .badge');
  return parseInt(flat(el?.textContent), 10) || 0;
}

// On a seller's offers page, the filter form has a wants-list picker. Find
// its parameter name from the option whose value is the list's id, instead
// of guessing it; null if the page has no such picker.
export function wantsFilterParam(doc, listId) {
  for (const sel of doc.querySelectorAll('select[name]')) {
    if ([...sel.options || sel.querySelectorAll('option')].some((o) => String(o.getAttribute('value')) === String(listId))) {
      return sel.getAttribute('name');
    }
  }
  return null;
}

export function isWantsFilterApplied(doc, param, listId) {
  const sel = doc.querySelector(`select[name="${param}"]`);
  const opt = sel && [...sel.querySelectorAll('option')].find((o) => String(o.getAttribute('value')) === String(listId));
  return !!opt && (opt.hasAttribute('selected') || sel.value === String(listId));
}
