// HTML fixtures shaped like Cardmarket's pages. Offer rows copy the structure
// of real product-page rows (seller-name, Item location tooltip, condition
// badge, language icon, price-container, item-count, add-to-cart form).
// The wants list markup is a best reconstruction from tools that parse it.

const LANG_POS = { English: 16, French: 32, German: 48, Spanish: 64, Italian: 80 };

export function offerRow({ id, seller, country = 'Switzerland', rating = 'outstanding', sales = 120, cond = 'NM', lang = 'English', price = '1,00 €', count = 1, foil = false, expansion = '', productUrl = '', sellerCell = '' }) {
  return `<div id="articleRow${id}" class="row g-0 article-row"><div class="d-none col"></div><div class="col-sellerProductInfo col"><div class="row g-0"><div class="col-seller col-12 col-lg-auto">${sellerCell || `<span class="seller-info d-flex align-items-center"><span class="seller-extended d-flex"><span class="d-flex has-content-centered me-1"><span data-bs-toggle="tooltip" class="fonticon-seller-rating-${rating}" aria-label="${rating}" data-bs-original-title="${rating}"></span></span><span class="badge text-bg-faded d-none d-sm-inline-flex has-content-centered me-1 sell-count" data-bs-original-title="${sales}&nbsp;Sales&nbsp;|&nbsp;10&nbsp;Available items">${sales}</span></span><span class="seller-name d-flex"><span data-bs-toggle="tooltip" class="icon d-flex has-content-centered me-1" aria-label="Item location: ${country}" data-bs-original-title="Item location: ${country}"><span class="icon"></span></span><span class="d-flex has-content-centered me-1"><a href="/en/Magic/Users/${seller}">${seller}</a></span></span></span>`}</div><div class="col-product col-12 col-lg"><div class="row g-0"><div class="product-attributes col">${expansion ? `<a href="/en/Magic/Expansions/${expansion.replace(/ /g, '-')}" class="expansion-symbol is-magic icon" aria-label="${expansion}" data-bs-original-title="${expansion}"><span>X</span></a>` : ''}${productUrl ? `<a href="${productUrl}" class="d-none">p</a>` : ''}<a href="https://help.cardmarket.com/en/CardCondition" class="article-condition condition-${cond.toLowerCase()} me-1" data-bs-original-title="c"><span class="badge ">${cond}</span></a><span style="background-position: -${LANG_POS[lang] || 0}px -0px;" class="icon me-2" aria-label="${lang}" data-bs-original-title="${lang}"></span>${foil ? '<span class="icon st_SpecialIcon mb-1" aria-label="Foil" data-bs-original-title="Foil"></span>' : ''}</div><div class="mobile-offer-container d-flex d-md-none justify-content-end col"><div class="amount-container d-flex d-md-none justify-content-center me-3"><span class="item-count small text-end">${count}</span></div><div class="d-flex flex-column"><div class="d-flex align-items-center justify-content-end"><span class="color-primary small text-end text-nowrap fw-bold ">${price}</span></div></div></div></div></div></div></div><div class="col-offer col-auto"><div class="price-container d-none d-md-flex justify-content-end"><div class="d-flex flex-column"><div class="d-flex align-items-center justify-content-end"><span class="color-primary small text-end text-nowrap fw-bold ">${price}</span></div></div></div><div class="amount-container d-none d-md-flex justify-content-end me-3"><span class="item-count small text-end">${count}</span></div><div class="actions-container d-flex align-items-center justify-content-end col ps-2 pe-0"><div class="input-group input-group-sm"><div class="d-md-none ms-auto"><a href="#" data-bs-toggle="modal" data-bs-target="#modal" data-modal="/en/Magic/Modal/Article_PutSingleInShoppingCart?idArticle=${id}&amp;ajaxAction=ShoppingCart_Add_AddArticlesFromProductPage&amp;ajaxCB=addArticleToSCCallback" class="modal-link mobile-cart btn btn-sm btn-primary"><span class="fonticon-cart"></span></a></div><div class="d-none d-md-flex ms-auto"><form method="POST" data-ajax-action="ShoppingCart_Add_AddArticlesFromProductPage" data-ajax-loader="articleRow${id}" data-ajax-callback="addArticleToSCCallback"><input type="hidden" name="__cmtkn" value="tok123" autocomplete="off"><button type="submit" data-id-amount="${id}" class="btn btn-primary btn-sm rounded" aria-label="Put in shopping cart"><span class="fonticon-cart"></span></button><input type="hidden" name="idArticle[${id}]" value="${id}"><input type="hidden" name="amount[${id}]" value=""></form></div></div></div></div></div>`;
}

export function productPage({ title, expansion, rows }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><header><a href="/en/Magic/ShoppingCart" class="shopping-cart"><span class="badge">0</span></a></header>
  <div class="page-title-container"><h1>${title}<span class="h4 text-muted">${expansion} - Singles</span></h1></div>
  <section id="table" class="col px-0"><div class="table article-table table-striped"><div class="table-header d-none d-lg-flex"><div class="row g-0"><div class="col-seller">Seller</div></div></div>
  <div class="table-body">${rows.join('<div class="row g-0 divider-row"></div>')}</div></div></section></body></html>`;
}

export function cardPage({ title, versions }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>${title}</h1>
  <div class="table"><div class="table-body">${versions.map((v) => `<div class="row g-0"><div class="col"><a href="${v.url}">${title}</a></div><div class="col"><span class="color-primary">${v.from}</span></div></div>`).join('')}</div></div>
  <aside><a href="/en/Magic/Products/Singles/Some-Set/Unrelated-Card">Unrelated Card</a></aside></body></html>`;
}

const LANG_FLAG = (l) => `<span class="icon" aria-label="${l}" data-bs-original-title="${l}"></span>`;

export function wantsListPage(rows) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>My deck</h1><div id="WantsListTable"><table class="table tablesorter"><thead><tr>
    <th></th><th>Amount</th><th>Name</th><th>Expansion</th><th>Languages</th><th>Condition</th>
    <th class="ternary"><span aria-label="Reverse Holo"></span></th><th class="ternary"><span aria-label="Signed"></span></th><th class="ternary"><span aria-label="Foil"></span></th><th class="ternary"><span aria-label="Altered"></span></th>
    <th>Buy price</th></tr></thead><tbody>
    ${rows.map((r) => `<tr id="wantRow${r.id}"><td><input type="checkbox" name="checkWantsRow[]" data-id-want="${r.id}"></td>
      <td class="amount">${r.amount}</td><td class="name min-size text-start p-2"><a href="${r.url}">${r.name}</a></td>
      <td class="expansion">${r.expansion ? `<span data-bs-toggle="tooltip" aria-label="${r.expansion}"></span>` : 'Any'}</td>
      <td class="languages">${(r.languages || []).map(LANG_FLAG).join('')}</td>
      <td class="condition"><span class="badge">${r.cond || 'PO'}</span></td>
      <td>Any</td><td>${r.signed || 'Any'}</td><td>${r.foil || 'Any'}</td><td>Any</td>
      <td class="buyPrice">${r.maxPrice || ''}</td></tr>`).join('')}
  </tbody></table></div></body></html>`;
}

export const wantsOverview = (lists) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Wants</h1>${lists.map((l) => `<div class="card"><h2>${l.name}</h2><a href="/en/Magic/Wants/${l.id}">${l.name}</a></div>`).join('')}</body></html>`;

// A row on a seller's own offers page: no seller block, a product link instead.
export function userOfferRow({ id, name, productUrl, expansion = '', cond = 'NM', lang = 'English', price = '1,00 €', count = 1 }) {
  return offerRow({ id, seller: 'x', cond, lang, price, count, expansion, sellerCell: `<a href="${productUrl}">${name}</a>` });
}

export function userOffersPage({ seller, listOptions = [], selected = null, rows = [], pages = 1 }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>${seller}</h1>
  <form id="UserOffersFilter"><select name="idWantsList"><option value="0">All</option>${listOptions.map((l) => `<option value="${l.id}"${String(l.id) === String(selected) ? ' selected' : ''}>${l.name}</option>`).join('')}</select></form>
  <div id="UserOffersTable" class="table article-table"><div class="table-body">${rows.join('')}</div></div>
  ${pages > 1 ? `<nav>${Array.from({ length: pages }, (_, i) => `<a href="?idWantsList=${selected}&site=${i + 1}">${i + 1}</a>`).join(' ')}</nav>` : ''}</body></html>`;
}
