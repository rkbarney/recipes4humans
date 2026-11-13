import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite, rewriteParts } from '../js/engine/index.js';
import { splitSteps } from '../js/engine/steps.js';
import { parseIngredients } from '../js/engine/ingredients.js';
import { isOvenPreheat } from '../js/engine/text-utils.js';

const texts = (s) => splitSteps([s]).actions.map((a) => a.text);
const ing = (line) => parseIngredients([line]).ingredients[0];

describe('stress-pass fixes: step structure', () => {
  it('a method heading such as "Procedure" or "Method" starts the steps', () => {
    const r = rewrite('Ingredients\n1 egg\n\nProcedure\n1. Boil the egg.\n');
    assert.equal(r.steps.length, 1);
  });
  it('a bare prep verb keeps the verb that supplies its object', () => {
    assert.deepEqual(texts('Core and chop the pepper.'), ['Core and chop the pepper.']);
    assert.deepEqual(texts('Peel and finely chop the shallot.'), ['Peel and finely chop the shallot.']);
  });
  it('a bare prep verb with a tail keeps its tail and a real second instruction still splits', () => {
    assert.deepEqual(texts('Slice thinly on the diagonal, and fry in oil.'), ['Slice thinly on the diagonal.', 'Fry in oil.']);
  });
  it('an unlisted verb followed by a particle is still an instruction', () => {
    assert.deepEqual(texts('Punch down the dough.'), ['Punch down the dough.']);
    assert.equal(rewriteParts({ ingredients: ['1 cup flour'], steps: ['Punch down the dough.'] }).cook.length, 1);
  });
  it('a sentence opening with "another" is not read as an instruction', () => {
    const r = rewriteParts({ ingredients: ['2 eggs'], steps: ['Crack the eggs. Another 2 minutes of beating helps.'] });
    assert.equal(r.cook.length + r.prep.length, 1);
  });
});

describe('stress-pass fixes: ingredient lines', () => {
  it('package, packet, tin and rib are units', () => {
    assert.equal(ing('2 packets (14 g) yeast').portions[0].unit, 'package');
    assert.equal(ing('1 tin plum tomatoes').portions[0].unit, 'tin');
    assert.equal(ing('2 ribs celery').portions[0].unit, 'rib');
  });
  it('"ea." and "each" after the number are not part of the name', () => {
    const i = ing('3 ea. bananas');
    assert.equal(i.name, 'bananas');
    assert.deepEqual(i.portions[0], { qty: 3 });
  });
  it('a size word between the number and the unit keeps the unit', () => {
    assert.deepEqual(ing('2 large cloves garlic').portions[0], { qty: 2, unit: 'clove' });
  });
  it('a trailing purpose phrase is not part of the name', () => {
    assert.equal(ing('1 cup vegetable oil for frying').name, 'vegetable oil');
  });
  it('"about" before an amount is read as the amount', () => {
    assert.deepEqual(ing('about 3 cups flour').portions[0], { qty: 3, unit: 'cup' });
  });
  it('an optional note is not a prep step, and a note that repeats the name adds no prep', () => {
    assert.deepEqual(ing('2 limes (optionally peeled)').portions[0], { qty: 2 });
    assert.equal(ing('1 cup freshly squeezed lemon juice (freshly squeezed)').portions[0].prep, undefined);
  });
});

describe('stress-pass fixes: matching and windows', () => {
  it('an inserted amount never lands inside a hyphenated modifier', () => {
    const r = rewriteParts({ ingredients: ['½ cup all-purpose flour'], steps: ['Pour all-purpose flour in a plate.'] });
    assert.equal(r.cook[0].text, 'Pour ½ cup all-purpose flour in a plate.');
  });
  it('any preheat that does not name a pan is an oven preheat', () => {
    assert.equal(isOvenPreheat('Preheat to 400 °F.'), true);
    assert.equal(isOvenPreheat('Preheat the skillet to medium.'), false);
  });
});

describe('stress-pass fixes: amounts', () => {
  it('greasing a pan with an ingredient the dish also needs does not use up its amount', () => {
    const r = rewriteParts({ ingredients: ['½ cup butter'], steps: ['Grease the pan with butter.', 'Cream the butter with sugar.'] });
    const texts = [...r.prep, ...r.cook].map((a) => a.text);
    assert.ok(texts.includes('Grease the pan with butter.'));
    assert.ok(texts.includes('Cream ½ cup butter with sugar.'));
  });
  it('greasing with an ingredient used nowhere else still gets its amount', () => {
    const r = rewriteParts({ ingredients: ['2 tbsp butter'], steps: ['Grease the pan with butter.'] });
    assert.equal(r.cook[0].text, 'Grease the pan with 2 tbsp butter.');
  });
  it('a word that is only part of the name takes a count without being pluralised', () => {
    const r = rewriteParts({ ingredients: ['4 boneless chicken breasts'], steps: ['Rub all over chicken.'] });
    assert.equal(r.cook[0].text, 'Rub all over 4 chicken.');
  });
});

describe('stress-pass fixes: amounts (alternatives)', () => {
  it('"grease the pan with oil or butter" treats both as coatings', () => {
    const r = rewriteParts({ ingredients: ['¼ cup butter', '⅓ cup oil'], steps: ['Grease the pan with oil or butter.', 'Melt the butter.', 'Whisk in the oil.'] });
    const t = [...r.prep, ...r.cook].map((a) => a.text);
    assert.ok(t.includes('Grease the pan with oil or butter.'));
  });
});
