// Numeric ids as Cardmarket's own URL filters use them (sellerCountry,
// language, minCondition). Country ids skip 32 and 34, which name no country.
export const COUNTRIES = [
  [1, 'Austria', 'AT'], [2, 'Belgium', 'BE'], [3, 'Bulgaria', 'BG'],
  [4, 'Switzerland', 'CH'], [5, 'Cyprus', 'CY'], [6, 'Czech Republic', 'CZ'],
  [7, 'Germany', 'DE'], [8, 'Denmark', 'DK'], [9, 'Estonia', 'EE'],
  [10, 'Spain', 'ES'], [11, 'Finland', 'FI'], [12, 'France', 'FR'],
  [13, 'United Kingdom', 'GB'], [14, 'Greece', 'GR'], [15, 'Hungary', 'HU'],
  [16, 'Ireland', 'IE'], [17, 'Italy', 'IT'], [18, 'Liechtenstein', 'LI'],
  [19, 'Lithuania', 'LT'], [20, 'Luxembourg', 'LU'], [21, 'Latvia', 'LV'],
  [22, 'Malta', 'MT'], [23, 'Netherlands', 'NL'], [24, 'Norway', 'NO'],
  [25, 'Poland', 'PL'], [26, 'Portugal', 'PT'], [27, 'Romania', 'RO'],
  [28, 'Sweden', 'SE'], [29, 'Singapore', 'SG'], [30, 'Slovenia', 'SI'],
  [31, 'Slovakia', 'SK'], [33, 'Canada', 'CA'], [35, 'Croatia', 'HR'],
  [36, 'Japan', 'JP'], [37, 'Iceland', 'IS'],
].map(([id, name, code]) => ({ id, name, code }));

export const countryByName = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === n) || null;
};

export const LANGUAGES = [
  [1, 'English'], [2, 'French'], [3, 'German'], [4, 'Spanish'], [5, 'Italian'],
  [6, 'S-Chinese'], [7, 'Japanese'], [8, 'Portuguese'], [9, 'Russian'],
  [10, 'Korean'], [11, 'T-Chinese'],
].map(([id, name]) => ({ id, name }));

const LANGUAGE_ALIASES = {
  'simplified chinese': 6, 'chinese': 6, 's-chinese': 6,
  'traditional chinese': 11, 't-chinese': 11,
};

export const languageByName = (name) => {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  if (LANGUAGE_ALIASES[n]) return LANGUAGES.find((l) => l.id === LANGUAGE_ALIASES[n]);
  return LANGUAGES.find((l) => l.name.toLowerCase() === n) || null;
};

// Best first: minCondition=3 means "Excellent or better".
export const CONDITIONS = [
  [1, 'MT', 'Mint'], [2, 'NM', 'Near Mint'], [3, 'EX', 'Excellent'],
  [4, 'GD', 'Good'], [5, 'LP', 'Light Played'], [6, 'PL', 'Played'], [7, 'PO', 'Poor'],
].map(([id, code, name]) => ({ id, code, name }));

export const conditionByCode = (code) => {
  const c = String(code || '').trim().toUpperCase();
  return CONDITIONS.find((x) => x.code === c) || null;
};

// From the fonticon-seller-rating-* classes on offer rows.
export const RATINGS = {
  outstanding: 5, 'very-good': 4, good: 3, average: 2, bad: 1, none: 0,
};

// Shipping is estimated per seller from tiers: the cheapest tier whose card
// and value limits fit the parcel is used. Cardmarket makes tracked shipping
// mandatory above 25 EUR, which is why the untracked tiers stop there. The
// figures are estimates; the user can edit them per seller country.
export const DEFAULT_SHIPPING = {
  default: [
    { maxCards: 4, maxValue: 25, price: 1.4 },
    { maxCards: 17, maxValue: 25, price: 2.1 },
    { maxCards: 40, maxValue: 25, price: 3.2 },
    { maxCards: 40, maxValue: 250, price: 6.5 },
    { maxCards: 100000, maxValue: 100000, price: 12 },
  ],
  // Cheapest letter as Cardmarket shows it within Switzerland (user-confirmed);
  // the larger tiers are still estimates.
  CH: [
    { maxCards: 4, maxValue: 25, price: 1.83 },
    { maxCards: 17, maxValue: 25, price: 2.6 },
    { maxCards: 40, maxValue: 25, price: 3.6 },
    { maxCards: 40, maxValue: 250, price: 8.5 },
    { maxCards: 100000, maxValue: 100000, price: 11 },
  ],
};

// Printings that are not tournament-legal. Cardmarket names the World
// Championship decks "WCD <year>: <player>" (and the 1996 set "Pro Tour
// Collector Set"), so match those names, not only the long form.
export const DEFAULT_EXCLUDED_EXPANSIONS = "World Championship Decks\nWCD\nPro Tour Collector Set\nCollectors' Edition\nInternational Edition\nOversized\nArt Series";
// Defaults earlier versions saved into settings; replaced on load.
export const OLD_EXCLUDED_EXPANSIONS = ["World Championship Decks\nCollectors' Edition\nInternational Edition\nOversized\nArt Series"];

// Swiss tiers earlier versions saved into settings; replaced on load.
export const OLD_CH_TIERS = [[1.6, 2.6, 3.6, 8.5, 11]];

export const DEFAULT_SETTINGS = {
  sellerCountries: [4],
  languages: [],          // empty = use what each want says
  minCondition: 0,        // 0 = use what each want says
  foil: 'want',           // 'want' | 'Y' | 'N' | 'any'
  minRating: 0,           // 0..5, see RATINGS
  allowUnrated: true,
  sellerTypes: [],        // [] = all; 0 private, 1 professional, 2 powerseller
  excludeSellers: '',
  excludeExpansions: DEFAULT_EXCLUDED_EXPANSIONS,
  maxVersions: 12,
  maxSellers: 0,          // 0 = unlimited
  sellerPenalty: 0,       // extra cost per seller, to trade money for fewer parcels
  delayMs: 1200,
  timeBudgetMs: 3000,
  scanMode: 'auto',       // 'auto' (only if a card page was cut off) | 'always' | 'off'
  scanSellers: 10,        // sellers whose whole wants-matching stock is read
  exact: false,           // also run the exact solver (downloads ~3.5 MB once)
  exactTimeMs: 15000,
  cacheMinutes: 30,
  shipping: DEFAULT_SHIPPING,
};
