import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredients } from '../js/engine/ingredients.js';
import { golden, patterns, splitInput } from './helpers/fixtures.js';

const one = (line) => {
  const r = parseIngredients([line]);
  assert.equal(r.ingredients.length, 1, `${line}: expected one ingredient`);
  return { ing: r.ingredients[0], flags: r.flags, p: r.ingredients[0].portions[0] };
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

describe('contract basics', () => {
  it('numbers ids i1..iN in order and keeps the raw line', () => {
    const r = parseIngredients(['2 eggs', 'For the sauce:', '1 cup milk']);
    assert.deepEqual(r.ingredients.map((i) => i.id), ['i1', 'i2']);
    assert.equal(r.ingredients[1].raw, '1 cup milk');
    assert.deepEqual(r.flags, []);
  });
  it('ignores blank lines and returns empty results for empty input', () => {
    assert.deepEqual(parseIngredients([]), { ingredients: [], flags: [] });
    assert.equal(parseIngredients(['', '  ', '1 egg']).ingredients.length, 1);
  });
  it('is deterministic', () => {
    const lines = ['1 cup (240 ml) milk', 'salt and pepper', '½ tsp plus 1 tbsp cumin'];
    assert.deepEqual(parseIngredients(lines), parseIngredients(lines));
  });
  it('gives every ingredient the contract fields', () => {
    const { ing } = one('1 small red onion, diced');
    assert.equal(typeof ing.name, 'string');
    assert.equal(typeof ing.head, 'string');
    assert.deepEqual(ing.alternates, []);
    assert.equal(ing.divided, false);
    assert.ok(Array.isArray(ing.portions));
    assert.equal('group' in ing, false);
  });
});

describe('spec 1: quantity', () => {
  it('whole numbers', () => assert.equal(one('3 eggs').p.qty, 3));
  it('decimals', () => assert.equal(one('1.5 cups milk').p.qty, 1.5));
  it('fraction characters', () => {
    assert.equal(one('½ cup milk').p.qty, 0.5);
    near(one('⅓ cup milk').p.qty, 1 / 3);
    assert.equal(one('¾ cup milk').p.qty, 0.75);
  });
  it('typed fractions', () => assert.equal(one('1/4 cup milk').p.qty, 0.25));
  it('mixed numbers in every spelling', () => {
    for (const l of ['1 ½ cups flour', '1 1/2 cups flour', '1½ cups flour', '1-1/2 cups flour']) assert.equal(one(l).p.qty, 1.5, l);
  });
  it('ranges', () => {
    assert.deepEqual(one('5 to 7 sprigs thyme').p.qty, [5, 7]);
    assert.deepEqual(one('5-7 sprigs thyme').p.qty, [5, 7]);
    assert.deepEqual(one('1 to 2 tablespoons honey').p, { qty: [1, 2], unit: 'tbsp' });
  });
  it('number words', () => assert.equal(one('two eggs').p.qty, 2));
  it('dual units keep the first as the amount and the other as an alternate, never added', () => {
    for (const l of ['1 cup (240 ml) milk', '1 cup / 240 ml milk']) {
      const { p, ing } = one(l);
      assert.deepEqual(p, { qty: 1, unit: 'cup', alt: { qty: 240, unit: 'ml' } });
      assert.equal(ing.name, 'milk');
    }
    assert.deepEqual(one('200 g / 7 oz flour').p, { qty: 200, unit: 'g', alt: { qty: 7, unit: 'oz' } });
    assert.equal(one('200 g / 7 oz flour').ing.name, 'flour');
    assert.deepEqual(one('1 (14-ounce) can tomatoes').p, { qty: 1, unit: 'can', alt: { qty: 14, unit: 'oz' } });
  });
  it('attached units', () => {
    assert.deepEqual(one('200g flour').p, { qty: 200, unit: 'g' });
    assert.deepEqual(one('2tbsp oil').p, { qty: 2, unit: 'tbsp' });
  });
});

describe('spec 1: unit', () => {
  const cases = [
    ['1 tablespoon oil', 'tbsp'], ['2 tablespoons oil', 'tbsp'], ['2 tbsp oil', 'tbsp'], ['2 Tbsp. oil', 'tbsp'], ['2 T oil', 'tbsp'],
    ['1 teaspoon salt', 'tsp'], ['2 teaspoons salt', 'tsp'], ['1 tsp. salt', 'tsp'], ['1 t salt', 'tsp'],
    ['1 cup milk', 'cup'], ['2 cups milk', 'cup'], ['2 c milk', 'cup'], ['2 c. milk', 'cup'],
    ['1 ounce cheese', 'oz'], ['8 ounces cheese', 'oz'], ['8 oz. cheese', 'oz'],
    ['1 pound beef', 'lb'], ['2 pounds beef', 'lb'], ['2 lb beef', 'lb'], ['2 lbs. beef', 'lb'],
    ['100 grams flour', 'g'], ['100 g flour', 'g'], ['1 kilogram flour', 'kg'], ['1 kg flour', 'kg'],
    ['250 milliliters milk', 'ml'], ['250 ml milk', 'ml'], ['1 liter water', 'l'], ['2 l water', 'l'],
    ['1 pinch salt', 'pinch'], ['2 dashes bitters', 'dash'], ['3 cloves garlic', 'clove'], ['2 cans beans', 'can'],
    ['1 stick butter', 'stick'], ['4 sprigs thyme', 'sprig'], ['1 bunch kale', 'bunch'], ['2 slices bread', 'slice'],
    ['2 pieces ginger', 'piece'], ['1 head cauliflower', 'head'], ['3 stalks celery', 'stalk'],
  ];
  for (const [line, unit] of cases) {
    it(`${line} -> ${unit}`, () => {
      const { p, ing } = one(line);
      assert.equal(p.unit, unit);
      assert.ok(p.qty > 0);
      assert.ok(!/^(?:tablespoons?|teaspoons?|cups?|ounces?|pounds?|grams?|pinch|cloves?)\b/i.test(ing.name), ing.name);
    });
  }
  it('a line can have no unit', () => {
    const { p, ing } = one('2 lemons');
    assert.deepEqual(p, { qty: 2 });
    assert.equal(ing.name, 'lemons');
  });
  it('"of" after the unit is dropped from the name', () => {
    assert.equal(one('1 clove of garlic').ing.name, 'garlic');
    assert.deepEqual(one('a pinch of salt').p, { qty: 1, unit: 'pinch' });
    assert.equal(one('a pinch of salt').ing.name, 'salt');
  });
  it('size and packaging words stay with the name, not the unit', () => {
    let r = one('1 small red onion');
    assert.deepEqual(r.p, { qty: 1 });
    assert.equal(r.ing.name, 'small red onion');
    r = one('2 large eggs');
    assert.deepEqual(r.p, { qty: 2 });
    assert.equal(r.ing.name, 'large eggs');
    r = one('1 (14-ounce) can tomatoes');
    assert.equal(r.ing.name, 'tomatoes');
    r = one('1 (8-ounce) package cream cheese');
    assert.equal(r.p.unit, undefined);
    assert.ok(r.ing.name.includes('cream cheese'));
    r = one('4 packed cups baby spinach');
    assert.equal(r.p.unit, 'cup');
    assert.equal(r.ing.name, 'packed baby spinach');
  });
});

describe('spec 1: name', () => {
  it('is the text after the unit up to the first comma or parenthesis', () => {
    assert.equal(one('1 cup flour, sifted').ing.name, 'flour');
    assert.equal(one('1 cup (130 g) flour (sifted)').ing.name, 'flour');
  });
  it('keeps descriptors for display and drops them from head', () => {
    const { ing } = one('⅓ cup packed fresh dill');
    assert.equal(ing.name, 'packed fresh dill');
    assert.equal(ing.head, 'dill');
    assert.deepEqual(ing.descriptors, ['packed', 'fresh']);
    assert.equal(one('1 cup low-sodium chicken broth').ing.head, 'chicken broth');
    assert.equal(one('1 tablespoon ground cumin').ing.head, 'cumin');
    assert.equal(one('1 small red onion').ing.head, 'onion');
    assert.equal(one('½ teaspoon red-pepper flakes').ing.head, 'red-pepper flakes');
  });
  it('head is lowercase and never empty', () => {
    assert.equal(one('Kosher salt').ing.head, 'salt');
    assert.equal(one('1 cup Fresh').ing.head, 'fresh');
  });
  it('trailing "to taste" and similar are not part of the name', () => {
    assert.equal(one('salt to taste').ing.name, 'salt');
    assert.equal(one('1 cup flour, optional').ing.name, 'flour');
  });
});

describe('spec 1: alternatives', () => {
  it('chicken or turkey', () => {
    const { ing } = one('1 pound ground chicken or turkey');
    assert.equal(ing.name, 'ground chicken');
    assert.deepEqual(ing.alternates, ['turkey']);
    assert.equal(ing.head, 'chicken');
  });
  it('broth or water', () => {
    const { ing, p } = one('4 cups low-sodium chicken broth or water');
    assert.equal(ing.name, 'low-sodium chicken broth');
    assert.deepEqual(ing.alternates, ['water']);
    assert.deepEqual(p, { qty: 4, unit: 'cup' });
  });
  it('several alternatives', () => {
    assert.deepEqual(one('1 cup milk or cream or water').ing.alternates, ['cream', 'water']);
  });
  it('a quantity inside an alternative is not kept in its name', () => {
    assert.deepEqual(one('2 tablespoons butter or 2 tablespoons oil').ing.alternates, ['oil']);
  });
});

describe('spec 1: plus', () => {
  it('"½ teaspoon plus 1 tablespoon turmeric" gives two portions', () => {
    const { ing } = one('½ teaspoon plus 1 tablespoon ground turmeric');
    assert.equal(ing.name, 'ground turmeric');
    assert.deepEqual(ing.portions, [{ qty: 0.5, unit: 'tsp' }, { qty: 1, unit: 'tbsp' }]);
  });
  it('"plus more for serving" adds an unmeasured serving portion', () => {
    const { ing } = one('½ teaspoon red-pepper flakes, plus more for serving');
    assert.deepEqual(ing.portions, [{ qty: 0.5, unit: 'tsp' }, { tag: 'serving' }]);
  });
  it('"plus N unit" after a comma is a second portion', () => {
    const { ing } = one('1 cup flour, plus 2 tablespoons for dusting');
    assert.deepEqual(ing.portions, [{ qty: 1, unit: 'cup' }, { qty: 2, unit: 'tbsp' }]);
  });
  it('a "+" between two measures means "plus" (bug fix: it used to keep only the first measure)', () => {
    const { ing } = one('1 cup + 2 tablespoons flour');
    assert.equal(ing.head, 'flour');
    assert.deepEqual(ing.portions, [{ qty: 1, unit: 'cup' }, { qty: 2, unit: 'tbsp' }]);
  });
  it('a plus that is not another measure of the same thing is flagged, not guessed', () => {
    const { ing, flags, p } = one('2 eggs plus 1 yolk');
    assert.equal(p.qty, undefined);
    assert.equal(flags[0].code, 'unparseable-quantity');
    assert.equal(flags[0].ingredientId, ing.id);
  });
});

describe('spec 1: divided', () => {
  it('marks the ingredient and keeps only what the line states', () => {
    const { ing } = one('4 tablespoons butter, divided');
    assert.equal(ing.divided, true);
    assert.equal(ing.name, 'butter');
    assert.deepEqual(ing.portions, [{ qty: 4, unit: 'tbsp' }]);
  });
  it('works inside parentheses and beside prep', () => {
    assert.equal(one('¾ cup rolled oats (divided)').ing.divided, true);
    const { ing } = one('2 cloves garlic, minced, divided');
    assert.equal(ing.divided, true);
    assert.equal(ing.portions[0].prep, 'minced');
  });
  it('is false otherwise', () => assert.equal(one('1 cup rice').ing.divided, false));
});

describe('spec 1: prep notes', () => {
  it('after a comma, as written', () => {
    for (const prep of ['diced', 'grated', 'chopped', 'minced', 'sliced', 'juiced', 'zested', 'halved', 'peeled', 'drained', 'rinsed', 'melted', 'softened', 'squeezed', 'finely chopped', 'cut into 1-inch pieces']) {
      assert.equal(one(`1 onion, ${prep}`).p.prep, prep, prep);
    }
  });
  it('in parentheses', () => {
    assert.equal(one('1 onion (diced)').p.prep, 'diced');
    assert.equal(one('1 can (15 ounces) black beans (drained and rinsed)').p.prep, 'drained and rinsed');
  });
  it('a parenthesis with fractions gives one portion per fraction, each with its own prep', () => {
    const { ing } = one('1 small red onion (½ diced, and ½ grated, then squeezed dry)');
    assert.deepEqual(ing.portions, [{ qty: 0.5, prep: 'diced' }, { qty: 0.5, prep: 'grated, then squeezed dry' }]);
    assert.equal(ing.head, 'onion');
  });
  it('counts in parentheses work the same ("2 lemons (1 juiced, 1 cut into wedges)")', () => {
    assert.deepEqual(one('2 lemons (1 juiced, 1 cut into wedges)').ing.portions, [{ qty: 1, prep: 'juiced' }, { qty: 1, prep: 'cut into wedges' }]);
  });
  it('fractions that do not add up to the amount are flagged, not guessed', () => {
    const { p, flags } = one('1 onion (½ diced, ¼ grated)');
    assert.equal(p.qty, undefined);
    assert.equal(flags[0].code, 'unparseable-quantity');
  });
  it('a unit inside the parenthesis is an alternate amount, not a prep portion', () => {
    const { p } = one('1 can (8 ounces, drained) beans');
    assert.deepEqual(p, { qty: 1, unit: 'can', prep: 'drained', alt: { qty: 8, unit: 'oz' } });
  });
  it('text with no prep word is not prep', () => {
    assert.equal(one('1 cup flour, plus more as needed').p.prep, undefined);
    assert.equal(one('1 cup flour (optional)').p.prep, undefined);
  });
  it('prep words inside the name are descriptors, not prep notes', () => {
    const { ing, p } = one('½ cup grated Parmesan');
    assert.equal(p.prep, undefined);
    assert.equal(ing.name, 'grated Parmesan');
    assert.equal(ing.head, 'parmesan');
  });
  it('prep on an unmeasured ingredient', () => {
    assert.deepEqual(one('Parsley, chopped, plus more for serving').ing.portions, [{ prep: 'chopped' }, { tag: 'serving' }]);
  });
});

describe('spec 1: no quantity', () => {
  it('"Kosher salt and black pepper" gives two unmeasured ingredients', () => {
    const r = parseIngredients(['Kosher salt and black pepper']);
    assert.deepEqual(r.ingredients.map((i) => [i.id, i.name, i.head]), [['i1', 'Kosher salt', 'salt'], ['i2', 'black pepper', 'pepper']]);
    for (const i of r.ingredients) {
      assert.deepEqual(i.portions, [{}]);
      assert.equal(i.portions[0].qty, undefined);
      assert.equal(i.raw, 'Kosher salt and black pepper');
    }
    assert.deepEqual(r.flags, []);
  });
  it('"salt and pepper, to taste" and the same with a header between', () => {
    const r = parseIngredients(['For the soup:', 'salt and pepper, to taste', '1 egg']);
    assert.deepEqual(r.ingredients.map((i) => [i.id, i.head, i.group]), [['i1', 'salt', 'For the soup'], ['i2', 'pepper', 'For the soup'], ['i3', 'egg', 'For the soup']]);
  });
  it('a single unmeasured ingredient', () => {
    const { ing, p } = one('Fresh basil leaves, for serving');
    assert.equal(p.qty, undefined);
    assert.deepEqual(ing.portions, [{ tag: 'serving' }]);
    assert.equal(one('Salt, to taste').p.qty, undefined);
  });
  it('does not split names that merely contain "and"', () => {
    assert.equal(one('half and half').ing.name, 'half and half');
    assert.equal(one('1 cup peas and carrots').ing.name, 'peas and carrots');
  });
  it('a measured line is never split on "and"', () => assert.equal(parseIngredients(['2 tbsp salt and pepper']).ingredients.length, 1));
});

describe('spec 1: group headers', () => {
  it('tag the ingredients under them and produce no ingredient', () => {
    const r = parseIngredients(['For the sauce:', '1 tbsp honey', '2 tbsp soy sauce', 'For the noodles:', '8 oz noodles']);
    assert.deepEqual(r.ingredients.map((i) => i.group), ['For the sauce', 'For the sauce', 'For the noodles']);
    assert.deepEqual(r.ingredients.map((i) => i.id), ['i1', 'i2', 'i3']);
  });
  it('ingredients before any header have no group', () => {
    const r = parseIngredients(['1 egg', 'Topping:', '1 tbsp sugar']);
    assert.equal(r.ingredients[0].group, undefined);
    assert.equal(r.ingredients[1].group, 'Topping');
  });
});

describe('unparseable quantities are flagged, never guessed', () => {
  const bad = ['1-inch piece ginger', '1 or two cups milk', '7 to 5 cups water', '1/0 cup milk', '1 cup to 2 cups milk', '0 cups milk', 'half a lemon', '1 cup 3 eggs', '1 cup'];
  for (const line of bad) {
    it(line, () => {
      const r = parseIngredients([line]);
      assert.equal(r.ingredients.length, 1);
      const [ing] = r.ingredients;
      assert.equal(ing.portions[0].qty, undefined);
      assert.equal(ing.portions[0].unit, undefined);
      assert.equal(r.flags.length, 1);
      assert.equal(r.flags[0].code, 'unparseable-quantity');
      assert.equal(r.flags[0].ingredientId, ing.id);
      assert.ok(ing.name.length > 0 && ing.head.length > 0);
    });
  }
  it('percentages in names are fine', () => {
    const r = parseIngredients(['1 cup 2% milk']);
    assert.equal(r.ingredients[0].name, '2% milk');
    assert.deepEqual(r.flags, []);
  });
});

describe('fixture ingredient lines', () => {
  /** Each entry: [head, qty, unit, extras] for the portions[0] and ingredient. */
  const expectations = {
    golden: [
      { head: 'chicken', alternates: ['turkey'], portions: [{ qty: 1, unit: 'lb' }] },
      { head: 'feta', portions: [{ qty: 0.5, unit: 'cup' }] },
      { head: 'oats', divided: true, portions: [{ qty: 0.75, unit: 'cup' }] },
      { head: 'onion', portions: [{ qty: 0.5, prep: 'diced' }, { qty: 0.5, prep: 'grated, then squeezed dry' }] },
      { head: 'dill', portions: [{ qty: 1 / 3, unit: 'cup', prep: 'finely chopped' }] },
      { head: 'cumin', portions: [{ qty: 1, unit: 'tbsp' }] },
      { head: 'turmeric', portions: [{ qty: 0.5, unit: 'tsp' }, { qty: 1, unit: 'tbsp' }] },
      { head: 'salt', portions: [{}] },
      { head: 'pepper', portions: [{}] },
      { head: 'olive oil', portions: [{ qty: 3, unit: 'tbsp' }] },
      { head: 'red-pepper flakes', portions: [{ qty: 0.5, unit: 'tsp' }, { tag: 'serving' }] },
      { head: 'chicken broth', alternates: ['water'], portions: [{ qty: 4, unit: 'cup' }] },
      { head: 'spinach', portions: [{ qty: 4, unit: 'cup' }] },
      { head: 'lemons', portions: [{ qty: 1, prep: 'juiced' }, { qty: 1, prep: 'cut into wedges' }] },
    ],
    '01-oven-bake-preheat': [
      { head: 'chicken thighs', portions: [{ qty: 6 }] },
      { head: 'olive oil', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'garlic', portions: [{ qty: 4, unit: 'clove', prep: 'minced' }] },
      { head: 'smoked paprika', portions: [{ qty: 2, unit: 'tsp' }] },
      { head: 'salt', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'pepper', portions: [{ qty: 0.5, unit: 'tsp' }] },
      { head: 'lemon', portions: [{ qty: 1, prep: 'juiced' }] },
    ],
    '02-braise-long-simmer': [
      { head: 'beef chuck roast', portions: [{ qty: 2, unit: 'lb' }] },
      { head: 'olive oil', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'onions', portions: [{ qty: 2 }] },
      { head: 'garlic', portions: [{ qty: 3, unit: 'clove', prep: 'minced' }] },
      { head: 'tomato paste', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'wine', portions: [{ qty: 1, unit: 'cup' }] },
      { head: 'beef broth', portions: [{ qty: 2, unit: 'cup' }] },
      { head: 'thyme', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'salt', portions: [{ qty: 1, unit: 'tsp' }] },
    ],
    '03-stir-fry-high-heat': [
      { head: 'chicken breast', portions: [{ qty: 12, unit: 'oz' }] },
      { head: 'vegetable oil', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'bell pepper', portions: [{ qty: 1 }] },
      { head: 'broccoli florets', portions: [{ qty: 2, unit: 'cup' }] },
      { head: 'garlic', portions: [{ qty: 3, unit: 'clove', prep: 'minced' }] },
      { head: 'soy sauce', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'cornstarch', portions: [{ qty: 1, unit: 'tbsp' }] },
      { head: 'water', portions: [{ qty: 3, unit: 'tbsp' }] },
      { head: 'rice', portions: [{ qty: 2, unit: 'cup' }] },
    ],
    '04-grouped-ingredients': [
      { head: 'peanut butter', group: 'For the sauce', portions: [{ qty: 3, unit: 'tbsp' }] },
      { head: 'soy sauce', group: 'For the sauce', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'rice vinegar', group: 'For the sauce', portions: [{ qty: 1, unit: 'tbsp' }] },
      { head: 'honey', group: 'For the sauce', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'rice noodles', group: 'For the noodles', portions: [{ qty: 8, unit: 'oz' }] },
      { head: 'cucumber', group: 'For the noodles', portions: [{ qty: 1 }] },
      { head: 'scallions', group: 'For the noodles', portions: [{ qty: 2 }] },
      { head: 'peanuts', group: 'For the noodles', portions: [{ qty: 2, unit: 'tbsp' }] },
    ],
    '05-divided-no-amounts': [
      { head: 'shrimp', portions: [{ qty: 1, unit: 'lb' }] },
      { head: 'butter', divided: true, portions: [{ qty: 4, unit: 'tbsp' }] },
      { head: 'garlic', portions: [{ qty: 4, unit: 'clove', prep: 'minced' }] },
      { head: 'paprika', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'salt', portions: [{ qty: 0.5, unit: 'tsp' }] },
      { head: 'wine', portions: [{ qty: 0.25, unit: 'cup' }] },
      { head: 'parsley', portions: [{ qty: 2, unit: 'tbsp' }] },
    ],
    '06-us-and-metric': [
      { head: 'flour', portions: [{ qty: 1.5, unit: 'cup', alt: { qty: 190, unit: 'g' } }] },
      { head: 'sugar', portions: [{ qty: 2, unit: 'tbsp', alt: { qty: 25, unit: 'g' } }] },
      { head: 'baking powder', portions: [{ qty: 2, unit: 'tsp' }] },
      { head: 'salt', portions: [{ qty: 0.25, unit: 'tsp' }] },
      { head: 'milk', portions: [{ qty: 1, unit: 'cup', alt: { qty: 240, unit: 'ml' } }] },
      { head: 'egg', portions: [{ qty: 1 }] },
      { head: 'butter', portions: [{ qty: 3, unit: 'tbsp', prep: 'melted', alt: { qty: 45, unit: 'g' } }] },
    ],
    '07-to-taste-unmeasured': [
      { head: 'spaghetti', portions: [{ qty: 12, unit: 'oz' }] },
      { head: 'olive oil', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'garlic', portions: [{ qty: 3, unit: 'clove', prep: 'minced' }] },
      { head: 'tomatoes', portions: [{ qty: 1, unit: 'can', alt: { qty: 28, unit: 'oz' } }] },
      { head: 'red-pepper flakes', portions: [{ qty: 1, unit: 'pinch' }] },
      { head: 'salt', portions: [{}] },
      { head: 'pepper', portions: [{}] },
      { head: 'parmesan', portions: [{ qty: 0.5, unit: 'cup' }] },
      { head: 'basil leaves', portions: [{ tag: 'serving' }] },
    ],
    '08-one-block-instructions': [
      { head: 'lentils', portions: [{ qty: 1, unit: 'cup' }] },
      { head: 'olive oil', portions: [{ qty: 1, unit: 'tbsp' }] },
      { head: 'onion', portions: [{ qty: 1, prep: 'diced' }] },
      { head: 'carrots', portions: [{ qty: 2 }] },
      { head: 'vegetable broth', portions: [{ qty: 4, unit: 'cup' }] },
      { head: 'cumin', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'salt', portions: [{ qty: 1, unit: 'tsp' }] },
    ],
    '09-collective-word': [
      { head: 'beef', portions: [{ qty: 1, unit: 'lb' }] },
      { head: 'chili powder', portions: [{ qty: 1, unit: 'tbsp' }] },
      { head: 'cumin', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'smoked paprika', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'garlic powder', portions: [{ qty: 0.5, unit: 'tsp' }] },
      { head: 'beans', portions: [{ qty: 1, unit: 'can', alt: { qty: 15, unit: 'oz' } }] },
      { head: 'tomatoes', portions: [{ qty: 1, unit: 'can', alt: { qty: 14, unit: 'oz' } }] },
      { head: 'beef broth', portions: [{ qty: 1, unit: 'cup' }] },
    ],
    '10-loose-casual': [
      { head: 'eggs', portions: [{ qty: 4 }] },
      { head: 'butter', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'milk', portions: [{ qty: 0.25, unit: 'cup' }] },
      { head: 'cheddar', portions: [{ qty: 0.5, unit: 'cup' }] },
      { head: 'bread', portions: [{ qty: 4, unit: 'slice' }] },
      { head: 'salt', portions: [{}] },
      { head: 'pepper', portions: [{}] },
      { head: 'chives', portions: [{ qty: 2, unit: 'tbsp' }] },
    ],
    '11-bundled-steps': [
      { head: 'olive oil', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'onion', portions: [{ qty: 1 }] },
      { head: 'garlic', portions: [{ qty: 3, unit: 'clove' }] },
      { head: 'smoked paprika', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'cumin', portions: [{ qty: 1, unit: 'tsp' }] },
      { head: 'chickpeas', portions: [{ qty: 1, unit: 'can', alt: { qty: 15, unit: 'oz' } }] },
      { head: 'vegetable broth', portions: [{ qty: 1, unit: 'cup' }] },
      { head: 'spinach', portions: [{ qty: 2, unit: 'cup' }] },
      { head: 'butter', portions: [{ qty: 2, unit: 'tbsp' }] },
      { head: 'salt', portions: [{}] },
      { head: 'pepper', portions: [{}] },
    ],
  };

  const fixtures = [golden(), ...patterns()];
  it('covers every fixture', () => {
    assert.deepEqual(
      fixtures.map((f) => f.name.split('/')[1] ?? f.name).sort(),
      Object.keys(expectations).sort(),
    );
  });

  for (const fx of fixtures) {
    const key = fx.name.split('/')[1] ?? fx.name;
    it(`${fx.name}: every ingredient line`, () => {
      const lines = splitInput(fx.input).ingredients;
      const r = parseIngredients(lines);
      const want = expectations[key];
      assert.equal(r.ingredients.length, want.length, 'ingredient count');
      assert.deepEqual(r.flags, [], 'no flags');
      r.ingredients.forEach((ing, i) => {
        const w = want[i];
        const label = `${key} #${i + 1} (${ing.raw})`;
        assert.equal(ing.id, `i${i + 1}`, label);
        assert.equal(ing.head, w.head, `${label} head`);
        assert.deepEqual(ing.alternates, w.alternates ?? [], `${label} alternates`);
        assert.equal(ing.divided, w.divided ?? false, `${label} divided`);
        assert.equal(ing.group, w.group, `${label} group`);
        assert.equal(ing.portions.length, w.portions.length, `${label} portion count`);
        ing.portions.forEach((p, j) => {
          const wp = w.portions[j];
          assert.deepEqual(Object.keys(p).sort(), Object.keys(wp).sort(), `${label} portion ${j} fields`);
          for (const k of Object.keys(wp)) {
            if (k === 'qty') near(p.qty, wp.qty);
            else assert.deepEqual(p[k], wp[k], `${label} portion ${j} ${k}`);
          }
        });
      });
    });
  }

  it('the golden recipe keeps its non-descriptor names for display', () => {
    const r = parseIngredients(splitInput(golden().input).ingredients);
    const names = Object.fromEntries(r.ingredients.map((i) => [i.head, i.name]));
    assert.equal(names.onion, 'small red onion');
    assert.equal(names.dill, 'packed fresh dill');
    assert.equal(names.spinach, 'packed baby spinach');
    assert.equal(names.cumin, 'ground cumin');
  });
});
