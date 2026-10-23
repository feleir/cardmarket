// Putting chosen offers in the Cardmarket cart.
//
// Each offer row on a product page carries a small add-to-cart form handled
// by Cardmarket's own scripts (data-ajax-action). We rebuild that form in the
// live page with the wanted amount and submit it, so the site's own handler
// does the request with its own token. If no handler takes the submit, the
// default navigation is cancelled and the site's "put in cart" dialog is
// opened instead, which the user confirms with one tap.
import { cartCount } from './parse.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hiddenHost() {
  let host = document.getElementById('cmopt-cart-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cmopt-cart-host';
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  return host;
}

function replayForm(offer, amount) {
  const { action, fields } = offer.cartForm;
  const host = hiddenHost();
  const loader = document.createElement('div');
  loader.id = `articleRow${offer.id}`;
  const form = document.createElement('form');
  form.method = 'POST';
  form.setAttribute('data-ajax-action', action);
  form.setAttribute('data-ajax-loader', loader.id);
  form.setAttribute('data-ajax-callback', 'addArticleToSCCallback');
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = /^amount\[/.test(name) ? String(amount) : value;
    form.appendChild(input);
  }
  const button = document.createElement('button');
  button.type = 'submit';
  button.setAttribute('data-id-amount', offer.id);
  form.appendChild(button);
  loader.appendChild(form);
  host.appendChild(loader);

  let handled = false;
  // Runs after document-level (delegated) handlers: if none prevented the
  // default, nobody sent it via AJAX, so stop the page from navigating.
  const guard = (e) => {
    if (e.target !== form) return;
    handled = e.defaultPrevented;
    if (!handled) e.preventDefault();
  };
  window.addEventListener('submit', guard);
  try {
    form.requestSubmit ? form.requestSubmit(button) : button.click();
  } finally {
    window.removeEventListener('submit', guard);
  }
  setTimeout(() => loader.remove(), 15000);
  return handled;
}

function openSiteDialog(offer) {
  if (!offer.cartModal) return false;
  const a = document.createElement('a');
  a.href = '#';
  a.setAttribute('data-bs-toggle', 'modal');
  a.setAttribute('data-bs-target', '#modal');
  a.setAttribute('data-modal', offer.cartModal);
  a.className = 'modal-link';
  hiddenHost().appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
  return true;
}

// Returns 'added' | 'dialog' | 'failed'.
export async function addToCart(offer, amount) {
  if (offer.cartForm) {
    const before = cartCount(document);
    if (replayForm(offer, amount)) {
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        if (cartCount(document) !== before) break;
      }
      return 'added';
    }
  }
  return openSiteDialog(offer) ? 'dialog' : 'failed';
}

export async function addAll(items, onEach) {
  const results = [];
  for (const it of items) {
    const r = await addToCart(it.offer, it.quantity);
    results.push(r);
    onEach?.(it, r);
    if (r === 'dialog') break; // the dialog needs the user before the next one
    await sleep(900);
  }
  return results;
}
