/**
 * Stage 6: find waiting windows and place deferrable prep in them.
 * @param {import("./types.js").Action[]} prep  Output of extractPrep.
 * @param {import("./types.js").Action[]} cook  Output of extractPrep.
 * @returns {{prep: import("./types.js").Action[], cook: import("./types.js").Action[]}}
 *   Deferred prep actions are removed from prep and their ids listed in the cook action meanwhile arrays.
 */
export function placeInWindows(prep, cook) {
  throw new Error('not implemented');
}
