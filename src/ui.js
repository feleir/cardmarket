// The overlay panel: settings, progress and results. Rendered into a shadow
// root so Cardmarket's styles and ours cannot interfere. Built for a phone
// screen first; on desktop it is a side panel.
import { COUNTRIES, CONDITIONS, LANGUAGES, DEFAULT_SETTINGS, DEFAULT_EXCLUDED_EXPANSIONS, OLD_EXCLUDED_EXPANSIONS, OLD_CH_TIERS, BUILT_IN_TIERS } from './constants.js';
import { SHIPPING_SCRAPED } from './shipping-data.js';
import { parseWantsOverview } from './parse.js';
import { formatTiers, parseTiers, publishedShipping, shippingFor, sameTiers } from './shipping.js';
import { Fetcher, BlockedError, StoppedError } from './net.js';
import { loadWantsList, collectOffers, toEnglish, pickSellersToScan, scanSellers, shouldScanSellers, findCard, deckWants, collectDeck } from './collect.js';
import { parseDecklist } from './deck.js';
import { planExtra } from './extra.js';
import { loadHighs, solveWith } from './exact.js';
import { planOptions } from './options.js';
import { optimize, printingOf } from './optimizer.js';
import { addAll, cartLog, siteCartCode, leftovers } from './cart.js';

const KEY = 'cmopt:settings';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') + ' €' : '–');
const condCode = (id) => CONDITIONS.find((c) => c.id === id)?.code || '';
const langName = (id) => LANGUAGES.find((l) => l.id === id)?.name || '';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      if (OLD_EXCLUDED_EXPANSIONS.includes(s.excludeExpansions)) s.excludeExpansions = DEFAULT_EXCLUDED_EXPANSIONS;
      if (s.delayMs === 1200) s.delayMs = DEFAULT_SETTINGS.delayMs; // the old default, before Cardmarket's browser checks
      // Settings from before the home country setting: Swiss if they bought
      // from Switzerland (the tiers then were Swiss), otherwise not set.
      if (s.homeCountry === undefined) s.homeCountry = (s.sellerCountries || []).includes(4) ? 'CH' : '';
      // Before version 2, saved shipping held every tier, built-in ones
      // included; keep only the user's edits, so Cardmarket's published
      // prices apply everywhere else.
      const edits = (sh) => Object.fromEntries(Object.entries(sh || {}).filter(([, tiers]) => {
        const prices = (tiers || []).map((t) => t.price).join();
        return !BUILT_IN_TIERS.some((b) => sameTiers(b, tiers)) && !OLD_CH_TIERS.some((old) => old.join() === prices);
      }));
      if (!(s.v >= 2)) {
        s.shipping = edits(s.shipping);
        s.shippingByHome = Object.fromEntries(Object.entries(s.shippingByHome || {}).map(([k, v]) => [k, edits(v)]));
        s.v = 2;
      }
      return { ...DEFAULT_SETTINGS, ...s };
    }
  } catch { /* fall through */ }
  return structuredClone(DEFAULT_SETTINGS);
}
const saveSettings = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };

const game = () => location.pathname.split('/').filter(Boolean)[1] || 'Magic';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; overflow: hidden; z-index: 2147483000; display: flex; justify-content: flex-end; background: rgba(0,0,0,.35);
  font: 15px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); }
.panel { color: var(--fg); --bg:#fff; --fg:#1b1f24; --muted:#5d6670; --line:#e3e6ea; --card:#f6f7f9; --accent:#0a6cff; --ok:#137a3a; --warn:#a35a00;
  background: var(--bg); width: 100%; max-width: 560px; height: 100%; display: flex; flex-direction: column; box-shadow: -4px 0 24px rgba(0,0,0,.2); }
@media (prefers-color-scheme: dark) { .panel { --bg:#16191d; --fg:#e8eaed; --muted:#9aa3ad; --line:#2c3238; --card:#1f2328; --accent:#5b9dff; --ok:#4cc47a; --warn:#e3a04a; } }
header { display:flex; align-items:center; gap:8px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
header h1 { font-size: 17px; margin: 0; flex: 1; }
nav { display:flex; border-bottom:1px solid var(--line); }
nav button { flex:1; padding: 12px 4px; background:none; border:0; border-bottom: 3px solid transparent; color: var(--muted); font: inherit; }
nav button.on { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
main { flex:1; overflow-y:auto; overflow-x:hidden; padding: 12px 16px 96px; -webkit-overflow-scrolling: touch; }
section { margin-bottom: 18px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 8px; }
label { display:block; margin: 8px 0 4px; }
select, input[type=number], input[type=text], textarea { width:100%; max-width:100%; min-width:0; font: inherit; padding: 10px; border-radius: 8px; border:1px solid var(--line); background: var(--card); color: var(--fg); }
textarea { min-height: 72px; font-family: ui-monospace, monospace; font-size: 13px; }
.row { display:flex; gap: 8px; } .row > * { flex:1; min-width:0; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { border:1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 14px; }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius: 10px; padding: 12px 16px; font: inherit; font-weight:600; background: var(--accent); color:#fff; text-decoration:none; }
.btn.sec { background: var(--card); color: var(--fg); border:1px solid var(--line); }
.btn.sm { padding: 7px 10px; font-size: 13px; border-radius: 8px; }
.btn[disabled] { opacity:.5; }
.x { background:none; border:0; font-size: 26px; color: var(--muted); padding: 0 6px; }
.bar { position: absolute; left:0; right:0; bottom:0; padding: 12px 16px; background: var(--bg); border-top:1px solid var(--line); display:flex; gap:8px; }
.bar .btn { flex:1; }
.panel { position: relative; }
.muted { color: var(--muted); font-size: 13px; }
.card { background: var(--card); border:1px solid var(--line); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
.opts { width:100%; border-collapse: collapse; margin-top: 6px; }
.opts td, .opts th { padding: 6px 4px 0; text-align:left; }
.opts tr.note td { padding-top: 0; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-size: 12px; }
.opts tr.on td { font-weight: 600; }
.sum { display:grid; grid-template-columns: 1fr auto; gap: 4px 12px; }
.sum b { text-align:right; }
.big { font-size: 22px; font-weight: 700; }
.ok { color: var(--ok); } .warn { color: var(--warn); }
.item { display:flex; gap:8px; align-items:flex-start; padding: 8px 0; border-top:1px solid var(--line); }
.item:first-of-type { border-top:0; }
.item .t { flex:1; min-width:0; } .item .t a { color: var(--fg); }
.item .p { text-align:right; white-space:nowrap; }
.progress { height: 8px; background: var(--card); border-radius: 4px; overflow:hidden; border:1px solid var(--line); }
.progress > div { height:100%; background: var(--accent); width:0; transition: width .2s; }
.log { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; color: var(--muted); max-height: 45vh; overflow:auto; }
details summary { padding: 6px 0; cursor: pointer; font-weight: 600; }
a { color: var(--accent); }
`;

export function mount() {
  const existing = document.getElementById('cmopt-root');
  if (existing) { existing.style.display = existing.style.display === 'none' ? '' : 'none'; return; }

  const rootEl = document.createElement('div');
  rootEl.id = 'cmopt-root';
  document.body.appendChild(rootEl);
  const shadow = rootEl.attachShadow({ mode: 'open' });

  const st = {
    settings: loadSettings(),
    tab: 'setup',
    lists: [],
    listUrl: '',
    wants: null,
    result: null,
    running: false,
    progress: 0,
    log: [],
    countryFilter: '',
    fetcher: null,
    cartState: new Map(),
    extra: { query: '', qty: 4, busy: false, msg: '', plan: null, want: null },
    options: null,      // other carts to choose from: [{ kind, result }]
    optionsBusy: false,
    optionsRun: 0,
    replanning: false,
    printCost: new Map(), // "card#|choice" -> change in the total vs. the cart shown (null: cannot supply)
    printRun: 0,
    cartMsg: null,
    adding: false,
  };

  const here = location.pathname.match(/\/Wants\/(\d+)/);
  if (here) st.listUrl = toEnglish(location.pathname.replace(/(\/Wants\/\d+).*$/, '$1'));

  shadow.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="panel">
    <header><h1>Cardmarket Optimizer</h1><button class="x" data-act="close" aria-label="Close">×</button></header>
    <nav></nav><main></main><div class="bar"></div></div></div>`;
  const $ = (sel) => shadow.querySelector(sel);
  const wrap = $('.wrap');
  // Pin the overlay to what is actually on screen. If the page underneath is
  // wider than the phone, mobile browsers widen the layout viewport and a
  // plain inset:0 overlay would spill off the right edge.
  const fit = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    Object.assign(wrap.style, { left: `${vv.offsetLeft}px`, top: `${vv.offsetTop}px`, width: `${vv.width}px`, height: `${vv.height}px`, right: 'auto', bottom: 'auto' });
  };
  fit();
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) rootEl.style.display = 'none'; });

  const log = (msg) => {
    st.log.push(msg);
    if (st.log.length > 300) st.log.shift();
    const el = shadow.querySelector('.log');
    if (el) { el.textContent = st.log.join('\n'); el.scrollTop = el.scrollHeight; }
  };
  const setProgress = (p, label) => {
    st.progress = p;
    const bar = shadow.querySelector('.progress > div');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    const l = shadow.querySelector('.plabel');
    if (l && label != null) l.textContent = label;
  };
  const update = (patch) => { Object.assign(st.settings, patch); saveSettings(st.settings); };

  // ---------- views ----------
  function viewWantsPicker() {
    return `<select data-k="list">${st.lists.length ? '' : `<option value="${esc(st.listUrl)}">${st.listUrl ? 'This wants list' : 'Loading lists…'}</option>`}
        ${st.lists.map((l) => `<option value="${esc(l.url)}" ${l.url === st.listUrl ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
      ${st.wants ? `<p class="muted">${st.wants.length} entries loaded${st.wants.some((w) => w.offers) ? ', offers fetched' : ''}.</p>` : ''}`;
  }

  // Decklist mode: paste a list exported from a deck site.
  function viewDeck(s) {
    const entries = parseDecklist(s.deckText, { includeSideboard: s.deckSideboard, skipBasics: s.deckSkipBasics });
    return `<textarea id="cmopt-deck" data-k="deckText" style="min-height:160px" placeholder="Paste a decklist, e.g.&#10;4 Lightning Bolt&#10;4 Goblin Guide (ZEN)&#10;&#10;Sideboard&#10;2 Duress">${esc(s.deckText)}</textarea>
      <label><input type="checkbox" data-k="deckSideboard" ${s.deckSideboard ? 'checked' : ''}> Include the sideboard</label>
      <label><input type="checkbox" data-k="deckSkipBasics" ${s.deckSkipBasics ? 'checked' : ''}> Skip basic lands</label>
      <p class="muted">${entries.length ? `${entries.length} different cards, ${entries.reduce((n, e) => n + e.quantity, 0)} in total. ` : ''}Any printing of each card, with your filters below. Export the list as text from Moxfield, Archidekt, MTGGoldfish, MTGTop8, Arena or MTGO.</p>`;
  }

  function viewSetup() {
    const s = st.settings;
    const sel = new Set(s.sellerCountries);
    const q = st.countryFilter.toLowerCase();
    const countries = [...COUNTRIES].sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.name.localeCompare(b.name))
      .filter((c) => !q || sel.has(c.id) || c.name.toLowerCase().includes(q));
    const home = COUNTRIES.find((c) => c.code === s.homeCountry);
    const published = publishedShipping(s.homeCountry);
    const eff = shippingFor(s.homeCountry, s.shipping);
    const shipCodes = ['default', ...new Set([...(home ? [home.code] : []), ...COUNTRIES.filter((c) => sel.has(c.id)).map((c) => c.code)])];
    return `
    <section><h2>What to buy</h2>
      <div class="chips" style="margin-bottom:10px">
        <button class="chip ${s.source !== 'deck' ? 'on' : ''}" data-source="wants">A wants list</button>
        <button class="chip ${s.source === 'deck' ? 'on' : ''}" data-source="deck">A decklist</button>
      </div>
      ${s.source === 'deck' ? viewDeck(s) : viewWantsPicker()}
    </section>
    <section><h2>You live in</h2>
      <select data-k="homeCountry">
        <option value="">Choose your country…</option>
        ${[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.code}" ${s.homeCountry === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <p class="${home ? 'muted' : 'warn'}">${home ? 'Shipping estimates are for parcels to ' + esc(home.name) + '. Each country you pick keeps its own tiers (Setup → Shipping estimates).' : 'Pick your country: shipping costs depend on where the parcels go.'}</p>
    </section>
    <section><h2>Seller countries (allow list)</h2>
      <input type="text" placeholder="Filter countries…" data-k="countryFilter" value="${esc(st.countryFilter)}">
      <div class="chips" style="margin-top:8px">${countries.map((c) => `<button class="chip ${sel.has(c.id) ? 'on' : ''}" data-country="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <p class="muted">${sel.size ? `${sel.size} selected — only these sellers are considered.` : 'None selected — sellers from every country are considered.'}
        ${home && !(sel.size === 1 && sel.has(home.id)) ? ` <button class="btn sm sec" data-act="onlyHome">Only ${esc(home.name)}</button>` : ''}</p>
    </section>
    <section><h2>Cards</h2>
      <label>Languages (overrides the wants list)</label>
      <div class="chips">${LANGUAGES.map((l) => `<button class="chip ${s.languages.includes(l.id) ? 'on' : ''}" data-lang="${l.id}">${esc(l.name)}</button>`).join('')}</div>
      <div class="row">
        <div><label>Minimum condition</label><select data-k="minCondition">
          <option value="0">As in wants list</option>
          ${CONDITIONS.map((c) => `<option value="${c.id}" ${s.minCondition === c.id ? 'selected' : ''}>${c.code} – ${c.name} or better</option>`).join('')}
        </select></div>
        <div><label>Foil</label><select data-k="foil">
          ${[['want', 'As in wants list'], ['N', 'Non-foil only'], ['Y', 'Foil only'], ['any', 'Either']].map(([v, t]) => `<option value="${v}" ${s.foil === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      </div>
      <label><input type="checkbox" data-k="anyPrinting" ${s.anyPrinting ? 'checked' : ''}> Any printing: ignore the expansion in the wants list and also look at every other printing of each card</label>
      ${s.anyPrinting ? `<label>Prefer the printing on the wants list unless another saves more than (€ per copy)</label>
        <input type="number" min="0" step="0.1" data-k="printingPremium" value="${s.printingPremium}">
        <p class="muted">0 = no preference, just the cheapest. Prices and totals stay real; this only steers the choice.</p>` : ''}
      <label><input type="checkbox" data-k="samePrinting" ${s.samePrinting ? 'checked' : ''}> Keep all copies of a card in one printing</label>
      ${s.samePrinting ? `<label>…unless mixing printings saves more than (€ per card)</label>
        <input type="number" min="0" step="0.5" data-k="mixPremium" value="${s.mixPremium}">
        <p class="muted">For cards whose copies can come from several printings (any printing, decklists, wants for any expansion).</p>` : ''}
      <details><summary>Printings / expansions</summary>
        <label>For "any printing" wants, check at most this many printings</label>
        <input type="number" min="1" max="60" data-k="maxVersions" value="${s.maxVersions}">
        <label>Never buy from expansions containing (one per line)</label>
        <textarea data-k="excludeExpansions">${esc(s.excludeExpansions)}</textarea>
      </details>
    </section>
    <section><h2>Sellers</h2>
      <div class="row">
        <div><label>Minimum rating</label><select data-k="minRating">
          ${[[0, 'Any'], [2, 'Average+'], [3, 'Good+'], [4, 'Very good+'], [5, 'Outstanding']].map(([v, t]) => `<option value="${v}" ${s.minRating === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div><label>Seller type</label><select data-k="sellerTypes">
          ${[['', 'All'], ['0', 'Private only'], ['1,2', 'Professional + Powerseller'], ['2', 'Powerseller only']].map(([v, t]) => `<option value="${v}" ${s.sellerTypes.join(',') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      </div>
      <label><input type="checkbox" data-k="allowUnrated" ${s.allowUnrated ? 'checked' : ''}> Allow new sellers without a rating</label>
      <label>Never buy from (usernames, one per line)</label>
      <textarea data-k="excludeSellers">${esc(s.excludeSellers)}</textarea>
    </section>
    <section><h2>Optimizer</h2>
      <div class="row">
        <div><label>Max sellers (0 = any)</label><input type="number" min="0" data-k="maxSellers" value="${s.maxSellers}"></div>
        <div><label>Extra cost per seller €</label><input type="number" min="0" step="0.1" data-k="sellerPenalty" value="${s.sellerPenalty}"></div>
      </div>
      <p class="muted">"Extra cost per seller" makes the optimizer prefer fewer parcels unless splitting saves more than that amount.</p>
      <div class="row">
        <div><label>Seller scan</label><select data-k="scanMode">
          ${[['auto', 'Auto'], ['always', 'Always'], ['off', 'Off']].map(([v, t]) => `<option value="${v}" ${s.scanMode === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div><label>Sellers to scan</label><input type="number" min="1" max="50" data-k="scanSellers" value="${s.scanSellers}"></div>
      </div>
      <p class="muted">Card pages show the cheapest offers first and hold the rest back. <b>Auto</b> reads the top sellers' whole stock (filtered by your wants list) only when some card page was cut off, so sellers hidden there are not missed. If every page showed all its offers, the card scan is already complete and this is skipped.</p>
      <label><input type="checkbox" data-k="exact" ${s.exact ? 'checked' : ''}> Exact solver — proves the cheapest cart (downloads ≈3.5 MB once)</label>
      <details><summary>Shipping estimates</summary>
        <label><input type="checkbox" data-k="vatInParcelValue" ${s.vatInParcelValue ? 'checked' : ''}> Count added VAT toward the 25 € tracked-shipping limit</label>
        <p class="muted">For countries where Cardmarket adds VAT on top of some sellers' prices (their offers carry a VAT note). Off (as Cardmarket does it): a parcel's value is the sellers' prices before that VAT. Enter the tiers below before VAT; for those sellers, VAT is added to their shipping too, as on Cardmarket.</p>
        <p class="muted">${published
          ? `Cardmarket's published shipping costs to ${esc(home.name)} (help.cardmarket.com, ${esc(SHIPPING_SCRAPED)}). Card counts come from the letter weights (20 g: 4 cards, 50 g: 17, 100 g: 40). Edit a country's tiers to use your own; they then win over the published ones.`
          : `${home ? `No published table for ${esc(home.name)}: rough estimates. ` : 'Pick your country to use Cardmarket\'s published prices. '}Check real prices on Cardmarket's Shipping Costs help page, or in your cart.`}</p>
        <p class="muted">One tier per line: <code>maxCards maxValue€ price€ [tracked]</code>. The cheapest tier that fits is used.</p>
        ${Object.keys(s.shipping || {}).length ? '<p><button class="btn sm sec" data-act="resetShipping">Use Cardmarket\'s prices again (drop my edits)</button></p>' : ''}
        ${shipCodes.map((code) => `<label>${code === 'default' ? 'Any other country' : `From ${esc(COUNTRIES.find((c) => c.code === code).name)}${code === s.homeCountry ? ' (within your country)' : ''}`}${s.shipping?.[code] ? ' · your edit' : ''}</label>
          <textarea data-ship="${code}">${esc(formatTiers(eff[code] || eff.default))}</textarea>`).join('')}
      </details>
      <details><summary>Advanced</summary>
        <div class="row">
          <div><label>Delay between pages (ms)</label><input type="number" min="300" step="100" data-k="delayMs" value="${s.delayMs}"></div>
          <div><label>Optimizer time (ms)</label><input type="number" min="200" step="500" data-k="timeBudgetMs" value="${s.timeBudgetMs}"></div>
        </div>
        <label>Exact solver time limit (ms)</label><input type="number" min="1000" step="1000" data-k="exactTimeMs" value="${s.exactTimeMs}">
        <label>Keep fetched offers for (minutes)</label><input type="number" min="0" data-k="cacheMinutes" value="${s.cacheMinutes}">
        <p><button class="btn sec sm" data-act="clearCache">Clear fetched offers</button>
           <button class="btn sec sm" data-act="reset">Reset settings</button></p>
      </details>
    </section>`;
  }

  function viewRun() {
    return `<section><div class="progress"><div style="width:${Math.round(st.progress * 100)}%"></div></div>
      <p class="plabel muted">${st.running ? 'Working…' : 'Idle'}</p></section>
      <section><div class="log">${esc(st.log.join('\n'))}</div></section>
      ${st.wants ? `<section><button class="btn sec" data-act="debug">Copy debug report</button>
        <p class="muted">Copies what the tool saw on Cardmarket (page structure, filters used; no login data) so a reading problem can be fixed.</p>
        <textarea id="cmopt-debug" readonly hidden></textarea></section>` : ''}`;
  }

  // Why this copy and not the cheaper one: what moving the copies there would
  // do to the total (card prices, plus shipping on both sides).
  function switchNote(it) {
    const w = it.switch;
    if (!w) return '';
    const n = w.moved > 1 ? `${w.moved} copies` : 'it';
    const parts = [`cards ${money(-w.cardsSaved)}`];
    if (!w.inCart) parts.push(`new parcel from ${esc(w.seller)} ${money(w.shippingThere)}`);
    else if (w.shippingThere > 0.005) parts.push(`${esc(w.seller)}'s parcel goes up a shipping step +${money(w.shippingThere)}`);
    if (w.shippingHere < -0.005) parts.push(`this parcel gets ${money(-w.shippingHere)} cheaper`);
    if (Math.abs(w.preference || 0) > 0.005) parts.push(`printing preference ${w.preference > 0 ? '+' : ''}${money(w.preference)}`);
    const head = `Cheaper: ${money(w.price)} at ${esc(w.seller)}. Taking ${n} there: ${parts.join(', ')}`;
    if (w.delta < -0.005) {
      return `<div class="warn">${head} = saves ${money(-w.delta)}${w.overCap ? ', but that would exceed your max sellers' : ' (missed saving)'}.</div>`;
    }
    return `<div class="muted">${head} = ${w.delta < 0.005 ? 'same total' : `+${money(w.delta)} overall`}, so it stays here.</div>`;
  }

  // The best single seller for all copies of this card, and what that would
  // change in the total.
  function oneSellerNote(it) {
    const a = it.allFromOne;
    if (!a || a.copies < 2) return '';
    const what = `All ${a.copies} from ${esc(a.seller)}${a.inCart ? ' (already in the cart)' : ''}`;
    if (a.delta < -0.005) return `<div class="warn">${what}: saves ${money(-a.delta)} (missed saving).</div>`;
    return `<div class="muted">${what}: ${a.delta < 0.005 ? 'same total' : `+${money(a.delta)} overall`}, shipping and VAT included.</div>`;
  }

  function cartButton(it, gi, ii) {
    const state = st.cartState.get(it.offer.id);
    if (state === 'added') return '<span class="ok">In cart ✓</span>';
    if (state === 'unconfirmed') return `<a class="warn" href="/en/${esc(game())}/ShoppingCart" target="_blank" rel="noopener">Sent · check cart</a>`;
    if (state === 'failed') return `<a class="warn" href="${esc(it.offer.productUrl)}" target="_blank" rel="noopener">Not added · open</a>`;
    return `<button class="btn sm sec" data-add="${gi}:${ii}">Add</button>`;
  }

  // "Add a card": the cheapest way to add copies of one more card to this
  // cart, next to a full re-plan with it.
  function viewExtra() {
    const x = st.extra;
    const p = x.plan;
    const line = (i) => `<div class="item"><div class="t">${i.quantity}× ${esc(i.want.name)} <span class="muted">· ${esc(i.offer.expansion)} · ${esc(langName(i.offer.language))} · ${esc(condCode(i.offer.condition))}</span>
        <div class="muted">${esc(i.seller)}: ${i.joins ? `joins their parcel (${i.shippingDelta > 0.005 ? `+${money(i.shippingDelta)} shipping, next step` : 'no extra shipping'})` : `new parcel +${money(i.shippingDelta)}`}</div></div>
        <div class="p">${money(i.offer.price)}</div></div>`;
    const changed = p ? p.replan.result.groups.filter((g) => !st.result.groups.some((h) => h.seller === g.seller)).length : 0;
    return `<div class="card"><b>Add a card</b>
      <div class="row" style="margin-top:8px">
        <input type="text" id="cmopt-extra-q" data-x="query" placeholder="Card name, e.g. Tinder Wall" value="${esc(x.query)}">
        <input type="number" id="cmopt-extra-n" data-x="qty" min="1" max="40" value="${x.qty}" style="max-width:80px">
      </div>
      <p><button class="btn sm" data-act="findExtra" ${x.busy ? 'disabled' : ''}>${x.busy ? 'Looking…' : 'Find the best way'}</button></p>
      ${x.msg ? `<p class="muted">${esc(x.msg)}</p>` : ''}
      ${p ? `
        <p><b>Add to this cart: +${money(p.fit.cost)}</b></p>
        ${p.fit.items.map(line).join('')}
        ${p.fit.missing ? `<p class="warn">${p.fit.missing} cop${p.fit.missing > 1 ? 'ies' : 'y'} could not be found with your filters.</p>` : ''}
        <p><button class="btn sm" data-act="addExtra">Put these in the Cardmarket cart</button> <button class="btn sm sec" data-act="keepExtra">Keep in the plan</button></p>
        <p style="margin-top:12px"><b>Or re-plan everything: +${money(p.replan.cost)}</b>
          ${p.replan.cost < p.fit.cost - 0.005 ? `<span class="ok">${money(p.fit.cost - p.replan.cost)} cheaper, but ${changed ? `${changed} new seller(s) and ` : ''}other items move.</span>` : '<span class="muted">no cheaper than adding to this cart.</span>'}</p>
        ${p.replan.cost < p.fit.cost - 0.005 ? '<p><button class="btn sm sec" data-act="useReplan">Use the re-planned cart</button></p>' : ''}` : ''}
    </div>`;
  }

  async function findExtra() {
    const x = st.extra;
    const q = x.query.trim();
    if (!q || !st.result) return;
    x.busy = true; x.msg = ''; x.plan = null; render();
    try {
      const s = st.settings;
      const fetcher = st.fetcher ||= new Fetcher({ onWait: log });
      fetcher.delayMs = s.delayMs; fetcher.stopped = false;
      const card = await findCard(fetcher, q, game());
      if (!card) throw new Error(`Could not find "${q}" on Cardmarket. Try the exact card name, or paste its Cardmarket link.`);
      const want = { idWant: `extra:${Date.now()}`, name: card.name, url: card.url, kind: /\/Cards\//.test(card.url) ? 'card' : 'product',
        quantity: Math.max(1, x.qty | 0), languages: [], minCondition: 0, flags: {}, maxPrice: 0, expansion: '' };
      await collectOffers(fetcher, [want], s);
      if (!want.offers.length) throw new Error(`No offers for ${card.name} with your filters (countries, condition, language).`);
      x.want = want;
      x.plan = planExtra(st.result, solveWants(), want, optOptions());
      const planned = st.result.groups.flatMap((g) => g.items).filter((it) => it.want.name === card.name).reduce((n, it) => n + it.quantity, 0);
      x.msg = `${card.name}: ${want.offers.length} offer(s) found.${planned ? ` The plan already buys ${planned}; these ${want.quantity} come on top.` : ''}`;
    } catch (e) {
      x.msg = e instanceof BlockedError ? e.message : e.message || String(e);
    }
    x.busy = false;
    render();
  }

  // A card's printings among its offers: [{ key, name, from, copies }], cheapest first.
  function printingsOf(w) {
    const by = new Map();
    for (const o of w.offers || []) {
      if (!(o.price > 0)) continue;
      const key = printingOf(o);
      const p = by.get(key) || { key, name: o.expansion || 'Unknown printing', from: Infinity, copies: 0 };
      p.from = Math.min(p.from, o.price);
      p.copies += Math.max(1, o.available | 0);
      by.set(key, p);
    }
    return [...by.values()].sort((a, b) => a.from - b.from);
  }

  // A printing choice's text, with how the total would change when known.
  function choiceLabel(w, i, choice, p) {
    const base = !choice ? (st.settings.samePrinting ? 'As in Setup (one printing unless mixing saves enough)' : 'As in Setup (cheapest, may mix)')
      : choice === 'mix' ? 'Cheapest, printings may mix' : choice === 'same' ? 'One printing, whichever is cheapest'
      : `${p.name} · from ${money(p.from)} · ${p.copies} cop${p.copies === 1 ? 'y' : 'ies'}`;
    if (p && p.copies < w.quantity) return `${base} (not enough)`;
    if (!st.printCost.has(`${i}|${choice}`)) return base;
    const d = st.printCost.get(`${i}|${choice}`);
    if (d == null) return `${base} · can't supply all`;
    return `${base} · ${Math.abs(d) < 0.005 ? '±0,00 €' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}`;
  }

  // For every printing choice of every card: the total of a cart with that
  // choice, re-planned briefly from the cart shown. In the background, mixed
  // cards first; each finished card updates its menu in place.
  async function findPrintCosts() {
    const run = ++st.printRun;
    st.printCost = new Map();
    const base = st.result;
    if (!base || !st.wants) return;
    const all = solveWants();
    const idx = new Map(all.map((w, k) => [w.idWant || w.name, k]));
    // The cart shown, as a warm start: picks[want] = [{ id, count }].
    const picks = all.map(() => []);
    for (const g of base.groups) for (const it of g.items) {
      const k = idx.get(it.want.idWant || it.want.name);
      if (k != null) picks[k].push({ id: it.offer.id, count: it.quantity });
    }
    const opts = { ...optOptions(), timeBudgetMs: 150 };
    const missingOf = (r) => r.missing.reduce((n, m) => n + m.count, 0);
    const need = missingOf(base);
    const cards = st.wants.map((w, i) => ({ w, i, k: idx.get(w.idWant || w.name), ps: printingsOf(w) }))
      .filter((x) => x.k != null && x.ps.length > 1)
      .sort((a, b) => (base.mixed || []).some((m) => m.name === b.w.name) - (base.mixed || []).some((m) => m.name === a.w.name));
    for (const { w, i, k, ps } of cards) {
      const choices = [...(w.printingChoice ? [''] : []), 'mix', 'same', ...ps.filter((p) => p.copies >= w.quantity).map((p) => `p:${p.key}`)];
      for (const c of choices) {
        await new Promise((r) => setTimeout(r, 0));
        if (run !== st.printRun) return;
        const wants = all.map((x, j) => {
          if (j !== k) return x;
          if (c === '') return w;
          if (c === 'mix') return { ...x, mixPenalty: 0 };
          if (c === 'same') return { ...x, mixPenalty: 1000 };
          return { ...x, offers: w.offers.filter((o) => printingOf(o) === c.slice(2)) };
        });
        const warm = picks.map((l, j) => (j === k ? [] : l));
        const r = optimize(wants, { ...opts, warmStart: warm });
        st.printCost.set(`${i}|${c}`, missingOf(r) > need ? null : Math.round((r.total - base.total) * 100) / 100);
      }
      // Update this card's menu without re-rendering (an open menu stays open).
      const sel = shadow.querySelector(`select[data-printing="${i}"]`);
      if (sel) for (const o of sel.options) {
        const p = o.value.startsWith('p:') ? ps.find((x) => `p:${x.key}` === o.value) : null;
        o.textContent = choiceLabel(w, i, o.value, p);
      }
    }
  }

  function viewPrintings() {
    const r = st.result;
    const keyOf = (w) => w.idWant || w.name;
    // What this cart buys of each card, per printing.
    const bought = new Map();
    for (const g of r.groups) for (const it of g.items) {
      const m = bought.get(keyOf(it.want)) || new Map();
      const n = it.offer.expansion || 'Unknown printing';
      m.set(n, (m.get(n) || 0) + it.quantity);
      bought.set(keyOf(it.want), m);
    }
    const cards = (st.wants || []).map((w, i) => ({ w, i, ps: printingsOf(w), got: bought.get(keyOf(w)) || new Map() }))
      .filter((x) => x.ps.length > 1);
    if (!cards.length) return '';
    const mixedN = cards.filter((x) => x.got.size > 1).length;
    cards.sort((a, b) => (b.got.size > 1) - (a.got.size > 1) || !!b.w.printingChoice - !!a.w.printingChoice);
    return `<details class="card" ${mixedN || cards.some((x) => x.w.printingChoice) ? 'open' : ''}>
      <summary><b>Printings</b> · ${cards.length} card(s) on offer in several printings${mixedN ? `, <span class="warn">${mixedN} mixed in this cart</span>` : ''}</summary>
      <p class="muted">Per card: the cheapest mix, one printing (whichever makes the cart cheapest), or a printing you choose. Each choice shows about how the total would change from this cart, shipping included. Choosing re-plans the cart from the offers already loaded.</p>
      ${st.replanning ? '<p class="muted">Re-planning…</p>' : ''}
      ${cards.map(({ w, i, ps, got }) => `<div class="item"><div class="t">
        <b>${w.quantity}× ${esc(w.name)}</b>${got.size > 1 ? ' <span class="warn">mixed</span>' : ''}
        <div class="muted">In this cart: ${got.size ? [...got].map(([n, k]) => `${k}× ${esc(n)}`).join(', ') : 'none'}</div>
        <select data-printing="${i}" ${st.replanning ? 'disabled' : ''}>
          <option value="">${esc(choiceLabel(w, i, ''))}</option>
          <option value="mix" ${w.printingChoice === 'mix' ? 'selected' : ''}>${esc(choiceLabel(w, i, 'mix'))}</option>
          <option value="same" ${w.printingChoice === 'same' ? 'selected' : ''}>${esc(choiceLabel(w, i, 'same'))}</option>
          ${ps.map((p) => `<option value="p:${esc(p.key)}" ${w.printingChoice === `p:${p.key}` ? 'selected' : ''}>${esc(choiceLabel(w, i, `p:${p.key}`, p))}</option>`).join('')}
        </select></div></div>`).join('')}
    </details>`;
  }

  function viewOptions() {
    if (st.optionsBusy) return '<div class="card"><b>Other options</b><p class="muted">Working out carts with fewer parcels…</p></div>';
    const rows = st.options;
    if (!rows) return '';
    if (rows.length < 2 && rows[0].result.groups.length < 2) return '';
    if (rows.length < 2) return '<div class="card"><b>Other options</b><p class="muted">No cart with fewer parcels can supply every card, and none is worth showing beside this one.</p></div>';
    const base = rows[0].result;
    const noteOf = (row) => {
      const r = row.result;
      const notes = [];
      if (row.kind === 'best') notes.push('cheapest');
      if (row.kind === 'matched') notes.push('one printing per card');
      if (r.mixed?.length) notes.push(`${r.mixed.length} card(s) in mixed printings`);
      if (r.exact === 'Optimal') notes.push('proven optimal');
      return notes.join(' · ');
    };
    return `<div class="card"><b>Other options</b>
      <p class="muted">The best cart for each number of parcels, from the offers already loaded. Fewer parcels can be worth a little more: less to track, fewer ratings to leave.</p>
      <table class="opts"><tr><th>Parcels</th><th>Total</th><th>vs. cheapest</th><th></th></tr>
      ${rows.map((row, i) => {
        const r = row.result;
        const d = r.total - base.total;
        const on = st.result === r;
        return `<tr class="${on ? 'on' : ''}"><td>${r.groups.length}</td><td><b>${money(r.total)}</b></td>
          <td>${i === 0 ? '—' : `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}`}</td>
          <td>${on ? '<span class="ok">Showing</span>' : `<button class="btn sm" data-option="${i}">Use</button>`}</td></tr>
          <tr class="note"><td colspan="4" class="muted">${esc(noteOf(row))}</td></tr>`;
      }).join('')}</table></div>`;
  }

  // The same card on the list more than once: each entry is bought.
  function viewDuplicates() {
    const by = new Map();
    for (const w of st.wants || []) {
      const k = w.name.toLowerCase();
      by.set(k, [...(by.get(k) || []), w]);
    }
    const dup = [...by.values()].filter((l) => l.length > 1);
    if (!dup.length) return '';
    return `<div class="card"><p class="warn">On your list more than once, and bought for every entry:</p>
      ${dup.map((l) => `<div class="muted">${esc(l[0].name)}: ${l.map((w) => `${w.quantity}${w.expansion ? ` (${esc(w.expansion)})` : ''}`).join(' + ')} = ${l.reduce((n, w) => n + w.quantity, 0)}</div>`).join('')}</div>`;
  }

  // Adding this plan would double cards an earlier plan left in the cart.
  function viewCartWarn() {
    const x = st.cartWarn;
    if (!x) return '';
    const plan = new Map();
    for (const g of st.result.groups) for (const it of g.items) plan.set(it.want.name, (plan.get(it.want.name) || 0) + it.quantity);
    const extra = new Map();
    for (const e of x.left) extra.set(e.name, (extra.get(e.name) || 0) + e.quantity);
    return `<div class="card"><p class="warn"><b>Your cart already has copies of these cards from an earlier plan:</b></p>
      ${x.left.map((e) => `<div class="muted">${e.quantity}× ${esc(e.name)} · ${esc(e.seller)}</div>`).join('')}
      <p>Adding this plan as well would buy ${[...extra].map(([n, k]) => `${plan.get(n) + k}× ${esc(n)} (this plan: ${plan.get(n)})`).join(', ')}.</p>
      <p><a href="/en/${esc(game())}/ShoppingCart" target="_blank" rel="noopener">Open the cart</a> and remove them, then add again. Or:</p>
      <p><button class="btn sm sec" data-act="cancelWarn">Cancel</button> <button class="btn sm" data-act="addForce">Add anyway</button></p></div>`;
  }

  function viewResults() {
    const r = st.result;
    if (!r) return '<p class="muted">Run the optimizer first.</p>';
    const saved = r.baseline.total - r.total;
    const missing = r.missing.reduce((n, m) => n + m.count, 0);
    return `
    ${viewCartWarn()}
    ${viewDuplicates()}
    ${st.cartMsg ? `<div class="card"><p class="${st.cartMsg.ok ? 'ok' : 'warn'}">${esc(st.cartMsg.text)}</p>
      <p><a href="/en/${esc(game())}/ShoppingCart">Open the Cardmarket cart</a> to check items and the real shipping.</p>
      ${st.failedSellers?.length ? `<p class="muted">Not added from: ${st.failedSellers.map(esc).join(', ')}. A seller that does not ship to you cannot be added.</p>
        <p><button class="btn sm" data-act="excludeFailed">Leave out ${st.failedSellers.length > 1 ? 'these sellers' : esc(st.failedSellers[0])} and re-plan</button></p>` : ''}</div>` : ''}
    <div class="card">
      <div class="sum">
        <span>Total (estimated)</span><b class="big">${money(r.total)}</b>
        <span>Cards</span><b>${money(r.itemsCost)}</b>
        <span>Shipping (est.)</span><b>${money(r.shippingCost)}</b>
        <span>Sellers / parcels</span><b>${r.groups.length}</b>
        <span>Cheapest-per-card instead</span><b>${money(r.baseline.total)} · ${r.baseline.sellers} sellers</b>
      </div>
      ${saved > 0.005 ? `<p class="ok">Saves about ${money(saved)} vs. picking the cheapest copy of each card${r.itemsCost > r.baseline.itemsCost + 0.005
        ? `: pays ${money(r.itemsCost - r.baseline.itemsCost)} more for cards to save ${money(r.baseline.shippingCost - r.shippingCost)} on shipping (${r.baseline.sellers - r.groups.length} fewer parcels)` : ''}.</p>` : ''}
      ${r.exact === 'Optimal' ? '<p class="ok">Proven optimal by the exact solver: no cheaper cart exists for these offers and shipping tiers.</p>'
        : r.exact ? '<p class="muted">Checked with the exact solver (stopped at its time limit; may not be the very best).</p>' : ''}
      ${missing ? `<p class="warn">${missing} card(s) could not be found with your filters (see bottom).</p>` : ''}
      <p class="muted">${r.stats.offersConsidered} offers from ${r.stats.sellersConsidered} sellers · ${r.stats.restarts} searches in ${r.stats.ms} ms</p>
      <p><button class="btn sec sm" data-act="cartData">Copy cart data</button> <span class="muted">to check a result that looks wrong</span></p>
      <textarea id="cmopt-cartdata" readonly hidden></textarea>
    </div>
    <div id="cmopt-options">${viewOptions()}</div>
    ${viewPrintings()}
    ${viewExtra()}
    ${r.groups.map((g, gi) => `
      <div class="card">
        <div class="row" style="align-items:center">
          <div><b><a href="${esc(g.info.sellerUrl)}" target="_blank" rel="noopener">${esc(g.seller)}</a></b>
            <div class="muted">${esc(g.info.countryName)} · ${'★'.repeat(g.info.rating) || 'new'} · ${g.cards} card(s)${g.info.trackedOnly ? ' · ships tracked only' : ''}</div></div>
          <div style="text-align:right"><b>${money(g.value + g.shipping)}</b><div class="muted">${money(g.value)} + ~${money(g.shipping)}</div></div>
        </div>
        ${g.items.map((it, ii) => `<div class="item">
          <div class="t"><a href="${esc(it.offer.productUrl)}" target="_blank" rel="noopener">${it.quantity}× ${esc(it.want.name)}</a>
            <div class="muted">${esc(it.offer.expansion)} · ${esc(langName(it.offer.language))} · ${esc(condCode(it.offer.condition))}${it.offer.isFoil ? ' · Foil' : ''}${it.offer.otherPrinting ? ` · <b>other printing</b> (list: ${esc(it.want.expansion)})` : ''}${it.offer.vat ? ` · incl. ${it.offer.vat}% VAT` : ''}${it.offer.comment ? ' · ' + esc(it.offer.comment) : ''}</div>
            ${switchNote(it)}${oneSellerNote(it)}</div>
          <div class="p">${money(it.offer.price)}<br>${cartButton(it, gi, ii)}</div>
        </div>`).join('')}
        <p><button class="btn sm" data-addseller="${gi}">Add all from ${esc(g.seller)}</button></p>
      </div>`).join('')}
    ${st.cartMsg && !st.cartMsg.ok ? '<p><button class="btn sec sm" data-act="debug">Copy debug report</button></p><textarea id="cmopt-debug" readonly hidden></textarea>' : ''}
    ${r.missing.length ? `<div class="card"><b>Not found</b>${r.missing.map((m) => `<div class="item"><div class="t">${m.count}× <a href="${esc(m.want.url)}" target="_blank" rel="noopener">${esc(m.want.name)}</a></div></div>`).join('')}</div>` : ''}
    <p class="muted">Shipping is an estimate from your tiers; the cart shows Cardmarket's real figure. Prices can change between fetching and buying.</p>`;
  }

  function render() {
    $('nav').innerHTML = [['setup', 'Setup'], ['run', 'Progress'], ['results', 'Results']]
      .map(([k, t]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${t}</button>`).join('');
    $('main').innerHTML = st.tab === 'setup' ? viewSetup() : st.tab === 'run' ? viewRun() : viewResults();
    const bar = $('.bar');
    if (st.running) bar.innerHTML = '<button class="btn sec" data-act="stop">Stop</button>';
    else if (st.tab === 'results' && st.result) {
      bar.innerHTML = `<button class="btn sec" data-act="copy">Copy list</button><button class="btn" data-act="addAll">Add all to cart</button>`;
    } else {
      bar.innerHTML = '<button class="btn" data-act="run">Fetch offers & optimize</button>';
    }
  }

  // ---------- actions ----------
  async function run() {
    const deckMode = st.settings.source === 'deck';
    const deck = deckMode ? parseDecklist(st.settings.deckText, { includeSideboard: st.settings.deckSideboard, skipBasics: st.settings.deckSkipBasics }) : [];
    if (deckMode && !deck.length) { st.log = ['Paste a decklist first (Setup → What to buy).']; st.tab = 'run'; render(); return; }
    if (!deckMode && !st.listUrl) { st.log = ['Pick a wants list first.']; st.tab = 'run'; render(); return; }
    st.running = true; st.tab = 'run'; st.log = []; st.progress = 0;
    if (!st.settings.homeCountry) st.log.push('Tip: pick your country under Setup → "You live in", so the shipping estimates fit where the parcels go.');
    render();
    const s = st.settings;
    // One fetcher for the whole session keeps its in-memory cache, so a
    // second run after tweaking settings only fetches pages it has not seen.
    const fetcher = st.fetcher ||= new Fetcher({ onWait: log });
    fetcher.delayMs = s.delayMs;
    fetcher.ttl = s.cacheMinutes * 60000;
    fetcher.stopped = false;
    fetcher.requests = 0;
    try {
      let wants;
      const progress = (i, n, w) => {
        setProgress(i / n, w ? `${i + 1}/${n} · ${w.name}` : 'Optimizing…');
        if (i > 0) log(describeWant(wants[i - 1]));
      };
      if (deckMode) {
        wants = deckWants(deck, game());
        log(`Decklist: ${wants.length} different cards, ${wants.reduce((n, w) => n + w.quantity, 0)} in total.`);
        st.wants = wants;
        await collectDeck(fetcher, wants, s, game(), progress, log);
      } else {
        log('Reading wants list…');
        wants = await loadWantsList(fetcher, st.listUrl, log);
        if (!wants.length) throw new Error('The wants list looks empty (or the page layout changed).');
        log(`${wants.length} entries, ${wants.reduce((n, w) => n + w.quantity, 0)} cards.`);
        st.wants = wants;
        await collectOffers(fetcher, wants, s, progress);
      }
      if (wants.every((w) => !w.offers.length)) log('⚠ No card got any offers. Tap "Copy debug report" below and send it, so the page reading can be fixed.');
      const opts = optOptions();
      // The seller scan filters sellers' stock by a Cardmarket wants list,
      // which a pasted deck does not have.
      const scan = deckMode ? { run: false, reason: 'deck' } : shouldScanSellers(wants, s.scanMode || 'auto');
      if (scan.reason === 'deck' && wants.some((w) => w.truncated)) log('Some card pages held back offers. The seller scan needs a Cardmarket wants list: import the deck into one (Wants → Add decklist) to use it.');
      if (scan.reason === 'complete') log('Every card page showed all its offers: seller scan not needed.');
      if (scan.reason === 'truncated') log(`${scan.cut} card page(s) held back offers: scanning sellers for hidden copies.`);
      if (scan.run && s.scanSellers > 0) {
        // A quick first cart says which sellers matter; their full stock
        // matching the wants list may hold copies the card pages did not show.
        const first = optimize(wants, { ...opts, timeBudgetMs: Math.min(1000, s.timeBudgetMs) });
        const picks = pickSellersToScan(wants, first.groups.map((g) => g.seller), s.scanSellers);
        const listId = (st.listUrl.match(/\/Wants\/(\d+)/) || [])[1];
        setProgress(0.95, `Scanning ${picks.length} sellers' stock for your other cards…`);
        log(`Scanning the stock of ${picks.length} sellers for more of your cards…`);
        const { added, diag: scanDiag } = await scanSellers(fetcher, wants, listId, picks, s, log);
        st.scanDiag = scanDiag;
        log(`Seller scan added ${added} offer(s).`);
      }
      log(`Fetched ${fetcher.requests} page(s).`);
      await reoptimize();
    } catch (e) {
      if (e instanceof StoppedError) log('Stopped. Pages fetched so far are cached; run again to continue.');
      else if (e instanceof BlockedError) log('⚠ ' + e.message);
      else { log('Error: ' + e.message); console.error(e); }
      st.running = false;
      render();
    }
  }

  // One log line per card; for a card left with no offers, say whether the
  // page had none or they were filtered out, and by what.
  function describeWant(w) {
    const n = w.offers.length;
    if (n || !w.diag) return `${w.name}: ${n} offer(s)`;
    const d = w.diag;
    const rows = d.pages.reduce((a, p) => a + (p.rows || 0), 0);
    const parsed = d.pages.reduce((a, p) => a + (p.parsed || 0), 0);
    const why = Object.entries(d.rejected).map(([k, v]) => `${v} ${k}`).join(', ');
    const parts = [`${d.pages.length} page(s)`, `${rows} offer rows`, `${parsed} read`];
    if (why) parts.push(`removed: ${why}`);
    if (d.versions) parts.push(`${d.versions} printings listed`);
    if (d.pages.some((p) => p.missing)) parts.push('a page was not found');
    return `${w.name}: 0 offer(s) (${parts.join(', ')})`;
  }

  // Everything the optimizer saw, compact: enough to rerun this exact case
  // (with the exact solver) and see why it bundled as it did.
  function cartData() {
    const s = st.settings;
    const r = st.result;
    // Compact so it fits in one chat message: sellers listed once, and per
    // card its 12 cheapest offers plus every offer from a seller in the cart.
    const inCart = new Set((r?.groups || []).map((g) => g.seller));
    const sellers = [];
    const si = new Map();
    const sellerIndex = (o) => {
      if (!si.has(o.seller)) { si.set(o.seller, sellers.length); sellers.push([o.seller, o.countryCode, o.trackedOnly ? 1 : 0, o.vat || 0]); }
      if (o.trackedOnly) sellers[si.get(o.seller)][2] = 1;
      if (o.vat) sellers[si.get(o.seller)][3] = o.vat;
      return si.get(o.seller);
    };
    const chosen = new Map();
    for (const g of r?.groups || []) for (const it of g.items) chosen.set(it.offer.id, it.quantity);
    const wants = (st.wants || []).map((w) => {
      const sorted = [...(w.offers || [])].sort((a, b) => a.price - b.price);
      const keep = sorted.filter((o, i) => i < 12 || inCart.has(o.seller) || chosen.has(o.id));
      // Printings: names listed once per card, an index on each offer.
      const ps = [...new Set(keep.map((o) => o.expansion || ''))];
      const many = ps.length > 1;
      const row = [w.name, w.quantity, keep.map((o) => {
        const r = [sellerIndex(o), o.price, o.available];
        if (chosen.has(o.id) || many) r.push(chosen.get(o.id) || 0);
        if (many) r.push(ps.indexOf(o.expansion || ''));
        return r;
      })];
      if (many || w.printingChoice) row.push(many ? ps : [], w.printingChoice || '');
      return row;
    });
    return JSON.stringify({
      tool: 'cmopt-cart2', mix: s.samePrinting ? Number(s.mixPremium) || 0 : 0, at: new Date().toISOString().slice(0, 16),
      home: s.homeCountry,
      shipping: { ...Object.fromEntries(Object.entries(shippingFor(s.homeCountry, s.shipping)).filter(([code]) => code === 'default' || sellers.some((x) => x[1] === code))), ...(s.sellerPenalty ? { penalty: s.sellerPenalty } : {}), ...(s.maxSellers ? { maxSellers: s.maxSellers } : {}) },
      total: r?.total, exact: r?.exact || '',
      sellers, // [name, country, tracked only, VAT %]
      wants, // [name, quantity, [[seller#, price, available, bought?, printing#?]], printings?, choice?]
    });
  }

  function debugReport() {
    const s = st.settings;
    const wants = st.wants || [];
    const empty = wants.find((w) => w.diag && !w.offers?.length);
    const pick = (w) => w && { name: w.name, url: w.url, kind: w.kind, quantity: w.quantity, languages: w.languages, minCondition: w.minCondition, flags: w.flags, maxPrice: w.maxPrice, expansion: w.expansion };
    return JSON.stringify({
      tool: 'cmopt', at: new Date().toISOString(), page: location.pathname, ua: navigator.userAgent,
      settings: { source: s.source, homeCountry: s.homeCountry, sellerCountries: s.sellerCountries, languages: s.languages, minCondition: s.minCondition, foil: s.foil, anyPrinting: s.anyPrinting, minRating: s.minRating, allowUnrated: s.allowUnrated, sellerTypes: s.sellerTypes, scanMode: s.scanMode, exact: s.exact, delayMs: s.delayMs },
      wants: wants.length, withOffers: wants.filter((w) => w.offers?.length).length, notFound: wants.filter((w) => w.notFound).map((w) => w.name),
      firstWants: wants.slice(0, 3).map(pick),
      wantsRowHtml: wants[0]?.rowHtml,
      emptyCard: empty && { ...pick(empty), diag: empty.diag },
      unreadRow: wants.flatMap((w) => w.diag?.pages || []).find((p) => p?.unread)?.unread,
      unreadOffer: wants.flatMap((w) => w.diag?.pages || []).find((p) => p?.unread)?.unreadOffer,
      log: st.log.slice(-40),
      result: st.result && { total: st.result.total, shipping: st.result.shippingCost, exact: st.result.exact || '',
        groups: st.result.groups.map((g) => ({ seller: g.seller, cards: g.cards, value: g.value, shipping: g.shipping, trackedOnly: !!g.info.trackedOnly,
          items: g.items.map((it) => `${it.quantity}x ${it.want.name} ${it.offer.price}${it.offer.vat ? ` (incl ${it.offer.vat}% VAT)` : ''}${it.allFromOne ? ` | all from ${it.allFromOne.seller}: ${it.allFromOne.delta}` : ''}`) })) },
      cart: cartLog.slice(-14),
      siteCart: st.cartMsg && !st.cartMsg.ok ? siteCartCode() : undefined,
      sellerScan: st.scanDiag,
    }, null, 1);
  }

  const optOptions = () => {
    const s = st.settings;
    return { shipping: shippingFor(s.homeCountry, s.shipping), sellerPenalty: s.sellerPenalty, maxSellers: s.maxSellers, timeBudgetMs: s.timeBudgetMs,
      printingPremium: s.anyPrinting ? s.printingPremium : 0, vatInParcelValue: !!s.vatInParcelValue,
      mixPenalty: s.samePrinting ? Number(s.mixPremium) || 0 : 0 };
  };

  // One cart: the exact solver's answer (when on) refined by the heuristic.
  async function solve(wants, opts, { exactMs = st.settings.exactTimeMs, quiet = false } = {}) {
    const s = st.settings;
    let exactStatus = '';
    const o = { ...opts };
    if (s.exact) {
      try {
        if (!quiet) {
          setProgress(0.97, 'Loading exact solver…');
          log('Loading exact solver (≈3.5 MB, cached by the browser after the first time)…');
        }
        const highs = await loadHighs();
        if (!quiet) setProgress(0.98, 'Solving exactly…');
        await new Promise((r) => setTimeout(r, 50)); // let the label paint before the solver blocks
        const t = Date.now();
        const ex = solveWith(highs, wants, { ...o, timeLimitMs: exactMs });
        if (ex) {
          o.warmStart = ex.picks;
          exactStatus = ex.status;
          if (!quiet) log(`Exact solver: ${ex.status === 'Optimal' ? 'proven optimal' : 'best found in time limit'} (${Date.now() - t} ms).`);
        }
      } catch (e) {
        if (!quiet) log('Exact solver unavailable here (' + (e.message || e) + '); using the heuristic only.');
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    const r = optimize(wants, o);
    r.exact = exactStatus;
    return r;
  }

  // The wants as the optimizer sees them, with each card's printing choice
  // from the Results screen: '' as in Setup, 'mix', 'same' or 'p:<printing>'.
  const solveWants = () => (st.wants || []).filter((w) => w.offers).map((w) => {
    const c = w.printingChoice || '';
    if (c === 'mix') return { ...w, mixPenalty: 0 };
    if (c === 'same') return { ...w, mixPenalty: 1000 };
    if (c.startsWith('p:')) return { ...w, offers: w.offers.filter((o) => printingOf(o) === c.slice(2)) };
    return w;
  });

  // Re-plan after a printing choice, from the offers already loaded.
  async function replan() {
    st.replanning = true;
    render();
    try {
      st.result = await solve(solveWants(), optOptions(), { quiet: true });
    } finally {
      st.replanning = false;
    }
    st.extra = { ...st.extra, plan: null, msg: '' };
    render();
    findOptions();
  }

  async function reoptimize() {
    st.result = await solve(solveWants(), optOptions());
    st.running = false;
    st.tab = 'results';
    render();
    findOptions();
  }

  // After the cheapest cart: the other carts worth choosing between, worked
  // out in the background from the offers already loaded.
  async function findOptions() {
    const run = ++st.optionsRun;
    st.printRun++;
    st.printCost = new Map();
    const best = st.result;
    st.options = null;
    st.optionsBusy = true;
    paintOptions();
    const wants = solveWants();
    const opts = { ...optOptions(), timeBudgetMs: Math.min(1500, st.settings.timeBudgetMs) };
    try {
      const rows = await planOptions(wants, opts, best,
        (w, o) => solve(w, o, { exactMs: Math.min(4000, st.settings.exactTimeMs), quiet: true }),
        { stopped: () => run !== st.optionsRun });
      if (run !== st.optionsRun) return;
      st.options = rows;
    } catch (e) {
      console.error(e);
      if (run === st.optionsRun) st.options = [];
    }
    st.optionsBusy = false;
    paintOptions();
    findPrintCosts();
  }
  const paintOptions = () => {
    const el = shadow.getElementById('cmopt-options');
    if (el) el.innerHTML = viewOptions();
  };

  function asText() {
    const r = st.result;
    const lines = [`Total ~${money(r.total)} (${money(r.itemsCost)} + shipping ~${money(r.shippingCost)})`, ''];
    for (const g of r.groups) {
      lines.push(`${g.seller} (${g.info.countryName}) — ${money(g.value)} + ~${money(g.shipping)}`);
      for (const it of g.items) lines.push(`  ${it.quantity}x ${it.want.name} [${it.offer.expansion}, ${langName(it.offer.language)}, ${condCode(it.offer.condition)}] ${money(it.offer.price)}`);
      lines.push('');
    }
    if (r.missing.length) lines.push('Not found:', ...r.missing.map((m) => `  ${m.count}x ${m.want.name}`));
    return lines.join('\n');
  }

  // Sends the items, then checks the cart; the result per article is kept
  // so the Results tab can mark what is in the cart and what is not.
  async function addItems(items, btn, { force = false } = {}) {
    if (st.adding) return;
    if (!force) {
      // Copies an earlier plan put in the cart, of cards this plan buys too.
      if (btn) { btn.disabled = true; btn.textContent = 'Checking the cart…'; }
      const left = await leftovers(st.result.groups.flatMap((g) => g.items));
      if (left.length) {
        st.cartWarn = { items, left };
        render();
        return;
      }
    }
    st.cartWarn = null;
    st.adding = true;
    let sent = 0;
    const label = (txt) => { if (btn && btn.isConnected) btn.textContent = txt; };
    if (btn) btn.disabled = true;
    try {
      const { added, failed, unconfirmed, check } = await addAll(items, (it, state) => {
        if (state === 'sent') label(`Sending ${++sent}/${items.length}…`);
        else if (state !== 'unknown') st.cartState.set(it.offer.id, state);
        if (sent === items.length) label('Checking the cart…');
      }, { pauseMs: st.settings.delayMs });
      // Sellers whose items could not be added: offered as a one-tap re-plan without them.
      st.failedSellers = check ? [] : [...new Set(failed.map((it) => it.offer.seller))];
      st.cartMsg = check
        ? { ok: false, text: `Cardmarket is showing its browser check ("Just a moment…"), so adding stopped${added.length ? ` after ${added.length} item(s)` : ''}. Open any Cardmarket page in this tab, wait until the check passes (tick the box if asked), then run cmopt and tap "Add all to cart" again. Items already in your cart stay there and are skipped.` }
        : failed.length
          ? { ok: false, text: `${added.length} of ${items.length} added to your cart. ${failed.length} could not be added; they are marked below with a link to the card.${unconfirmed.length
            ? ` ${unconfirmed.length} of them were sent to Cardmarket but the cart does not show them (yet): open the cart and check before adding them again, so nothing is bought twice.` : ''}` }
          : { ok: true, text: `All ${added.length} added to your cart.` };
    } catch (e) {
      st.cartMsg = { ok: false, text: 'Adding to the cart failed: ' + (e.message || e) };
    }
    st.adding = false;
    render();
  }

  shadow.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-tab]');
    if (!t) return;
    if (t.dataset.tab) { st.tab = t.dataset.tab; render(); return; }
    if (t.dataset.source) {
      update({ source: t.dataset.source });
      st.wants = null; st.result = null;
      render();
      return;
    }
    if (t.dataset.country) {
      const id = Number(t.dataset.country);
      const set = new Set(st.settings.sellerCountries);
      set.has(id) ? set.delete(id) : set.add(id);
      update({ sellerCountries: [...set] });
      render();
      return;
    }
    if (t.dataset.lang) {
      const id = Number(t.dataset.lang);
      const set = new Set(st.settings.languages);
      set.has(id) ? set.delete(id) : set.add(id);
      update({ languages: [...set] });
      render();
      return;
    }
    if (t.dataset.add) {
      const [gi, ii] = t.dataset.add.split(':').map(Number);
      await addItems([st.result.groups[gi].items[ii]], t);
      return;
    }
    if (t.dataset.option) {
      st.result = st.options[Number(t.dataset.option)].result;
      st.extra = { ...st.extra, plan: null, msg: '' };
      st.printCost = new Map();
      render();
      findPrintCosts();
      return;
    }
    if (t.dataset.addseller) { await addItems(st.result.groups[Number(t.dataset.addseller)].items, t); return; }
    switch (t.dataset.act) {
      case 'close': rootEl.style.display = 'none'; break;
      case 'run': run(); break;
      case 'stop': st.fetcher?.stop(); break;
      case 'addAll': await addItems(st.result.groups.flatMap((g) => g.items), t); break;
      case 'addForce': await addItems(st.cartWarn.items, t, { force: true }); break;
      case 'resetShipping': update({ shipping: {} }); render(); break;
      case 'onlyHome': {
        const home = COUNTRIES.find((c) => c.code === st.settings.homeCountry);
        if (home) update({ sellerCountries: [home.id] });
        render();
        break;
      }
      case 'cancelWarn': st.cartWarn = null; render(); break;
      case 'copy':
        try { await navigator.clipboard.writeText(asText()); t.textContent = 'Copied ✓'; } catch { prompt('Copy:', asText()); }
        break;
      case 'cartData': {
        const text = cartData();
        try {
          await navigator.clipboard.writeText(text);
          t.textContent = 'Copied ✓ — paste it in the chat';
        } catch {
          const ta = shadow.getElementById('cmopt-cartdata');
          ta.hidden = false;
          ta.value = text;
          ta.focus();
          ta.select();
          t.textContent = 'Selected — use Copy';
        }
        break;
      }
      case 'excludeFailed': {
        // Remember them in "Never buy from" and re-plan with the offers
        // already read (no new page loads).
        const drop = new Set(st.failedSellers.map((x) => x.toLowerCase()));
        const list = st.settings.excludeSellers.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        update({ excludeSellers: [...new Set([...list, ...st.failedSellers])].join('\n') });
        for (const w of st.wants || []) if (w.offers) w.offers = w.offers.filter((o) => !drop.has(o.seller.toLowerCase()));
        log(`Left out ${st.failedSellers.join(', ')} (added to "Never buy from" in Setup).`);
        st.failedSellers = [];
        st.cartMsg = null;
        await reoptimize();
        break;
      }
      case 'findExtra': await findExtra(); break;
      case 'addExtra': await addItems(st.extra.plan.fit.items, t); break;
      case 'keepExtra': {
        // The cart with the new copies added becomes the plan.
        st.wants.push(st.extra.want);
        st.result = st.extra.plan.fit.result;
        st.extra = { ...st.extra, plan: null, msg: `${st.extra.want.name} added to the plan.` };
        st.options = null; st.optionsRun++; // worked out without the new card
        render();
        findPrintCosts();
        break;
      }
      case 'useReplan': {
        st.wants.push(st.extra.want);
        st.result = st.extra.plan.replan.result;
        st.extra = { ...st.extra, plan: null, msg: `Re-planned with ${st.extra.want.name}. Items that moved need adding to the cart again.` };
        render();
        findOptions();
        break;
      }
      case 'debug': {
        const text = debugReport();
        try {
          await navigator.clipboard.writeText(text);
          t.textContent = 'Copied ✓ — paste it in the chat';
        } catch {
          const ta = shadow.getElementById('cmopt-debug');
          ta.hidden = false;
          ta.value = text;
          ta.focus();
          ta.select();
          t.textContent = 'Selected — use Copy';
        }
        break;
      }
      case 'clearCache': Fetcher.clearCache(); st.fetcher = null; st.wants = null; t.textContent = 'Cleared ✓'; break;
      case 'reset': {
        // Back to the defaults, but still living in the same country.
        const home = st.settings.homeCountry;
        st.settings = { ...structuredClone(DEFAULT_SETTINGS), homeCountry: home };
        saveSettings(st.settings); render(); break;
      }
      default:
    }
  });

  shadow.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.printing) {
      st.wants[Number(t.dataset.printing)].printingChoice = t.value;
      replan();
      return;
    }
    if (t.dataset.ship) {
      const tiers = parseTiers(t.value);
      if (tiers.length) {
        // Same as the published tiers: not an edit.
        const code = t.dataset.ship;
        const pub = (publishedShipping(st.settings.homeCountry) || {})[code];
        const shipping = { ...st.settings.shipping };
        if (pub && sameTiers(pub, tiers)) delete shipping[code]; else shipping[code] = tiers;
        update({ shipping });
        render();
      }
      return;
    }
    const k = t.dataset.k;
    if (!k || k === 'countryFilter') return;
    if (k === 'homeCountry') {
      // Each home country keeps its own tiers.
      const old = st.settings.homeCountry;
      const byHome = { ...(st.settings.shippingByHome || {}), [old || '_']: st.settings.shipping };
      update({ homeCountry: t.value, shippingByHome: byHome, shipping: byHome[t.value || '_'] || {} });
      render();
      return;
    }
    if (k === 'list') { st.listUrl = t.value; st.wants = null; st.result = null; render(); return; }
    if (k === 'sellerTypes') { update({ sellerTypes: t.value ? t.value.split(',').map(Number) : [] }); return; }
    if (t.type === 'checkbox') { update({ [k]: t.checked }); if (k === 'anyPrinting' || k === 'samePrinting' || k.startsWith('deck')) render(); }
    else if (k === 'deckText') { update({ deckText: t.value }); st.wants = null; render(); }
    else if (t.type === 'number' || ['minCondition', 'minRating'].includes(k)) update({ [k]: Number(t.value) || 0 });
    else update({ [k]: t.value });
  });
  shadow.addEventListener('input', (e) => {
    const xk = e.target.dataset?.x;
    if (xk) { st.extra[xk] = xk === 'qty' ? Number(e.target.value) || 1 : e.target.value; return; }
    if (e.target.dataset.k !== 'countryFilter') return;
    st.countryFilter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = shadow.querySelector('[data-k="countryFilter"]');
    input.focus();
    input.setSelectionRange(pos, pos);
  });

  render();

  // Discover the user's wants lists for the picker.
  (async () => {
    try {
      const f = new Fetcher({ delayMs: 0 });
      const doc = await f.doc(`/en/${game()}/Wants`);
      st.lists = doc ? parseWantsOverview(doc).map((l) => ({ ...l, url: toEnglish(l.url) })) : [];
      if (!st.listUrl && st.lists.length) st.listUrl = st.lists[0].url;
      if (st.listUrl && !st.lists.some((l) => l.url === st.listUrl)) st.lists.unshift({ name: 'This wants list', url: st.listUrl });
    } catch (e) {
      log('Could not load wants lists: ' + e.message);
    }
    if (st.tab === 'setup' && !st.running) render();
  })();
}
