// Regression tests for bugs found by `npm run live` on real recipe pages. The inputs are made up; real
// recipe text is never committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredients } from '../js/engine/ingredients.js';
import { rewrite } from '../js/engine/index.js';
import { gatherLine, numberSteps, linkFailureMessage } from '../js/ui.js';

test('a comma between descriptors does not end the ingredient name', () => {
  const { ingredients } = parseIngredients(['4 (6- to 8-oz.) boneless, skinless chicken breasts', '1 large, ripe avocado', '2 cups flour, sifted']);
  assert.equal(ingredients[0].head, 'chicken breasts');
  assert.deepEqual(ingredients[0].portions.map((p) => p.qty), [4]);
  assert.equal(ingredients[1].head, 'avocado');
  assert.equal(ingredients[2].head, 'flour');
});

test('the Gather total keeps the unit when the line writes it as "c." or "600g/"', () => {
  const r = rewrite([
    'Ingredients', '3 c. cottage cheese', '600g/ 1.2lb chicken thigh', '',
    'Directions', 'Mix half the cottage cheese with salt. Stir in the rest of the cottage cheese. Cook half the chicken thigh. Cook the remaining chicken thigh.',
  ].join('\n'));
  const numbering = numberSteps(r);
  assert.match(gatherLine(r.ingredients[0], numbering), /^3 cups cottage cheese/);
  assert.match(gatherLine(r.ingredients[1], numbering), /^600 g \(1\.2 lb\) chicken thigh/);
});

test('"add onions" with exactly one onion reads "1 onion"', () => {
  const r = rewrite(['Ingredients', '1 onion', '', 'Directions', 'Add onions to the pan.'].join('\n'));
  assert.equal(r.cook[0].text, 'Add 1 onion to the pan.');
});

test('link failures say what happened and what to do', () => {
  assert.match(linkFailureMessage(402, 'www.example.com'), /^example\.com does not let other apps read its recipes\. Paste/);
  assert.match(linkFailureMessage(403, 'example.com'), /does not let other apps/);
  assert.match(linkFailureMessage(404, 'example.com'), /not found/);
  assert.match(linkFailureMessage(200, 'example.com', true), /No recipe data/);
  assert.match(linkFailureMessage(403, 'example.com', false, true), /not set up for this web address/);
  assert.match(linkFailureMessage(null, 'example.com'), /Could not read a recipe from example\.com/);
});
