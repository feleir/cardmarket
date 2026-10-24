// The Chrome extension, loaded unpacked into Chromium, against a mocked
// cardmarket.com: the launcher button appears, the optimizer runs, an item
// goes into the cart through the page's own (mock) cart script - which needs
// the page's JavaScript world - and the toolbar button's injection works.
//   node scripts/e2e-extension.mjs   (after npm run build)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { offerRow, productPage, wantsListPage, wantsOverview } from '../test/fixtures.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(`${execSync('npm root -g').toString().trim()}/playwright`); }

const ext = path.resolve('extension');
await mkdir('docs/store', { recursive: true });
await mkdir('e2e-out', { recursive: true });
const P = '/en/Magic/Products/Singles';
const pages = {
  '/en/Magic/Wants': wantsOverview([{ id: 7, name: 'Burn' }]),
  '/en/Magic/Wants/7': wantsListPage([{ id: 1, amount: 2, name: 'Counterspell', url: `${P}/Ice-Age/Counterspell` }]),
  [`${P}/Ice-Age/Counterspell`]: productPage({ title: 'Counterspell', expansion: 'Ice Age', rows: [
    offerRow({ id: 30, seller: 'basel_magic', price: '1,20 €', count: 2 }),
    offerRow({ id: 31, seller: 'other_ch', price: '1,25 €', count: 2 }),
  ] }),
};
// Like Cardmarket's jcp(): a page-world queue the cart code waits on.
const pageScript = `<script>
  window.jcpStack = []; window.doingJCPCall = false;
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-ajax-action]'); if (!f) return; e.preventDefault();
    window.doingJCPCall = true;
    const x = new XMLHttpRequest(); x.open('POST', '/en/Magic/AjaxAction/ShoppingCart_Add');
    x.onloadend = () => { window.doingJCPCall = false; }; x.send(new FormData(f));
  });
</script>`;
const cart = new Map();
const remote = [];

const ctx = await pw.chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'cmopt-')), {
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 800 },
});
await ctx.route('https://www.cardmarket.com/**', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === 'POST' && u.pathname.startsWith('/en/Magic/AjaxAction/')) {
    await new Promise((r) => setTimeout(r, 1500));
    const body = req.postData() || '';
    const id = body.match(/name="idArticle\[(\d+)\]"/)?.[1];
    const amount = body.match(/name="amount\[\d+\]"\r\n\r\n(\d+)/)?.[1];
    if (id) cart.set(id, Number(amount));
    return route.fulfill({ status: 200, body: '<ok/>' });
  }
  if (u.pathname === '/en/Magic/ShoppingCart') return route.fulfill({ status: 200, contentType: 'text/html', body: [...cart.keys()].map((id) => `<div id="articleRow${id}"></div>`).join('') });
  let html = pages[u.pathname];
  if (!html) return route.fulfill({ status: 404, body: 'not found' });
  if (html.includes('article-row')) html = html.replace('</body>', `${pageScript}</body>`);
  return route.fulfill({ status: 200, contentType: 'text/html', body: html });
});

ctx.on('request', (r) => { if (!/^https:\/\/www\.cardmarket\.com\/|^chrome-extension:/.test(r.url())) remote.push(r.url()); });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
check(!!sw, 'extension loaded (service worker running)');

const page = await ctx.newPage();
await page.goto('https://www.cardmarket.com/en/Magic/Wants/7');
await page.evaluate(() => localStorage.setItem('cmopt:settings', JSON.stringify({ sellerCountries: [4], delayMs: 200, timeBudgetMs: 300, exact: true })));
check(await page.waitForSelector('#cmopt-launch', { timeout: 10000 }).then(() => true, () => false), 'launcher button on a Cardmarket page');
await page.click('#cmopt-launch');
check(await page.waitForSelector('#cmopt-root >> text=Fetch offers & optimize', { timeout: 10000 }).then(() => true, () => false), 'panel opens');
await page.waitForSelector('#cmopt-root option:has-text("Burn")', { state: 'attached', timeout: 10000 }).catch(() => {});
await page.screenshot({ path: 'docs/store/screenshot-setup.png' });
await page.click('#cmopt-root >> text=Fetch offers & optimize');
check(await page.waitForSelector('#cmopt-root >> text=Total (estimated)', { timeout: 60000 }).then(() => true, () => false), 'optimizer runs');
const text = await page.locator('#cmopt-root main').innerText();
await page.screenshot({ path: 'docs/store/screenshot-results.png' });
check(/2× Counterspell/.test(text) && /basel_magic/.test(text), 'picks 2 Counterspell from basel_magic');
check(/Proven optimal by the exact solver/.test(text), 'exact solver runs from the solver packaged in the extension');
check(remote.length === 0, `no code or data loaded from outside Cardmarket and the extension${remote.length ? `: ${remote.join(', ')}` : ''}`);

await page.click('#cmopt-root >> text=Add all to cart');
await page.waitForSelector('#cmopt-root >> text=added to your cart', { timeout: 60000 }).catch(() => {});
check(cart.get('30') === 2, `cart got article 30 × 2 through the page's cart script (cart: ${JSON.stringify([...cart])})`);
check(/All 1 added to your cart/.test(await page.locator('#cmopt-root main').innerText()), 'cart result reported');

// The toolbar button: the service worker injects into the page's world and toggles the panel.
const shown = () => page.evaluate(() => document.getElementById('cmopt-root').style.display !== 'none');
const before = await shown();
await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://www.cardmarket.com/*' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => window.__cmoptMount && window.__cmoptMount() });
});
check((await shown()) !== before, 'toolbar button toggles the panel');
await page.screenshot({ path: 'e2e-out/extension.png' });

await ctx.close();
process.exitCode = failed ? 1 : 0;
