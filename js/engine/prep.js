/**
 * Stage 5: turn prep notes into prep actions and separate Prep from Cook (SPEC, "5. Prep extraction").
 */
import { formatQuantity } from './quantity.js';
import { PREP_BASE, appliesHeat, isOvenPreheat } from './text-utils.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Adverbs that may stand in front of a prep word ("finely chopped"). */
const ADVERB = /^[a-z]{3,}ly$/i;

/** Singular of a name when exactly one (or less) is meant: "lemons" with 1 gives "lemon". */
function singularName(name) {
  const words = name.split(' ');
  let w = words[words.length - 1];
  if (/(?:ss|us|is|ses)$/i.test(w)) return name;
  if (/ies$/i.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/(?:ches|shes|xes|oes)$/i.test(w)) w = w.slice(0, -2);
  else if (/s$/i.test(w)) w = w.slice(0, -1);
  words[words.length - 1] = w;
  return words.join(' ');
}

/** "grated, then squeezed dry" as an instruction on `subject`: "Grate ½ small red onion, then squeeze dry." */
export function prepInstruction(prep, subject) {
  const words = prep.trim().split(/(\s+|,)/).filter((w) => w !== '' && !/^\s+$/.test(w));
  const k = words.findIndex((w) => Object.hasOwn(PREP_BASE, w.toLowerCase().replace(/[^a-z]/g, '')));
  if (k < 0) return `Prepare ${subject} (${prep}).`;
  const before = words.slice(0, k).filter((w) => ADVERB.test(w));
  const verb = PREP_BASE[words[k].toLowerCase().replace(/[^a-z]/g, '')];
  let rest = '';
  for (let i = k + 1; i < words.length; i++) {
    const w = words[i];
    const key = w.toLowerCase().replace(/[^a-z]/g, '');
    if (w === ',') { rest += ','; continue; }
    const needsThen = Object.hasOwn(PREP_BASE, key) && !/^(?:then|and)$/i.test(words[i - 1] || '');
    const piece = Object.hasOwn(PREP_BASE, key) ? PREP_BASE[key] : w;
    // "cut into wedges": "cut" stays an instruction on its own and "into wedges" follows the subject.
    rest += ` ${needsThen && words[i - 1] === ',' ? 'then ' : ''}${piece}`;
  }
  const lead = [...before, verb].join(' ');
  return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${subject}${rest.replace(/\s+,/g, ',')}.`;
}

function amountText(ing, idxs) {
  const ps = idxs.map((i) => ing.portions[i]);
  if (ps.length === 1 && ps[0].qty !== undefined) {
    const p = ps[0];
    return `${formatQuantity(p.qty, p.unit)}${p.alt ? ` (${formatQuantity(p.alt.qty, p.alt.unit)})` : ''}`;
  }
  return ing.total || '';
}

/** Prep actions made from ingredient lines: one per distinct prep wording of an ingredient. */
function ingredientPrep(ingredients) {
  const out = [];
  for (const ing of ingredients) {
    const groups = new Map();
    ing.portions.forEach((p, idx) => {
      if (!p.prep || p.tag === 'serving') return;
      if (!groups.has(p.prep)) groups.set(p.prep, []);
      groups.get(p.prep).push(idx);
    });
    for (const [prep, idxs] of groups) {
      const amount = amountText(ing, idxs);
      // "Juice 1 lemon", "Dice ½ small red onion": a single item is named in the singular.
      const name = amount === '1' || /^[½¼¾⅓⅔⅛⅜⅝⅞]$/.test(amount) ? singularName(ing.name) : ing.name;
      const subject = [amount, name].filter(Boolean).join(' ');
      out.push({
        id: `p${out.length + 1}`,
        text: prepInstruction(prep, subject),
        original: { step: 0, start: 0, end: 0, ingredientId: ing.id },
        uses: idxs.map((portion) => ({ ingredientId: ing.id, portion })),
        kind: 'hands-on',
        notes: [],
        meanwhile: [],
      });
    }
  }
  return out;
}

/**
 * Stage 5: turn prep notes into prep actions and separate Prep from Cook.
 * @param {import("./types.js").ParsedIngredient[]} ingredients  Output of resolveAmounts.
 * @param {import("./types.js").Action[]} actions                Output of resolveAmounts, in recipe order.
 * @returns {{prep: import("./types.js").Action[], cook: import("./types.js").Action[]}}
 *   prep: prep-note actions (ids p1..pN) merged by first use with the mixing steps that come before the first heat.
 *   cook: the remaining actions, never reordered.
 */
export function extractPrep(ingredients, actions) {
  const acts = clone(actions);
  const pActions = ingredientPrep(clone(ingredients));

  // The Prep stage ends at the first action that applies heat, except an oven preheat, which does not end it.
  let boundary = acts.findIndex((a) => appliesHeat(a.text) && !isOvenPreheat(a.text));
  const noHeat = boundary < 0;
  if (noHeat) boundary = 0; // no heat anywhere: every step stays in Cook, in order
  const stepPrep = [];
  const cook = [];
  acts.forEach((a, i) => {
    if (i < boundary && !isOvenPreheat(a.text)) stepPrep.push({ a, i });
    else cook.push(a);
  });

  // Where an ingredient's prep belongs: just before the first action that uses that ingredient.
  const firstUse = (ingId) => {
    const i = acts.findIndex((a) => a.uses.some((u) => u.ingredientId === ingId));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const items = [
    ...pActions.map((a, n) => ({ a, key: firstUse(a.original.ingredientId), rank: 0, n })),
    ...stepPrep.map(({ a, i }) => ({ a, key: i, rank: 1, n: i })),
  ];
  items.sort((x, y) => x.key - y.key || x.rank - y.rank || x.n - y.n);
  return { prep: items.map((x) => x.a), cook };
}
