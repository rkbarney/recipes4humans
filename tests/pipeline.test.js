/**
 * Whole-pipeline tests: rewrite() and rewriteParts() from text to result, and an end-to-end recipe
 * checked against invariants (not against wording).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewrite, rewriteParts } from '../js/engine/index.js';
import { splitSentences } from '../js/engine/steps-sentences.js';
import { patterns } from './helpers/fixtures.js';

const texts = (list) => list.map((a) => a.text);
const all = (r) => [...r.prep, ...r.cook];
const count = (r, re) => all(r).filter((a) => re.test(a.text)).length;

describe('rewrite: finding the sections', () => {
  it('finds the title, ingredients and steps by their headings', () => {
    const r = rewrite('Pancakes\n\nIngredients\n1 cup flour\n2 eggs\n\nInstructions\nMix the flour.\nAdd the eggs.\n');
    assert.equal(r.title, 'Pancakes');
    assert.deepEqual(r.ingredients.map((i) => i.raw), ['1 cup flour', '2 eggs']);
    assert.deepEqual(r.steps, ['Mix the flour.', 'Add the eggs.']);
  });
  for (const h of ['Preparation', 'Instructions', 'Directions', 'Method', 'Steps']) {
    it(`accepts "${h}" as the steps heading`, () => {
      const r = rewrite(`Ingredients\n1 cup flour\n\n${h}\nMix the flour.\n`);
      assert.deepEqual(r.steps, ['Mix the flour.']);
    });
  }
  it('ignores case and a trailing colon in headings', () => {
    const r = rewrite('INGREDIENTS:\n1 cup flour\n\nDIRECTIONS:\nMix the flour.');
    assert.equal(r.ingredients.length, 1);
    assert.deepEqual(r.steps, ['Mix the flour.']);
  });
  it('strips bullets, numbering and "Step N" lines', () => {
    const r = rewrite('Ingredients\n- 1 cup flour\n• 2 eggs\n* 1 pinch salt\n\nSteps\nStep 1\nMix the flour.\n2. Add the eggs.\n3) Stir in the salt.\n');
    assert.deepEqual(r.ingredients.map((i) => i.raw), ['1 cup flour', '2 eggs', '1 pinch salt']);
    assert.deepEqual(r.steps, ['Mix the flour.', 'Add the eggs.', 'Stir in the salt.']);
  });
  it('ignores "Yield:" lines', () => {
    const r = rewrite('Pancakes\nYield: 4 servings\n\nIngredients\n1 cup flour\n\nSteps\nMix the flour.\n');
    assert.equal(r.title, 'Pancakes');
    assert.ok(!r.ingredients.some((i) => /yield/i.test(i.raw)));
    assert.ok(!r.steps.some((s) => /yield/i.test(s)));
  });
  it('finds the steps even when they come before the ingredients', () => {
    const r = rewrite('Method\nMix the flour.\n\nIngredients\n1 cup flour\n');
    assert.deepEqual(r.steps, ['Mix the flour.']);
    assert.equal(r.ingredients.length, 1);
  });
  it('throws an Error with code "no-sections" when there is no steps heading', () => {
    assert.throws(() => rewrite('Ingredients\n1 cup flour\n'), (e) => e instanceof Error && e.code === 'no-sections');
  });
  it('throws no-sections when there is no ingredients heading', () => {
    assert.throws(() => rewrite('Steps\nMix the flour.\n'), (e) => e.code === 'no-sections');
  });
  it('throws no-sections for plain text with no headings, and for an empty string', () => {
    assert.throws(() => rewrite('Just some words with no headings.'), (e) => e.code === 'no-sections');
    assert.throws(() => rewrite(''), (e) => e.code === 'no-sections');
  });
  it('the error message says what to do', () => {
    try { rewrite('hello'); assert.fail('should throw'); } catch (e) { assert.match(e.message, /heading/i); }
  });
});

describe('rewriteParts', () => {
  it('takes ingredient lines and steps and returns the result shape', () => {
    const r = rewriteParts({ ingredients: ['1 cup flour'], steps: ['Mix the flour.'] });
    assert.deepEqual(Object.keys(r).sort(), ['cook', 'deferred', 'flags', 'ingredients', 'prep', 'steps']);
    assert.deepEqual(r.steps, ['Mix the flour.']);
    assert.deepEqual(texts(r.cook), ['Mix 1 cup flour.']);
  });
  it('carries the title and source link through', () => {
    const r = rewriteParts({ ingredients: ['1 cup flour'], steps: ['Mix the flour.'], title: 'Bread', sourceUrl: 'https://example.com/bread' });
    assert.equal(r.title, 'Bread');
    assert.equal(r.sourceUrl, 'https://example.com/bread');
  });
  it('gives every action a unique id, and every ingredient an id', () => {
    const r = rewriteParts({ ingredients: ['1 onion, diced', '1 cup rice'], steps: ['Heat oil.', 'Add the onion.', 'Add the rice.'] });
    const ids = [...all(r), ...r.deferred].map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(r.ingredients.map((i) => i.id), ['i1', 'i2']);
  });
  it('is deterministic and does not change its input', () => {
    const input = { ingredients: ['1 onion, diced', '1 cup rice'], steps: ['Heat oil.', 'Add the onion.', 'Simmer for 10 minutes.', 'Add the rice.'] };
    const before = JSON.stringify(input);
    const a = rewriteParts(input);
    const b = rewriteParts(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), before);
  });
  it('a recipe the engine cannot make sense of still returns: nothing is inserted, and flags say why', () => {
    const r = rewriteParts({ ingredients: ['1 cup rice'], steps: ['Stir the sauce well.'] });
    assert.deepEqual(texts(r.cook), ['Stir the sauce well.']);
    assert.ok(r.flags.some((f) => f.code === 'unused-ingredient'));
  });
  it('every action says where it came from', () => {
    const r = rewriteParts({ ingredients: ['1 cup rice'], steps: ['Heat oil. Add the rice.'] });
    for (const a of r.cook) assert.ok(a.original.step >= 1);
  });
});

const MAC = `Mac and Cheese Test

Ingredients
- 6 ounces sharp cheddar, grated, divided
- 2 tablespoons butter
- 2 tablespoons flour
- 1½ cups milk
- 8 ounces elbow pasta
- ¼ cup breadcrumbs
- Salt and pepper

Steps
1. Boil the pasta in salted water until just tender, about 8 minutes, then drain.
2. Meanwhile, melt the butter in a saucepan, whisk in the flour and cook for 1 minute, stirring constantly. Slowly pour in the milk, whisking until smooth, and simmer until thickened, about 5 minutes.
3. Stir in 5 ounces of the cheddar until melted, season with salt and pepper, and fold in the pasta.
4. Top with the breadcrumbs and the remaining cheddar, then broil until golden, 2 to 3 minutes.
`;

describe('end to end: mac and cheese', () => {
  const r = rewrite(MAC);
  const find = (re) => all(r).find((a) => re.test(a.text));

  it('keeps "5 ounces" as the recipe states it and inserts no other amount of cheddar there', () => {
    const a = find(/Stir in/);
    assert.match(a.text, /5 ounces of the cheddar/);
    assert.equal((a.text.match(/\d/g) || []).length, 1, 'no second number in the action');
  });
  it('the last cheddar use resolves to 1 oz by subtraction (6 minus 5) and the amount is inserted', () => {
    const a = find(/remaining/);
    assert.match(a.text, /remaining 1 oz (?:sharp )?cheddar/);
  });
  it('butter, flour, milk, pasta and breadcrumbs each get their amount exactly once', () => {
    for (const [word, amount] of [['butter', '2 tbsp'], ['flour', '2 tbsp'], ['milk', '1½ cups'], ['pasta', '8 oz'], ['breadcrumbs', '¼ cup']]) {
      const hits = all(r).filter((a) => new RegExp(`${amount} (?:\\w+ )?${word}`).test(a.text));
      assert.equal(hits.length, 1, `${word}: ${amount} appears in ${hits.length} actions`);
    }
  });
  it('salt and pepper get no amount', () => {
    const a = find(/Season/);
    assert.match(a.text, /salt and pepper/i);
    assert.doesNotMatch(a.text, /\d/);
    assert.doesNotMatch(texts(r.cook).join(' '), /\d\s*(?:tsp|tbsp|pinch)\s+(?:salt|pepper)/i);
  });
  it('inserts no amount inside an "until" clause', () => {
    for (const a of all(r)) {
      const m = /\buntil\b(.*)$/i.exec(a.text);
      if (m) assert.doesNotMatch(m[1], /\d+\s*(?:oz|ounces?|cups?|tbsp|tsp)\b|\b\d+\s+(?:tbsp|cups?)\b/i, a.text);
    }
    assert.match(find(/Boil/).text, /until just tender, about 8 minutes/);
    assert.match(find(/whisking until smooth/).text, /whisking until smooth/);
  });
  it('"grate 6 oz cheddar" is a prep action', () => {
    const grate = [...r.prep, ...r.deferred].find((a) => /^Grate 6 oz (?:sharp )?cheddar\.$/.test(a.text));
    assert.ok(grate, 'a prep action (deferred into the boil window, so it is listed in deferred)');
    assert.equal(grate.kind, 'hands-on');
    assert.equal(grate.original.ingredientId, 'i1');
  });
  it('the cook actions are in the original order', () => {
    const steps = r.cook.map((a) => a.original.step);
    assert.deepEqual(steps, [...steps].sort((x, y) => x - y));
    const order = ['Boil', 'melt|Melt', 'whisk|Whisk', 'pour|Pour', 'simmer|Simmer', 'Stir in', 'Season|season', 'fold|Fold', 'Top', 'roil'];
    let at = -1;
    for (const w of order) {
      const i = r.cook.findIndex((a, k) => k > at && new RegExp(w).test(a.text));
      assert.ok(i > at, `"${w}" after position ${at}: ${texts(r.cook).join(' | ')}`);
      at = i;
    }
  });
  it('the broil action (under 5 minutes, high heat) has no meanwhile', () => {
    const a = r.cook.find((x) => /roil/.test(x.text));
    assert.deepEqual(a.meanwhile, []);
  });
  it('the boil is a waiting window and the cheddar is grated in it', () => {
    const a = r.cook.find((x) => /^Boil/.test(x.text));
    assert.equal(a.kind, 'waiting');
    assert.equal(a.meanwhile.length, 1);
    const grated = r.deferred.find((d) => d.id === a.meanwhile[0]);
    assert.match(grated.text, /^Grate 6 oz/);
  });
  it('the second use of the pasta gets no repeat amount', () => {
    assert.match(find(/fold in the pasta/i).text, /fold in the pasta/i);
    assert.equal(count(r, /8 oz (?:elbow )?pasta/), 1);
  });
  it('has no flags', () => {
    assert.deepEqual(r.flags, []);
  });
  it('the ingredient list lists the split of the cheddar', () => {
    const ched = r.ingredients.find((i) => /cheddar/.test(i.name));
    assert.deepEqual(ched.portions.filter((p) => p.qty !== undefined).map((p) => [p.qty, p.unit]), [[5, 'oz'], [1, 'oz']]);
  });
});

describe('end to end: small recipes', () => {
  it('a recipe with no heat step keeps every step in Cook, with amounts', () => {
    const r = rewriteParts({ ingredients: ['2 cups flour', '1 cup sugar'], steps: ['Mix the flour and the sugar.'] });
    assert.deepEqual(texts(r.cook), ['Mix 2 cups flour and 1 cup sugar.']);
    assert.deepEqual(r.prep, []);
  });
  it('a divided ingredient with stated amounts in both uses adds up with no flag', () => {
    const r = rewriteParts({ ingredients: ['¾ cup oats, divided'], steps: ['Heat oil.', 'Add ¼ cup oats.', 'Add the remaining oats.'] });
    assert.deepEqual(texts(r.cook), ['Heat oil.', 'Add ¼ cup oats.', 'Add the remaining ½ cup oats.']);
    assert.deepEqual(r.flags, []);
  });
});

describe('no recipe text is lost', () => {
  // Words without articles or the "and" and "then" a split removes, and with a plural s ignored (an inserted amount may pluralise a unit-less noun).
  const words = (t) => (t.toLowerCase().match(/[a-zà-ɏ]+/g) ?? []).filter((w) => !['the', 'a', 'an', 'and', 'then'].includes(w)).map((w) => w.replace(/(?:es|s)$/, ''));
  /**
   * Every sentence of every input step: all its words appear in the action text or notes of the same step.
   * A step with no instruction at all adds its sentences to the previous action, so it looks back to that action's step.
   */
  function missing(r) {
    const out = [];
    const pool = [...r.prep, ...r.cook, ...r.deferred];
    const has = (n) => pool.some((a) => a.original.step === n);
    r.steps.forEach((step, i) => {
      let from = i + 1;
      while (from > 1 && !has(from)) from--;
      const bag = new Set(words(pool.filter((a) => a.original.step >= from && a.original.step <= i + 1)
        .map((a) => `${a.text} ${a.notes.join(' ')}`).join(' ')));
      for (const sp of splitSentences(step)) {
        const lost = words(step.slice(sp.start, sp.end)).filter((w) => !bag.has(w));
        if (lost.length) out.push(`step ${i + 1}: "${step.slice(sp.start, sp.end)}" lost ${lost.join(', ')}`);
      }
    });
    return out;
  }
  it('an instruction-free sentence before the first action of a step is kept as a note', () => {
    const r = rewriteParts({
      ingredients: ['1 cup rice', '2 cups water'],
      steps: ['Rinse the rice.', 'This is the part that matters. Boil the water. Add the rice.', 'It is done when tender. The rice keeps well.'],
    });
    assert.deepEqual(missing(r), []);
    const boil = all(r).find((a) => /^Boil/.test(a.text));
    assert.ok(boil.notes.includes('This is the part that matters.'));
  });
  it('holds for the golden recipe and every pattern recipe', () => {
    const gold = rewrite(readFileSync(new URL('./fixtures/golden/input.txt', import.meta.url), 'utf8'));
    assert.deepEqual(missing(gold), []);
    for (const fx of patterns()) {
      const r = rewrite(fx.input);
      assert.deepEqual(missing(r), [], fx.name);
    }
  });
});

describe('pipeline: a count lands on the counted noun', () => {
  it('"the chicken" gets no number, "the chicken thighs" does', () => {
    const r = rewriteParts({
      ingredients: ['4 chicken thighs', '2 tablespoons olive oil', '1 tablespoon paprika', '3 carrots, sliced'],
      steps: ['Rub the oil and paprika all over the chicken. Roast the chicken thighs with the carrots for 35 minutes, until cooked through.'],
    });
    assert.deepEqual(texts(r.prep).filter((t) => /^Rub/.test(t)), ['Rub 2 tbsp oil and 1 tbsp paprika all over the chicken.']);
    assert.deepEqual(texts(r.cook), ['Roast 4 chicken thighs with 3 carrots for 35 minutes, until cooked through.']);
    assert.deepEqual(r.flags, []);
  });
  it('with no full mention no count is inserted and nothing is flagged', () => {
    const r = rewriteParts({ ingredients: ['4 chicken thighs'], steps: ['Roast the chicken for 35 minutes.'] });
    assert.deepEqual(texts(all(r)), ['Roast the chicken for 35 minutes.']);
    assert.deepEqual(r.flags, []);
  });
});
