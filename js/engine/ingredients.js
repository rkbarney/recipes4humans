/**
 * Stage 1: parse ingredient lines (docs/SPEC.md, "1. Ingredient parsing").
 *
 * Principle: a wrong amount is worse than a missing one. A line whose quantity cannot be read with
 * confidence comes back with no quantity and an `unparseable-quantity` flag.
 */
import { parseQuantityPrefix, parseAmount, matchUnitPrefix } from './quantity.js';
import { stem } from './text-utils.js';

/** @typedef {import('./types.js').ParsedIngredient} ParsedIngredient */
/** @typedef {import('./types.js').Flag} Flag */

const FRACTION_CHARS = '¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const STARTS_NUMERIC = new RegExp(`^(?:\\d|\\.\\d|[${FRACTION_CHARS}])`);

const PREP_RE = new RegExp(
  '\\b(?:diced|grated|chopped|minced|sliced|juiced|zested|halved|peeled|drained|rinsed|melted|softened|squeezed|'
  + 'cut into|cubed|shredded|crushed|crumbled|trimmed|mashed|beaten|toasted|quartered|seeded|cored|thawed|'
  + 'julienned|torn|pitted|deveined|stemmed|cooked|washed|scrubbed)\\b',
  'i',
);

/** Words kept in `name` for display but dropped from `head`, which is used for matching. */
const DESCRIPTORS = new Set([
  'fresh', 'freshly', 'ground', 'packed', 'low-sodium', 'reduced-sodium', 'low-fat', 'reduced-fat', 'fat-free',
  'nonfat', 'unsalted', 'salted', 'sweetened', 'unsweetened', 'kosher', 'small', 'medium', 'large',
  'extra-large', 'jumbo', 'big', 'red', 'green', 'yellow', 'white', 'black', 'brown', 'golden', 'dried', 'dry',
  'raw', 'cooked', 'boneless', 'skinless', 'bone-in', 'skin-on', 'baby', 'plain', 'extra-virgin', 'virgin',
  'all-purpose', 'rolled', 'crumbled', 'grated', 'shredded', 'roasted', 'toasted', 'chopped', 'diced', 'sliced',
  'minced', 'crushed', 'canned', 'frozen', 'thawed', 'organic', 'heaping', 'finely', 'coarsely', 'roughly',
  'thinly', 'lightly', 'ripe', 'thick-cut', 'thin', 'pitted', 'peeled',
]);

const MODIFIERS_BEFORE_UNIT = /^(packed|heaping|heaped|level|scant|generous|rounded)\s+/i;
/** "about 6 cups flour": an approximation word in front of the amount is dropped, the amount is kept. */
const APPROX_BEFORE_QTY = /^(?:about|approximately|approx\.?|roughly|around|~)\s*(?=\d|[¼½¾⅓⅔⅛⅜⅝⅞])/i;
/** "4 large cloves garlic", "2 medium ribs celery": a size word between the amount and its unit describes the unit. */
const SIZE_BEFORE_UNIT = /^(?:small|medium|large|big|jumbo)\s+/i;
/** "3 ea. bananas", "2 each lemons": a count marker, not a unit. */
const EACH_MARKER = /^(?:ea\.?|each)(?![A-Za-z])\s*/i;
const ARTICLE_UNITS = new Set(['pinch', 'dash', 'clove', 'can', 'stick', 'sprig', 'bunch', 'slice', 'piece', 'head', 'stalk']);
const VAGUE_QUANTITY = /^(?:half|quarter|dozen|couple|few|several)\b/i;
const TRAILING_PHRASE = /\s+(to taste|as needed|for serving|for garnish|for garnishing|to serve|optional)$/i;
/** "vegetable oil for frying and stir-frying": what the ingredient is for is not part of its name. */
const PURPOSE_PHRASE = /\s+for\s+[A-Za-z-]+ing(?:\s+(?:and|or)\s+[A-Za-z-]+ing)*$/i;

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Strip leading numbers and stray punctuation so a line we could not read still gets a usable name. */
function fallbackName(text) {
  return text.replace(new RegExp(`^[\\d\\s.,/${FRACTION_CHARS}\\-–—]+`), '').trim() || text.trim();
}

const descriptorKey = (tok) => String(tok || '').toLowerCase().replace(/[,;.]+$/, '');

/** "yellow or white cornmeal": an "or" with a descriptor on each side and a word after them joins descriptors, not ingredients. */
const DESCRIPTOR_OR = /(?<![\w-])([\w-]+)\s+or\s+([\w-]+)(?=\s+\S)/gi;
function maskDescriptorOr(name) {
  return name.replace(DESCRIPTOR_OR, (m, a, b) => (DESCRIPTORS.has(a.toLowerCase()) && DESCRIPTORS.has(b.toLowerCase()) ? `${a} ${b}` : m));
}

function computeHead(name) {
  const descriptors = [];
  const kept = [];
  const toks = name.split(/\s+/).filter(Boolean);
  toks.forEach((tok, i) => {
    const key = descriptorKey(tok);
    if (key === 'or' && DESCRIPTORS.has(descriptorKey(toks[i - 1])) && DESCRIPTORS.has(descriptorKey(toks[i + 1])) && i + 2 < toks.length) return;
    if (DESCRIPTORS.has(key)) descriptors.push(tok);
    else kept.push(tok);
  });
  if (kept.length === 0) return { head: name.toLowerCase().trim(), descriptors: [] };
  return { head: kept.join(' ').toLowerCase().replace(/[,;.]+$/, ''), descriptors };
}

// ---------------------------------------------------------------- pieces of text after a comma or in parentheses

/** Mutable collection of what the notes of one line say. */
function newNotes() {
  return { divided: false, prep: [], servingTag: false, plusMoreServing: false, extra: [] };
}

function addNote(piece, notes) {
  let s = piece.trim();
  if (!s) return;
  if (/\bdivided\b/i.test(s)) {
    notes.divided = true;
    s = s.replace(/\bdivided\b/gi, '').replace(/^[\s,;]*(?:and\s+)?|(?:\s+and)?[\s,;]*$/gi, '').trim();
    if (!s) return;
  }
  let m = /^plus\s+(.*)$/i.exec(s);
  if (m) {
    if (/^(?:more|extra|additional)\b/i.test(m[1])) {
      if (/\b(?:serving|garnish|serve)\b/i.test(m[1])) notes.plusMoreServing = true;
      return;
    }
    const q = parseQuantityPrefix(m[1]);
    const u = q && matchUnitPrefix(m[1].slice(q.length).trimStart());
    if (q && u) notes.extra.push({ qty: q.qty, unit: u.unit });
    return;
  }
  m = /\b(?:for|to)\s+(?:serving|serve|garnish|garnishing)\b/i.exec(s);
  if (m && !PREP_RE.test(s.replace(m[0], ''))) {
    notes.servingTag = true;
    return;
  }
  // An optional step ("optionally peeled") is not an instruction the recipe needs.
  if (/\boptional(?:ly)?\b/i.test(s)) return;
  if (PREP_RE.test(s)) {
    notes.prep.push(s);
    if (m) notes.servingTag = true;
  }
}

/** Is there a quantity followed by a word at the start of s? */
function quantityThenWord(s) {
  const q = parseQuantityPrefix(s);
  return q && /^\s+[A-Za-z]/.test(s.slice(q.length));
}

/**
 * "½ diced, and ½ grated, then squeezed dry" -> [{qty: .5, prep: 'diced'}, {qty: .5, prep: 'grated, then squeezed dry'}].
 * Null unless every segment is a quantity (no unit) followed by prep wording.
 */
function fractionSegments(content) {
  if (!quantityThenWord(content)) return null;
  const starts = [0];
  const re = /,\s*(?:and\s+)?|\s+and\s+|;\s*/g;
  let m;
  while ((m = re.exec(content))) {
    const at = m.index + m[0].length;
    if (quantityThenWord(content.slice(at))) starts.push(at);
  }
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = content.slice(starts[i], starts[i + 1] ?? content.length).replace(/(?:[\s,;]+and)?[\s,;]*$/i, '').trim();
    const q = parseQuantityPrefix(seg);
    if (!q || Array.isArray(q.qty)) return null;
    const rest = seg.slice(q.length).trim();
    if (!rest || matchUnitPrefix(rest) || !PREP_RE.test(rest)) return null;
    out.push({ qty: q.qty, prep: rest });
  }
  return out;
}

// ---------------------------------------------------------------- one line

/**
 * @returns {{items: object[], flagMessage?: string}}  items are ingredients without ids and group.
 */
function parseLine(raw) {
  let text = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:[-*•▢☐]\s+)/, '')
    // "1 cup + 2 tablespoons flour" is "1 cup plus 2 tablespoons flour"; reading only the first part would be a wrong amount.
    .replace(/\s\+\s/g, ' plus ');

  const parens = [];
  text = text.replace(/\(([^()]*)\)/g, (_, c) => { parens.push(c.trim()); return ' '; });
  text = text.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

  let comma = text.indexOf(',');
  // "boneless, skinless chicken breasts": a comma between descriptor words does not end the name.
  const onlyDescriptors = (t) => {
    const words = t.trim().split(/\s+/).filter((w) => !/^[\d½¼¾⅓⅔⅛./-]+$/.test(w) && !/^(?:cups?|tbsp|tsp|oz|lbs?|g|ml|c\.?|can|cans)\.?$/i.test(w));
    return words.length > 0 && words.every((w) => DESCRIPTORS.has(descriptorKey(w)));
  };
  while (comma >= 0 && onlyDescriptors(text.slice(0, comma)) && /[A-Za-z]/.test(text.slice(comma + 1))) comma = text.indexOf(',', comma + 1);
  const headText = (comma < 0 ? text : text.slice(0, comma)).replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const tailText = comma < 0 ? '' : text.slice(comma + 1);

  // ---- quantity and unit
  let rest = headText.replace(APPROX_BEFORE_QTY, '');
  let qty;
  let unit;
  let alt;
  const extraPortions = [];
  let bad = null;
  let prefixWords = '';

  const q = parseQuantityPrefix(rest);
  const article = /^(?:a|an)\s+/i.exec(rest);
  if (q) {
    qty = q.qty;
    rest = rest.slice(q.length).trimStart();
    let mod;
    const mods = [];
    while ((mod = MODIFIERS_BEFORE_UNIT.exec(rest))) {
      mods.push(mod[1]);
      rest = rest.slice(mod[0].length);
    }
    prefixWords = mods.join(' ');
    const eachMark = EACH_MARKER.exec(rest);
    if (eachMark) rest = rest.slice(eachMark[0].length);
    let u = matchUnitPrefix(rest);
    const size = SIZE_BEFORE_UNIT.exec(rest);
    if (!u && size) {
      const after = matchUnitPrefix(rest.slice(size[0].length));
      if (after) { u = { unit: after.unit, length: size[0].length + after.length }; }
    }
    if (u) {
      unit = u.unit;
      rest = rest.slice(u.length).trimStart().replace(/^of\s+/i, '');
      let m;
      while (unit && (m = /^plus\s+/i.exec(rest))) {
        const q2 = parseQuantityPrefix(rest.slice(m[0].length));
        const after = q2 && rest.slice(m[0].length + q2.length).trimStart();
        const u2 = after && matchUnitPrefix(after);
        if (!u2) break;
        extraPortions.push({ qty: q2.qty, unit: u2.unit });
        rest = after.slice(u2.length).trimStart().replace(/^of\s+/i, '');
      }
      const slash = /^\/\s*/.exec(rest);
      if (slash) {
        const q3 = parseQuantityPrefix(rest.slice(slash[0].length));
        const after = q3 && rest.slice(slash[0].length + q3.length).trimStart();
        const u3 = after && matchUnitPrefix(after);
        if (u3) {
          alt = { qty: q3.qty, unit: u3.unit };
          rest = after.slice(u3.length).trimStart();
        }
      }
    }
  } else if (article && ARTICLE_UNITS.has(matchUnitPrefix(rest.slice(article[0].length))?.unit)) {
    const u = matchUnitPrefix(rest.slice(article[0].length));
    qty = 1;
    unit = u.unit;
    rest = rest.slice(article[0].length + u.length).trimStart().replace(/^of\s+/i, '');
  } else if (['pinch', 'dash'].includes(matchUnitPrefix(rest)?.unit) && /^\w+\s+of\s+/i.test(rest)) {
    const u = matchUnitPrefix(rest);
    qty = 1;
    unit = u.unit;
    rest = rest.slice(u.length).trimStart().replace(/^of\s+/i, '');
  } else if (STARTS_NUMERIC.test(rest)) {
    bad = 'quantity not understood';
  } else if (VAGUE_QUANTITY.test(rest)) {
    bad = 'vague quantity';
  }

  let name = (prefixWords ? `${prefixWords} ${rest}` : rest).trim();
  const notes = newNotes();

  // A name that still starts like a quantity means we mis-read the line.
  if (!bad && qty !== undefined) {
    if (/^\d/.test(name) && !/^\d+(?:\.\d+)?%/.test(name)) bad = 'text after the quantity starts with a number';
    else if (new RegExp(`^[${FRACTION_CHARS}]`).test(name)) bad = 'text after the quantity starts with a fraction';
    else if (/^(?:[-–—]|or\b|to\b|plus\b|and\b)/i.test(name)) bad = 'text after the quantity is not an ingredient name';
    else if (/\bplus\b/i.test(name)) bad = 'more than one amount in the line';
    else if (name === '') bad = 'no ingredient name';
  }
  if (bad) {
    qty = undefined;
    unit = undefined;
    alt = undefined;
    extraPortions.length = 0;
    name = fallbackName(headText);
  }

  // Trailing phrases glued to the name ("salt to taste").
  let m;
  while ((m = TRAILING_PHRASE.exec(name) || PURPOSE_PHRASE.exec(name))) {
    if (m[1] && /serv|garnish/i.test(m[1])) notes.servingTag = true;
    name = name.slice(0, m.index).trim();
  }

  // ---- notes from the comma tail and from parentheses
  let fraction = null;
  for (const piece of tailText.split(',')) addNote(piece, notes);
  for (const content of parens) {
    if (!bad && qty !== undefined && !Array.isArray(qty)) {
      const seg = fractionSegments(content);
      if (seg) {
        const sum = seg.reduce((a, s) => a + s.qty, 0);
        if (fraction === null && Math.abs(sum - qty) < 1e-6) {
          fraction = seg;
          continue;
        }
        bad = 'parts in parentheses do not add up to the amount';
        break;
      }
    }
    for (const piece of content.split(',')) {
      const amt = parseAmount(piece);
      if (amt && amt.unit && !alt) alt = amt;
      else addNote(piece, notes);
    }
  }
  if (bad && qty !== undefined) {
    qty = undefined;
    unit = undefined;
    alt = undefined;
    fraction = null;
    extraPortions.length = 0;
  }

  // A prep note that only repeats the name ("freshly squeezed lemon juice (that is, freshly squeezed)") adds no step.
  const nameStems = new Set((name.match(/[A-Za-z]+/g) || []).map((w) => stem(w)));
  notes.prep = notes.prep.filter((piece) => {
    const words = (piece.match(new RegExp(PREP_RE.source, 'gi')) || []).filter((w) => !/\s/.test(w));
    return !(words.length && words.every((w) => nameStems.has(stem(w))));
  });

  // ---- names: unmeasured "A and B" lines, then alternates
  let names = [name];
  let alternates = [];
  if (!name) names = [raw.trim()];
  else if (!/\s+or\s+/i.test(name) && qty === undefined && !bad) {
    const parts = name.split(/\s+and\s+/i);
    if (parts.length === 2 && parts.every((p) => p.split(/\s+/).length <= 3) && !/^half and half$/i.test(name)) names = parts.map((p) => p.trim());
  }
  if (names.length === 1 && /\s+or\s+/i.test(maskDescriptorOr(names[0]))) {
    const parts = names[0].split(/\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
    names = [parts[0]];
    alternates = parts.slice(1).map((p) => {
      const pq = parseQuantityPrefix(p);
      if (!pq) return p;
      const after = p.slice(pq.length).trimStart();
      const pu = matchUnitPrefix(after);
      return (pu ? after.slice(pu.length).trimStart().replace(/^of\s+/i, '') : after) || p;
    });
  }

  // ---- portions
  const mk = () => {
    let portions;
    if (fraction) {
      portions = fraction.map((f) => (unit ? { qty: f.qty, unit, prep: f.prep } : { qty: f.qty, prep: f.prep }));
    } else if (qty !== undefined) {
      portions = [unit ? { qty, unit } : { qty }];
      for (const e of [...extraPortions, ...notes.extra]) portions.push({ ...e });
    } else {
      portions = [{}];
    }
    if (!fraction) {
      if (notes.prep.length) for (const p of portions) p.prep = notes.prep.join(', ');
      if (alt && portions.length === 1) portions[0].alt = { ...alt };
      if (notes.servingTag && !notes.plusMoreServing) portions[0].tag = 'serving';
    }
    if (notes.plusMoreServing) portions.push({ tag: 'serving' });
    return portions;
  };

  const items = names.map((n, idx) => {
    const { head, descriptors } = computeHead(n);
    return {
      raw,
      name: n,
      head,
      descriptors,
      alternates: idx === 0 ? alternates : [],
      divided: notes.divided,
      portions: clone(mk()),
    };
  });
  return { items, flagMessage: bad ? `Could not read the amount in "${raw.trim()}" (${bad}).` : undefined };
}

// ---------------------------------------------------------------- stage entry point

/**
 * Stage 1: parse ingredient lines.
 * @param {string[]} lines  One entry per ingredient line, bullets removed. Group headers ("For the sauce:") are included as lines.
 * @returns {{ingredients: ParsedIngredient[], flags: Flag[]}}
 *   Ingredients in list order, ids i1..iN (headers produce no ingredient). Flags: unparseable-quantity.
 */
export function parseIngredients(lines) {
  const list = typeof lines === 'string' ? lines.split('\n') : Array.from(lines ?? [], String);
  const ingredients = [];
  const flags = [];
  let group;
  for (const raw of list) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(':')) {
      const g = line.slice(0, -1).trim();
      if (g) group = g;
      continue;
    }
    const { items, flagMessage } = parseLine(raw);
    for (const item of items) {
      const ing = { id: `i${ingredients.length + 1}`, ...item };
      if (group !== undefined) ing.group = group;
      ingredients.push(ing);
      if (flagMessage) flags.push({ ingredientId: ing.id, code: 'unparseable-quantity', message: flagMessage });
    }
  }
  return { ingredients, flags };
}
