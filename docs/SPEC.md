# Recipe Rewriter: MVP spec

Nov 12, 2026 · @Richard

## Summary

A mobile web app that takes a recipe and rewrites it into a cooking view: one action per line, the amount on every use, hidden prep made explicit, and safe "meanwhile" suggestions during waits.

Version 1 uses rules only, with no AI, so it costs nothing per recipe and gives the same output every time. Pasted text comes first; importing from a URL is the second milestone.

Version 1 is done when the meatball soup recipe in this doc produces the target output below, and a 10-recipe test set produces zero wrong amounts.

"Recipe Rewriter" was the working title; the product and its repository are named recipes4humans.

## Problem and audience

Recipes are written to look short on a page, not to be followed at a stove. Five specific pains follow from that, and each has a matching fix.

| Pain | Example from the test recipe | Fix |
| --- | --- | --- |
| Amounts live only in the ingredient list | "add the cumin" | The amount appears on every use: "add 1 tbsp cumin" |
| One step holds several actions | Step 2 has five actions | One action per line |
| Prep is hidden in the ingredient list | Squeezing the grated onion dry never appears in the steps | Prep becomes explicit steps |
| Totals are split across steps without warning | ¾ cup oats is ¼ cup in the meatballs and ½ cup in the pot | The split is shown up front and on each use |
| Waiting time is wasted, or the cook jumps around | Lemons are needed at the end but never prepped | Prep is suggested during stated waits |

The first user is the owner, cooking from a phone. The wider audience is anyone who loses their place in a recipe, including people with ADHD. That positioning is a later test and makes no medical claims.

Existing tools cover parts of this. RecipeStripper puts amounts inline. Hold My Spoon does amounts and some prep, but left five actions in one step and gave a wrong "meanwhile" instruction on this recipe. No tool that was tested does all five reliably.

## Scope

Version 1 is the rules engine, a paste box and a cooking view. Everything that costs money per use or needs an account waits.

| In version 1 | Out of version 1 |
| --- | --- |
| Paste recipe text (ingredients and steps) | AI of any kind |
| Import from a URL, for sites with structured recipe data (milestone 2) | Photo and PDF import |
| Rules engine: split steps, match amounts, resolve splits, extract prep, suggest prep during waits | Accounts, and a library that syncs across devices |
| Cooking view with check-off and "show original" | Unit conversion and serving scaling (planned for 1.1) |
| Works in phone browsers, installable to the home screen | Timers |
| Recipes saved in the browser, with JSON export and import; nothing stored on a server | Ads |
| Flags wherever the engine is unsure | Reordering cooking steps, or timing several dishes together |

Two rules hold throughout. A wrong amount is worse than a missing one, so when the engine is unsure it inserts nothing and flags the line. And the engine never changes the order of cooking steps; it only moves prep.

## Design principles

RecipeStripper is the reference for look and feel: the owner rates it the best site in this space. Four things carry over.

- **Plain text first.** The cooking view is text on a plain background. No photos, cards, icons for decoration, or animation.
- **Minimal.** One purpose per screen. Nothing on the cooking view except the recipe and its controls.
- **Local by default.** Rewritten recipes are saved in the browser with no sign-up. The owner can export all of them to one JSON file and import that file on another device.
- **A short, clear pitch.** The landing page says what the tool does in one or two lines, above the paste box, with a before-and-after example below.

## User flow

The whole flow is three screens on a phone: paste, rewrite, cook.

1. Open the site. The home screen has one box for a URL and one for pasted text.
2. Paste a recipe. The app finds the ingredient block and the step block from headings such as "Ingredients" and "Preparation", "Instructions", "Directions" or "Steps". If it cannot tell them apart, it asks for the two parts in separate boxes.
3. Tap Rewrite. The cooking view appears at once, because the engine runs in the browser.
4. Cook from three stages in order: Gather, Prep, Cook.
5. Tap a line to check it off. The checked state is kept in the browser, so locking the phone or switching apps does not lose the place.
6. Tap the "original" control on any line to see the recipe's own sentence for it.

The screen stays awake while the cooking view is open, where the browser allows it. Lines the engine was unsure about carry a small marker that explains why.

## The cooking view

The output has three stages: Gather lists what to get out with every split shown, Prep lists the work to do before any heat, and Cook lists single actions in the recipe's own order. The lemony chicken and feta meatball soup is the golden test; its target output follows.

The target is judged on structure: where actions are cut, which amounts appear, which prep is surfaced and where the "meanwhile" lands. Wording is not judged. Rules cut the recipe's own sentences and insert amounts; they do not rephrase, so real output will be wordier than the lines below.

### Gather

- 1 lb ground chicken or turkey
- ½ cup crumbled feta
- ¾ cup rolled oats: ¼ cup for step 4, ½ cup for step 12
- 1 small red onion: half diced, half grated and squeezed dry
- ⅓ packed cup dill: 2 tbsp held back for serving
- 1 tbsp ground cumin
- Ground turmeric: ½ tsp for step 4, 1 tbsp for step 9
- Kosher salt: 1 tsp for step 4, more to season
- Black pepper
- 3 tbsp olive oil
- ½ tsp red-pepper flakes, plus more for serving
- 4 cups low-sodium chicken broth or water
- 4 packed cups baby spinach
- 2 lemons: 1 juiced, 1 cut into wedges

### Prep

1. Halve 1 small red onion. Dice one half.
2. Grate the other half, then squeeze it in a paper towel to remove the liquid.
3. Finely chop ⅓ packed cup dill.
4. In a medium bowl, add 1 lb ground chicken, ½ cup feta, ¼ cup oats, the grated onion, most of the dill (keep 2 tbsp for garnish), 1 tbsp cumin, ½ tsp turmeric and 1 tsp salt.
5. Combine gently without overworking the meat.
6. Wet your palms and shape into about 25 balls, 1½ inches each.

### Cook

7. Heat 3 tbsp olive oil in a large Dutch oven over medium until shimmering.
8. Add the diced onion, season with salt, and cook about 2 minutes until it begins to soften.
9. Add 1 tbsp turmeric and ½ tsp red-pepper flakes. Stir about 30 seconds until fragrant.
10. Push the onions to the sides, then add the meatballs.
11. Cook 5 to 7 minutes until browned on two sides. *Meanwhile: juice 1 lemon, and cut 1 lemon into wedges.*
12. Pour in 4 cups broth and ½ cup oats. Tilt the pot to distribute them without disturbing the meatballs.
13. Bring to a gentle boil, then reduce to an active simmer. Season with salt.
14. Cook about 4 minutes, stirring gently, until the oats have softened and the meatballs are cooked through.
15. Stir in 4 packed cups spinach and the lemon juice. About 2 minutes, until wilted.
16. Adjust the seasoning to taste.
17. Spoon into bowls. Top with black pepper and the remaining 2 tbsp dill. Serve with lemon wedges and more red-pepper flakes.

Four original steps become 17 actions. Lines 1 to 3 and the "meanwhile" on line 11 exist only in the ingredient list of the original.

## Rewrite rules

The engine is a pipeline of six stages, each a pure function with its own tests. Text goes in and a structured result comes out, with no network and no randomness.

1. Parse each ingredient line into quantity, unit, name, portions and prep notes.
2. Split each step into single actions.
3. Match ingredient mentions inside each action.
4. Resolve the amount for each use.
5. Turn prep notes into prep actions.
6. Find waiting windows and place deferrable prep in them.

### 1. Ingredient parsing

- **Quantity:** whole numbers, decimals, fraction characters (½, ⅓, ¾), typed fractions (1/2), mixed numbers (1 ½) and ranges (5 to 7).
- **Unit:** from a fixed list with plurals and abbreviations: tsp, tbsp, cup, oz, lb, g, kg, ml, l, pinch, clove, can, stick and similar. A line can have no unit ("2 lemons").
- **Name:** the text after the unit, up to the first comma or parenthesis. Descriptors such as fresh, ground, packed and low-sodium are kept for display and ignored for matching.
- **Alternatives:** "chicken or turkey" and "broth or water" give one ingredient with alternates; a mention of any of them matches.
- **Plus:** "½ teaspoon plus 1 tablespoon turmeric" gives two portions. "plus more for serving" gives an extra unmeasured portion tagged for serving.
- **Divided:** the word marks the ingredient as split; the portions come from the steps.
- **Prep notes:** text after a comma or in parentheses that contains a prep word (diced, grated, chopped, minced, sliced, juiced, zested, halved, peeled, drained, rinsed, melted, softened, squeezed, "cut into"). A parenthesis with fractions, such as "(½ diced, and ½ grated, then squeezed...)", gives one portion per fraction, each with its own prep.
- **No quantity:** "Kosher salt and black pepper" gives two unmeasured ingredients.
- **Group headers:** a line such as "For the sauce:" tags the ingredients under it with that group.

### 2. Step splitting

- Split into sentences first, protecting fractions, mixed numbers and abbreviations.
- Inside a sentence, split at ", then", "and then", a semicolon, and "and" or ", and" when the next word is a cooking verb starting a new instruction.
- Do not split when "and" joins nouns or conditions: "season with salt and pepper", "until softened and cooked through".
- These stay attached to their action: "until ...", "about N minutes", heat levels, and "stirring occasionally".
- A parenthesis becomes a note on its action.
- A sentence with no instruction ("You will have about 25 balls") becomes a note on the previous action.
- Each action records its duration (minutes, seconds, hours, ranges), its "until" cue, and its position in the original text for the "show original" control.

### 3. Matching

- Match on the ingredient's head noun, longest name first, so "red-pepper flakes" is tried before "pepper".
- A prep word next to the mention picks the portion: "grated onion" and "diced onion" map to the two halves; "lemon juice" maps to the juiced lemon and "lemon wedges" to the other.
- Things made by earlier steps ("the meatballs", "the sauce", "the dough", "the mixture") are not ingredients and get no amount.
- Collective words ("the spices", "the dry ingredients") are not expanded in version 1. The line is flagged.
- If the step already states an amount ("¼ cup oats"), keep it, record the use, and insert nothing.
- Otherwise insert the amount before the name: "add 1 tbsp cumin".
- Unmeasured uses ("season with salt") are left as written.

### 4. Amount resolution

| Situation | Rule |
| --- | --- |
| Ingredient used once | Insert the full amount |
| Used several times, amounts stated in the steps | Use the stated amounts; flag if they do not add up to the total |
| "remaining" or "the rest of" | Total minus earlier uses; if the step states the number, check it |
| "half", "a third of" | Do the arithmetic |
| "most of" or "some of", with a "reserve N" stated | Assign N to the later use and show "most of" with the reserve |
| Used several times with no amounts anywhere | Show the total on the first use, flagged "recipe does not say how to split" |
| Total cannot be parsed | Insert nothing and flag |

The Gather list shows every split by step number, as in "¾ cup oats: ¼ cup for step 4, ½ cup for step 12".

### 5. Prep extraction

- Every prep note becomes a prep action, with the participle turned into an instruction: diced to "Dice", grated to "Grate", juiced to "Juice".
- Prep actions are ordered by when their ingredient is first used.
- Mixing and shaping steps that come before the first heat stay in Prep, in the recipe's order.

### 6. Waiting windows

- An action is a waiting window if its verb is on the waiting list (simmer, bake, roast, boil, rest, marinate, chill, brown, reduce, soak, rise) and it states a duration of at least 3 minutes.
- "Stirring constantly", "whisking constantly" and "stirring frequently" cancel the window.
- Frying, searing, broiling, grilling and roasting are windows at a stated 5 minutes or more, and get no suggestions under that. Turning or flipping more than once ("turning often", "flipping frequently", "turning every minute") cancels a window, like constant stirring.
- Preheating an oven and bringing a large pot of water to a boil count as 10-minute windows even with no stated time. No other defaults exist.
- A prep action is deferrable if its ingredient is first used after the window ends. It goes in the earliest window where it fits.
- Prep times come from a small table (dice an onion 2 minutes, juice a lemon 1 minute, mince garlic 1 minute per 2 cloves). A window is filled to at most 60% of its shortest stated time.
- Cooking actions are never moved.

### Flags

The engine flags: an ingredient in the list that no step uses, an ingredient in a step that is not in the list, amounts that do not add up, a split it cannot resolve, a collective word, and a quantity it cannot parse.

## Architecture

The app follows the pattern of the owner's JustRSS (github.com/rkbarney/justrss): a static site in plain JavaScript modules with no framework and no build step, data kept on the device, a service worker for offline use, and one small Cloudflare Worker for fetching pages. It lives in its own repository under the `rkbarney` account.

| Part | Path | What it is |
| --- | --- | --- |
| Engine | `js/engine/` | Plain JavaScript modules, one per rule stage. Text in, structured result out. No browser or network code, so it runs under `node --test`. |
| Web app | `index.html`, `js/`, `css/` | Static pages that import the engine and run it in the browser. Same layout as JustRSS: `app.js`, `ui.js`, `storage.js`, `config.js`. |
| Offline and install | `manifest.json`, `service-worker.js` | Makes the app installable to the home screen and usable offline, as in JustRSS. |
| Storage | `js/storage.js` | Saved recipes in IndexedDB, settings in localStorage, export and import as one JSON file. |
| URL fetcher | `worker/` | A copy of the JustRSS proxy Worker with this site's origins. It returns the page; the browser reads the schema.org Recipe data out of it. |
| Tests | `tests/` | `node --test`, with jsdom where a test needs to parse a page. |

Pasted text never leaves the phone: the engine runs in the browser and nothing is sent to a server. The Worker exists only because browsers cannot fetch other sites' pages directly.

The Worker keeps the protections the JustRSS proxy already has: a referer check against this site's origins, http and https only, private addresses blocked, a rate limit per IP, and no logging or storage. The static site can be hosted on GitHub Pages or Cloudflare Pages.

Recipes imported from a URL always show a link back to the source. The app never publishes or indexes a recipe page, and never shows ads on a recipe view.

The engine takes plain text as its only input. That keeps later inputs simple: a photo or PDF import only has to produce the same text.

### Result shape

The engine documents these shapes as JSDoc types. They are shown in TypeScript notation here because it is shorter.

```ts
type Rewrite = {
  title?: string;
  sourceUrl?: string;
  ingredients: Ingredient[];
  prep: Action[];
  cook: Action[];
  flags: Flag[];
};

type Ingredient = {
  id: string;
  raw: string;            // the original line
  name: string;
  alternates: string[];
  group?: string;         // "For the sauce"
  portions: Portion[];    // one per use
};

type Portion = {
  qty?: number | [number, number];
  unit?: string;
  prep?: string;          // "diced"
  usedIn?: string;        // action id
  tag?: 'serving';
};

type Action = {
  id: string;
  text: string;           // with amounts inserted
  original: { step: number; start: number; end: number };
  uses: { ingredientId: string; portion: number }[];
  minutes?: [number, number];
  until?: string;
  kind: 'hands-on' | 'waiting';
  notes: string[];
  meanwhile: string[];    // prep action ids placed in this window
};

type Flag = { actionId?: string; ingredientId?: string; code: string; message: string };
```

## Test plan

The engine is deterministic, so every test compares real output with an expected result saved in the repository.

### Golden recipe

The meatball soup must produce the target in "The cooking view" exactly on structure:

- 6 prep actions and 11 cook actions, cut at the same points.
- Every amount shown in the target appears, and no other amount does.
- Oats, turmeric, onion and lemons each resolve to the two portions shown.
- The "squeeze the grated onion" action exists.
- Juicing and cutting the lemons land in the browning window on line 11.
- No cooking action is out of the original order.

### Pattern set

Ten more recipes, each written for this project in original words so they can be committed, covering between them:

- An oven bake with a preheat.
- A braise or long simmer.
- A stir-fry (high heat, no usable windows).
- Grouped ingredients ("For the sauce").
- A "divided" ingredient with no amounts in the steps.
- Amounts given in both US and metric.
- "To taste" and other unmeasured ingredients.
- Instructions written as one block of text.
- A collective word ("add the spices").
- Loose, casual wording of the kind found on user-submitted sites.

Real recipes copied from websites stay out of the repository. They are kept in a local folder that git ignores and used for manual checks only.

### Pass criteria

| Measure | Target |
| --- | --- |
| Golden recipe | Passes on every point above |
| Wrong amounts across the pattern set | 0 |
| Ingredient uses that get an amount or a flag | At least 90% |
| Cooking actions moved out of order | 0 |
| Unit tests for each rule in "Rewrite rules" | All pass in CI |

### Checks outside the engine

- **Site probe (milestone 2):** a script calls the Worker with one recipe URL from each of the 19 sites on the test list and records whether the fetch worked and whether recipe data was found.
- **Phone check:** the paste and cook flow is tried on a real phone at a narrow width.
- **Kitchen check:** the owner cooks one real meal from the cooking view and notes every point of friction.

## Build plan

Nine tasks, each sized for one agent on a cheaper model, each ending in a pull request with passing tests. Tasks 2 and 3 run in parallel; so can 6 and 7, because the web app can be built against the saved golden result before the engine is finished.

| # | Task | Delivers | Needs |
| --- | --- | --- | --- |
| 0 | Scaffold | Repository laid out like JustRSS: plain JavaScript modules, no build step, node --test, manifest and service worker, CI on GitHub Actions | Repository created and access granted |
| 1 | Fixtures | Golden recipe input and expected result as JSON; the ten pattern recipes with expected results | 0 |
| 2 | Ingredient parser | Stage 1 of the rules, with a unit test per rule | 1 |
| 3 | Step splitter | Stage 2 of the rules, with a unit test per rule | 1 |
| 4 | Matcher and amounts | Stages 3 and 4, plus flags | 2, 3 |
| 5 | Prep and windows | Stages 5 and 6; golden recipe passes end to end | 4 |
| 6 | Web app | Landing page, paste screen and cooking view, per "Design principles"; check-off state; show original; screen stays awake | 1 |
| 7 | Local library | Save rewritten recipes in the browser; export all to JSON; import from JSON | 6 |
| 8 | URL fetcher | A copy of the JustRSS proxy Worker, recipe-data extraction in the browser, the site probe script and its report | 0 |

### Milestones

1. **Paste works (tasks 0 to 7).** The golden recipe passes, the pattern set meets the pass criteria, and the site is live on a Cloudflare address.
2. **URL import (task 8).** The probe report shows which of the 19 sites work; the URL box is switched on for those.
3. **Kitchen check.** One real meal cooked from it, and the friction list turned into fixes.

### How the work is reviewed

- Each agent gets this doc plus its task row, and may not change another task's files.
- Task 4 is the hardest and the one most likely to produce wrong amounts. It gets the strongest review, and a stronger model if the first attempt misses the pass criteria.
- Claude reviews every pull request against this spec before the owner sees it. The owner reviews at each milestone.

## Version 2: own domain, Google sign-in and sync

Version 1 is working for about ten friends and family. Version 2 moves it to its own domain, recipes4humans.com, and adds an optional Google sign-in so a library follows its owner between phone and computer. Sync is free for now.

### Decisions

| Question | Answer |
| --- | --- |
| Domain | recipes4humans.com, bought by the owner. |
| Moving current users | No automatic handoff. The current users are all friends who know it is a beta; the owner messages them to export from the old address, import on the new one, and re-add the app to the home screen. |
| Hosting | Cloudflare: one Worker serves the static site, the API under `/api/` and the page fetcher, all from recipes4humans.com. Same origin means no cross-site cookies (which Safari blocks) and no CORS for the app's own calls. |
| Sign-in | Google only, through Google Identity Services. The Worker checks Google's ID token and sets its own session cookie. No Firebase or other SDK, and still no build step. |
| Signed out | The app works exactly as version 1: recipes on the device only, nothing on a server. |
| What syncs | The whole recipe record: text or parts, title, source link, ticked lines and collapsed sections. Ticking a step on the laptop shows on the phone. |
| Signing out | Wipes that device's recipes and settings. The account keeps them. |
| Price | Free. Sync moves out of the paid tier. |

### Parts

| Part | Path | What it is |
| --- | --- | --- |
| Site Worker | `worker/` | Grows from the page fetcher into the site's Worker: static assets, `/api/auth/*`, `/api/sync`, `/api/account`, and the fetcher at `/api/fetch`. The fetcher keeps its protections. |
| Database | Cloudflare D1 | Tables: `users` (Google subject id, email, name, created), `sessions` (random token hash, user, expires), `recipes` (user, recipe id, JSON body, updated, deleted, server sequence). |
| Sync client | `js/sync.js` | Pushes local changes and pulls the account's changes. Pure merge logic kept apart from network code so it runs under `node --test`. |
| Storage | `js/storage.js` | Records gain `updated` (milliseconds) and `deleted` (a tombstone, so a delete reaches other devices). `listRecipes` hides tombstones. |
| Service worker | `service-worker.js` | Never caches `/api/`. |

### Sign-in

1. The Sign in with Google button runs in redirect mode, not popup mode, because popups fail in iPhone home-screen apps. Google posts the ID token to `/api/auth/google`.
2. The Worker checks the token's signature against Google's published keys, and checks the audience (this app's client id), the issuer and the expiry. It finds or creates the user.
3. The Worker sets a session cookie: random, HttpOnly, Secure, SameSite=Lax, 90 days. Only a hash of the token is stored.
4. `/api/auth/me` returns the signed-in user or 401. `/api/auth/logout` deletes the session.

The owner sets up the Google Cloud project, the OAuth client id and the consent screen. The consent screen needs a privacy policy page and a home page on recipes4humans.com. Email and profile scopes do not need Google's review.

### Sync

Last write wins, per recipe. The library is small and one person rarely edits the same recipe on two devices at once.

- **Push and pull in one call.** `POST /api/sync` with `{ since, changes }`. The server keeps each incoming record whose `updated` is newer than the stored one, then returns every record changed after `since`, plus a new cursor. The cursor is a server sequence number, not a clock, so a phone with the wrong time cannot lose changes.
- **When.** On app start, about two seconds after any save (ticks included, so a burst of ticks is one call), when the app returns to the foreground, and when the device comes back online. No live push.
- **First sign-in on a device.** Local recipes are pushed to the account. Recipe ids are random, so they do not collide with the account's.
- **Offline.** Changes wait in IndexedDB and go up on the next sync. The cooking view never waits on the network.
- **Limits.** 1 MB per recipe, 2,000 recipes per account, and a per-user rate limit on `/api/sync`.

### Account

A small account panel: who is signed in, Sign out (wipes this device), Export all (still the backup), and Delete my account, which removes the user, sessions and recipes from D1.

### Privacy

"Pasted text never leaves the phone" stays true while signed out. Signed in, recipes are stored in the owner's Cloudflare account so they can sync; they are never shared, published or read for any other purpose. The privacy policy page says this plainly, and says how to delete everything.

### Build plan

| # | Task | Delivers | Needs |
| --- | --- | --- | --- |
| 9 | Move to Cloudflare (done) | The site served by the Worker on recipes4humans.com; fetcher moved to `/api/fetch`; GitHub Pages deploy replaced with `wrangler deploy` in CI | Domain bought and on Cloudflare |
| 10 | Sign-in spike (done) | Sign in with Google working from an iPhone home-screen app, end to end, before anything else is built on it | 9, Google client id |
| 11 | Auth and sync API (done) | D1 schema and migrations, the auth and sync endpoints, account deletion, with tests | 10 |
| 12 | Sync in the app (done) | `updated` and tombstones in storage, `js/sync.js`, sync triggers, the account panel | 11 |
| 13 | Launch (privacy page done) | Privacy policy page, consent screen set to production, a note to current users on how to move | 12 |

### Checks

- Sign in on the iPhone home-screen app and in desktop Chrome; save on one, see it on the other within a few seconds of opening.
- Tick a step on one device; it shows on the other.
- Delete on one device; it disappears on the other.
- Edit while offline, reconnect; the edit arrives.
- Sign out; the device's library is empty. Sign back in; it returns.
- Delete account; the D1 rows are gone.

## Later

The free tier is everything that costs nothing to run; the paid tier is everything that costs money per use. Nothing below is built in version 1.

### Free, version 1.1 candidates

These come from common complaints about online recipes, and all can be done with rules.

| Complaint | Feature |
| --- | --- |
| "Marinate overnight" is buried in step 3 | A "Heads up" block at the top listing any wait of 30 minutes or more, and anything that must be done ahead (softened butter, cooked rice, room-temperature eggs) |
| The right pan or tool is discovered halfway through | An equipment list in Gather, read from the steps ("medium bowl", "large Dutch oven") |
| Stated cooking times are optimistic and leave out prep | An estimated total: stated times plus prep-table times |
| Cups versus grams, US versus metric | Unit conversion, with a density table for cups to grams |
| Cooking for two from a recipe for six | Serving scaling, applied to every inline amount |
| Setting a timer means leaving the recipe | A timer started from any step that states a time |

### Paid tier

- **Photo and PDF import.** Cookbook pages and handwritten family recipe cards. Needs a vision model, so it has a cost per use.
- **Smarter rewriting.** Terse rephrasing of each action, and expansion of collective words such as "the spices". Needs a language model.

### Money and positioning

- No ads on any recipe view. A tip jar on the landing page is the only revenue in the free tier.
- The ADHD positioning is tested before it is adopted: post the before and after of one recipe where people with ADHD discuss cooking, and see whether anyone asks for the tool.

## Open questions

None of these blocks task 0, but the first two shape the web app.

- [ ] Answered: iPhone. Test in Safari. Prompt the owner to add the app to the home screen so Safari does not clear saved recipes, treat JSON export as the backup, and expect copy and paste for URLs since iPhone web apps cannot appear in the share sheet. Verify each of these on a real phone.
- [ ] Answered: yes. Version 1 keeps the recipe's own wording, cut into single actions.
- [ ] Should the repository be public or private? Private is the safer default while test recipes are being collected.
- [ ] Which of the 1.1 candidates, if any, belong in version 1?
- [ ] Answered: the product and repository are recipes4humans, on recipes4humans.com (see "Version 2").
- [ ] Does the employer's outside-activity policy need checking before a tip jar or paid tier is added?
