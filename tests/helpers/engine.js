/**
 * Runs stages 1 to 3 (or 4) on small inputs, so a test can look at one stage's output on its own.
 */
import { parseIngredients } from '../../js/engine/ingredients.js';
import { splitSteps } from '../../js/engine/steps.js';
import { matchIngredients } from '../../js/engine/match.js';
import { resolveAmounts } from '../../js/engine/amounts.js';

/** Stage 3 on ingredient lines and step strings. */
export function matched(lines, steps) {
  const { ingredients } = parseIngredients(lines);
  const { actions } = splitSteps(Array.isArray(steps) ? steps : [steps]);
  return { ingredients, actions, ...matchIngredients(ingredients, actions) };
}

/** Stage 4 on ingredient lines and step strings. */
export function resolved(lines, steps) {
  const m = matched(lines, steps);
  const r = resolveAmounts(m.ingredients, m.actions, m.mentions);
  return { ...r, stage3: m, texts: r.actions.map((a) => a.text), flags: [...m.flags.filter((f) => f.code !== 'unused-ingredient'), ...r.flags] };
}

export const flagCodes = (flags) => flags.map((f) => f.code);
export const byName = (ingredients, name) => ingredients.find((i) => i.name.toLowerCase().includes(name));
