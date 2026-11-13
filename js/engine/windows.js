/**
 * Stage 6: find waiting windows and place deferrable prep in them (SPEC, "6. Waiting windows").
 * Cooking actions are never moved; only prep made from ingredient lines is.
 */
import { isWaitingVerb } from './verbs.js';
import { leadVerb } from './text-utils.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Stirring that has to continue: it cancels a window. "Stirring occasionally" does not. */
const CONSTANT_STIR = /\b(?:stir(?:ring)?|whisk(?:ing)?|mix(?:ing)?)\b[^,.;]*?\b(?:constantly|frequently|often|continuously|continually)\b|\b(?:constantly|frequently|often|continuously|continually)\s+(?:stir(?:ring)?|whisk(?:ing)?|mix(?:ing)?)\b/i;
/** Turning or flipping that happens more than once: the cook has to stay at the pan. "Turning once" does not. */
const TURN_OFTEN = /\b(?:turn(?:ing)?|flip(?:ping)?|rotat(?:e|ing)|toss(?:ing)?)\b[^.;]*?\b(?:often|frequently|constantly|continuously|continually|regularly|every|twice|several times|multiple times|a few times)\b|\b(?:often|frequently|constantly|continuously|continually|regularly)\s+(?:turn(?:ing)?|flip(?:ping)?|rotat(?:e|ing)|toss(?:ing)?)\b/i;
/** Dry-heat verbs that are windows only at 5 minutes or more (they are not on the general waiting list). */
const HEAT_VERBS = new Set(['sear', 'broil', 'fry', 'pan-fry', 'deep-fry', 'grill', 'roast']);
const HIGH_HEAT = /\b(?:fry|fried|frying|sear|searing|broil|broiling|pan-fry|stir-fry|high heat)\b/i;
const LONGER_VERBS = new Set(['cook', 'let', 'leave', 'cover', 'set']);

/** Prep verbs that name a state to reach, not a task to do while something cooks. */
const STATE_VERBS = new Set(['melt', 'soften', 'thaw', 'cook', 'toast', 'warm', 'temper']);

/** Minutes of work per prep verb. */
const PREP_MINUTES = {
  dice: 2, chop: 2, slice: 2, grate: 2, zest: 1, juice: 1, peel: 1, halve: 1, crumble: 1, rinse: 1, drain: 1,
};

/** Minutes a prep action takes. Mincing is 1 minute per 2 cloves; "cut into wedges" is 1; anything else 2. */
export function prepMinutes(text) {
  const words = text.trim().split(/\s+/);
  const verb = (words.find((w) => !/ly$/i.test(w)) || '').toLowerCase().replace(/[^a-z]/g, '');
  if (verb === 'mince') {
    const m = /(\d+(?:\.\d+)?)\s*cloves?\b/i.exec(text);
    return m ? Math.max(1, Math.ceil(Number(m[1]) / 2)) : 1;
  }
  if (verb === 'cut' && /\bwedges?\b/i.test(text)) return 1;
  return PREP_MINUTES[verb] ?? 2;
}

/**
 * Is this cook action a waiting window? Returns {capacity, usable} (capacity in minutes of prep it can
 * hold) or null.
 */
function windowOf(a) {
  const verb = leadVerb(a.text);
  const fullText = `${a.text} ${(a.notes || []).join(' ')}`;
  const stirring = CONSTANT_STIR.test(fullText) || TURN_OFTEN.test(fullText);
  const min = a.minutes ? a.minutes[0] : undefined;

  // An oven preheat and a big pot of water coming to a boil are 10-minute windows with no stated time.
  if (min === undefined && verb === 'preheat' && /\boven\b/i.test(a.text)) return { capacity: 6, usable: true, stated: false };
  if (min === undefined && verb === 'bring' && /\bwater\b/i.test(a.text) && /\bboil\b/i.test(a.text)) return { capacity: 6, usable: true, stated: false };
  if (min === undefined || stirring) return null;

  if (HEAT_VERBS.has(verb) && min >= 5) return { capacity: 0.6 * min, usable: true, stated: true };
  if (isWaitingVerb(verb) && min >= 3) return { capacity: 0.6 * min, usable: !(HIGH_HEAT.test(a.text) && min < 5), stated: true };
  if (LONGER_VERBS.has(verb) && min >= 5 && (verb !== 'set' || /^\s*set\s+aside\b/i.test(a.text))) {
    return { capacity: 0.6 * min, usable: true, stated: true };
  }
  return null;
}

/** First action (in prep then cook order) that uses any of these portions, as 'prep' or a cook index. */
function firstUser(p, prep, cook) {
  const hit = (a) => (a.uses || []).some((u) => p.uses.some((x) => x.ingredientId === u.ingredientId && x.portion === u.portion));
  if (prep.some((a) => a !== p && a.original.ingredientId === undefined && hit(a))) return -1;
  return cook.findIndex(hit);
}

/**
 * Stage 6: find waiting windows and place deferrable prep in them.
 * @param {import("./types.js").Action[]} prep  Output of extractPrep.
 * @param {import("./types.js").Action[]} cook  Output of extractPrep.
 * @returns {{prep: import("./types.js").Action[], cook: import("./types.js").Action[], deferred: import("./types.js").Action[]}}
 *   Deferred prep actions are removed from prep and their ids listed in the cook action meanwhile arrays.
 */
export function placeInWindows(prep, cook) {
  const outPrep = clone(prep);
  const outCook = clone(cook);
  const deferred = [];

  const windows = [];
  outCook.forEach((a, i) => {
    const w = windowOf(a);
    if (!w) return;
    a.kind = 'waiting';
    windows.push({ index: i, action: a, left: w.capacity, usable: w.usable });
  });

  const keep = [];
  for (const p of outPrep) {
    const fromIngredient = p.original && p.original.ingredientId !== undefined && p.original.step === 0;
    const state = STATE_VERBS.has(p.text.trim().split(/\s+/)[0].toLowerCase());
    if (!fromIngredient || state) { keep.push(p); continue; }
    const use = firstUser(p, outPrep, outCook);
    if (use < 0) { keep.push(p); continue; }
    const minutes = prepMinutes(p.text);
    const w = windows.find((x) => x.usable && x.index < use && x.left + 1e-9 >= minutes);
    if (!w) { keep.push(p); continue; }
    w.left -= minutes;
    w.action.meanwhile.push(p.id);
    deferred.push(p);
  }
  return { prep: keep, cook: outCook, deferred };
}
