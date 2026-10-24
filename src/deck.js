// Decklists pasted from deck sites (Moxfield, Archidekt, MTGGoldfish,
// MTGTop8, Arena, MTGO): one card per line with a count, optional set code,
// collector number and foil marker, and optional section headings.

const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']);

const SECTION = /^(?:\/\/\s*)?(deck|main ?deck|mainboard|main|sideboard|side|commander|commanders|companion|maybeboard|maybe|considering|tokens?)\s*:?\s*(?:\(\d+\))?$/i;

// "4 Lightning Bolt", "4x Lightning Bolt (M10) 146", "1 Sol Ring [CMR] *F*",
// "SB: 2 Duress", "Lightning Bolt" -> { quantity, name, sideboard }
function parseLine(raw) {
  let line = raw.trim();
  let sideboard = false;
  if (/^SB:\s*/i.test(line)) { sideboard = true; line = line.replace(/^SB:\s*/i, ''); }
  const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  const quantity = m ? Number(m[1]) : 1;
  let name = (m ? m[2] : line)
    .replace(/\s+\*[^*]+\*\s*$/g, '')            // *F*, *E* foil/etched markers
    .replace(/\s+[([][A-Za-z0-9]{2,6}[)\]](\s+\S+)?\s*$/, '') // (SET) 123 / [SET]
    .replace(/\s+#\S+$/, '')                        // Archidekt tags
    .replace(/\s+\^[^^]*\^$/, '')                   // Archidekt categories
    .trim();
  return name ? { quantity, name, sideboard } : null;
}

// text -> [{ name, quantity }] merged by name, in first-seen order.
export function parseDecklist(text, { includeSideboard = true, skipBasics = true } = {}) {
  const out = new Map();
  let section = 'main';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { if (section === 'main' && out.size) section = 'after-blank'; continue; }
    if (/^(#|\/\/(?!\s*(sideboard|deck|commander)))/i.test(line) && !SECTION.test(line)) continue;
    const head = line.match(SECTION);
    if (head) {
      const h = head[1].toLowerCase();
      section = /side/.test(h) ? 'side' : /maybe|consider|token/.test(h) ? 'skip' : 'main';
      continue;
    }
    const card = parseLine(line);
    if (!card) continue;
    // Arena/MTGO lists put the sideboard after a blank line, without a heading.
    const side = card.sideboard || section === 'side' || section === 'after-blank';
    if (section === 'skip') continue;
    if (side && !includeSideboard) continue;
    if (skipBasics && BASICS.has(card.name.toLowerCase())) continue;
    const key = card.name.toLowerCase();
    const prev = out.get(key);
    if (prev) prev.quantity += card.quantity;
    else out.set(key, { name: card.name, quantity: card.quantity });
  }
  return [...out.values()];
}
