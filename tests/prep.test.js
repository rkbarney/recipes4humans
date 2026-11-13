/**
 * Stage 5 (prep extraction) tests: SPEC "5. Prep extraction" and the prep decisions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteParts } from '../js/engine/index.js';
import { prepInstruction } from '../js/engine/prep.js';

const run = (ingredients, steps) => rewriteParts({ ingredients, steps });
const texts = (list) => list.map((a) => a.text);

describe('spec 5: every prep note becomes a prep action', () => {
  it('turns the participle into an instruction: diced to "Dice", grated to "Grate", juiced to "Juice"', () => {
    const r = run(['1 onion, diced', '1 cup cheddar, grated', '1 lemon, juiced'], ['Heat oil.', 'Add the onion, the cheddar and the lemon.']);
    assert.deepEqual(texts(r.prep).sort(), ['Dice 1 onion.', 'Grate 1 cup cheddar.', 'Juice 1 lemon.']);
  });
  it('keeps an adverb in front of the verb ("finely chopped")', () => {
    const r = run(['2 tablespoons parsley, finely chopped'], ['Heat oil.', 'Add the parsley.']);
    assert.deepEqual(texts(r.prep), ['Finely chop 2 tbsp parsley.']);
  });
  it('joins two verbs: "zested and juiced" is "Zest and juice 1 lemon."', () => {
    assert.deepEqual(texts(run(['1 lemon, zested and juiced'], ['Heat oil.', 'Add the lemon.']).prep), ['Zest and juice 1 lemon.']);
  });
  it('names one item in the singular and many in the plural', () => {
    const r = run(['2 lemons, juiced', '1 lemon, zested'], ['Heat oil.', 'Add the lemons.']);
    assert.deepEqual(texts(r.prep), ['Juice 2 lemons.', 'Zest 1 lemon.']);
  });
  it('a portion with its own prep note: "½ diced" and "½ grated" make two actions', () => {
    const r = run(['1 onion (½ diced, ½ grated)'], ['Heat oil.', 'Add the diced onion.', 'Add the grated onion.']);
    assert.equal(r.prep.length, 2);
    assert.match(r.prep[0].text, /^Dice ½/);
    assert.match(r.prep[1].text, /^Grate ½/);
  });
  it('an ingredient with no prep note makes no prep action', () => {
    assert.deepEqual(run(['1 cup rice'], ['Heat oil.', 'Add the rice.']).prep, []);
  });
  it('a prep action records its ingredient in original.ingredientId, with step 0', () => {
    const a = run(['1 onion, diced'], ['Heat oil.', 'Add the onion.']).prep[0];
    assert.deepEqual(a.original, { step: 0, start: 0, end: 0, ingredientId: 'i1' });
    assert.equal(a.id, 'p1');
    assert.deepEqual(a.uses, [{ ingredientId: 'i1', portion: 0 }]);
    assert.equal(a.kind, 'hands-on');
  });
  it('prepInstruction wraps an unknown prep word as "Prepare"', () => {
    assert.equal(prepInstruction('smashed', '1 clove garlic'), 'Prepare 1 clove garlic (smashed).');
  });
  it('prepInstruction handles "grated, then squeezed dry"', () => {
    assert.equal(prepInstruction('grated, then squeezed dry', '1 zucchini'), 'Grate 1 zucchini, then squeeze dry.');
  });
});

describe('spec 5: order of the prep actions', () => {
  it('is the order in which the ingredients are first used, not the order of the list', () => {
    const r = run(['1 cup cheddar, grated', '1 onion, diced'], ['Heat oil.', 'Add the onion.', 'Add the cheddar.']);
    assert.deepEqual(texts(r.prep), ['Dice 1 onion.', 'Grate 1 cup cheddar.']);
  });
  it('ids follow the ingredient list, and stay unique', () => {
    const r = run(['1 cup cheddar, grated', '1 onion, diced'], ['Heat oil.', 'Add the onion.', 'Add the cheddar.']);
    assert.deepEqual(r.prep.map((a) => a.id), ['p2', 'p1']);
  });
  it('an ingredient that no step uses sorts last and is flagged', () => {
    const r = run(['1 onion, diced', '1 stalk celery, chopped'], ['Heat oil.', 'Add the celery.']);
    assert.deepEqual(texts(r.prep), ['Chop 1 stalk celery.', 'Dice 1 onion.']);
    assert.ok(r.flags.some((f) => f.code === 'unused-ingredient'));
  });
});

describe('spec 5: mixing and shaping before the first heat stay in Prep', () => {
  it('moves steps before the first heat into prep, in the recipe order', () => {
    const r = run(['1 onion', '1 cup rice', '2 eggs'], ['Chop the onion.', 'Whisk the eggs.', 'Heat oil in a pan.', 'Add the onion, rice and eggs.']);
    assert.deepEqual(texts(r.prep), ['Chop 1 onion.', 'Whisk 2 eggs.']);
    assert.deepEqual(texts(r.cook), ['Heat oil in a pan.', 'Add the onion, 1 cup rice and eggs.']);
  });
  it('puts ingredient prep before the step that first uses it, then step prep after it', () => {
    const r = run(['1 cup cheddar, grated', '1 onion'], ['Stir the cheddar.', 'Heat oil.', 'Add the onion.']);
    assert.deepEqual(texts(r.prep), ['Grate 1 cup cheddar.', 'Stir 1 cup cheddar.']);
  });
  it('an oven preheat stays in Cook and does not end Prep', () => {
    const r = run(['1 onion'], ['Preheat the oven to 350F.', 'Chop the onion.', 'Heat oil.', 'Add the onion.']);
    assert.deepEqual(texts(r.cook).slice(0, 2), ['Preheat the oven to 350F.', 'Heat oil.']);
    assert.deepEqual(texts(r.prep), ['Chop 1 onion.']);
  });
  it('a heat verb ends Prep: later mixing stays in Cook', () => {
    const r = run(['1 onion', '1 cup rice'], ['Heat oil.', 'Chop the onion.', 'Add the rice.']);
    assert.deepEqual(r.prep, []);
    assert.equal(r.cook.length, 3);
  });
  it('"bring to a boil" and "melt" apply heat', () => {
    const r1 = run(['1 cup rice', '2 tablespoons butter'], ['Mix the rice.', 'Bring the water to a boil.', 'Add the rice.']);
    assert.deepEqual(texts(r1.prep), ['Mix 1 cup rice.']);
    const r2 = run(['2 tablespoons butter', '1 cup rice'], ['Mix the rice.', 'Melt the butter.', 'Add the rice.']);
    assert.equal(r2.prep.length, 1);
  });
  it('with no heat anywhere, every step stays in Cook in order', () => {
    const r = run(['1 cup flour', '1 cup sugar'], ['Mix the flour.', 'Stir in the sugar.']);
    assert.deepEqual(r.prep, []);
    assert.equal(r.cook.length, 2);
  });
  it('cook actions are never reordered', () => {
    const r = run(['1 onion, diced', '1 cup rice'], ['Heat oil.', 'Add the rice.', 'Add the onion.', 'Bake 20 minutes.']);
    assert.deepEqual(r.cook.map((a) => a.original.step), [...r.cook.map((a) => a.original.step)].sort((x, y) => x - y));
    assert.match(r.cook[0].text, /^Heat/);
    assert.match(r.cook[3].text, /^Bake/);
  });
});
