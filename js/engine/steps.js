/**
 * Stage 2: split steps into single actions.
 * @param {string[]} steps  One entry per recipe step, leading numbers removed. A recipe written as one block is a one-element array.
 * @returns {{actions: import("./types.js").Action[], flags: import("./types.js").Flag[]}}
 *   Actions in recipe order, ids a1..aN. text is the recipe own wording (no amounts inserted),
 *   uses [] and meanwhile [] (filled by later stages), kind set, minutes/until/notes/original filled.
 */
export function splitSteps(steps) {
  throw new Error('not implemented');
}
