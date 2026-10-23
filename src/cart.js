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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = () => location.pathname.split('/').filter(Boolean)[1] || 'Magic';

export const cartLog = [];
const note = (entry) => { cartLog.push({ at: new Date().toISOString(), ...entry }); if (cartLog.length > 200) cartLog.shift(); };

// Article ids now in the cart.
export async function cartArticleIds() {
  const r = await fetch(`/en/${game()}/ShoppingCart`, { credentials: 'include' });
  const html = await r.text();
  return new Set(html.match(/\d+/g) || []);
}

const pageOf = (it) => it.offer.pageUrl
  || `${it.offer.productUrl}${it.want?.filters ? `?${filterQuery(it.want.filters)}` : ''}`;

function openFrame(url) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    // Desktop width, so the page renders the desktop cart form; off-screen.
    f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none';
    f.setAttribute('aria-hidden', 'true');
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok ? f : (f.remove(), null)); } };
    f.addEventListener('load', () => setTimeout(() => finish(true), 1500)); // let the site's scripts bind
    setTimeout(() => finish(false), 25000);
    f.src = url;
    document.body.appendChild(f);
  });
}

function pressAdd(doc, offer, amount) {
  const row = doc.getElementById(`articleRow${offer.id}`) || doc.getElementById(`stockRow${offer.id}`);
  if (!row) return 'row not on the page (sold, or moved to a later page)';
  const form = row.querySelector('form[data-ajax-action*="ShoppingCart"], form[action*="ShoppingCart"]');
  if (!form) return 'row has no cart button (logged out, or your own offer)';
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

// items: [{ offer, want, quantity }]. onEach(item, state): 'sent' | 'added' | 'failed'.
export async function addAll(items, onEach) {
  const byPage = new Map();
  for (const it of items) {
    const url = pageOf(it);
    if (!byPage.has(url)) byPage.set(url, []);
    byPage.get(url).push(it);
  }
  for (const [url, list] of byPage) {
    const frame = await openFrame(url);
    const doc = frame?.contentDocument;
    if (!doc || !doc.querySelector('.article-row')) {
      note({ step: 'frame', url, error: frame ? 'page opened but has no offer rows' : 'page could not be opened in the background (blocked or timed out)', title: doc?.title });
      frame?.remove();
      list.forEach((it) => onEach?.(it, 'sent'));
      continue;
    }
    for (const it of list) {
      const problem = pressAdd(doc, it.offer, it.quantity);
      note({ step: 'press', url, article: it.offer.id, amount: it.quantity, ...(problem ? { error: problem } : {}) });
      onEach?.(it, 'sent');
      await sleep(problem ? 100 : 1800); // give the site's request time to finish
    }
    await sleep(800);
    frame.remove();
  }
  const inCart = await cartArticleIds();
  const added = items.filter((it) => inCart.has(it.offer.id));
  const failed = items.filter((it) => !inCart.has(it.offer.id));
  note({ step: 'check', added: added.length, failed: failed.map((i) => i.offer.id) });
  for (const it of items) onEach?.(it, inCart.has(it.offer.id) ? 'added' : 'failed');
  return { added, failed };
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
