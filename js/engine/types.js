/**
 * Result shape of the rewrite engine (from docs/SPEC.md, "Result shape").
 * This file holds only JSDoc typedefs; it exports nothing at runtime.
 */

/**
 * @typedef {Object} Rewrite
 * @property {string} [title]
 * @property {string} [sourceUrl]
 * @property {string[]} steps  The recipe's steps as the engine read them (bullets and numbering removed), index = original.step - 1.
 * @property {Ingredient[]} ingredients
 * @property {Action[]} prep   Prep stage actions, after deferred prep has been moved into windows.
 * @property {Action[]} cook   Cook stage actions, always in the recipe's own order.
 * @property {Action[]} deferred  Prep actions placed in a waiting window; referenced by id from that action's `meanwhile`.
 * @property {Flag[]} flags
 */

/**
 * @typedef {Object} Ingredient
 * @property {string} id            Stable id, 'i1', 'i2', ... in list order.
 * @property {string} raw           The original line.
 * @property {string} name          Display name (descriptors kept).
 * @property {string[]} alternates  "chicken or turkey" gives name 'chicken', alternates ['turkey'].
 * @property {string[]} [descriptors]  Words of the name that tell it from another ingredient with the same head ('brown' in 'brown sugar'); used by matching.
 * @property {string} [group]       "For the sauce"
 * @property {string} [total]       Display text of the whole amount ("¾ cup", "½ cup plus 2 tbsp"); set by resolveAmounts, absent for unmeasured ingredients.
 * @property {Portion[]} portions   One per use.
 */

/**
 * @typedef {Object} Portion
 * @property {number | [number, number]} [qty]
 * @property {string} [unit]
 * @property {{qty: number | [number, number], unit?: string}} [alt]  The same amount in another unit ("1 stick (113 g)" gives qty 1, unit 'stick', alt {qty: 113, unit: 'g'}).
 * @property {string} [prep]     "diced"
 * @property {string} [note]     Set by resolveAmounts on a use whose amount is not a number: 'most of it', 'some', 'the rest', 'more', 'more to season'.
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
 *
 * A prep action made from an ingredient line has `original: {step: 0, start: 0, end: 0, ingredientId}`.
 * `ingredientId` is set only on those; it is how stage 6 tells them from prep made from a step, which never moves.
 */

/**
 * @typedef {Object} Flag
 * @property {string} [actionId]
 * @property {string} [ingredientId]
 * @property {string} code     One of: unused-ingredient, unknown-ingredient, ambiguous-ingredient, amounts-mismatch, split-unresolved, collective-word, unparseable-quantity.
 *   ambiguous-ingredient: a step names something two listed ingredients could be ("pepper" with black pepper and red-pepper flakes); nothing was matched or inserted.
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
 * @property {number} lead          Offset where the noun phrase starts (before its descriptors), so an amount can go in front of it.
 * @property {{start: number, end: number}} [article]  "the " in front of the noun phrase; replaced when an amount is inserted.
 * @property {string} [prepWord]    Prep participle in front of the noun ('grated').
 * @property {string} [derived]     'juiced', 'wedges', ... for "lemon juice", "lemon wedges"; 'part' for "egg whites" (a part, never given an amount).
 * @property {number} [derivedEnd]  End offset of the derived noun.
 * @property {{qty: number | [number, number], unit?: string, start: number, end: number}} [stated]  Amount already written in the step.
 * @property {string} [quantifier]  'remaining' | 'rest' | 'most' | 'half' | 'third' | 'quarter' | 'some' | 'more'.
 * @property {number} [fraction]    The fraction of a 'half', 'third' or 'quarter'.
 * @property {boolean} [unsure]     A number or unit stands in front that could not be read as this ingredient's amount ("a pot of water", "a lemon"); nothing is inserted.
 * @property {boolean} [seasoning]  "season with", "to taste".
 * @property {boolean} [serving]    Serving or garnish context.
 * @property {boolean} [inUntil]    Inside an "until" clause: never gets an amount.
 * Reserve amounts ("reserve 2 tbsp") are read by stage 4 from the action's notes.
 *
 * @typedef {Object} CollectiveMention
 * @property {string} actionId
 * @property {string} word          'spices', 'dry ingredients', ...
 */

export {};
