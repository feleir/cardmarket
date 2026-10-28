// Scrapes Cardmarket's published shipping costs for every seller country ->
// buyer country pair (the widget on help.cardmarket.com/en/ShippingCosts,
// which reads /api/shippingCosts) into data/shipping-raw.json, then builds
// src/shipping-data.js from it.
//   node scripts/scrape-shipping.mjs          (about 1200 requests, a few minutes)
//   node scripts/scrape-shipping.mjs --build  (rebuild from the saved file only)
import { readFile, writeFile } from 'node:fs/promises';
import { buildTable } from './shipping-table.mjs';

const API = 'https://help.cardmarket.com/api';
const RAW = new URL('../data/shipping-raw.json', import.meta.url);
const OUT = new URL('../src/shipping-data.js', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw new Error(`${path}: ${e.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

let raw;
if (process.argv.includes('--build')) {
  raw = JSON.parse(await readFile(RAW, 'utf8'));
} else {
  const countries = [];
  for (let page = 0; ; page++) {
    const r = await get(`/countries?page=${page}&limit=50&locale=en`);
    countries.push(...r.items);
    if (!r.items.length || countries.length >= r.total) break;
  }
  const list = countries.filter((c) => c.externalId > 0).map((c) => ({ id: c.externalId, name: c.name }));
  const pairs = {};
  let n = 0;
  for (const from of list) {
    for (const to of list) {
      pairs[`${from.id}-${to.id}`] = await get(`/shippingCosts?locale=en&fromCountry=${from.id}&toCountry=${to.id}`);
      if (++n % 50 === 0) console.log(`${n}/${list.length ** 2}`);
      await sleep(150);
    }
  }
  raw = { scraped: new Date().toISOString().slice(0, 10), source: 'https://help.cardmarket.com/en/ShippingCosts', countries: list, pairs };
  await writeFile(RAW, JSON.stringify(raw));
}
const js = buildTable(raw);
await writeFile(OUT, js);
console.log(`${Object.keys(raw.pairs).length} pairs from ${raw.scraped}; src/shipping-data.js ${js.length} bytes`);
