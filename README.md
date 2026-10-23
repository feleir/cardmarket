# Cardmarket Optimizer

Reads a Cardmarket wants list and builds the cheapest cart it can find, counting shipping. You choose which seller countries to buy from (for example, Switzerland only), and it can then put the result in your Cardmarket cart.

It runs inside cardmarket.com in your own logged-in browser, including **Chrome on Android**. Nothing runs on a server.

## Why it's built this way

| Question | Finding |
|---|---|
| Official API? | Cardmarket's API is closed to new applicants ("currently not accepting applications"), and it was always meant for sellers' stock tools. A buyer tool can't rely on it. |
| Browser extension on a phone? | Chrome for Android still doesn't run extensions (as of Oct 2026, only experimental desktop-Android builds do). |
| What works on a phone | A **bookmarklet**: a bookmark whose URL is JavaScript. In Chrome on Android you start it by typing its name in the address bar. It runs on cardmarket.com with your session, so it can read your wants lists and offer pages the way you would. A **userscript** build is included for Firefox on Android or desktop with Tampermonkey or Violentmonkey. |
| Data source | Product pages with Cardmarket's own URL filters: `sellerCountry=4,…` (4 = Switzerland), `language=1,3`, `minCondition=1..7`, `isFoil/isSigned/isAltered=Y|N`, `sellerType`. These filters **fail open**: a value Cardmarket doesn't recognise just shows every offer. So every offer is checked again in the tool (country, language, condition, foil, max price, rating, blocked sellers and expansions). |
| Rate limits / Cloudflare | Pages are fetched one at a time with a pause between them (1.2 s by default). An HTTP 429 makes it back off and retry. A Cloudflare check stops the run with a message. Parsed pages are cached for 30 min, so a second run after changing settings is quick. |

## Install

Run `npm install && npm run build`. That produces:

- `dist/bookmarklet.txt`: the whole tool as one `javascript:` URL (~39 KB)
- `dist/cm-optimizer.user.js`: the userscript (adds a **⚡ Optimize** button)
- `docs/index.html`: an install page with a **Copy bookmarklet** button. If you turn on GitHub Pages for `/docs`, you can open it on your phone.

**Android / Chrome:**
1. Copy the bookmarklet.
2. Bookmark any page, then edit that bookmark: name it `cmopt` and paste the code as its URL.
3. On cardmarket.com (logged in), type `cmopt` in the address bar and tap the bookmark suggestion.

## How to use

1. **Setup:**
   - Pick a wants list.
   - Tap the seller countries you allow.
   - Optionally override language, minimum condition and foil. Otherwise each want's own settings are used.
   - Set the minimum seller rating, seller type and sellers to block.
   - **Max sellers**, **Extra cost per seller**: trade money for fewer parcels.
   - **Printings**: for "any printing" wants, how many printings to check (cheapest first), and expansions to never buy from. Defaults include World Championship Decks and Collectors' Edition, which aren't tournament-legal.
   - **Shipping estimates**: one line per tier, `maxCards maxValue price`, for each seller country.
2. **Fetch offers & optimize.** It loads about one page per want, more for "any printing" wants.
3. **Results:**
   - The total, split into cards and estimated shipping.
   - A comparison with "cheapest copy of every card".
   - Your order grouped by seller, plus a list of cards that couldn't be found.
   - **Add**, **Add all from seller** and **Add all to cart** buttons, and **Copy list**.

## How the optimizer works

It picks one offer per wanted copy so that the cost below is as low as possible:

```
Σ item prices  +  Σ over sellers used ( shipping(cards, value) + extra cost per seller )
```

It respects each article's available quantity and the optional cap on sellers. Shipping per seller is the cheapest tier that fits the parcel. Cardmarket requires tracked shipping above €25, so the untracked tiers stop there.

This is a facility-location problem (NP-hard), so it uses a heuristic instead of an exact solver:
1. **Greedy start.** Scarce and expensive cards are placed first, each at its cheapest *marginal* cost (price plus extra shipping).
2. **Local search.** It repeats three moves until none helps:
   - move a single copy to another seller;
   - **close a seller** and move its copies elsewhere;
   - **open a seller** and pull every copy it can supply.
3. **Restarts.** It repeats from randomised starts within a time budget (3 s by default) and keeps the best result.

In the tests it finds the exact optimum on random small cases compared against brute force (it may miss on at most 2 of 40). On a 150-want, 80-seller case it finishes in 2 s, about 6% cheaper than cheapest-per-card, with 28 parcels instead of 61.

## Tests

```
npm test        # parser, filter and optimizer unit tests (incl. brute-force comparison)
npm run e2e     # headless Chromium at Pixel 7 size against a mocked cardmarket.com
```

The e2e test checks four things:
- a German seller served despite `sellerCountry=4` gets filtered out;
- the total matches a hand-computed optimum;
- a card with no offers is reported;
- "Add all to cart" replays Cardmarket's own add-to-cart form, with the right article ids and amounts.

## Limitations: please check on the live site

My build environment can't reach cardmarket.com, so the markup comes from real product-page HTML published by other open-source Cardmarket tools, not from a live session. Each item below is a guess about the live site with a fallback:

- **Offer rows** (`.article-row`, `Item location:` tooltip, `.price-container`, `.item-count`, the `ShoppingCart_Add_AddArticlesFromProductPage` form) match real captured HTML.
- **Wants list table** (`#WantsListTable`, `input[data-id-want]`, `td.amount`, `td.languages`, ternary columns) is rebuilt from other tools' parsers.
- **"Any printing" wants** link to `/Cards/<name>`. If that page lists offers, they're used directly. Otherwise the tool follows the printing links and fetches the cheapest `maxVersions` printings.
- **Only the first page of offers** per card is read (Cardmarket shows the cheapest matching offers first). With a country filter that's usually all of them.
- **Add to cart** submits a copy of the row's own form inside the live page, so Cardmarket's own script and token handle it. If no script picks it up, it opens Cardmarket's "put in cart" dialog instead. If that also fails, it opens the product page.
- **Shipping** is an estimate. Check the tiers for your country on Cardmarket's *Shipping Costs* help page. The cart always shows the real amount before you pay.

If a page layout has changed, the Progress tab shows which step failed. Error details are in the browser console.
