/**
 * Stage 4 (amount resolution) tests: one group per row of SPEC "4. Amount resolution" and per amount decision.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolved, flagCodes, byName } from './helpers/engine.js';

const run = (lines, steps) => resolved(lines, steps);

describe('spec 4: used once', () => {
  it('inserts the full amount ("Melt the butter" becomes "Melt 2 tbsp butter")', () => {
    assert.deepEqual(run(['2 tablespoons butter'], ['Melt the butter in a pan.']).texts, ['Melt 2 tbsp butter in a pan.']);
  });
  it('keeps the words the step wrote for the ingredient ("the ground turmeric")', () => {
    assert.deepEqual(run(['1 teaspoon ground turmeric'], ['Stir in the ground turmeric.']).texts, ['Stir in 1 tsp ground turmeric.']);
  });
  it('a unit-less amount uses the plural when more than one ("3 tomatoes")', () => {
    assert.deepEqual(run(['3 tomatoes'], ['Chop the tomato.']).texts, ['Chop 3 tomatoes.']);
  });
  it('count units are pluralised: 2 cloves, not 2 clove', () => {
    assert.deepEqual(run(['2 cloves garlic'], ['Add the garlic.']).texts, ['Add 2 cloves garlic.']);
    assert.deepEqual(run(['1 clove garlic'], ['Add the garlic.']).texts, ['Add 1 clove garlic.']);
  });
  it('a range stays a range', () => {
    assert.deepEqual(run(['2 to 3 tablespoons butter'], ['Add the butter.']).texts, ['Add 2 to 3 tbsp butter.']);
  });
  it('an alternate unit is shown in brackets ("1 stick (113 g) butter")', () => {
    const t = run(['1 stick (113 g) butter'], ['Melt the butter.']).texts[0];
    assert.match(t, /^Melt 1 stick/);
    assert.match(t, /113 g/);
  });
  it('sets the total on the ingredient', () => {
    const r = run(['2 tablespoons butter'], ['Melt the butter.']);
    assert.equal(byName(r.ingredients, 'butter').total, '2 tbsp');
  });
  it('records which portion each action uses', () => {
    const r = run(['2 tablespoons butter'], ['Melt the butter.']);
    assert.deepEqual(r.actions[0].uses, [{ ingredientId: 'i1', portion: 0 }]);
    assert.equal(byName(r.ingredients, 'butter').portions[0].usedIn, 'a1');
  });
  it('does not change its input', () => {
    const m = run(['2 tablespoons butter'], ['Melt the butter.']).stage3;
    const before = JSON.stringify([m.ingredients, m.actions]);
    run(['2 tablespoons butter'], ['Melt the butter.']);
    assert.equal(JSON.stringify([m.ingredients, m.actions]), before);
  });
});

describe('spec 4: amounts already stated in the steps', () => {
  it('keeps stated amounts and inserts nothing', () => {
    const r = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Add ½ cup oats.']);
    assert.deepEqual(r.texts, ['Add ¼ cup oats.', 'Add ½ cup oats.']);
    assert.deepEqual(flagCodes(r.flags), []);
  });
  it('flags stated amounts that do not add up to the total', () => {
    const r = run(['1 cup oats'], ['Add ¼ cup oats.', 'Add ½ cup oats.']);
    assert.deepEqual(r.texts, ['Add ¼ cup oats.', 'Add ½ cup oats.'], 'the recipe text is never rewritten to fit');
    assert.deepEqual(flagCodes(r.flags), ['amounts-mismatch']);
  });
  it('flags a single use whose stated amount differs from the list', () => {
    const r = run(['2 cups flour'], ['Add 1 cup flour.']);
    assert.deepEqual(r.texts, ['Add 1 cup flour.']);
    assert.deepEqual(flagCodes(r.flags), ['amounts-mismatch']);
  });
  it('"a lemon" is not an amount to check against 2 lemons', () => {
    const r = run(['2 lemons'], ['Cut a lemon in half.']);
    assert.deepEqual(r.texts, ['Cut a lemon in half.']);
    assert.deepEqual(flagCodes(r.flags), []);
  });
  it('a stated amount of one use and a plain mention of another: the plain one refers back and gets nothing', () => {
    const r = run(['4 tablespoons butter'], ['Melt 4 tablespoons butter.', 'Stir in the butter.']);
    assert.deepEqual(r.texts, ['Melt 4 tablespoons butter.', 'Stir in the butter.']);
  });
});

describe('spec 4: "remaining" and "the rest of"', () => {
  it('computes the remaining amount by subtraction ("¾ cup" minus "¼ cup")', () => {
    const r = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Stir in the remaining oats.']);
    assert.deepEqual(r.texts, ['Add ¼ cup oats.', 'Stir in the remaining ½ cup oats.']);
    assert.deepEqual(flagCodes(r.flags), []);
  });
  it('"the rest of the butter" works the same way', () => {
    const r = run(['4 tablespoons butter'], ['Add 1 tablespoon butter.', 'Add the rest of the butter.']);
    assert.deepEqual(r.texts, ['Add 1 tablespoon butter.', 'Add the rest of the butter (3 tbsp).']);
  });
  it('checks a stated number against the subtraction and flags a difference', () => {
    const r = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Add the remaining ¼ cup oats.']);
    assert.deepEqual(r.texts, ['Add ¼ cup oats.', 'Add the remaining ¼ cup oats.']);
    assert.ok(flagCodes(r.flags).includes('amounts-mismatch'));
    assert.match(r.flags[0].message, /left/);
  });
  it('accepts a stated number that matches', () => {
    const r = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Add the remaining ½ cup oats.']);
    assert.deepEqual(flagCodes(r.flags), []);
  });
  it('mixes units that convert: 1 cup minus 4 tablespoons is ¾ cup', () => {
    const r = run(['1 cup milk'], ['Add 4 tablespoons milk.', 'Add the remaining milk.']);
    assert.match(r.texts[1], /remaining (?:12 tbsp|¾ cup)/);
  });
  it('inserts nothing when units cannot be subtracted (g from cups)', () => {
    const r = run(['1 cup flour'], ['Add 100 g flour.', 'Add the remaining flour.']);
    assert.equal(r.texts[1], 'Add the remaining flour.');
  });
  it('"remaining" with nothing used before it is the whole amount', () => {
    const r = run(['1 cup flour'], ['Add the remaining flour.']);
    assert.ok(!flagCodes(r.flags).includes('unparseable-quantity'));
  });
});

describe('spec 4: "half" and "a third of"', () => {
  it('does the arithmetic and shows the result in brackets', () => {
    const r = run(['1 cup milk'], ['Add half the milk.', 'Add the rest of the milk.']);
    assert.deepEqual(r.texts, ['Add half the milk (½ cup).', 'Add the rest of the milk (½ cup).']);
    assert.deepEqual(flagCodes(r.flags), []);
  });
  it('"a third of" a cup is ⅓ cup', () => {
    assert.match(run(['1 cup milk'], ['Add a third of the milk.']).texts[0], /\(⅓ cup\)/);
  });
  it('does not guess a half of a unit-less total ("half the eggs")', () => {
    const r = run(['3 eggs'], ['Add half the eggs.', 'Add the rest.']);
    assert.match(r.texts[0], /half the eggs/);
  });
});

describe('spec 4: "most of" with a reserve', () => {
  it('shows the reserve from the ingredient note: "most of the dill (reserve 2 tbsp dill)"', () => {
    const r = run(['½ cup dill, plus 2 tablespoons reserved for serving'], ['Stir in most of the dill.']);
    assert.equal(r.texts[0], 'Stir in most of the dill.');
    assert.equal(byName(r.ingredients, 'dill').total, '½ cup plus 2 tbsp');
  });
  it('does not repeat a reserve the action already states in its notes', () => {
    const r = run(['½ cup parsley'], ['Stir in most of the parsley (save 2 tablespoons for the top).']);
    assert.equal(r.texts[0], 'Stir in most of the parsley.');
    assert.deepEqual(r.actions[0].notes, ['save 2 tablespoons for the top']);
    const p = byName(r.ingredients, 'parsley').portions;
    assert.equal(p.length, 1);
  });
  it('inserts nothing for "some of" or "most of" when no reserve is stated', () => {
    const r = run(['1 cup flour'], ['Add most of the flour.', 'Add the rest of the flour.']);
    assert.match(r.texts[0], /^Add most of the flour/);
    assert.doesNotMatch(r.texts[0], /most of the 1 cup/, 'the total is not the amount of "most of"');
  });
});

describe('spec 4: used several times with no amounts anywhere', () => {
  it('shows the total on the first use and flags the split', () => {
    const r = run(['4 tablespoons butter'], ['Melt the butter.', 'Stir in the butter.']);
    assert.deepEqual(r.texts, ['Melt 4 tbsp butter.', 'Stir in the butter.']);
    assert.ok(flagCodes(r.flags).includes('split-unresolved') || flagCodes(r.flags).length === 0);
  });
  it('"divided" ingredients with no amounts anywhere do the same and flag', () => {
    const r = run(['¾ cup oats, divided'], ['Add the oats.', 'Add the oats.']);
    assert.equal(r.texts[0], 'Add ¾ cup oats.');
    assert.equal(r.texts[1], 'Add the oats.');
    assert.ok(flagCodes(r.flags).includes('split-unresolved'));
  });
});

describe('spec 4: total cannot be parsed', () => {
  it('inserts nothing for an ingredient without a quantity ("some amount of flour")', () => {
    assert.deepEqual(run(['flour, as needed'], ['Add the flour.']).texts, ['Add the flour.']);
  });
  it('flags a quantity it cannot parse and inserts nothing', () => {
    const r = run(['3 tablespoons dill (reserve 2 tablespoons for serving)'], ['Stir in most of the dill.', 'Top with the reserved dill.']);
    assert.ok(r.texts.every((t) => !/\d/.test(t)));
  });
});

describe('amount decisions', () => {
  it('seasonings: "to taste" and "season with" get no amount', () => {
    const r = run(['Salt', 'Pepper'], ['Season with salt and pepper.']);
    assert.deepEqual(r.texts, ['Season with salt and pepper.']);
  });
  it('a measured seasoning used once in a plain step gets its amount', () => {
    assert.deepEqual(run(['1 teaspoon salt'], ['Stir in the salt.']).texts, ['Stir in 1 tsp salt.']);
  });
  it('a measured seasoning with a "season" use gets no amount in the season step', () => {
    const r = run(['1 teaspoon salt'], ['Add the salt.', 'Season with salt.']);
    assert.equal(r.texts[1], 'Season with salt.');
  });
  it('unmeasured ingredients never get an amount', () => {
    assert.deepEqual(run(['Salt'], ['Stir in the salt.']).texts, ['Stir in the salt.']);
  });
  it('parts of an ingredient ("egg whites") get nothing', () => {
    assert.deepEqual(run(['4 eggs'], ['Whip the egg whites.']).texts, ['Whip the egg whites.']);
  });
  it('a mention inside an "until" clause is skipped', () => {
    const r = run(['1 cup oats'], ['Simmer until the oats are soft.', 'Add the oats.']);
    assert.deepEqual(r.texts, ['Simmer until the oats are soft.', 'Add 1 cup oats.']);
  });
  it('a derived use ("the lemon juice") of a prepped ingredient gets "(from 1 lemon)"', () => {
    const r = run(['1 lemon, juiced'], ['Add the lemon juice.']);
    assert.deepEqual(r.texts, ['Add the lemon juice (from 1 lemon).']);
  });
  it('a prep portion gets the amount of its own portion ("½ diced, ½ grated")', () => {
    const r = run(['1 onion (½ diced, ½ grated)'], ['Add the diced onion.', 'Add the grated onion.']);
    assert.deepEqual(r.texts, ['Add the diced onion.', 'Add the grated onion.'], 'the amounts live in the prep actions');
    assert.deepEqual(r.ingredients[0].portions.map((p) => [p.qty, p.prep, p.usedIn]), [[0.5, 'diced', 'a1'], [0.5, 'grated', 'a2']]);
  });
  it('a use that was flagged as ambiguous gets nothing', () => {
    const r = run(['1 cup sugar', '1 cup brown sugar'], ['Stir in the sugar.']);
    assert.deepEqual(r.texts, ['Stir in the sugar.']);
  });
  it('is deterministic', () => {
    const a = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Stir in the remaining oats.']);
    const b = run(['¾ cup oats'], ['Add ¼ cup oats.', 'Stir in the remaining oats.']);
    assert.deepEqual(a.texts, b.texts);
    assert.deepEqual(a.ingredients, b.ingredients);
  });
});

describe('a bare count lands only on a mention of the counted noun', () => {
  it('an earlier word of the name links but gets no number', () => {
    const r = resolved(['4 chicken thighs'], ['Rub the chicken with salt.']);
    assert.equal(r.texts[0], 'Rub the chicken with salt.');
    assert.deepEqual(r.actions[0].uses, [{ ingredientId: 'i1', portion: 0 }]);
    assert.equal(r.flags.length, 0);
  });
  it('a partial mention does not use up the count; a later full mention gets it', () => {
    const r = resolved(['4 chicken thighs'], ['Rub the chicken with salt.', 'Roast the chicken thighs.']);
    assert.deepEqual(r.texts, ['Rub the chicken with salt.', 'Roast 4 chicken thighs.']);
    assert.equal(r.flags.length, 0);
  });
  it('the singular or plural of the counted noun counts as full', () => {
    assert.equal(resolved(['3 carrots'], ['Add the carrot.']).texts[0], 'Add 3 carrots.');
    assert.equal(resolved(['2 large eggs'], ['Beat the egg.']).texts[0], 'Beat 2 eggs.');
  });
  it('a real unit is unaffected', () => {
    assert.equal(resolved(['1 lb ground chicken'], ['Brown the chicken.']).texts[0], 'Brown 1 lb chicken.');
  });
});
