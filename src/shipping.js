import { COUNTRIES, defaultShipping } from './constants.js';
import { SHIPPING_COUNTRIES, SHIPPING_LISTS, SHIPPING_MATRIX } from './shipping-data.js';

// Shipping estimate for one parcel from one seller.
// tiers: [{ maxCards, maxValue, price }]; the cheapest that fits is used, and
// the most expensive tier is the fallback when none fits.
export function tierCost(tiers, cards, value) {
  if (cards <= 0) return 0;
  let best = Infinity;
  let fallback = 0;
  for (const t of tiers) {
    fallback = Math.max(fallback, t.price);
    if (cards <= t.maxCards && value <= t.maxValue + 1e-9 && t.price < best) best = t.price;
  }
  return best === Infinity ? fallback : best;
}

export function tiersFor(shipping, countryCode) {
  return (shipping && (shipping[countryCode] || shipping.default)) || [];
}

// "maxCards maxValue price [tracked]" per line, e.g. "17 25 2.10" or "224 100 4.88 tracked".
export function parseTiers(text) {
  return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[\s;]+/);
    const [maxCards, maxValue, price] = parts.slice(0, 3).map((x) => Number(String(x).replace(',', '.')));
    return { maxCards, maxValue, price, ...(/^t/i.test(parts[3] || '') ? { tracked: true } : {}) };
  }).filter((t) => [t.maxCards, t.maxValue, t.price].every(Number.isFinite));
}

export const formatTiers = (tiers) => tiers.map((t) => `${t.maxCards} ${t.maxValue} ${t.price}${t.tracked ? ' tracked' : ''}`).join('\n');

// Cardmarket's published shipping costs to a buyer's country, by seller
// country code (scraped, see scripts/scrape-shipping.mjs). "default", for a
// seller country the table does not have: the country whose cheapest
// 17-card letter is the median one.
export function publishedShipping(homeCode) {
  const home = COUNTRIES.find((c) => c.code === homeCode);
  const to = home ? SHIPPING_COUNTRIES.indexOf(home.id) : -1;
  if (to < 0) return null;
  const out = {};
  for (const c of COUNTRIES) {
    const from = SHIPPING_COUNTRIES.indexOf(c.id);
    const rows = from >= 0 ? SHIPPING_LISTS[SHIPPING_MATRIX[from][to]] : null;
    if (rows) out[c.code] = rows.map(([maxCards, maxValue, price, tracked]) => ({ maxCards, maxValue, price, ...(tracked ? { tracked: true } : {}) }));
  }
  const codes = Object.keys(out).sort((a, b) => tierCost(out[a], 17, 20) - tierCost(out[b], 17, 20));
  if (!codes.length) return null;
  out.default = out[codes[Math.floor(codes.length / 2)]];
  return out;
}
// The tiers in use: Cardmarket's published ones to the buyer's country (or
// rough estimates without a table for it), with the user's own edits on top.
export const shippingFor = (homeCode, overrides = {}) => ({ ...(publishedShipping(homeCode) || defaultShipping(homeCode)), ...overrides });
export const sameTiers = (a, b) => formatTiers(a || []) === formatTiers(b || []);

// A seller who ships only tracked (marked on its offers) can use only the
// tracked tiers: marked as such (Cardmarket's published ones), or else
// those allowing more than 25 EUR, above which Cardmarket requires tracking.
export const TRACKED_ABOVE = 25;
export function sellerTiers(shipping, offer) {
  const tiers = tiersFor(shipping, offer.countryCode);
  if (!offer.trackedOnly) return tiers;
  const marked = tiers.some((t) => t.tracked);
  const tracked = tiers.filter((t) => (marked ? t.tracked : t.maxValue > TRACKED_ABOVE));
  return tracked.length ? tracked : tiers;
}

// The VAT Cardmarket adds to the whole order (cards and shipping) for
// sellers whose prices carry the VAT note: the multiplier for shipping.
export const shippingVat = (offer) => 1 + (Number(offer?.vat) || 0) / 100;
