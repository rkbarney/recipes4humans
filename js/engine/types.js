/**
 * Result shape of the rewrite engine (from docs/SPEC.md, "Result shape").
 * This file holds only JSDoc typedefs; it exports nothing at runtime.
 */

/**
 * @typedef {Object} Rewrite
 * @property {string} [title]
 * @property {string} [sourceUrl]
 * @property {Ingredient[]} ingredients
 * @property {Action[]} prep   Prep stage actions, after deferred prep has been moved into windows.
 * @property {Action[]} cook   Cook stage actions, always in the recipe's own order.
 * @property {Flag[]} flags
 */

/**
 * @typedef {Object} Ingredient
 * @property {string} id            Stable id, 'i1', 'i2', ... in list order.
 * @property {string} raw           The original line.
 * @property {string} name          Display name (descriptors kept).
 * @property {string[]} alternates  "chicken or turkey" gives name 'chicken', alternates ['turkey'].
 * @property {string} [group]       "For the sauce"
 * @property {Portion[]} portions   One per use.
 */

/**
 * @typedef {Object} Portion
 * @property {number | [number, number]} [qty]
 * @property {string} [unit]
 * @property {string} [prep]     "diced"
 * @property {string} [usedIn]   Action id.
 * @property {'serving'} [tag]
 */

/**
 * @typedef {Object} Action
 * @property {string} id         'a1', 'a2', ... for step actions; 'p1', 'p2', ... for prep actions.
 * @property {string} text       With amounts inserted.
 * @property {{step: number, start: number, end: number}} original  1-based step; offsets into that step's text.
 * @property {{ingredientId: string, portion: number}[]} uses
 * @property {[number, number]} [minutes]
 * @property {string} [until]
 * @property {'hands-on' | 'waiting'} kind
 * @property {string[]} notes
 * @property {string[]} meanwhile  Prep action ids placed in this window.
 */

/**
 * @typedef {Object} Flag
 * @property {string} [actionId]
 * @property {string} [ingredientId]
 * @property {string} code     One of: unused-ingredient, unknown-ingredient, amounts-mismatch, split-unresolved, collective-word, unparseable-quantity.
 * @property {string} message
 */

/**
 * Engine-internal types passed between stages (see js/engine/README.md).
 *
 * @typedef {Object} ParsedIngredient
 * @property {string} id
 * @property {string} raw
 * @property {string} name          Display name, descriptors kept.
 * @property {string} head          Lowercase head noun phrase used for matching, descriptors removed ('red-pepper flakes', 'onion').
 * @property {string[]} alternates
 * @property {string} [group]
 * @property {boolean} divided      True if the line says "divided".
 * @property {Portion[]} portions   From the line itself: 'plus' and per-fraction prep portions. Empty qty for unmeasured.
 *
 * @typedef {Object} Mention
 * @property {string} actionId
 * @property {string} ingredientId
 * @property {number} start         Offset into the action's raw text.
 * @property {number} end
 * @property {string} [prepWord]    Prep word adjacent to the mention ('grated', 'juice', 'wedges').
 * @property {{qty: number | [number, number], unit?: string, start: number, end: number}} [stated]  Amount already written in the step.
 * @property {string} [quantifier]  'remaining' | 'rest' | 'most' | 'half' | 'some' when such a word precedes the mention.
 * @property {number} [reserve]     Not used; reserve amounts are read by stage 4 from the action's notes.
 *
 * @typedef {Object} CollectiveMention
 * @property {string} actionId
 * @property {string} word          'spices', 'dry ingredients', ...
 */

export {};
