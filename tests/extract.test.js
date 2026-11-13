import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRecipe } from '../js/extract.js';

const URL1 = 'https://example.test/toast';
const page = (...blocks) => `<html><head>${blocks.join('\n')}</head><body><p>Hello</p></body></html>`;
const ld = (obj, attrs = 'type="application/ld+json"') =>
  `<script ${attrs}>${typeof obj === 'string' ? obj : JSON.stringify(obj)}</script>`;

const base = {
  '@type': 'Recipe',
  name: 'Plain Toast',
  recipeIngredient: ['2 slices bread', '1 tbsp butter'],
  recipeInstructions: ['Toast the bread.', 'Butter it.'],
};

test('plain Recipe object', () => {
  const r = extractRecipe(page(ld({ '@context': 'https://schema.org', ...base })), URL1);
  assert.deepEqual(r, {
    title: 'Plain Toast',
    ingredients: ['2 slices bread', '1 tbsp butter'],
    steps: ['Toast the bread.', 'Butter it.'],
    sourceUrl: URL1,
  });
});

test('attribute order and quoting vary', () => {
  const html = page(`<script id=x TYPE='application/ld+json' data-a="1">${JSON.stringify(base)}</script>`);
  assert.equal(extractRecipe(html, URL1).title, 'Plain Toast');
  const bare = page(`<script type=application/ld+json>${JSON.stringify(base)}</script>`);
  assert.equal(extractRecipe(bare, URL1).title, 'Plain Toast');
});

test('Recipe inside @graph', () => {
  const r = extractRecipe(page(ld({ '@graph': [{ '@type': 'WebSite' }, base] })), URL1);
  assert.equal(r.title, 'Plain Toast');
});

test('top-level array', () => {
  const r = extractRecipe(page(ld([{ '@type': 'Organization' }, base])), URL1);
  assert.equal(r.ingredients.length, 2);
});

test('@type as an array', () => {
  const r = extractRecipe(page(ld({ ...base, '@type': ['Article', 'Recipe'] })), URL1);
  assert.equal(r.title, 'Plain Toast');
});

test('HowToStep objects', () => {
  const steps = [{ '@type': 'HowToStep', text: 'Slice the bread.' }, { '@type': 'HowToStep', text: 'Toast it.' }];
  const r = extractRecipe(page(ld({ ...base, recipeInstructions: steps })), URL1);
  assert.deepEqual(r.steps, ['Slice the bread.', 'Toast it.']);
});

test('HowToSection objects are flattened in order', () => {
  const sections = [
    { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Slice.' }, { '@type': 'HowToStep', text: 'Plate.' }] },
    { '@type': 'HowToSection', name: 'Cook', itemListElement: [{ '@type': 'HowToStep', text: 'Toast.' }] },
  ];
  const r = extractRecipe(page(ld({ ...base, recipeInstructions: sections })), URL1);
  assert.deepEqual(r.steps, ['Slice.', 'Plate.', 'Toast.']);
});

test('a single string of instructions is split on newlines', () => {
  const r = extractRecipe(page(ld({ ...base, recipeInstructions: 'Slice.\nToast.\n\n  Butter.  ' })), URL1);
  assert.deepEqual(r.steps, ['Slice.', 'Toast.', 'Butter.']);
});

test('HTML entities and tags inside strings', () => {
  const r = extractRecipe(page(ld({
    ...base,
    name: 'Tom &amp; Jerry&#39;s <em>Toast</em>',
    recipeIngredient: ['1&nbsp;cup   milk', '<b>2</b> eggs &frac12; tsp salt'],
    recipeInstructions: ['<p>Whisk &amp; pour.</p>', 'Cook   for 5&#x2013;6 minutes.'],
  })), URL1);
  assert.equal(r.title, "Tom & Jerry's Toast");
  assert.deepEqual(r.ingredients, ['1 cup milk', '2 eggs ½ tsp salt']);
  assert.deepEqual(r.steps, ['Whisk & pour.', 'Cook for 5–6 minutes.']);
});

test('a malformed block followed by a good one', () => {
  const r = extractRecipe(page(ld('{"@type": "Recipe", "name": '), ld(base)), URL1);
  assert.equal(r.title, 'Plain Toast');
});

test('no recipe gives null', () => {
  assert.equal(extractRecipe(page(ld({ '@type': 'Article', name: 'News' })), URL1), null);
  assert.equal(extractRecipe('<html><body><h1>Toast</h1><ul><li>bread</li></ul></body></html>', URL1), null);
  assert.equal(extractRecipe('', URL1), null);
});

test('ignores script blocks of other types', () => {
  const html = page(`<script type="application/json">${JSON.stringify(base)}</script>`);
  assert.equal(extractRecipe(html, URL1), null);
});
