/**
 * Stage 6 (waiting windows) tests: SPEC "6. Waiting windows" and the window decisions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteParts } from '../js/engine/index.js';
import { prepMinutes } from '../js/engine/windows.js';

const ING = ['1 onion, diced', '1 lemon, juiced', '2 cloves garlic, minced'];
const USE = ['Add the onion.', 'Add the garlic.', 'Add the lemon juice.'];
const run = (first, ingredients = ING, rest = USE) => rewriteParts({ ingredients, steps: [first, ...rest] });
const win = (r) => r.cook[0];

describe('spec 6: what is a waiting window', () => {
  for (const [text, label] of [
    ['Simmer the sauce for 10 minutes.', 'simmer'],
    ['Bake for 20 minutes.', 'bake'],
    ['Roast the squash for 30 minutes.', 'roast'],
    ['Boil the potatoes for 10 minutes.', 'boil'],
    ['Let the dough rest for 30 minutes.', 'rest'],
    ['Marinate the chicken for 30 minutes.', 'marinate'],
    ['Chill the mixture for 30 minutes.', 'chill'],
    ['Brown the meat for 8 minutes.', 'brown'],
    ['Reduce the liquid for 10 minutes.', 'reduce'],
    ['Soak the beans for 60 minutes.', 'soak'],
  ]) {
    it(`a ${label} with a duration of 3 minutes or more is a window`, () => {
      const r = run(text);
      assert.equal(win(r).kind, 'waiting');
      assert.ok(win(r).meanwhile.length > 0, 'prep is placed in it');
    });
  }
  it('under 3 minutes is not a window', () => {
    const r = run('Simmer for 2 minutes.');
    assert.equal(win(r).kind, 'hands-on');
    assert.deepEqual(win(r).meanwhile, []);
    assert.deepEqual(r.deferred, []);
  });
  it('exactly 3 minutes is a window', () => {
    assert.equal(win(run('Bake for 3 minutes.')).kind, 'waiting');
  });
  it('an action with no stated time is not a window ("Simmer until thick")', () => {
    assert.equal(win(run('Simmer until thick.')).kind, 'hands-on');
  });
  it('uses the shortest stated time of a range', () => {
    const r = run('Simmer for 3 to 10 minutes.');
    assert.equal(win(r).kind, 'waiting');
    assert.ok(win(r).meanwhile.length < 3, '60% of 3 minutes holds one or two small tasks, not all three');
  });
  it('a "cook", "let", "leave" or "cover" needs 5 minutes', () => {
    assert.equal(win(run('Cook the rice for 5 minutes.')).kind, 'waiting');
    assert.equal(win(run('Cover and cook for 4 minutes.')).kind, 'hands-on');
    assert.equal(win(run('Let it stand for 10 minutes.')).kind, 'waiting');
    assert.equal(win(run('Leave for 4 minutes.')).kind, 'hands-on');
  });
  it('a verb that is not a waiting verb is not a window ("Stir for 10 minutes")', () => {
    assert.equal(win(run('Stir for 10 minutes.')).kind, 'hands-on');
  });
});

describe('spec 6: stirring cancels the window', () => {
  for (const t of [
    'Simmer, stirring constantly, for 20 minutes.',
    'Simmer for 20 minutes, whisking constantly.',
    'Simmer for 20 minutes, stirring frequently.',
    'Simmer for 20 minutes, stirring often.',
  ]) {
    it(`"${t}"`, () => {
      const r = run(t);
      assert.equal(win(r).kind, 'hands-on');
      assert.deepEqual(r.deferred, []);
    });
  }
  it('"stirring occasionally" does not cancel it', () => {
    assert.equal(win(run('Simmer for 20 minutes, stirring occasionally.')).kind, 'waiting');
  });
});

describe('spec 6: frying, searing and broiling under 5 minutes', () => {
  it('get no suggestions', () => {
    for (const t of ['Brown the meat on high heat for 4 minutes.', 'Sear the steak for 4 minutes.', 'Broil for 4 minutes.']) {
      const r = run(t);
      assert.deepEqual(win(r).meanwhile, [], t);
      assert.deepEqual(r.deferred, [], t);
    }
  });
  it('5 minutes or more is usable', () => {
    assert.equal(win(run('Sear the steak for 8 minutes.')).meanwhile.length, 0, 'sear is not on the waiting list, so it is never a window');
    assert.ok(win(run('Brown the meat on high heat for 8 minutes.')).meanwhile.length > 0);
  });
});

describe('spec 6: no stated time', () => {
  it('preheating an oven is a window with no stated time', () => {
    const r = run('Preheat the oven to 400F.');
    assert.equal(win(r).kind, 'waiting');
    assert.ok(win(r).meanwhile.length > 0);
  });
  it('bringing a pot of water to a boil is a window', () => {
    assert.equal(win(run('Bring a large pot of water to a boil.')).kind, 'waiting');
  });
  it('bringing a sauce to a simmer is not (no other defaults exist)', () => {
    assert.equal(win(run('Bring the sauce to a simmer.')).kind, 'hands-on');
    assert.equal(win(run('Heat the oil in a pan.')).kind, 'hands-on');
  });
  it('the preheat window holds 6 minutes of prep (60% of 10)', () => {
    const r = rewriteParts({
      ingredients: ['2 onions, diced', '2 carrots, diced', '2 stalks celery, diced', '2 peppers, diced'],
      steps: ['Preheat the oven to 400F.', 'Add the onions.', 'Add the carrots.', 'Add the celery.', 'Add the peppers.'],
    });
    assert.equal(win(r).meanwhile.length, 3, '3 x 2 minutes fills 6 minutes');
    assert.equal(r.prep.length, 1, 'the fourth stays in prep');
  });
});

describe('spec 6: which prep goes in a window', () => {
  it('only prep whose ingredient is first used after the window ends', () => {
    const r = rewriteParts({
      ingredients: ['1 onion, diced', '1 clove garlic, minced'],
      steps: ['Add the onion.', 'Simmer the sauce for 10 minutes.', 'Add the garlic.'],
    });
    assert.deepEqual(r.deferred.map((a) => a.text), ['Mince 1 clove garlic.']);
    assert.ok(r.prep.some((a) => a.text === 'Dice 1 onion.'));
    assert.deepEqual(r.cook.find((a) => a.kind === 'waiting').meanwhile, ['p2']);
  });
  it('an ingredient used by the window action itself is not deferred into it', () => {
    const r = rewriteParts({ ingredients: ['1 onion, diced'], steps: ['Simmer the onion for 10 minutes.'] });
    assert.deepEqual(r.deferred, []);
    assert.deepEqual(r.prep.map((a) => a.text), ['Dice 1 onion.']);
  });
  it('goes in the earliest window where it fits', () => {
    const r = rewriteParts({
      ingredients: ['1 onion, diced'],
      steps: ['Simmer the sauce for 10 minutes.', 'Bake for 20 minutes.', 'Add the onion.'],
    });
    assert.deepEqual(r.cook[0].meanwhile, ['p1']);
    assert.deepEqual(r.cook[1].meanwhile, []);
  });
  it('moves to the next window when the first is full', () => {
    const r = rewriteParts({
      ingredients: ['2 onions, diced', '2 carrots, diced', '2 stalks celery, diced'],
      steps: ['Simmer the sauce for 5 minutes.', 'Bake for 20 minutes.', 'Add the onions.', 'Add the carrots.', 'Add the celery.'],
    });
    assert.deepEqual(r.cook[0].meanwhile, ['p1'], '60% of 5 is 3 minutes: one 2-minute task');
    assert.deepEqual(r.cook[1].meanwhile, ['p2', 'p3']);
  });
  it('a window never holds more than 60% of its time', () => {
    const r = rewriteParts({
      ingredients: ['1 onion, diced', '1 carrot, diced'],
      steps: ['Simmer the sauce for 3 minutes.', 'Add the onion.', 'Add the carrot.'],
    });
    assert.equal(r.cook[0].meanwhile.length, 0, '60% of 3 is 1.8 minutes: a 2-minute task does not fit');
  });
  it('a window after the ingredient is first used does not take it', () => {
    const r = rewriteParts({
      ingredients: ['1 onion, diced'],
      steps: ['Heat oil.', 'Add the onion.', 'Simmer the sauce for 10 minutes.'],
    });
    assert.deepEqual(r.deferred, []);
    assert.deepEqual(r.cook[2].meanwhile, []);
  });
  it('state prep (melt, soften, thaw, toast, warm) is never deferred', () => {
    const r = rewriteParts({
      ingredients: ['2 tablespoons butter, melted'],
      steps: ['Simmer the sauce for 20 minutes.', 'Stir in the butter.'],
    });
    assert.deepEqual(r.deferred, []);
    assert.deepEqual(r.prep.map((a) => a.text), ['Melt 2 tbsp butter.']);
  });
  it('prep made from a step (not an ingredient line) is never moved', () => {
    const r = rewriteParts({
      ingredients: ['1 onion', '1 cup rice'],
      steps: ['Chop the onion.', 'Simmer the sauce for 10 minutes.', 'Add the onion and the rice.'],
    });
    assert.deepEqual(r.deferred, []);
  });
  it('the deferred actions carry the window in meanwhile and keep their text', () => {
    const r = run('Simmer for 10 minutes.');
    const ids = new Set(r.deferred.map((a) => a.id));
    assert.deepEqual(new Set(win(r).meanwhile), ids);
    assert.ok(!r.prep.some((a) => ids.has(a.id)));
  });
  it('cook actions keep their order and count', () => {
    const r = run('Simmer for 10 minutes.');
    assert.deepEqual(r.cook.map((a) => a.text.split(' ')[0]), ['Simmer', 'Add', 'Add', 'Add']);
  });
});

describe('spec 6: prep times', () => {
  it('follows the table: dice 2, juice 1, mince 1 per 2 cloves', () => {
    assert.equal(prepMinutes('Dice 1 onion.'), 2);
    assert.equal(prepMinutes('Juice 1 lemon.'), 1);
    assert.equal(prepMinutes('Mince 1 clove garlic.'), 1);
    assert.equal(prepMinutes('Mince 2 cloves garlic.'), 1);
    assert.equal(prepMinutes('Mince 3 cloves garlic.'), 2);
    assert.equal(prepMinutes('Mince 6 cloves garlic.'), 3);
  });
  it('"cut into wedges" is 1, anything not in the table is 2', () => {
    assert.equal(prepMinutes('Cut 1 lemon into wedges.'), 1);
    assert.equal(prepMinutes('Frobnicate 1 lemon.'), 2);
  });
  it('skips an adverb to find the verb: "Finely chop"', () => {
    assert.equal(prepMinutes('Finely chop 1 onion.'), 2);
  });
  it('a larger garlic prep needs a bigger window', () => {
    const steps = ['Simmer the sauce for 5 minutes.', 'Add the garlic.'];
    const small = rewriteParts({ ingredients: ['2 cloves garlic, minced'], steps });
    const large = rewriteParts({ ingredients: ['8 cloves garlic, minced'], steps });
    assert.deepEqual(small.cook[0].meanwhile, ['p1'], '1 minute fits in 3');
    assert.deepEqual(large.cook[0].meanwhile, [], '4 minutes does not');
  });
});
