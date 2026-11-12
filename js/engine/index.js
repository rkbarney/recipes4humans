/**
 * Engine entry points. Runs stages 1 to 6 (see README.md in this folder).
 */

/**
 * Rewrite a whole recipe pasted as text. Finds the ingredient and step blocks from headings.
 * @param {string} text
 * @returns {import('./types.js').Rewrite}
 */
export function rewrite(text) {
  throw new Error('not implemented');
}

/**
 * Rewrite a recipe whose two parts are already separated.
 * @param {{ingredients: string | string[], steps: string | string[]}} parts
 *   Strings are split into lines (ingredients) or numbered steps (steps); arrays are used as given.
 * @returns {import('./types.js').Rewrite}
 */
export function rewriteParts({ ingredients, steps }) {
  throw new Error('not implemented');
}
