# Engine

Pure functions, no browser or network code. Types are in `types.js`. The pipeline in `index.js` is:

    lines  -> parseIngredients  -> { ingredients: ParsedIngredient[], flags }
    steps  -> splitSteps        -> { actions: Action[], flags }
    (ingredients, actions) -> matchIngredients -> { mentions, collective, flags }
    (ingredients, actions, mentions) -> resolveAmounts -> { ingredients, actions, flags }
    (ingredients, actions) -> extractPrep -> { prep, cook }
    (prep, cook) -> placeInWindows -> { prep, cook, deferred }

`rewriteParts` concatenates the flags of all stages, then returns `{ title?, sourceUrl?, steps, ingredients, prep, cook, deferred, flags }` (a `Rewrite`; `ingredients` are the `ParsedIngredient`s with extra fields allowed). `rewriteParts({ingredients, steps, title?, sourceUrl?})` takes the two parts already separated. `rewrite(text)` finds the title and the two blocks by headings (Ingredients; Preparation, Instructions, Directions, Method or Steps, in either order), strips bullets, numbering and "Step N" lines, ignores "Yield:" lines, then calls `rewriteParts`. When it cannot find both blocks it throws an `Error` whose `code` is `'no-sections'`; the app then asks for the two parts separately.

## Stage contracts

Stages 1 and 2 are independent and can be built in parallel; stages 3 to 6 consume their output exactly as below.

1. `parseIngredients(lines: string[])` in `ingredients.js`. Group header lines (ending in a colon) tag later ingredients with `group` (without the colon) and produce no ingredient. Ids are `i1..iN`. `name` keeps descriptors; `head` is lowercase without descriptors. `portions`: one per "plus" part, one per fraction in a prep parenthesis (each with `prep`), or a single portion; "plus more for serving" adds `{tag: 'serving'}`. A line with "divided" sets `divided: true` and `portions` holds only what the line itself states (usually the total). Unmeasured ingredients have `qty` undefined. Prep wording is stored in `portion.prep` as written ("diced").
2. `splitSteps(steps: string[])` in `steps.js`. Input steps have no numbering. Output actions have ids `a1..aN` in recipe order, `text` equal to the recipe's own wording for that action (a parenthesis is moved to `notes`, an instruction-free sentence is appended to the previous action's `notes`), `original.step` is the 1-based index into `steps` and `start`/`end` are offsets into that step string, `minutes` is `[min, max]` in minutes (seconds converted), `until` is the text after "until", `kind` is `'hands-on'` for now (stage 6 sets `'waiting'`), `uses: []`, `meanwhile: []`.
3. `matchIngredients(ingredients, actions)`. A `Mention` points into the action `text` (offsets), may carry a `prepWord`, a `stated` amount already in the text, and a `quantifier`. Collective words ("the spices") go in `collective`, not `mentions`.
4. `resolveAmounts(ingredients, actions, mentions)`. Fills `portion.usedIn`, `action.uses`, inserts amounts into `action.text`. Everything it cannot resolve is flagged, not guessed.
5. `extractPrep(ingredients, actions)`. Prep action ids are `p1..pN`; `prep` is ordered as described in the spec, `cook` keeps the order of the input actions.
6. `placeInWindows(prep, cook)`. Sets `kind: 'waiting'` on window actions, fills `meanwhile` with the ids of placed prep actions, and moves those actions out of `prep` into a third list, `deferred`. It returns `{ prep, cook, deferred }`, and `rewriteParts` returns `{ ingredients, prep, cook, deferred, flags }`, so the UI can look a placed action up by id. Placed prep actions are not counted in the Prep stage (see tests/fixtures/README.md).

## Matching and amount decisions

- Names match in three tiers: the full head, the last word of the head, then another word of the name exactly as written. Longest match wins. The third tier is off for names ending in broth, oil, powder, flakes and similar, for colour and size words, and for hyphenated parts, so "the beef" never means beef broth.
- Two ingredients that fit one word with no distinguishing descriptor ("pepper" for black pepper and red-pepper flakes) give `ambiguous-ingredient`: no mention, no amount.
- Product words (sauce, dough, batter, mixture, meatballs, marinade, dressing, filling) and ingredient-group names are never ingredients. A verb at the start of an action ("Oil the pan") is not a mention.
- An ingredient used once gets its full amount. A stated amount is kept and nothing is inserted. "Remaining" and "the rest" are the total minus earlier uses; "half" and "a third" are scaled; "most of" with a reserve in the notes shows the reserve. With no amounts anywhere the total goes on the first use only, with `split-unresolved`.
- Never given an amount: unmeasured ingredients, seasoning uses, parts ("egg whites"), mentions inside "until" clauses, and anything the engine marked `unsure`.
- A prep-bound use of a unit-less total gets "(from 1 lemon)". A count unit is pluralised in what is inserted ("2 cloves garlic").
- Ingredient prep actions carry `original.ingredientId`. Only those can move into a window.

Flag codes: `unused-ingredient`, `unknown-ingredient`, `ambiguous-ingredient`, `amounts-mismatch`, `split-unresolved`, `collective-word`, `unparseable-quantity`.

A sentence with no instruction becomes a note on the previous action (stage 2). One that comes before any action has nothing to attach to and is dropped.
