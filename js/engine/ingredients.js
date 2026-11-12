/**
 * Stage 1: parse ingredient lines.
 * @param {string[]} lines  One entry per ingredient line, bullets removed. Group headers ("For the sauce:") are included as lines.
 * @returns {{ingredients: import("./types.js").ParsedIngredient[], flags: import("./types.js").Flag[]}}
 *   Ingredients in list order, ids i1..iN (headers produce no ingredient). Flags: unparseable-quantity.
 */
export function parseIngredients(lines) {
  throw new Error('not implemented');
}
