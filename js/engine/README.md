# Engine

Pure functions, no browser or network code. Types are in `types.js`. The pipeline in `index.js` is:

    lines  -> parseIngredients  -> { ingredients: ParsedIngredient[], flags }
    steps  -> splitSteps        -> { actions: Action[], flags }
    (ingredients, actions) -> matchIngredients -> { mentions, collective, flags }
    (ingredients, actions, mentions) -> resolveAmounts -> { ingredients, actions, flags }
    (ingredients, actions) -> extractPrep -> { prep, cook }
    (prep, cook) -> placeInWindows -> { prep, cook }

`rewriteParts` concatenates the flags of all stages, then returns `{ ingredients, prep, cook, flags }` (a `Rewrite`; `ingredients` are the `ParsedIngredient`s with extra fields allowed). `rewrite(text)` first splits sections by headings, strips bullets and step numbers, then calls `rewriteParts`.

## Stage contracts

Stages 1 and 2 are independent and can be built in parallel; stages 3 to 6 consume their output exactly as below.

1. `parseIngredients(lines: string[])` in `ingredients.js`. Group header lines (ending in a colon) tag later ingredients with `group` (without the colon) and produce no ingredient. Ids are `i1..iN`. `name` keeps descriptors; `head` is lowercase without descriptors. `portions`: one per "plus" part, one per fraction in a prep parenthesis (each with `prep`), or a single portion; "plus more for serving" adds `{tag: 'serving'}`. A line with "divided" sets `divided: true` and `portions` holds only what the line itself states (usually the total). Unmeasured ingredients have `qty` undefined. Prep wording is stored in `portion.prep` as written ("diced").
2. `splitSteps(steps: string[])` in `steps.js`. Input steps have no numbering. Output actions have ids `a1..aN` in recipe order, `text` equal to the recipe's own wording for that action (a parenthesis is moved to `notes`, an instruction-free sentence is appended to the previous action's `notes`), `original.step` is the 1-based index into `steps` and `start`/`end` are offsets into that step string, `minutes` is `[min, max]` in minutes (seconds converted), `until` is the text after "until", `kind` is `'hands-on'` for now (stage 6 sets `'waiting'`), `uses: []`, `meanwhile: []`.
3. `matchIngredients(ingredients, actions)`. A `Mention` points into the action `text` (offsets), may carry a `prepWord`, a `stated` amount already in the text, and a `quantifier`. Collective words ("the spices") go in `collective`, not `mentions`.
4. `resolveAmounts(ingredients, actions, mentions)`. Fills `portion.usedIn`, `action.uses`, inserts amounts into `action.text`. Everything it cannot resolve is flagged, not guessed.
5. `extractPrep(ingredients, actions)`. Prep action ids are `p1..pN`; `prep` is ordered as described in the spec, `cook` keeps the order of the input actions.
6. `placeInWindows(prep, cook)`. Sets `kind: 'waiting'` on window actions, fills `meanwhile`, and removes placed actions from `prep`. Placed prep actions are not counted in the Prep stage (see tests/fixtures/README.md).

Flag codes: `unused-ingredient`, `unknown-ingredient`, `amounts-mismatch`, `split-unresolved`, `collective-word`, `unparseable-quantity`.

Every stage function currently throws `new Error('not implemented')`.
