/**
 * Small text helpers shared by stages 3 to 6: tokenizing step text, comparing words as singulars,
 * finding the verb an action starts with, and recognising prep words. Pure functions.
 */
import { COOKING_VERBS } from './verbs.js';

export const FRACTION_GLYPHS = '½¼¾⅓⅔⅛⅜⅝⅞';
const LETTER = 'A-Za-zÀ-ÖØ-öø-ÿ';

/**
 * Tokens of a text, with offsets. Types: 'w' word, 'n' number or fraction glyph, 'p' any other character.
 * A hyphen between two letters does not make a token: "red-pepper" is the words red and pepper, both
 * marked `hy`, so phrases can be compared word by word.
 * @param {string} text
 * @returns {{type: 'w'|'n'|'p', text: string, lower: string, start: number, end: number, hy?: boolean}[]}
 */
export function tokenize(text) {
  const re = new RegExp(`[${LETTER}]+(?:['’][${LETTER}]+)?|\\d+(?:[.,]\\d+)?|[${FRACTION_GLYPHS}]|\\S`, 'g');
  const raw = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0];
    const type = new RegExp(`^[${LETTER}]`).test(t) ? 'w' : /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(t) ? 'n' : 'p';
    raw.push({ type, text: t, lower: t.toLowerCase(), start: m.index, end: m.index + t.length });
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const prev = out[out.length - 1];
    const next = raw[i + 1];
    if (t.text === '-' && prev && prev.type === 'w' && prev.end === t.start && next && next.type === 'w' && next.start === t.end) {
      prev.hy = true;
      next.hy = true;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** A word reduced to a form that is the same for singular and plural: tomatoes and tomato, leaves and leaf is not tried. */
export function singular(word) {
  const w = String(word).toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|sses|oes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Words that never belong to an ingredient's name, so they stop a noun phrase. */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'with', 'in', 'into', 'to', 'on', 'onto', 'over', 'for', 'from', 'until', 'till',
  'then', 'plus', 'each', 'per', 'about', 'your', 'this', 'that', 'these', 'those', 'it', 'them', 'more', 'most', 'some',
  'remaining', 'rest', 'other', 'half', 'any', 'all', 'at', 'by', 'as', 'if', 'when', 'once', 'while', 'but', 'so', 'no',
  'extra', 'additional', 'another', 'both', 'into', 'under', 'around', 'through', 'without', 'than', 'is', 'are', 'be',
  'few', 'little', 'bit', 'pinch', 'dash', 'splash', 'handful', 'couple', 'touch', 'drizzle', 'sprinkle',
]);

/** Prep participles (as used in ingredient lines and in step text) mapped to their imperative. */
export const PREP_BASE = {
  diced: 'dice', grated: 'grate', chopped: 'chop', minced: 'mince', sliced: 'slice', juiced: 'juice', zested: 'zest',
  halved: 'halve', peeled: 'peel', drained: 'drain', rinsed: 'rinse', melted: 'melt', softened: 'soften',
  squeezed: 'squeeze', cut: 'cut', cubed: 'cube', shredded: 'shred', crushed: 'crush', crumbled: 'crumble',
  trimmed: 'trim', mashed: 'mash', beaten: 'beat', toasted: 'toast', quartered: 'quarter', seeded: 'seed',
  cored: 'core', thawed: 'thaw', julienned: 'julienne', torn: 'tear', pitted: 'pit', deveined: 'devein',
  stemmed: 'stem', cooked: 'cook', washed: 'wash', scrubbed: 'scrub', sifted: 'sift',
};

/** Nouns derived from a prep verb, as they appear after an ingredient ("lemon juice", "lemon wedges"). */
export const DERIVED_PREP = {
  juice: 'juiced', wedges: 'wedges', wedge: 'wedges', zest: 'zested', slices: 'sliced', cubes: 'cubed',
  halves: 'halved', peel: 'peeled', shreds: 'shredded',
};

/** A word cut down so that "diced" and "dice", "chopped" and "chop", "wedges" and "wedge" compare equal. */
export function stem(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  w = w.replace(/(?:ing|ed|es|s|e)$/, '');
  if (/([^aeiou])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** True if a word is a prep participle ("diced", "grated", ...). */
export function isPrepWord(word) {
  return Object.hasOwn(PREP_BASE, String(word).toLowerCase());
}

const isLy = (w) => /^[a-z]{3,}ly$/.test(w);

/** Words that open an adverbial phrase ending at a comma ("In a bowl, combine ..."). */
const OPENERS = new Set(['in', 'on', 'over', 'with', 'once', 'when', 'after', 'before', 'while', 'as', 'if', 'using', 'for', 'at', 'from', 'by', 'during', 'to']);
const LEAD_ADVERBS = new Set(['then', 'next', 'now', 'also', 'first', 'finally', 'meanwhile', 'again', 'afterwards', 'later', 'just', 'quickly', 'immediately', 'soon']);

/**
 * The verb an action starts with, lowercase, or '' when there is none: the first word, after any
 * leading adverb and any opening phrase that ends at a comma ("In a large skillet, heat the oil").
 * @param {string} text
 */
export function leadVerb(text) {
  const toks = tokenize(String(text)).filter((t) => t.type === 'w' || (t.type === 'p' && t.text === ','));
  let i = 0;
  for (let guard = 0; guard < 8 && i < toks.length; guard++) {
    const t = toks[i];
    if (t.type === 'p') { i++; continue; }
    const w = joinHyphen(toks, i);
    if (LEAD_ADVERBS.has(t.lower) || (isLy(t.lower) && !COOKING_VERBS.has(t.lower))) { i++; continue; }
    if (OPENERS.has(t.lower)) {
      let c = i + 1;
      while (c < toks.length && toks[c].type !== 'p') c++;
      if (c < toks.length) { i = c + 1; continue; }
      // No comma: the verb is the first cooking verb that follows ("In a bowl combine the flour").
      for (let j = i + 1; j < toks.length; j++) if (COOKING_VERBS.has(toks[j].lower)) return toks[j].lower;
      return t.lower;
    }
    return w;
  }
  return toks[i] && toks[i].type === 'w' ? joinHyphen(toks, i) : '';
}

/** The word at toks[i], with its hyphenated parts joined: "stir-fry". */
function joinHyphen(toks, i) {
  let w = toks[i].lower;
  while (toks[i].hy && toks[i + 1] && toks[i + 1].hy && toks[i + 1].start === toks[i].end + 1) {
    w += `-${toks[i + 1].lower}`;
    i++;
  }
  return w;
}

/** Heat-applying verbs: the first action with one of these (other than an oven preheat) ends the Prep stage. */
export const HEAT_VERBS = new Set([
  'heat', 'preheat', 'warm', 'melt', 'boil', 'simmer', 'sauté', 'saute', 'fry', 'sear', 'brown', 'roast', 'bake',
  'grill', 'broil', 'toast', 'cook', 'stir-fry', 'pan-fry', 'deep-fry', 'steam', 'braise', 'blanch', 'caramelize',
  'char', 'microwave', 'reheat', 'sweat',
]);

/** True when an action applies heat: its verb is a heat verb, or it brings something to a boil or simmer. */
export function appliesHeat(text) {
  const v = leadVerb(text);
  if (HEAT_VERBS.has(v)) return true;
  return v === 'bring' && /\b(?:boil|simmer)\b/i.test(text);
}

/** True for "Preheat the oven" (and toaster oven): a heat action that does not end the Prep stage. */
export function isOvenPreheat(text) {
  return leadVerb(text) === 'preheat' && /\boven\b/i.test(text);
}

const COUNT_UNITS = new Set(['cup', 'clove', 'sprig', 'stalk', 'slice', 'can', 'bunch', 'head', 'piece', 'stick', 'package', 'pinch']);

/** A quantity as text, with a count unit in the plural when the amount is more than one: "2 cloves", "1 clove", "5 to 7 sprigs". */
export function showQuantity(qty, unit, format) {
  const n = Array.isArray(qty) ? qty[1] : qty;
  const u = unit && COUNT_UNITS.has(unit) && n > 1 ? (/(?:ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`) : unit;
  return format(qty, u);
}
