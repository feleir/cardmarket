// The overlay panel: settings, progress and results. Rendered into a shadow
// root so Cardmarket's styles and ours cannot interfere. Built for a phone
// screen first; on desktop it is a side panel.
import { COUNTRIES, CONDITIONS, LANGUAGES, DEFAULT_SETTINGS, DEFAULT_SHIPPING } from './constants.js';
import { parseWantsOverview } from './parse.js';
import { formatTiers, parseTiers } from './shipping.js';
import { Fetcher, BlockedError, StoppedError } from './net.js';
import { loadWantsList, collectOffers, toEnglish } from './collect.js';
import { optimize } from './optimizer.js';
import { addToCart, addAll } from './cart.js';

const KEY = 'cmopt:settings';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') + ' €' : '–');
const condCode = (id) => CONDITIONS.find((c) => c.id === id)?.code || '';
const langName = (id) => LANGUAGES.find((l) => l.id === id)?.name || '';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { ...DEFAULT_SETTINGS, ...s, shipping: { ...DEFAULT_SHIPPING, ...(s.shipping || {}) } };
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
.panel { --bg:#fff; --fg:#1b1f24; --muted:#5d6670; --line:#e3e6ea; --card:#f6f7f9; --accent:#0a6cff; --ok:#137a3a; --warn:#a35a00;
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
  function viewSetup() {
    const s = st.settings;
    const sel = new Set(s.sellerCountries);
    const q = st.countryFilter.toLowerCase();
    const countries = [...COUNTRIES].sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.name.localeCompare(b.name))
      .filter((c) => !q || sel.has(c.id) || c.name.toLowerCase().includes(q));
    const shipCodes = ['default', ...COUNTRIES.filter((c) => sel.has(c.id)).map((c) => c.code)];
    return `
    <section><h2>Wants list</h2>
      <select data-k="list">${st.lists.length ? '' : `<option value="${esc(st.listUrl)}">${st.listUrl ? 'This wants list' : 'Loading lists…'}</option>`}
        ${st.lists.map((l) => `<option value="${esc(l.url)}" ${l.url === st.listUrl ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
      ${st.wants ? `<p class="muted">${st.wants.length} entries loaded${st.wants.some((w) => w.offers) ? ', offers fetched' : ''}.</p>` : ''}
    </section>
    <section><h2>Seller countries (allow list)</h2>
      <input type="text" placeholder="Filter countries…" data-k="countryFilter" value="${esc(st.countryFilter)}">
      <div class="chips" style="margin-top:8px">${countries.map((c) => `<button class="chip ${sel.has(c.id) ? 'on' : ''}" data-country="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <p class="muted">${sel.size ? `${sel.size} selected — only these sellers are considered.` : 'None selected — sellers from every country are considered.'}</p>
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
      <details><summary>Shipping estimates</summary>
        <p class="muted">One tier per line: <code>maxCards maxValue€ price€</code>. The cheapest tier that fits is used. Check real prices for your country on Cardmarket's Shipping Costs help page.</p>
        ${shipCodes.map((code) => `<label>${code === 'default' ? 'Any other country' : `From ${esc(COUNTRIES.find((c) => c.code === code).name)}`}</label>
          <textarea data-ship="${code}">${esc(formatTiers(s.shipping[code] || s.shipping.default))}</textarea>`).join('')}
      </details>
      <details><summary>Advanced</summary>
        <div class="row">
          <div><label>Delay between pages (ms)</label><input type="number" min="300" step="100" data-k="delayMs" value="${s.delayMs}"></div>
          <div><label>Optimizer time (ms)</label><input type="number" min="200" step="500" data-k="timeBudgetMs" value="${s.timeBudgetMs}"></div>
        </div>
        <label>Keep fetched offers for (minutes)</label><input type="number" min="0" data-k="cacheMinutes" value="${s.cacheMinutes}">
        <p><button class="btn sec sm" data-act="clearCache">Clear fetched offers</button>
           <button class="btn sec sm" data-act="reset">Reset settings</button></p>
      </details>
    </section>`;
  }

  function viewRun() {
    return `<section><div class="progress"><div style="width:${Math.round(st.progress * 100)}%"></div></div>
      <p class="plabel muted">${st.running ? 'Working…' : 'Idle'}</p></section>
      <section><div class="log">${esc(st.log.join('\n'))}</div></section>`;
  }

  function viewResults() {
    const r = st.result;
    if (!r) return '<p class="muted">Run the optimizer first.</p>';
    const saved = r.baseline.total - r.total;
    const missing = r.missing.reduce((n, m) => n + m.count, 0);
    return `
    <div class="card">
      <div class="sum">
        <span>Total (estimated)</span><b class="big">${money(r.total)}</b>
        <span>Cards</span><b>${money(r.itemsCost)}</b>
        <span>Shipping (est.)</span><b>${money(r.shippingCost)}</b>
        <span>Sellers / parcels</span><b>${r.groups.length}</b>
        <span>Cheapest-per-card instead</span><b>${money(r.baseline.total)} · ${r.baseline.sellers} sellers</b>
      </div>
      ${saved > 0.005 ? `<p class="ok">Saves about ${money(saved)} vs. picking the cheapest copy of each card.</p>` : ''}
      ${missing ? `<p class="warn">${missing} card(s) could not be found with your filters (see bottom).</p>` : ''}
      <p class="muted">${r.stats.offersConsidered} offers from ${r.stats.sellersConsidered} sellers · ${r.stats.restarts} searches in ${r.stats.ms} ms</p>
    </div>
    ${r.groups.map((g, gi) => `
      <div class="card">
        <div class="row" style="align-items:center">
          <div><b><a href="${esc(g.info.sellerUrl)}" target="_blank" rel="noopener">${esc(g.seller)}</a></b>
            <div class="muted">${esc(g.info.countryName)} · ${'★'.repeat(g.info.rating) || 'new'} · ${g.cards} card(s)</div></div>
          <div style="text-align:right"><b>${money(g.value + g.shipping)}</b><div class="muted">${money(g.value)} + ~${money(g.shipping)}</div></div>
        </div>
        ${g.items.map((it, ii) => `<div class="item">
          <div class="t"><a href="${esc(it.offer.productUrl)}" target="_blank" rel="noopener">${it.quantity}× ${esc(it.want.name)}</a>
            <div class="muted">${esc(it.offer.expansion)} · ${esc(langName(it.offer.language))} · ${esc(condCode(it.offer.condition))}${it.offer.isFoil ? ' · Foil' : ''}${it.offer.comment ? ' · ' + esc(it.offer.comment) : ''}</div></div>
          <div class="p">${money(it.offer.price)}<br><button class="btn sm sec" data-add="${gi}:${ii}">Add</button></div>
        </div>`).join('')}
        <p><button class="btn sm" data-addseller="${gi}">Add all from ${esc(g.seller)}</button></p>
      </div>`).join('')}
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
    if (!st.listUrl) { alert('Pick a wants list first.'); return; }
    st.running = true; st.tab = 'run'; st.log = []; st.progress = 0;
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
      log('Reading wants list…');
      const wants = await loadWantsList(fetcher, st.listUrl, log);
      if (!wants.length) throw new Error('The wants list looks empty (or the page layout changed).');
      log(`${wants.length} entries, ${wants.reduce((n, w) => n + w.quantity, 0)} cards.`);
      st.wants = wants;
      await collectOffers(fetcher, wants, s, (i, n, w) => {
        setProgress(i / n, w ? `${i + 1}/${n} · ${w.name}` : 'Optimizing…');
        if (i > 0) { const p = wants[i - 1]; log(`${p.name}: ${p.offers.length} offer(s)`); }
      });
      log(`${wants.at(-1).name}: ${wants.at(-1).offers.length} offer(s)`);
      log(`Fetched ${fetcher.requests} page(s).`);
      reoptimize();
    } catch (e) {
      if (e instanceof StoppedError) log('Stopped. Pages fetched so far are cached; run again to continue.');
      else if (e instanceof BlockedError) log('⚠ ' + e.message);
      else { log('Error: ' + e.message); console.error(e); }
      st.running = false;
      render();
    }
  }

  function reoptimize() {
    const s = st.settings;
    st.running = false;
    const wants = (st.wants || []).filter((w) => w.offers);
    st.result = optimize(wants, {
      shipping: s.shipping, sellerPenalty: s.sellerPenalty, maxSellers: s.maxSellers, timeBudgetMs: s.timeBudgetMs,
    });
    st.tab = 'results';
    render();
  }

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

  async function addItems(items, btn) {
    if (btn) btn.disabled = true;
    const results = await addAll(items, (it, res) => {
      if (res === 'failed') window.open(it.offer.productUrl, '_blank');
    });
    if (btn) {
      btn.disabled = false;
      const n = results.filter((x) => x === 'added').length;
      btn.textContent = results.includes('dialog') ? 'Confirm in dialog, then tap again' : `Added ${n}/${items.length}`;
    }
  }

  shadow.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-tab]');
    if (!t) return;
    if (t.dataset.tab) { st.tab = t.dataset.tab; render(); return; }
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
      const it = st.result.groups[gi].items[ii];
      t.disabled = true;
      const res = await addToCart(it.offer, it.quantity);
      t.textContent = res === 'added' ? 'Added ✓' : res === 'dialog' ? 'Confirm…' : 'Open';
      if (res === 'failed') window.open(it.offer.productUrl, '_blank');
      if (res !== 'added') t.disabled = false;
      return;
    }
    if (t.dataset.addseller) { await addItems(st.result.groups[Number(t.dataset.addseller)].items, t); return; }
    switch (t.dataset.act) {
      case 'close': rootEl.style.display = 'none'; break;
      case 'run': run(); break;
      case 'stop': st.fetcher?.stop(); break;
      case 'addAll': await addItems(st.result.groups.flatMap((g) => g.items), t); break;
      case 'copy':
        try { await navigator.clipboard.writeText(asText()); t.textContent = 'Copied ✓'; } catch { prompt('Copy:', asText()); }
        break;
      case 'clearCache': Fetcher.clearCache(); st.fetcher = null; st.wants = null; t.textContent = 'Cleared ✓'; break;
      case 'reset': st.settings = structuredClone(DEFAULT_SETTINGS); saveSettings(st.settings); render(); break;
      default:
    }
  });

  shadow.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.ship) {
      const tiers = parseTiers(t.value);
      if (tiers.length) update({ shipping: { ...st.settings.shipping, [t.dataset.ship]: tiers } });
      return;
    }
    const k = t.dataset.k;
    if (!k || k === 'countryFilter') return;
    if (k === 'list') { st.listUrl = t.value; st.wants = null; st.result = null; render(); return; }
    if (k === 'sellerTypes') { update({ sellerTypes: t.value ? t.value.split(',').map(Number) : [] }); return; }
    if (t.type === 'checkbox') update({ [k]: t.checked });
    else if (t.type === 'number' || ['minCondition', 'minRating'].includes(k)) update({ [k]: Number(t.value) || 0 });
    else update({ [k]: t.value });
  });
  shadow.addEventListener('input', (e) => {
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
