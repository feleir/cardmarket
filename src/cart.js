// Putting chosen offers in the Cardmarket cart.
//
// Cardmarket's add-to-cart buttons are handled by its own scripts, which
// build the request themselves; posting the row's form fields elsewhere is
// refused (a live test showed PostGetAction redirecting to the home page).
// So the page each offer came from is opened in a hidden frame (same site,
// same login), the row's quantity is set, and its own "Put in cart" button
// is pressed: Cardmarket's code then does exactly what it does for a tap.
// Nothing counts as added until the cart page shows the article. Every step
// is kept in `cartLog` for the debug report.
import { filterQuery } from './collect.js';
import { isChallengePage } from './parse.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = () => location.pathname.split('/').filter(Boolean)[1] || 'Magic';

export const cartLog = [];
const note = (entry) => { cartLog.push({ at: new Date().toISOString(), ...entry }); if (cartLog.length > 200) cartLog.shift(); };

// Article ids now in the cart.
export async function cartArticleIds() {
  const r = await fetch(`/en/${game()}/ShoppingCart`, { credentials: 'include' });
  const html = await r.text();
  // The browser check instead of the cart: nothing can be told about it.
  if (isChallengePage(html)) return Object.assign(new Set(), { html: '', check: true });
  const ids = new Set(html.match(/\d+/g) || []);
  ids.html = html;
  return ids;
}

// For items the cart check did not find: does the cart page mention the
// card at all (added under another id?), and what is around it.
function cartEvidence(html, items) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/\s+/g, ' ');
  return items.slice(0, 8).map((it) => {
    const name = it.want?.name || it.offer.name || '';
    const at = name ? text.indexOf(name) : -1;
    return { article: it.offer.id, name, seller: it.offer.seller, amount: it.quantity,
      nameInCart: at >= 0, around: at >= 0 ? text.slice(Math.max(0, at - 400), at + 300) : undefined };
  });
}

const pageOf = (it) => it.offer.pageUrl
  || `${it.offer.productUrl}${it.want?.filters ? `?${filterQuery(it.want.filters)}` : ''}`;

// Cardmarket's Cloudflare protection can answer a page load with its
// browser check ("Just a moment..."). It sometimes clears by itself after a
// few seconds (the frame then reloads); one that needs the user cannot be
// passed in a hidden frame.
export class CheckPageError extends Error {}
const isCheckDoc = (doc) => !!doc && (/just a moment|attention required/i.test(doc.title || '') || isChallengePage(doc.documentElement?.outerHTML.slice(0, 5000)));

// Resolves { frame, check } once the page shows offer rows (plus a moment
// for the site's scripts to bind), or after 30 s.
function openFrame(url) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    // Desktop width, so the page renders the desktop cart form; off-screen.
    f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none';
    f.setAttribute('aria-hidden', 'true');
    const start = Date.now();
    const poll = setInterval(() => {
      let doc = null;
      try { doc = f.contentDocument; } catch { /* not readable yet */ }
      const ready = doc && doc.readyState === 'complete' && doc.querySelector('.article-row');
      if (ready) {
        clearInterval(poll);
        setTimeout(() => resolve({ frame: f }), 1500); // let the site's scripts bind
      } else if (Date.now() - start > 30000) {
        clearInterval(poll);
        resolve({ frame: f, check: isCheckDoc(doc) });
      } else if (doc && doc.readyState === 'complete' && !isCheckDoc(doc) && Date.now() - start > 8000 && doc.location.href !== 'about:blank') {
        clearInterval(poll); // a normal page without offers: no point waiting longer
        resolve({ frame: f });
      }
    }, 300);
    f.src = url;
    document.body.appendChild(f);
  });
}

// Watch the frame's requests and Cardmarket's result messages. Its cart
// buttons go through jcp(), which queues calls (jcpStack / doingJCPCall) and
// sends them one at a time with XMLHttpRequest; closing the frame while one
// is queued or in flight cancels it, which is how early versions lost the
// last item on each page.
function watch(win) {
  const w = { inflight: 0, messages: [] };
  try {
    const X = win.XMLHttpRequest.prototype;
    const send = X.send;
    X.send = function (...args) {
      w.inflight++;
      this.addEventListener('loadend', () => { w.inflight--; });
      return send.apply(this, args);
    };
  } catch { /* ignore */ }
  try {
    const R = win.AJAXResponse;
    const show = R && R.showResultMessage;
    if (typeof show === 'function') {
      R.showResultMessage = function (res, ...rest) {
        try {
          // Keep what the response object holds; its field names are not known.
          const seen = new WeakSet();
          w.messages.push(JSON.stringify(res, (k, v) => {
            if (v && typeof v === 'object') { if (seen.has(v) || v.nodeType) return undefined; seen.add(v); }
            return typeof v === 'function' ? undefined : v;
          }).slice(0, 400));
        } catch { /* ignore */ }
        return show.call(this, res, ...rest);
      };
    }
  } catch { /* ignore */ }
  return w;
}

// Can this script see the frame page's own JavaScript (Cardmarket's jcp
// queue)? Not when it runs in a sandbox, such as some userscript managers
// on Safari: then the frame's XMLHttpRequest and jcp state are invisible.
const seesPage = (win) => { try { return typeof win.jcp === 'function'; } catch { return false; } };

async function settled(win, w, { min = 400, max = 15000 } = {}) {
  const start = Date.now();
  // Blind: give each request a fixed time instead; the cart check and the
  // retry afterwards catch anything that still did not make it.
  if (!seesPage(win)) { await sleep(Math.max(min, 3000)); return true; }
  await sleep(min);
  let quietSince = 0;
  while (Date.now() - start < max) {
    let busy = w.inflight > 0;
    try { busy ||= !!win.doingJCPCall || (win.jcpStack && win.jcpStack.length > 0); } catch { /* ignore */ }
    if (busy) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince > 500) return true;
    await sleep(150);
  }
  return false;
}

let lastRowHtml = '';
function pressAdd(doc, offer, amount) {
  lastRowHtml = '';
  const row = doc.getElementById(`articleRow${offer.id}`) || doc.getElementById(`stockRow${offer.id}`);
  if (!row) return 'row not on the page (sold, or moved to a later page)';
  const form = row.querySelector('form[data-ajax-action*="ShoppingCart"], form[action*="ShoppingCart"]');
  if (!form) {
    // Keep what the row shows instead of a button, to learn how Cardmarket
    // marks sellers that do not ship to the buyer.
    lastRowHtml = (row.querySelector('.col-offer') || row).outerHTML.replace(/\s+/g, ' ').slice(0, 1500);
    return 'row has no cart button (does the seller ship to you?)';
  }
  // Quantity: the hidden amount field, and any visible amount picker in the row.
  for (const el of row.querySelectorAll('input[name^="amount"], select[name^="amount"], .amount-input, select[name*="mount"]')) {
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(amount))) continue;
    el.value = String(amount);
  }
  const button = form.querySelector('button[type="submit"], input[type="submit"], button');
  if (!button) return 'no button in the cart form';
  button.click();
  return '';
}

async function pressAll(items, onEach, pause) {
  const byPage = new Map();
  for (const it of items) {
    const url = pageOf(it);
    if (!byPage.has(url)) byPage.set(url, []);
    byPage.get(url).push(it);
  }
  let first = true;
  for (const [url, list] of byPage) {
    if (!first) await sleep(pause);
    first = false;
    const { frame, check } = await openFrame(url);
    let doc = null;
    try { doc = frame.contentDocument; } catch { /* ignore */ }
    if (check || isCheckDoc(doc)) {
      note({ step: 'frame', url, error: 'Cardmarket showed its browser check instead of the page', title: doc?.title });
      frame.remove();
      throw new CheckPageError('check');
    }
    if (!doc || !doc.querySelector('.article-row')) {
      note({ step: 'frame', url, error: doc ? 'page opened but has no offer rows' : 'page could not be opened in the background', title: doc?.title });
      frame.remove();
      list.forEach((it) => onEach?.(it, 'sent'));
      continue;
    }
    const win = frame.contentWindow;
    const w = watch(win);
    for (const it of list) {
      const before = w.messages.length;
      const problem = pressAdd(doc, it.offer, it.quantity);
      const finished = problem ? true : await settled(win, w);
      note({ step: 'press', url, article: it.offer.id, seller: it.offer.seller, amount: it.quantity,
        ...(problem ? { error: problem } : {}), ...(lastRowHtml ? { row: lastRowHtml } : {}), ...(finished ? {} : { error: 'no answer from Cardmarket within 15 s' }),
        ...(w.messages.length > before ? { message: w.messages.slice(before).join(' | ') } : {}) });
      onEach?.(it, 'sent');
    }
    await settled(win, w, { min: 300 });
    frame.remove();
  }
}

// items: [{ offer, want, quantity }]. onEach(item, state): 'sent' | 'added' | 'failed'.
// Anything not in the cart after the first pass is pressed once more.
// Returns { added, failed, check } where check means Cardmarket's browser
// check stopped the run (the user has to pass it in the tab, then retry).
export async function addAll(items, onEach, { pauseMs = 1200 } = {}) {
  let check = false;
  // Articles already in the cart are not pressed again, so running "Add all"
  // a second time (after a browser check, say) never doubles anything.
  const before = await cartArticleIds();
  if (before.check) {
    note({ step: 'check', added: 0, check: true, error: 'the cart page showed the browser check' });
    return { added: [], failed: items, check: true };
  }
  const toSend = items.filter((it) => !before.has(it.offer.id));
  if (toSend.length < items.length) note({ step: 'skip', alreadyInCart: items.length - toSend.length });
  items.filter((it) => before.has(it.offer.id)).forEach((it) => onEach?.(it, 'sent'));
  try {
    await pressAll(toSend, onEach, pauseMs);
  } catch (e) {
    if (!(e instanceof CheckPageError)) throw e;
    check = true;
  }
  let inCart = await cartArticleIds();
  if (inCart.check) check = true;
  const retry = check ? [] : items.filter((it) => !inCart.has(it.offer.id));
  if (retry.length) {
    note({ step: 'retry', articles: retry.map((i) => i.offer.id) });
    try {
      await pressAll(retry, null, pauseMs);
    } catch (e) {
      if (!(e instanceof CheckPageError)) throw e;
      check = true;
    }
    inCart = await cartArticleIds();
    if (inCart.check) check = true;
  }
  const added = items.filter((it) => inCart.has(it.offer.id));
  const failed = items.filter((it) => !inCart.has(it.offer.id));
  note({ step: 'check', added: added.length, failed: failed.map((i) => i.offer.id), check, ...(failed.length && !inCart.check ? { evidence: cartEvidence(inCart.html, failed) } : {}) });
  for (const it of items) onEach?.(it, inCart.has(it.offer.id) ? 'added' : inCart.check ? 'unknown' : 'failed');
  return { added, failed, check };
}

// What the live page's own cart code looks like, for the debug report when
// adding fails: Cardmarket's global AJAX helper and the jQuery submit/click
// handlers it binds.
export function siteCartCode() {
  const out = {};
  try { out.jcp = typeof window.jcp === 'function' ? String(window.jcp).slice(0, 1500) : null; } catch { /* ignore */ }
  try {
    const $ = window.jQuery;
    const ev = $?._data?.(document, 'events') || {};
    out.documentHandlers = Object.fromEntries(['submit', 'click'].map((k) => [k, (ev[k] || []).map((h) => ({ selector: h.selector, code: String(h.handler).slice(0, 600) })).filter((h) => /ajax|cart|form/i.test(h.selector + h.code)).slice(0, 5)]));
  } catch { /* ignore */ }
  try {
    out.globals = Object.keys(window).filter((k) => /ajax|cart|basket|jcp/i.test(k)).slice(0, 30);
  } catch { /* ignore */ }
  return out;
}
