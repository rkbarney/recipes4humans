/**
 * Stage 3: find ingredient mentions inside each action.
 * @param {import("./types.js").ParsedIngredient[]} ingredients  Output of parseIngredients.
 * @param {import("./types.js").Action[]} actions                Output of splitSteps.
 * @returns {{mentions: import("./types.js").Mention[], collective: import("./types.js").CollectiveMention[], flags: import("./types.js").Flag[]}}
 *   Mentions in action order. Flags: unknown-ingredient, unused-ingredient, collective-word.
 */
export function matchIngredients(ingredients, actions) {
  throw new Error('not implemented');
}
