import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatNumber, formatQty, formatUnit, formatAmount, leadingAmount, numberSteps, stepNumberFor,
  resolveMeanwhile, gatherLine, originalFor, shouldShowIosHint, iosHintText, groupFlags, stepsFromInput, fallbackTitle,
} from '../js/ui.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/golden/sample-result.json', import.meta.url), 'utf8'));
const byId = (id) => sample.ingredients.find((i) => i.id === id);

test('quantity display uses fraction characters', () => {
  assert.equal(formatNumber(0.75), '¾');
  assert.equal(formatNumber(1 / 3), '⅓');
  assert.equal(formatNumber(0.333), '⅓');
  assert.equal(formatNumber(1.5), '1½');
  assert.equal(formatNumber(2), '2');
  assert.equal(formatNumber(0.4), '0.4');
  assert.equal(formatNumber(0.99999), '1');
  assert.equal(formatQty([5, 7]), '5 to 7');
  assert.equal(formatQty([2, 2]), '2');
});

test('units pluralize only where English does', () => {
  assert.equal(formatUnit('cup', 1), 'cup');
  assert.equal(formatUnit('cup', 4), 'cups');
  assert.equal(formatUnit('tbsp', 4), 'tbsp');
  assert.equal(formatUnit('pinch', 2), 'pinches');
  assert.equal(formatAmount({ qty: 0.75, unit: 'cup' }), '¾ cup');
  assert.equal(formatAmount({ qty: 2 }), '2');
  assert.equal(formatAmount({ unit: 'cup' }), '');
});

test('leadingAmount reads the total from an ingredient line', () => {
  assert.deepEqual(leadingAmount('⅓ cup packed fresh dill, finely chopped'), { qty: 1 / 3, unit: 'cup' });
  assert.deepEqual(leadingAmount('1 pound ground chicken'), { qty: 1, unit: 'lb' });
  assert.deepEqual(leadingAmount('1 1/2 cups flour'), { qty: 1.5, unit: 'cup' });
  assert.deepEqual(leadingAmount('2 lemons'), { qty: 2 });
  assert.equal(leadingAmount('Kosher salt'), null);
  assert.equal(leadingAmount('½ teaspoon plus 1 tablespoon ground turmeric'), null);
});

test('steps are numbered continuously across Prep and Cook', () => {
  const n = numberSteps(sample);
  assert.equal(n.total, 17);
  assert.equal(n.numbers.get('p1'), 1);
  assert.equal(n.numbers.get('a1'), 4);
  assert.equal(n.numbers.get('a3'), 6);
  assert.equal(n.numbers.get('a4'), 7);
  assert.equal(n.numbers.get('a14'), 17);
});

test('a recipe paragraph that gave several actions is one numbered group with lettered actions', () => {
  const n = numberSteps(sample);
  assert.deepEqual(n.groups.map((g) => g.actions.length), [5, 3, 3]);
  assert.deepEqual(n.groups.map((g) => g.number), [7, 8, 9]);
  assert.equal(n.labels.get('p1'), '1');
  assert.equal(n.labels.get('a1'), '4');
  assert.equal(n.labels.get('a4'), '7a');
  assert.equal(n.labels.get('a8'), '7e');
  assert.equal(n.labels.get('a14'), '9c');
  // Every group's actions come from one original paragraph.
  for (const g of n.groups) assert.equal(new Set(g.actions.map((a) => a.original.step)).size, 1);
});

test('deferred actions take their window action number and are not numbered themselves', () => {
  const n = numberSteps(sample);
  assert.equal(n.numbers.has('p4'), false);
  assert.equal(stepNumberFor('p4', n), '7e');
  assert.equal(stepNumberFor('a9', n), '8a');
  assert.equal(stepNumberFor('nope', n), undefined);
});

test('meanwhile ids resolve to the placed prep actions, in order', () => {
  const browning = sample.cook.find((a) => a.id === 'a8');
  const placed = resolveMeanwhile(browning, sample);
  assert.deepEqual(placed.map((a) => a.id), ['p4', 'p5']);
  assert.match(placed[0].text, /Juice/);
  assert.deepEqual(resolveMeanwhile(sample.cook[0], sample), []);
  assert.deepEqual(resolveMeanwhile({ meanwhile: ['p5', 'zzz', 'p4'] }, sample).map((a) => a.id), ['p5', 'p4']);
});

test('Gather line shows the split by step number', () => {
  const n = numberSteps(sample);
  assert.equal(gatherLine(byId('i3'), n), '¾ cup rolled oats: ¼ cup for step 4, ½ cup for step 8a');
  assert.equal(gatherLine(byId('i7'), n), 'ground turmeric: ½ tsp for step 4, 1 tbsp for step 7c');
});

test('Gather line: single use, alternates, serving, prep portions, unmeasured', () => {
  const n = numberSteps(sample);
  assert.equal(gatherLine(byId('i1'), n), '1 lb ground chicken or turkey');
  assert.equal(gatherLine(byId('i12'), n), '4 cups low-sodium chicken broth or water');
  assert.equal(gatherLine(byId('i11'), n), '½ tsp red-pepper flakes, plus more for serving');
  assert.equal(gatherLine(byId('i14'), n), '2 lemons: 1 juiced, 1 cut into wedges');
  assert.equal(gatherLine(byId('i4'), n), '1 small red onion: ½ diced, ½ grated, then squeezed dry');
  assert.equal(gatherLine(byId('i9'), n), 'black pepper');
  assert.equal(gatherLine(byId('i8'), n), 'kosher salt: 1 tsp for step 4, more to season');
  assert.equal(gatherLine(byId('i5'), n), '⅓ cup packed fresh dill: most of it for step 4, 2 tbsp for step 9c');
});

test('original sentence comes from the step text; prep actions fall back to the ingredient line', () => {
  const a9 = sample.cook.find((a) => a.id === 'a9');
  const o = originalFor(a9, sample.steps, sample.ingredients);
  assert.equal(o.text, 'Pour in the broth and the remaining ½ cup oats, tilting the pot to distribute them without disturbing the meatballs.');
  const p2 = sample.prep.find((a) => a.id === 'p2');
  const f = originalFor(p2, sample.steps, sample.ingredients);
  assert.match(f.text, /^1 small red onion/);
  assert.equal(originalFor({ original: { step: 0, start: 0, end: 0 }, uses: [] }, sample.steps, sample.ingredients), null);
  assert.equal(originalFor({ ...a9, uses: [] }, undefined, sample.ingredients), null);
});

test('flags group by action, then ingredient, then the rest', () => {
  const g = groupFlags([
    { actionId: 'a1', code: 'x', message: 'one' },
    { ingredientId: 'i2', code: 'x', message: 'two' },
    { code: 'x', message: 'three' },
  ]);
  assert.equal(g.byAction.get('a1').length, 1);
  assert.equal(g.byIngredient.get('i2').length, 1);
  assert.equal(g.other.length, 1);
});

test('iPhone hint shows only in non-installed iOS Safari that was not dismissed', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  assert.equal(shouldShowIosHint({ ua: safari }), true);
  assert.equal(shouldShowIosHint({ ua: safari, standalone: true }), false);
  assert.equal(shouldShowIosHint({ ua: safari, dismissed: true }), false);
  assert.equal(shouldShowIosHint({ ua: safari.replace('Safari/604.1', 'CriOS/120 Safari/604.1') }), false);
  assert.equal(shouldShowIosHint({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' }), false);
  assert.equal(shouldShowIosHint({ ua: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', touchPoints: 5 }), true);
});

test('steps and title fallbacks from saved input', () => {
  const text = 'Soup\n\nIngredients\n- 1 onion\n\nDirections\n1. Chop it.\n2. Cook it.';
  assert.deepEqual(stepsFromInput({ text }), ['Chop it.', 'Cook it.']);
  assert.deepEqual(stepsFromInput({ parts: { ingredients: 'a', steps: 'Chop it. Cook it.' } }), ['Chop it. Cook it.']);
  assert.deepEqual(stepsFromInput({ text: 'no headings' }), []);
  assert.equal(fallbackTitle('\n  Soup  \nIngredients'), 'Soup');
  assert.equal(fallbackTitle(''), 'Untitled recipe');
});

test('the sample result has the golden structure', () => {
  assert.equal(sample.prep.length, 6);
  assert.equal(sample.cook.length, 11);
  assert.deepEqual(sample.deferred.map((a) => a.id), ['p4', 'p5']);
  assert.deepEqual(sample.cook.find((a) => a.meanwhile.length).meanwhile, ['p4', 'p5']);
  assert.ok(sample.flags.length >= 1);
});

test('Gather: a "most of / reserve" split reads by step; prep words only when the portions differ by prep', () => {
  const n = { numbers: new Map([['a1', 2], ['a5', 9]]), labels: new Map([['a1', '2'], ['a5', '9']]), windowOf: new Map(), total: 9 };
  const herb = {
    name: 'fresh parsley', alternates: [], total: { qty: 0.5, unit: 'cup' },
    portions: [
      { note: 'most of it', prep: 'chopped', usedIn: 'a1' },
      { qty: 2, unit: 'tbsp', prep: 'chopped', usedIn: 'a5' },
    ],
  };
  assert.equal(gatherLine(herb, n), '½ cup fresh parsley: most of it for step 2, 2 tbsp for step 9');
  const veg = {
    name: 'carrot', alternates: [], total: { qty: 2 },
    portions: [{ qty: 1, prep: 'sliced', usedIn: 'a1' }, { qty: 1, prep: 'shredded', usedIn: 'a5' }],
  };
  assert.equal(gatherLine(veg, n), '2 carrot: 1 sliced, 1 shredded');
});

test('Gather: an unmeasured use with a stated use names no step', () => {
  const n = { numbers: new Map([['a1', 2], ['a5', 9]]), labels: new Map([['a1', '2'], ['a5', '9']]), windowOf: new Map(), total: 9 };
  const ing = {
    name: 'sea salt', alternates: [],
    portions: [{ qty: 1, unit: 'tsp', usedIn: 'a1' }, { note: 'more to season', usedIn: 'a5' }],
  };
  assert.equal(gatherLine(ing, n), 'sea salt: 1 tsp for step 2, more to season');
  const other = { name: 'sea salt', alternates: [], portions: [{ qty: 1, unit: 'tsp', usedIn: 'a1' }, { note: 'more', usedIn: 'a5' }] };
  assert.equal(gatherLine(other, n), 'sea salt: 1 tsp for step 2, more');
  const rest = { name: 'rice', alternates: [], total: { qty: 1, unit: 'cup' }, portions: [{ qty: 0.5, unit: 'cup', usedIn: 'a1' }, { note: 'the rest', usedIn: 'a5' }] };
  assert.equal(gatherLine(rest, n), '1 cup rice: ½ cup for step 2, the rest for step 9');
});

test('the homepage example can be pasted and gives what it shows', async () => {
  const { rewrite } = await import('../js/engine/index.js');
  const { EXAMPLE_BEFORE, EXAMPLE_AFTER } = await import('../js/ui.js');
  const r = rewrite(EXAMPLE_BEFORE);
  assert.deepEqual(r.flags, []);
  const after = EXAMPLE_AFTER.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ''));
  assert.deepEqual([...r.prep, ...r.cook].map((a) => a.text), after);
});

test('the iPhone hint mentions sign-in only to people who are signed out', () => {
  assert.match(iosHintText(false), /Sign in with Google/);
  assert.match(iosHintText(false), /Add to Home Screen/);
  assert.doesNotMatch(iosHintText(true), /Sign in/);
  assert.match(iosHintText(true), /Add to Home Screen/);
});
