/**
 * Stage 5: turn prep notes into prep actions and separate Prep from Cook.
 * @param {import("./types.js").ParsedIngredient[]} ingredients  Output of resolveAmounts.
 * @param {import("./types.js").Action[]} actions                Output of resolveAmounts, in recipe order.
 * @returns {{prep: import("./types.js").Action[], cook: import("./types.js").Action[]}}
 *   prep: prep-note actions (ids p1..pN) merged by first use with the mixing steps that come before the first heat.
 *   cook: the remaining actions, never reordered.
 */
export function extractPrep(ingredients, actions) {
  throw new Error('not implemented');
}
