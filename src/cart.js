// Putting chosen offers in the Cardmarket cart.
//
// Each offer row carries a small add-to-cart form (data-ajax-action =
// "ShoppingCart_Add_AddArticlesFromProductPage", fields __cmtkn,
// idArticle[id], amount[id]). Cardmarket's plain form posts go to
// /<lang>/<game>/PostGetAction/<action>, so the form is posted there
// directly. Nothing counts as added until the cart page shows the article.
// For articles still missing, the site's own "put in cart" dialog form
// (Modal/Article_PutSingleInShoppingCart) is fetched and posted instead.
// Every attempt is kept in `cartLog` for the debug report.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = () => location.pathname.split('/').filter(Boolean)[1] || 'Magic';

export const cartLog = [];
const note = (entry) => { cartLog.push({ at: new Date().toISOString(), ...entry }); if (cartLog.length > 200) cartLog.shift(); };

// The session token is the same across the site's forms; prefer the live
// page's copy over one cached with the offer.
const liveToken = () => document.querySelector('input[name="__cmtkn"]')?.value || '';

async function post(url, fields) {
  const body = new FormData();
  for (const [n, v] of fields) body.append(n, v);
  try {
    const r = await fetch(url, { method: 'POST', body, credentials: 'include' });
    const text = await r.text().catch(() => '');
    return { status: r.status, finalUrl: r.url.replace(location.origin, ''), snippet: text.replace(/\s+/g, ' ').slice(0, 300) };
  } catch (e) {
    return { status: 0, error: String(e.message || e) };
  }
}

function formFields(offer, amount) {
  const token = liveToken();
  return offer.cartForm.fields.map(([n, v]) => [n, /^amount\[/.test(n) ? String(amount) : n === '__cmtkn' && token ? token : v]);
}

// Article ids now in the cart.
export async function cartArticleIds() {
  const r = await fetch(`/en/${game()}/ShoppingCart`, { credentials: 'include' });
  const html = await r.text();
  return new Set(html.match(/\d+/g) || []);
}

async function addDirect(offer, amount) {
  if (!offer.cartForm) return { ok: false, why: 'no cart form on the offer (logged out when it was fetched?)' };
  const url = `/en/${game()}/PostGetAction/${offer.cartForm.action}`;
  const res = await post(url, formFields(offer, amount));
  note({ step: 'direct', article: offer.id, amount, url, ...res });
  return { ok: res.status >= 200 && res.status < 400, res };
}

// Fallback: the dialog Cardmarket's mobile layout opens. Post its form.
async function addViaDialog(offer, amount) {
  if (!offer.cartModal) return false;
  const modalUrl = offer.cartModal.replace(/^https?:\/\/[^/]+/, '').replace(/^\/[a-z]{2}\//, '/en/');
  let doc;
  try {
    const r = await fetch(modalUrl, { credentials: 'include' });
    doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  } catch (e) {
    note({ step: 'dialog', article: offer.id, url: modalUrl, error: String(e.message || e) });
    return false;
  }
  const form = doc.querySelector('form');
  if (!form) {
    note({ step: 'dialog', article: offer.id, url: modalUrl, error: 'no form in dialog', snippet: doc.body?.innerHTML.replace(/\s+/g, ' ').slice(0, 600) });
    return false;
  }
  const action = form.getAttribute('action') || (form.getAttribute('data-ajax-action') ? `/en/${game()}/PostGetAction/${form.getAttribute('data-ajax-action')}` : '');
  const fields = [];
  for (const el of form.querySelectorAll('input[name], select[name]')) {
    const name = el.getAttribute('name');
    if (el.type === 'checkbox' && !el.hasAttribute('checked')) continue;
    let value = el.tagName === 'SELECT' ? (el.querySelector('option[selected]') || el.querySelector('option'))?.getAttribute('value') || '' : el.getAttribute('value') || '';
    if (/amount/i.test(name)) value = String(amount);
    fields.push([name, value]);
  }
  const res = await post(action, fields);
  note({ step: 'dialog', article: offer.id, amount, url: action, fields: fields.map(([n]) => n), ...res });
  return res.status >= 200 && res.status < 400;
}

// items: [{ offer, quantity }]. onEach(item, state) with state 'sent' | 'added' | 'failed'.
// Returns { added, failed } after checking the cart.
export async function addAll(items, onEach) {
  for (const it of items) {
    await addDirect(it.offer, it.quantity);
    onEach?.(it, 'sent');
    await sleep(700);
  }
  let inCart = await cartArticleIds();
  const missing = items.filter((it) => !inCart.has(it.offer.id));
  if (missing.length) {
    for (const it of missing) {
      await addViaDialog(it.offer, it.quantity);
      await sleep(700);
    }
    inCart = await cartArticleIds();
  }
  const added = items.filter((it) => inCart.has(it.offer.id));
  const failed = items.filter((it) => !inCart.has(it.offer.id));
  note({ step: 'check', added: added.map((i) => i.offer.id), failed: failed.map((i) => i.offer.id) });
  for (const it of items) onEach?.(it, inCart.has(it.offer.id) ? 'added' : 'failed');
  return { added, failed };
}

export const addToCart = async (offer, quantity) => (await addAll([{ offer, quantity }])).added.length ? 'added' : 'failed';
