/**
 * Sentence splitting for recipe steps. Returns trimmed [start, end) spans into the input, so callers
 * can slice the original text. Protected from false breaks: decimals and fractions (no space after
 * the dot), abbreviations, temperatures ("350°F."), and anything inside parentheses.
 */

/** Abbreviations that never end a sentence. */
const NEVER_BREAK = new Set(['approx', 'no', 'vs', 'dr', 'mr', 'mrs', 'ms', 'st', 'incl', 'ca', 'e.g', 'i.e']);

/** Unit abbreviations: the period ends a sentence only if an uppercase word follows ("Cook 5 min. Stir."). */
const UNIT_ABBR = new Set([
  'min', 'mins', 'sec', 'secs', 'hr', 'hrs', 'tbsp', 'tbs', 'tsp', 'oz', 'lb', 'lbs', 'pkg', 'pt', 'qt',
  'gal', 'doz', 'med', 'lg', 'sm', 'g', 'kg', 'ml', 'cm', 'mm',
]);

const isUpper = (c) => c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';

/**
 * @param {string} text
 * @returns {{start: number, end: number}[]} sentence spans, whitespace trimmed, in order
 */
export function splitSentences(text) {
  const spans = [];
  const n = text.length;
  let i = 0;
  while (i < n && isSpace(text[i])) i++;
  let start = i;
  let depth = 0;
  for (; i < n; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth = Math.max(0, depth - 1);
      // "(about 8 hours.) Then ..." : a period closing the parenthesis may end the sentence.
      if (depth === 0 && text[i - 1] === '.' && i + 1 < n && isSpace(text[i + 1])) {
        let k = i + 1;
        while (k < n && isSpace(text[k])) k++;
        if (isUpper(text[k])) { spans.push({ start, end: i + 1 }); start = k; i = k - 1; }
      }
    }
    else if (depth === 0 && (c === '.' || c === '!' || c === '?')) {
      let j = i + 1;
      while (j < n && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;
      while (j < n && '"\'”’'.includes(text[j])) j++;
      if (j < n && !isSpace(text[j])) { i = j - 1; continue; } // "1.5", "3.5 cups": no space after the dot
      let k = j;
      while (k < n && isSpace(text[k])) k++;
      const next = text[k]; // undefined at end of text
      if (c === '.' && j === i + 1 && !endsSentence(text, i, next)) continue;
      spans.push({ start, end: j });
      start = k;
      i = k - 1;
    }
  }
  if (start < n) {
    let end = n;
    while (end > start && isSpace(text[end - 1])) end--;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/** Decide whether the single period at index i ends a sentence, given the next non-space character. */
function endsSentence(text, i, next) {
  if (next === undefined) return true;
  const before = text.slice(0, i);
  // Temperature: "350°F." or "350 F." is a unit abbreviation.
  const temp = /(?:°\s*|\d\s*)([FfCc])$/.exec(before);
  if (temp) return isUpper(next);
  const m = /([A-Za-z]+)$/.exec(before);
  if (!m) return true;
  const word = m[1].toLowerCase();
  const prev = before[before.length - m[1].length - 1];
  if (prev === '.') return false; // "e.g." / "i.e."
  if (NEVER_BREAK.has(word)) return false;
  if (UNIT_ABBR.has(word)) return isUpper(next);
  return true;
}
