# Fixtures

All recipes here are original wording; nothing is copied from a website or cookbook. Real recipes go in the git-ignored `local-recipes/`.

Each fixture folder has `input.txt` and `expected.json`. `tests/helpers/fixtures.js` (`splitInput`) turns `input.txt` into `{ingredients: string[], steps: string[]}` for `rewriteParts`: bullets and step numbers are removed, group headers such as `For the sauce:` stay as lines, and an unnumbered Preparation block is a one-element steps array.

## expected.json

Wording is never compared. Actions are listed in order: all Prep actions, then all Cook actions, as they appear in the Prep and Cook stages of the result.

```
{
  "name": "...",
  "counts": { "prep": 6, "cook": 11 },     // length of result.prep and result.cook
  "actions": [ {
      "stage": "prep" | "cook",
      "contains": ["dice", "onion"],        // lowercase words the action text must contain
      "amounts": ["¼ cup oats"],            // must appear
      "notAmounts": ["¾ cup oats"],         // must NOT appear
      "noAmountFor": ["salt"],              // optional: no number may be inserted before this word
      "noteContains": ["reserve"],          // optional: words that must occur in action.notes
      "kind": "waiting",                    // optional
      "minutes": [5, 7],                    // optional [min, max]
      "meanwhile": [ { "contains": ["juice", "lemon"] } ]   // EXACT list of placed prep actions, in order
  } ],
  "split": [ { "ingredient": "oats", "portions": [ {"qty": 0.25, "unit": "cup"}, {"qty": 0.5, "unit": "cup"} ] },
             { "ingredient": "butter", "unresolved": true } ],
  "groups": { "honey": "For the sauce" },   // optional
  "flags": [ { "code": "split-unresolved", "ingredient": "butter" } ],
  "flagsExact": true                         // default true; false allows extra flags
}
```

Amount strings are `<quantity> [unit] <ingredient word>`, for example `1½ cup flour`, `190 g flour`, `1 tbsp turmeric`, `1 lemon`. Units are canonical (tsp, tbsp, cup, oz, lb, g, ml, clove, can, slice, pinch); the engine's own text may say "tablespoons" or "tbsp". A matcher (`tests/helpers/check.js`) accepts up to three descriptor words between the amount and the ingredient word. Portion `qty` is a number (0.25 for ¼) or `[min, max]`; portions may instead carry `note` (for example `"most of"`) or `tag: "serving"`.

`tests/fixtures.test.js` checks that every expected amount occurs in the input or is derivable from it (a sum, difference or half of quantities in the input; cups, tablespoons and teaspoons convert).

## Conventions the fixtures assume (spec silent or ambiguous)

- `counts.prep` counts the Prep stage after deferral: prep actions placed in a window as "meanwhile" are not in `result.prep`. They are only referenced by id from the window action. The golden recipe is therefore 6 prep and 11 cook, with the two lemon actions under cook action 11.
- Prep actions are ordered by when their ingredient is first used, merged with mixing steps that come before the first heat in recipe order.
- Heating that starts the Cook stage: heating oil, preheating, melting butter in a pan, boiling.
- Window actions are the ones with a waiting-list verb: simmer, bake, boil, brown, and so on. "Preheat the oven" is a 10-minute window with no stated time.
