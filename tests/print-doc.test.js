import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../js/engine/index.js';
import { printDoc, numberSteps, EXAMPLE_BEFORE } from '../js/ui.js';

// Made-up recipe: one paragraph with several actions, so Cook has a lettered group.
const TEXT = `Ingredients
2 cups rice
1 tbsp butter
1 onion, diced
3 cups water

Directions
Melt the butter in a pot, add the rice and onion, then pour in the water and simmer 15 minutes.`;

test('printDoc has Gather, Prep and Cook with the same labels as the screen', () => {
  const result = rewrite(TEXT);
  const doc = printDoc({ title: 'Rice', sourceUrl: 'https://example.com/rice' }, result);
  assert.equal(doc.title, result.title || 'Rice');
  assert.equal(doc.subtitle, 'Source: https://example.com/rice');
  const headings = doc.blocks.filter((b) => b.type === 'h').map((b) => b.text);
  assert.deepEqual(headings, ['Gather', 'Prep', 'Cook']);

  const numbering = numberSteps(result);
  const labels = doc.blocks.filter((b) => b.label).map((b) => b.label);
  const expected = [
    ...(result.prep || []).map((a) => `${numbering.numbers.get(a.id)}.`),
    ...numbering.groups.flatMap((g) => g.actions.map((a) => `${numbering.labels.get(a.id)}.`)),
  ];
  assert.deepEqual(labels, expected);
  assert.ok(labels.some((l) => /^\d+[a-z]\.$/.test(l)), 'a grouped action keeps its letter, e.g. "2b."');
});

test('printDoc carries every action text and every Gather line', () => {
  const result = rewrite(EXAMPLE_BEFORE);
  const doc = printDoc({}, result);
  const texts = doc.blocks.map((b) => b.text);
  for (const a of [...(result.prep || []), ...(result.cook || [])]) assert.ok(texts.includes(a.text), a.text);
  const gatherCount = doc.blocks.indexOf(doc.blocks.find((b) => b.type === 'h' && b.text !== 'Gather')) - 1;
  assert.equal(gatherCount, result.ingredients.length);
  assert.equal(doc.subtitle, undefined);
});
