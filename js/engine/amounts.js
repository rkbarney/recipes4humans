/**
 * Stage 4: resolve the amount for each use and insert it into the action text.
 * @param {import("./types.js").ParsedIngredient[]} ingredients
 * @param {import("./types.js").Action[]} actions
 * @param {import("./types.js").Mention[]} mentions  Output of matchIngredients.
 * @returns {{ingredients: import("./types.js").ParsedIngredient[], actions: import("./types.js").Action[], flags: import("./types.js").Flag[]}}
 *   Ingredients with portions completed (usedIn set); actions with text amounts inserted and uses filled.
 *   Flags: amounts-mismatch, split-unresolved, unparseable-quantity.
 */
export function resolveAmounts(ingredients, actions, mentions) {
  throw new Error('not implemented');
}
