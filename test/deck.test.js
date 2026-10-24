import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecklist } from '../src/deck.js';

test('Moxfield / Arena export with sections, set codes and foil markers', () => {
  const text = `Deck
4 Lightning Bolt (M10) 146
4x Goblin Guide [ZEN]
2 Sol Ring (CMR) 472 *F*
20 Mountain

Sideboard
2 Duress (M19) 94
1 Lightning Bolt`;
  assert.deepEqual(parseDecklist(text), [
    { name: 'Lightning Bolt', quantity: 5 }, { name: 'Goblin Guide', quantity: 4 },
    { name: 'Sol Ring', quantity: 2 }, { name: 'Duress', quantity: 2 },
  ]);
  assert.deepEqual(parseDecklist(text, { includeSideboard: false }).map((c) => c.quantity), [4, 4, 2]);
  assert.equal(parseDecklist(text, { skipBasics: false }).find((c) => c.name === 'Mountain').quantity, 20);
});

test('MTGO style: sideboard after a blank line, SB: prefixes, commander and maybeboard', () => {
  assert.deepEqual(parseDecklist('4 Counterspell\n2 Brainstorm\n\n3 Pyroblast'), [
    { name: 'Counterspell', quantity: 4 }, { name: 'Brainstorm', quantity: 2 }, { name: 'Pyroblast', quantity: 3 }]);
  assert.deepEqual(parseDecklist('4 Counterspell\nSB: 2 Pyroblast', { includeSideboard: false }), [{ name: 'Counterspell', quantity: 4 }]);
  const edh = `Commander\n1 Atraxa, Praetors' Voice (2X2) 190\n\nDeck\n1 Sol Ring\n1 Delver of Secrets // Insectile Aberration\n\nMaybeboard\n1 Black Lotus`;
  assert.deepEqual(parseDecklist(edh).map((c) => c.name), ["Atraxa, Praetors' Voice", 'Sol Ring', 'Delver of Secrets // Insectile Aberration']);
});

test('deck cards are read from their card page, or found with the search', async () => {
  const { parseHTML } = await import('linkedom');
  const { deckWants, collectDeck } = await import('../src/collect.js');
  const { DEFAULT_SETTINGS } = await import('../src/constants.js');
  const { offerRow, productPage } = await import('./fixtures.js');
  const doc = (h) => parseHTML(h).document;
  const pages = {
    '/en/Magic/Cards/Lightning-Bolt': productPage({ title: 'Lightning Bolt', expansion: '', rows: [offerRow({ id: 1, seller: 'a', price: '0,50 €', count: 4, expansion: 'Magic 2010' })] }),
    // Not at the guessed address: the search finds it.
    '/en/Magic/Products/Search': '<!doctype html><html><body><a href="/en/Magic/Cards/AEther-Vial">Aether Vial</a></body></html>',
    '/en/Magic/Cards/AEther-Vial': productPage({ title: 'Aether Vial', expansion: '', rows: [offerRow({ id: 2, seller: 'b', price: '9,00 €', expansion: 'Darksteel' })] }),
  };
  const fetched = [];
  const mem = new Map();
  const fetcher = { cached: (u) => mem.get(u), store: (u, v) => mem.set(u, v),
    doc: async (u) => { fetched.push(u); const h = pages[u.split('?')[0]]; return h ? doc(h) : null; } };
  const wants = deckWants([{ name: 'Lightning Bolt', quantity: 4 }, { name: 'Aether Vial', quantity: 1 }, { name: 'Made Up Card', quantity: 1 }]);
  const log = [];
  await collectDeck(fetcher, wants, { ...DEFAULT_SETTINGS }, 'Magic', null, (m) => log.push(m));
  assert.deepEqual(wants.map((w) => [w.name, w.offers.length, !!w.notFound]), [['Lightning Bolt', 1, false], ['Aether Vial', 1, false], ['Made Up Card', 0, true]]);
  assert.equal(wants[1].url, '/en/Magic/Cards/AEther-Vial');
  assert.ok(fetched[0].startsWith('/en/Magic/Cards/Lightning-Bolt?sellerCountry=4'));
});
