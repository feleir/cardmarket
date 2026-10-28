# Publishing on the Chrome Web Store

The package is `dist/cardmarket-optimizer-extension.zip` (built by `npm run build`; `npm run extension` also runs its end-to-end test).

## One-time setup
1. Register as a Chrome Web Store developer at https://chrome.google.com/webstore/devconsole (one-time 5 USD fee, Google account).
2. **New item** → upload the zip.

## Store listing
- **Name:** Wants Optimizer for Cardmarket
- **Summary (≤132 chars):** Cheapest cart for your Cardmarket wants list: card prices plus shipping across sellers, from the countries you choose.
- **Category:** Shopping
- **Description:**

  Cardmarket's Shopping Wizard often misses cheaper carts. This extension reads your wants list and the offers for every card, and then finds the combination of sellers with the lowest total, shipping included. It weighs cheaper copies against extra parcels and bundles cards where that saves money.

  - Choose which seller countries to buy from, minimum condition, languages, seller rating.
  - Counts shipping per parcel, tracked shipping above 25 €, sellers that ship tracked only, and the VAT Cardmarket adds on top of some sellers' prices outside the EU (e.g. Switzerland).
  - "Any printing" with a preference for the printing on your list unless another saves enough.
  - Reads the full stock of the most promising sellers (filtered by your wants list) to find bundles hidden in long offer lists.
  - Optional exact solver that proves the cheapest cart.
  - Explains every choice: what taking a cheaper copy elsewhere would cost in shipping.
  - Puts the result in your Cardmarket cart, using Cardmarket's own cart buttons.
  - "Add a card": the cheapest way to add copies of one more card to your cart.

  Everything runs in your browser with your own login. Nothing is sent anywhere but cardmarket.com. Not affiliated with Cardmarket.

- **Screenshots (1280×800):** take them on the real site: the Setup tab over a wants list, and the Results tab. `docs/store/` has two from the test setup as a reference for framing.
- **Icon:** `extension/icons/128.png`.

## Privacy tab
- **Single purpose:** "Find the cheapest combination of sellers for a Cardmarket wants list and add it to the cart."
- **Permission justifications:**
  - `host_permissions: https://www.cardmarket.com/*`: reads the wants list, card offer pages and cart on cardmarket.com, and adds the chosen articles to the cart.
  - `scripting`: the toolbar button opens the optimizer panel on the current Cardmarket tab.
- **Remote code:** No. All code, including the exact solver (WebAssembly), is in the package.
- **Data usage:** collects none of the listed data types. Certify that data is not sold or transferred and is not used for unrelated purposes.
- **Privacy policy URL:** https://github.com/feleir/cardmarket/blob/main/PRIVACY.md (or the branch it lives on).

## Things to know
- Review usually takes a few days. Updates: bump `version` in `package.json`, run `npm run build`, and upload the new zip.
- The tool reads many Cardmarket pages per run, with a pause between each. Cardmarket can answer with its browser check after many runs, and its terms may limit automated access. Publishing publicly makes the tool more visible to Cardmarket, so keep the default pacing.
