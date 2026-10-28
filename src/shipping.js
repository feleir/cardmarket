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

// "maxCards maxValue price" per line, e.g. "17 25 2.10".
export function parseTiers(text) {
  return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [maxCards, maxValue, price] = l.split(/[\s;]+/).map((x) => Number(String(x).replace(',', '.')));
    return { maxCards, maxValue, price };
  }).filter((t) => [t.maxCards, t.maxValue, t.price].every(Number.isFinite));
}

export const formatTiers = (tiers) => tiers.map((t) => `${t.maxCards} ${t.maxValue} ${t.price}`).join('\n');

// Cardmarket requires tracked shipping above 25 EUR, so tiers allowing more
// value than that are the tracked ones. A seller who ships only tracked
// (marked on its offers) can use only those.
export const TRACKED_ABOVE = 25;
export function sellerTiers(shipping, offer) {
  const tiers = tiersFor(shipping, offer.countryCode);
  if (!offer.trackedOnly) return tiers;
  const tracked = tiers.filter((t) => t.maxValue > TRACKED_ABOVE);
  return tracked.length ? tracked : tiers;
}

// The VAT Cardmarket adds to the whole order (cards and shipping) for
// sellers whose prices carry the VAT note: the multiplier for shipping.
export const shippingVat = (offer) => 1 + (Number(offer?.vat) || 0) / 100;
