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

`npm install && npm run build` produces:

- `dist/loader-bookmarklet.txt`: **the bookmarklet to use**, about 1.3 KB. It downloads `dist/cm-optimizer.js` from the public raw GitHub URL (`config.cmoptUrl` in `package.json`) each time it runs. It keeps a copy on cardmarket.com for when the download fails, and shows a message at the bottom of the page if something goes wrong. It carries no credentials, because it runs inside cardmarket.com's page. That's why the repository has to be public.
- `dist/bookmarklet.txt`: the whole tool as one `javascript:` URL (~49 KB), for when no public copy is available. It's easy to cut off when copying on a phone, and a cut-off bookmarklet does nothing.
- `dist/cm-optimizer.user.js`: the userscript (adds a **⚡ Optimize** button).
- `docs/index.html`: an install page with a **Copy bookmarklet** button.

**Android / Chrome:**
1. Copy the loader bookmarklet.
2. Bookmark any page, then edit that bookmark: name it `cmopt` and paste the code as its URL. Check that it starts with `javascript:`.
3. On cardmarket.com (logged in), type `cmopt` in the address bar and tap the ☆ bookmark suggestion. Starting it from the Bookmarks screen does nothing.

Updates: push a new `dist/cm-optimizer.js` to the branch in `config.cmoptUrl`. The bookmarklet picks it up within a few minutes, since raw.githubusercontent.com caches for about 5 minutes. If the branch changes (e.g. after merging to `main`), update `config.cmoptUrl`, rebuild, and re-copy the bookmarklet.

## How to use

1. **Setup:**
   - Pick a wants list.
   - Tap the seller countries you allow.
   - Optionally override language, minimum condition and foil. Otherwise each want's own settings are used.
   - **Any printing**: ignore the expansion a want names and also consider every other printing of the card, read from the card's all-printings page. Non-tournament printings in the block list stay excluded.
     With it on, **prefer the printing on the wants list unless another saves more than X € per copy** (default 0,50 €; 0 = plain cheapest). When choosing, the optimizer counts each copy of another printing X € dearer. Totals and the cart use real prices. Items from another printing are labelled.
   - Set the minimum seller rating, seller type and sellers to block.
   - **Max sellers**, **Extra cost per seller**: trade money for fewer parcels.
   - **Printings**: for "any printing" wants, how many printings to check (cheapest first), and expansions to never buy from. Defaults include World Championship Decks and Collectors' Edition, which aren't tournament-legal.
   - **Shipping estimates**: one line per tier, `maxCards maxValue price`, for each seller country.
2. **Fetch offers & optimize.** It loads about one page per want, more for "any printing" wants.
3. **Results:**
   - The total, split into cards and estimated shipping.
   - A comparison with "cheapest copy of every card".
   - Your order grouped by seller, plus a list of cards that couldn't be found.
   - **Add**, **Add all from seller** and **Add all to cart** buttons, and **Copy list**. **Add all** skips what is already in the cart, so it can be run again safely.
   - For every item, what taking the cheaper copies from another seller would change in the total: card prices plus shipping on both sides (a new parcel, a parcel moving up or down a step). A negative number would be a missed saving.
   - **Add a card**: type a card name (or paste its Cardmarket link) and how many copies. You get the cheapest way to add them to the cart as planned: copies join parcels that already ship when that adds little or no shipping. You also get a full re-plan with the card included, for comparison. Buttons put the new copies in the Cardmarket cart, keep them in the plan, or switch to the re-planned cart.
   - **Copy cart data**: a compact JSON of the offers and the result; `node scripts/check-cart.mjs <file>` reruns it against the exact solver.

## How the optimizer works

The point is to beat Cardmarket's Shopping Wizard where it usually goes wrong. Sometimes another seller is cheaper. Sometimes paying for a second parcel is cheaper than taking a pricier copy, and sometimes the opposite: one parcel with slightly pricier cards beats several cheap ones. So the tool compares **every seller against every other**, with shipping included.

It picks one offer per wanted copy so that the cost below is as low as possible:

```
Σ item prices  +  Σ over sellers used ( shipping(cards, value) + extra cost per seller )
```

It respects each article's available quantity, and an article listed under two wants is only bought as often as it is in stock. You can cap the number of sellers. Shipping per seller is the cheapest tier that fits the parcel. Cardmarket requires tracked shipping above €25, so the untracked tiers stop there.

### 1. Collect offers: card scan first, seller scan only when needed

Every card on the wants list is looked up on its card page with your filters, and every offer there, from every seller, goes into one pool. The optimizer buckets that pool by seller. That **card scan** is the main data source.

The weak spot: a card page shows the cheapest batch of offers and holds the rest back behind "show more". A seller who has many of your cards, each a little above the cheapest, can be hidden on every one of those pages, and that is exactly the seller a single parcel could come from. So each card page is checked for being cut off (a "show more / load more" control, or a full batch of 50 rows).

**Seller scan** (Setup → Optimizer → Seller scan):
- **Auto** (default): if no card page was cut off, the card scan already saw every offer and nothing more is fetched. Typical with a single seller country. If some pages were cut off, it reads the whole stock of the top sellers (10 by default), **filtered by your wants list**, every page of it. "Top" means sellers who appeared for the most of your cards; cards whose page was cut off count double, plus everyone already in the cart.
- **Always**: scan even when every page was complete.
- **Off**: never scan.

The filter's parameter name isn't hard-coded. It's read from the seller page's own filter form. Every offer found this way goes through the same checks as the card scan.

### 2. Optimize

The problem is NP-hard (a facility-location problem with stepped shipping costs), so there are two solvers.

**Heuristic** (always runs, a few seconds):
- **Starts:**
  - a greedy cart that places scarce and expensive cards first, each at its cheapest *marginal* cost (price plus extra shipping);
  - the cheapest-copy-of-every-card cart. Starting from this one means the result is **never worse than buying cheapest per card**.
- **Local search**, repeating these moves until none helps:
  - move one copy to another seller;
  - **chain move**: copy A goes into seller T, and one of T's copies moves out. This gets past shipping thresholds, where a parcel at 4 cards / €24.99 rejects any single extra card;
  - **close a seller** and spread its copies over the others;
  - **pull** to any seller, in the cart or not, the copies it can supply: first only those that cost little more there, then everything it stocks.
- **Iterated search:** shake the best cart (drop 1–3 sellers, re-pick ~15% of copies, or pull to a random seller), search again, keep any improvement. Fresh random starts are mixed in.

**Exact solver** (optional, *Setup → Optimizer → Exact solver*): the same problem as a mixed-integer program solved by [HiGHS](https://highs.dev) compiled to WebAssembly. It downloads about 3.5 MB from jsDelivr the first time, and the browser caches it after that. The heuristic then polishes its answer. If cardmarket.com's content-security policy blocks the download, the tool says so and uses the heuristic. It isn't used together with a seller cap.

### How close is the heuristic?

`npm run bench` compares the heuristic (1.5 s) with the proven optimum from HiGHS on realistic random carts: a few big stores at a mark-up, many small sellers who are cheapest on a few cards, Swiss shipping tiers.

| Cart size | Exact optimum found | Mean gap | Worst gap |
|---|---|---|---|
| 20 wants, 15 sellers | 11 / 12 | 0.04 % | 0.48 % (~€1) |
| 35 wants, 22 sellers | 10 / 12 | 0.01 % | 0.09 % |
| 50 wants, 30 sellers | 3 / 12 | 0.08 % | 0.26 % |

Before the cheapest-per-card start, the chain move and the iterated search were added, the worst gap at 50 wants was 0.94%. In one case it was even worse than cheapest-per-card. Both cases now have regression tests (`test/exact.test.js`).

The results explain the trade-offs: how much more you pay for cards versus how much you save on shipping, and, for each bundled card, the cheapest copy elsewhere that was passed up.

## Tests

```
npm test        # parser, filter, seller-scan matching and optimizer tests (incl. brute force and exact-solver comparisons)
npm run e2e     # headless Chromium at Pixel 7 size against a mocked cardmarket.com
npm run bench   # heuristic vs exact optimum on realistic carts
```

The e2e test checks four things:
- a German seller served despite `sellerCountry=4` gets filtered out;
- the total matches a hand-computed optimum;
- a card with no offers is reported;
- "Add all to cart" replays Cardmarket's own add-to-cart form, with the right article ids and amounts;
- with every card page complete, Auto skips the seller scan (no seller pages fetched);
- when the Counterspell page is cut off, Auto runs the scan, and with the exact solver it finds a hidden bundle: a store that shows up only on the Counterspell page also stocks Sheoldred and the Bolts on page 2 of its wants-filtered stock. The best cart drops from €75.90 (3 parcels) to €73.60 (1 parcel).

## Limitations: please check on the live site

My build environment can't reach cardmarket.com, so the markup comes from real product-page HTML published by other open-source Cardmarket tools, not from a live session. Each item below is a guess about the live site with a fallback:

- **Offer rows** (`.article-row`, `Item location:` tooltip, `.price-container`, `.item-count`, the `ShoppingCart_Add_AddArticlesFromProductPage` form) match real captured HTML.
- **Wants list table** (`#WantsListTable`, `input[data-id-want]`, `td.amount`, `td.languages`, ternary columns) is rebuilt from other tools' parsers.
- **"Any printing" wants** link to `/Cards/<name>`. If that page lists offers, they're used directly. Otherwise the tool follows the printing links and fetches the cheapest `maxVersions` printings.
- **Only the first batch of offers** per card is read (Cardmarket shows the cheapest matching offers first). Whether a page was cut off is guessed from a "show more" control or a full batch of 50 rows. I couldn't check the exact markup and batch size live. When a page is cut off, the seller scan (Auto) covers the sellers that matter most.
- **Seller scan:** the wants-list filter on seller pages is found from the page's own filter form. If none can be confirmed, the scan is skipped and the log says so.
- **Add to cart** opens each offer's page in a hidden frame (same site, same login), sets the row's quantity and presses its own "Put in cart" button, so Cardmarket's own script sends the request. Posting the form fields directly was tried live and refused: PostGetAction redirects to the home page. Afterwards the cart page is checked, and items are marked *In cart* or *Not added* with a link. This needs Cardmarket to allow its pages in a frame on its own site; the debug report records it if not.
- **Shipping** is an estimate. Check the tiers for your country on Cardmarket's *Shipping Costs* help page. The cart always shows the real amount before you pay.

If a page layout has changed, the Progress tab shows which step failed. Error details are in the browser console.
