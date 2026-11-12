/**
 * Amount helpers shared by the fixture tests (and by the engine tests later).
 * An "amount string" in expected.json looks like "¼ cup oats": quantity, optional unit, then the
 * ingredient key word(s). See tests/fixtures/README.md.
 */

const FRACTIONS = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8 };
const FR = '[½⅓⅔¼¾⅛]';

export const QTY_SOURCE = `(\\d+)\\s*(${FR})|(\\d+)\\s+(\\d+)\\/(\\d+)|(\\d+)\\/(\\d+)|(${FR})|(\\d+(?:\\.\\d+)?)`;

const UNITS = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg',
  ml: 'ml', l: 'l',
  pinch: 'pinch', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', slice: 'slice', slices: 'slice', stick: 'stick', sticks: 'stick',
};

export function normalizeUnit(word) {
  if (!word) return '';
  return UNITS[word.toLowerCase().replace(/\.$/, '')] ?? '';
}

function qtyFromMatch(m) {
  if (m[1] !== undefined) return Number(m[1]) + FRACTIONS[m[2]];
  if (m[3] !== undefined) return Number(m[3]) + Number(m[4]) / Number(m[5]);
  if (m[6] !== undefined) return Number(m[6]) / Number(m[7]);
  if (m[8] !== undefined) return FRACTIONS[m[8]];
  return Number(m[9]);
}

/** Parse an amount string like "¼ cup oats" into { qty, unit, key }. Returns null if it has no leading quantity. */
export function parseAmount(str) {
  const m = new RegExp(`^\\s*(?:${QTY_SOURCE})\\s*`).exec(str);
  if (!m) return null;
  const qty = qtyFromMatch(m);
  const rest = str.slice(m[0].length).trim();
  const [first, ...others] = rest.split(/\s+/);
  const unit = normalizeUnit(first);
  const key = (unit ? others : [first, ...others]).join(' ').trim();
  return { qty, unit, key };
}

/** Every quantity (with the unit that follows it, if known) found anywhere in a text. */
export function findAmounts(text) {
  const re = new RegExp(`(?:${QTY_SOURCE})\\s*([A-Za-z.]+)?`, 'g');
  const found = [];
  let m;
  while ((m = re.exec(text.toLowerCase())) !== null) {
    found.push({ qty: qtyFromMatch(m), unit: normalizeUnit(m[10]) });
  }
  return found;
}

function toBase({ qty, unit }) {
  switch (unit) {
    case 'tsp': return ['vol', qty];
    case 'tbsp': return ['vol', qty * 3];
    case 'cup': return ['vol', qty * 48];
    case 'oz': return ['mass', qty];
    case 'lb': return ['mass', qty * 16];
    case 'kg': return ['g', qty * 1000];
    case 'l': return ['ml', qty * 1000];
    default: return [unit || 'count', qty];
  }
}

const close = (a, b) => Math.abs(a - b) < 1e-6;

/**
 * True if the amount equals a quantity written in the text, or one that can be derived from them:
 * a sum or difference of two (same kind of unit, two rounds), or a half. Cups, tablespoons and
 * teaspoons convert to each other; pounds and ounces convert to each other.
 */
export function isDerivable(text, amount) {
  const sets = new Map();
  const add = (cat, v) => {
    if (!sets.has(cat)) sets.set(cat, []);
    const arr = sets.get(cat);
    if (v > 0 && !arr.some((x) => close(x, v))) arr.push(v);
  };
  for (const a of findAmounts(text)) add(...toBase(a));
  for (let round = 0; round < 2; round++) {
    for (const [cat, arr] of sets) {
      const snapshot = [...arr];
      for (const x of snapshot) {
        add(cat, x / 2);
        for (const y of snapshot) { add(cat, x + y); add(cat, Math.abs(x - y)); }
      }
    }
  }
  const [cat, v] = toBase(amount);
  return (sets.get(cat) ?? []).some((x) => close(x, v));
}
