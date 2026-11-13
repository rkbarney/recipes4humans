/**
 * Quantities and units: parsing, formatting and arithmetic. Pure functions, no dependencies.
 *
 * A "qty" is a number or a [min, max] range of numbers. A "Quantity" is { qty, unit? } where
 * unit is a canonical unit name (see UNITS). Amounts are never guessed: every parser here
 * returns null when the text is not a quantity it fully understands.
 */

const FRACTION_CHARS = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 1 / 10,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const FR = `[${Object.keys(FRACTION_CHARS).join('')}]`;

const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

// ---------------------------------------------------------------- units

/** Canonical unit -> accepted spellings (lowercase; single-letter case rules are in normalizeUnit). */
const UNIT_WORDS = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tbls', 'tablespoon', 'tablespoons'],
  cup: ['cup', 'cups'],
  oz: ['oz', 'ounce', 'ounces'],
  'fl oz': ['floz'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  g: ['g', 'gm', 'gram', 'grams'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  pt: ['pt', 'pint', 'pints'],
  qt: ['qt', 'quart', 'quarts'],
  gal: ['gal', 'gallon', 'gallons'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  tin: ['tin', 'tins'],
  package: ['package', 'packages', 'pkg', 'pkgs', 'packet', 'packets'],
  rib: ['rib', 'ribs'],
  stick: ['stick', 'sticks'],
  sprig: ['sprig', 'sprigs'],
  bunch: ['bunch', 'bunches'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
  head: ['head', 'heads'],
  stalk: ['stalk', 'stalks'],
};

const WORD_TO_UNIT = new Map();
for (const [unit, words] of Object.entries(UNIT_WORDS)) for (const w of words) WORD_TO_UNIT.set(w, unit);

/** Canonical unit names this module knows. */
export const UNITS = Object.freeze(Object.keys(UNIT_WORDS));

/** Teaspoons per unit, for the units convertUnit understands. */
const TSP_PER = { tsp: 1, tbsp: 3, cup: 48 };

/**
 * Canonical unit for a word, or undefined. Accepts plurals and abbreviations with or without a trailing
 * period. Single letters: "T" is tbsp, "t" is tsp (case matters); "c"/"C" cup; "g", "l"/"L".
 * @param {string} word
 * @returns {string | undefined}
 */
export function normalizeUnit(word) {
  if (typeof word !== 'string') return undefined;
  const w = word.trim().replace(/\.$/, '');
  if (w === 'T') return 'tbsp';
  if (w === 't') return 'tsp';
  if (w === 'c' || w === 'C') return 'cup';
  if (w === 'L') return 'l';
  return WORD_TO_UNIT.get(w.toLowerCase());
}

/**
 * Match a unit word at the start of a string (no leading whitespace skipped).
 * @param {string} str
 * @returns {{unit: string, length: number} | null}  length counts the word and one trailing period.
 */
export function matchUnitPrefix(str) {
  const m = /^([A-Za-z]+)(\.?)(?![A-Za-z])/.exec(str);
  if (!m) return null;
  if (m[1].toLowerCase() === 'fl') {
    const n = /^\.?\s+oz\.?(?![A-Za-z])/i.exec(str.slice(m[1].length));
    return n ? { unit: 'fl oz', length: m[1].length + n[0].length } : null;
  }
  const unit = normalizeUnit(m[1]);
  return unit ? { unit, length: m[0].length } : null;
}

/** True for units convertUnit can convert between (tsp, tbsp, cup). */
export function isVolumeUnit(unit) {
  return Object.hasOwn(TSP_PER, unit);
}

/**
 * Convert a number between tsp, tbsp and cup.
 * @returns {number | null} null when either unit is not convertible.
 */
export function convertUnit(n, from, to) {
  if (!isVolumeUnit(from) || !isVolumeUnit(to)) return null;
  return clean((n * TSP_PER[from]) / TSP_PER[to]);
}

/**
 * Convert a Quantity to another of tsp, tbsp, cup (ranges convert both ends).
 * @param {{qty: number | [number, number], unit?: string}} q
 * @returns {{qty: number | [number, number], unit: string} | null}
 */
export function convertQuantity(q, toUnit) {
  if (!q || q.unit === undefined) return null;
  if (q.unit === toUnit) return { qty: q.qty, unit: toUnit };
  const f = (n) => convertUnit(n, q.unit, toUnit);
  if (Array.isArray(q.qty)) {
    const lo = f(q.qty[0]);
    const hi = f(q.qty[1]);
    return lo === null || hi === null ? null : { qty: [lo, hi], unit: toUnit };
  }
  const v = f(q.qty);
  return v === null ? null : { qty: v, unit: toUnit };
}

// ---------------------------------------------------------------- parsing

const NUM = [
  `\\d+\\s*${FR}`,            // 1½, 1 ½
  `\\d+[ -]\\d+\\/\\d+`,      // 1 1/2, 1-1/2
  `\\d+\\/\\d+`,              // 1/2
  FR,                          // ½
  `\\d*\\.\\d+`,              // .5, 1.5
  `\\d+`,                     // 3
].join('|');
const NUM_RE = new RegExp(`^(?:${NUM})`);
const WORD_RE = new RegExp(`^(${Object.keys(NUM_WORDS).join('|')})(?![A-Za-z])`, 'i');

/** Parse one number at the start of str. Returns {value, length} or null. */
function numberPrefix(str) {
  const m = NUM_RE.exec(str);
  if (!m) {
    const w = WORD_RE.exec(str);
    return w ? { value: NUM_WORDS[w[1].toLowerCase()], length: w[0].length } : null;
  }
  const t = m[0];
  let value;
  let x;
  if ((x = new RegExp(`^(\\d+)\\s*(${FR})$`).exec(t))) value = Number(x[1]) + FRACTION_CHARS[x[2]];
  else if ((x = /^(\d+)[ -](\d+)\/(\d+)$/.exec(t))) value = Number(x[3]) === 0 ? NaN : Number(x[1]) + Number(x[2]) / Number(x[3]);
  else if ((x = /^(\d+)\/(\d+)$/.exec(t))) value = Number(x[2]) === 0 ? NaN : Number(x[1]) / Number(x[2]);
  else if (t in FRACTION_CHARS) value = FRACTION_CHARS[t];
  else value = Number(t);
  if (!Number.isFinite(value)) return null;
  return { value, length: t.length };
}

/**
 * Parse a quantity at the start of a string: number, decimal, fraction character, typed fraction,
 * mixed number or range ("5 to 7", "5-7", "5 or 7"). Number words one to twelve are accepted.
 * Returns null if the text does not start with a quantity or the quantity is zero or a reversed range.
 * @param {string} str
 * @returns {{qty: number | [number, number], length: number} | null}  length = characters consumed.
 */
export function parseQuantityPrefix(str) {
  const a = numberPrefix(str);
  if (!a || a.value <= 0) return null;
  const rest = str.slice(a.length);
  const sep = /^(?:\s*[-–—]\s*|\s+to\s+|\s+or\s+)/i.exec(rest);
  if (sep) {
    const b = numberPrefix(rest.slice(sep[0].length));
    // "or" only joins two plain numerals; never a number word ("1 or two" is not a range we trust).
    if (b && b.value > 0) {
      const isOr = /or/i.test(sep[0]);
      if (!(isOr && (!/^\d/.test(str) || !/^\d/.test(rest.slice(sep[0].length))))) {
        if (b.value < a.value) return null;
        const length = a.length + sep[0].length + b.length;
        return { qty: b.value === a.value ? a.value : [a.value, b.value], length };
      }
    }
  }
  return { qty: a.value, length: a.length };
}

/**
 * Parse a whole string as a quantity ("1 1/2", "5 to 7", "¼"). Null if anything else is in it.
 * @param {string} str
 * @returns {number | [number, number] | null}
 */
export function parseQuantity(str) {
  const s = String(str ?? '').trim();
  const r = parseQuantityPrefix(s);
  return r && r.length === s.length ? r.qty : null;
}

/**
 * Parse a whole string as quantity plus optional unit: "240 ml", "14-ounce", "2 tbsp.", "1½ cups", "3".
 * @returns {{qty: number | [number, number], unit?: string} | null}
 */
export function parseAmount(str) {
  const s = String(str ?? '').trim();
  const q = parseQuantityPrefix(s);
  if (!q) return null;
  const rest = s.slice(q.length).replace(/^[\s-]+/, '');
  if (rest === '') return { qty: q.qty };
  const u = matchUnitPrefix(rest);
  return u && u.length === rest.length ? { qty: q.qty, unit: u.unit } : null;
}

// ---------------------------------------------------------------- formatting

const EPS = 1e-6;
const FRACTION_DISPLAY = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

function clean(n) {
  return Math.round(n * 1e12) / 1e12;
}

/** Format one number: 0.25 gives "¼", 1.5 gives "1½", 2 gives "2", 0.1 gives "0.1". */
export function formatNumber(n) {
  let whole = Math.floor(n + EPS);
  const frac = n - whole;
  if (Math.abs(frac) < EPS) return String(whole);
  if (Math.abs(frac - 1) < EPS) return String(whole + 1);
  for (const [v, ch] of FRACTION_DISPLAY) {
    if (Math.abs(frac - v) < EPS) return whole === 0 ? ch : `${whole}${ch}`;
  }
  whole = Math.round(n * 100) / 100;
  return String(whole);
}

/**
 * Format a quantity for display: formatQuantity(0.25, 'cup') is "¼ cup", formatQuantity(1, 'tbsp') is
 * "1 tbsp", a range is "5 to 7 min". Also accepts a Quantity object. The unit is the canonical name,
 * never pluralised.
 * @param {number | [number, number] | {qty: number | [number, number], unit?: string}} qty
 * @param {string} [unit]
 */
export function formatQuantity(qty, unit) {
  if (qty !== null && typeof qty === 'object' && !Array.isArray(qty)) return formatQuantity(qty.qty, qty.unit);
  const n = Array.isArray(qty) ? `${formatNumber(qty[0])} to ${formatNumber(qty[1])}` : formatNumber(qty);
  return unit ? `${n} ${unit}` : n;
}

// ---------------------------------------------------------------- arithmetic

const bounds = (q) => (Array.isArray(q) ? q : [q, q]);
const collapse = (lo, hi) => {
  lo = clean(lo);
  hi = clean(hi);
  return lo === hi ? lo : [lo, hi];
};

/** Bring two Quantities to a common unit, or null when they cannot be combined. */
function align(a, b) {
  if (!a || !b) return null;
  if (a.unit === b.unit) return [a, b, a.unit];
  if (isVolumeUnit(a.unit) && isVolumeUnit(b.unit)) {
    const to = TSP_PER[a.unit] <= TSP_PER[b.unit] ? a.unit : b.unit; // smaller unit keeps results exact
    return [convertQuantity(a, to), convertQuantity(b, to), to];
  }
  return null;
}

/**
 * Add two Quantities. Same unit adds directly; tsp, tbsp and cup are converted to the smaller of the two
 * units. Anything else (g and oz, no unit and cup) returns null: totals are never guessed. Ranges add
 * end to end.
 * @param {{qty: number | [number, number], unit?: string}} a
 * @param {{qty: number | [number, number], unit?: string}} b
 * @returns {{qty: number | [number, number], unit?: string} | null}
 */
export function addQuantities(a, b) {
  const al = align(a, b);
  if (!al) return null;
  const [x, y, unit] = al;
  const [xl, xh] = bounds(x.qty);
  const [yl, yh] = bounds(y.qty);
  const out = { qty: collapse(xl + yl, xh + yh) };
  if (unit !== undefined) out.unit = unit;
  return out;
}

/**
 * Subtract b from a (what is left of a after using b). Null for incompatible units or when b is more
 * than a. If either side is a range the result is the widest range that is certain.
 */
export function subtractQuantities(a, b) {
  const al = align(a, b);
  if (!al) return null;
  const [x, y, unit] = al;
  const [xl, xh] = bounds(x.qty);
  const [yl, yh] = bounds(y.qty);
  const lo = xl - yh;
  const hi = xh - yl;
  if (lo < -EPS) return null;
  const out = { qty: collapse(Math.max(lo, 0), Math.max(hi, 0)) };
  if (unit !== undefined) out.unit = unit;
  return out;
}
