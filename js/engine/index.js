/**
 * Engine entry points. Runs stages 1 to 6 (see README.md in this folder).
 */
import { parseIngredients } from './ingredients.js';
import { splitSteps } from './steps.js';
import { matchIngredients } from './match.js';
import { resolveAmounts } from './amounts.js';
import { extractPrep } from './prep.js';
import { placeInWindows } from './windows.js';

const BULLET = /^\s*(?:[-*•▢☐□◦▪]|•)\s+/;
const INGREDIENT_HEADING = /^\W*ingredients?\W*(?:\(.*\))?\W*$/i;
const STEP_HEADING = /^\W*(?:preparation|instructions|directions|method|procedure|steps)\W*$/i;
const OTHER_HEADING = /^\W*(?:notes?|tips?|nutrition(?: facts| information)?|storage|equipment|variations?|serving suggestions?|recipe notes?)\W*$/i;
const META_LINE = /^\s*(?:yield|yields|serves|servings?|makes|prep time|cook time|total time|time|author|source|course|cuisine|active time)\b\s*:/i;
const STEP_MARKER = /^\s*step\s+\d+\s*[:.)-]?\s*/i;
const NUMBERING = /^\s*\d+\s*[.)]\s+/;

function noSections() {
  const err = new Error('Could not find both an ingredients section and a steps section. Use headings such as "Ingredients" and "Preparation", "Instructions", "Directions", "Method" or "Steps", or paste the two parts separately.');
  err.code = 'no-sections';
  return err;
}

/** Ingredient lines of a block: bullets removed, meta lines such as "Yield: 4 servings" dropped. */
function cleanIngredientLines(lines) {
  return lines.map((l) => l.replace(BULLET, '').trim()).filter((l) => l && !META_LINE.test(l));
}

/** Steps of a block: bullets, numbering and "Step N" markers removed; wrapped lines joined into their step. */
function cleanSteps(lines) {
  const kept = lines.map((l) => l.trim()).filter((l) => l && !META_LINE.test(l));
  if (!kept.length) return [];
  const steps = [];
  let current = null;
  let marked = false;
  for (const raw of kept) {
    let line = raw.replace(BULLET, '');
    const wasMarker = STEP_MARKER.test(line);
    const wasNumbered = NUMBERING.test(line);
    if (wasMarker) {
      line = line.replace(STEP_MARKER, '').trim();
      marked = true;
      current = null;
      if (!line) continue; // a "Step 2" line on its own
    } else if (wasNumbered) {
      line = line.replace(NUMBERING, '');
      current = null;
    }
    if (!line) continue;
    // A new step starts at a numbered line, or after a line that ended a sentence. Otherwise the line wraps.
    if (current !== null && !wasNumbered && !wasMarker && !/[.!?:)"”]$/.test(steps[current])) steps[current] += ` ${line}`;
    else if (current !== null && !wasNumbered && !wasMarker && marked) steps[current] += ` ${line}`;
    else { steps.push(line); current = steps.length - 1; }
    if (!wasNumbered && !wasMarker && !marked && current !== null && steps.length > 1 && false) current = null;
  }
  return steps;
}

function toLines(value) {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? '').split(/\r?\n/);
}

/** Find the title, ingredient block and step block of a pasted recipe. */
function splitSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const mark = (re) => lines.findIndex((l) => re.test(l.trim()));
  const iAt = mark(INGREDIENT_HEADING);
  const sAt = mark(STEP_HEADING);
  if (iAt < 0 || sAt < 0) throw noSections();
  const endOf = (start) => {
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (INGREDIENT_HEADING.test(t) || STEP_HEADING.test(t) || OTHER_HEADING.test(t)) return i;
    }
    return lines.length;
  };
  const ingredients = cleanIngredientLines(lines.slice(iAt + 1, endOf(iAt)));
  const steps = cleanSteps(lines.slice(sAt + 1, endOf(sAt)));
  if (!ingredients.length || !steps.length) throw noSections();
  const first = Math.min(iAt, sAt);
  const title = lines.slice(0, first).map((l) => l.trim()).find((l) => l && !META_LINE.test(l));
  return { title: title ? title.replace(/^#+\s*/, '').trim() : undefined, ingredients, steps };
}

/** Drop repeated flags: the same code on the same action and ingredient, keeping the first wording. */
function dedupe(flags) {
  const seen = new Set();
  return flags.filter((f) => {
    const key = `${f.code}|${f.actionId ?? ''}|${f.ingredientId ?? ''}|${f.actionId || f.ingredientId ? '' : f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Rewrite a whole recipe pasted as text. Finds the ingredient and step blocks from headings.
 * @param {string} text
 * @returns {import('./types.js').Rewrite}
 * @throws {Error} with `code = 'no-sections'` when the ingredients or the steps cannot be found.
 */
export function rewrite(text) {
  const { title, ingredients, steps } = splitSections(text);
  return rewriteParts({ title, ingredients, steps });
}

/**
 * Rewrite a recipe whose two parts are already separated.
 * @param {{ingredients: string | string[], steps: string | string[], title?: string, sourceUrl?: string}} parts
 *   Strings are split into lines (ingredients) or numbered steps (steps); arrays are used as given.
 * @returns {import('./types.js').Rewrite}
 */
export function rewriteParts({ ingredients, steps, title, sourceUrl }) {
  const lines = Array.isArray(ingredients) ? ingredients.map(String) : cleanIngredientLines(toLines(ingredients));
  const stepList = Array.isArray(steps) ? steps.map(String) : cleanSteps(toLines(steps));

  const s1 = parseIngredients(lines);
  const s2 = splitSteps(stepList);
  const s3 = matchIngredients(s1.ingredients, s2.actions);
  const s4 = resolveAmounts(s1.ingredients, s2.actions, s3.mentions);
  const s5 = extractPrep(s4.ingredients, s4.actions);
  const s6 = placeInWindows(s5.prep, s5.cook);

  const result = {
    title,
    sourceUrl,
    steps: stepList,
    ingredients: s4.ingredients,
    prep: s6.prep,
    cook: s6.cook,
    deferred: s6.deferred,
    flags: dedupe([...s1.flags, ...s2.flags, ...s3.flags, ...s4.flags]),
  };
  if (result.title === undefined) delete result.title;
  if (result.sourceUrl === undefined) delete result.sourceUrl;
  return result;
}
