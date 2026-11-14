import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, normalizeRecipe, buildExport, parseImport, mergeRecipes, sortRecipes } from '../js/storage.js';

const rec = (id, extra = {}) => ({ id, title: `Recipe ${id}`, text: 'Ingredients\n- 1 egg\nPreparation\n1. Boil it.', created: 1000, checked: {}, ...extra });

test('newId gives distinct, url-safe ids', () => {
  const a = newId(1, 0.123456789);
  const b = newId(1, 0.987654321);
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9-]+$/);
});

test('normalizeRecipe keeps good records and drops unknown fields', () => {
  const r = normalizeRecipe({ ...rec('a'), extra: 1, checked: { a1: true, a2: false, a3: 'yes' } });
  assert.deepEqual(Object.keys(r).sort(), ['checked', 'created', 'id', 'text', 'title']);
  assert.deepEqual(r.checked, { a1: true });
});

test('normalizeRecipe accepts parts and rejects unusable records', () => {
  const parts = normalizeRecipe({ id: 'p', parts: { ingredients: ['1 egg'], steps: 'Boil it.' } }, 5);
  assert.equal(parts.title, 'Untitled recipe');
  assert.equal(parts.created, 5);
  assert.deepEqual(parts.parts, { ingredients: ['1 egg'], steps: 'Boil it.' });
  assert.equal(normalizeRecipe(null), null);
  assert.equal(normalizeRecipe({ text: 'no id' }), null);
  assert.equal(normalizeRecipe({ id: 'x' }), null);
  assert.equal(normalizeRecipe({ id: 'x', text: '   ' }), null);
  assert.equal(normalizeRecipe({ id: 'x', parts: { ingredients: 3, steps: 'a' } }), null);
});

test('export then import round-trips', () => {
  const recipes = [rec('a', { checked: { a1: true } }), rec('b', { sourceUrl: 'https://example.com/r' })];
  const file = JSON.stringify(buildExport(recipes, Date.UTC(2026, 10, 12)));
  const out = parseImport(file);
  assert.equal(out.error, undefined);
  assert.equal(out.invalid, 0);
  assert.deepEqual(out.recipes, recipes);
  assert.equal(JSON.parse(file).exported, '2026-11-12T00:00:00.000Z');
  assert.equal(JSON.parse(file).app, 'recipes4humans');
});

test('parseImport reports bad files and counts invalid records', () => {
  assert.match(parseImport('not json').error, /not valid JSON/);
  assert.match(parseImport('{"hello": 1}').error, /export/);
  const mixed = parseImport(JSON.stringify({ recipes: [rec('a'), { id: 'bad' }, 7] }));
  assert.equal(mixed.recipes.length, 1);
  assert.equal(mixed.invalid, 2);
  assert.equal(parseImport(JSON.stringify([rec('a')])).recipes.length, 1);
});

test('merge adds new ids and skips duplicates, keeping the existing copy', () => {
  const existing = [rec('a', { title: 'Mine' }), rec('b')];
  const incoming = [rec('a', { title: 'Theirs' }), rec('c'), rec('c'), rec('d')];
  const { toAdd, skipped } = mergeRecipes(existing, incoming);
  assert.deepEqual(toAdd.map((r) => r.id), ['c', 'd']);
  assert.equal(skipped, 2);
  assert.equal(mergeRecipes([], []).skipped, 0);
});

test('sortRecipes puts starred recipes first, newest first within each group', () => {
  const list = [rec('old', { created: 1 }), rec('new', { created: 3 }), rec('star-old', { created: 2, starred: true }), rec('star-new', { created: 4, starred: true })];
  assert.deepEqual(sortRecipes(list).map((r) => r.id), ['star-new', 'star-old', 'new', 'old']);
});

test('normalizeRecipe keeps a star and drops anything else in that field', () => {
  assert.equal(normalizeRecipe(rec('a', { starred: true })).starred, true);
  assert.equal('starred' in normalizeRecipe(rec('b', { starred: 'yes' })), false);
});

test('buildExport leaves out sync bookkeeping', () => {
  const out = buildExport([{ ...rec('a'), dirty: true, updated: 5, starred: true }]);
  assert.equal('dirty' in out.recipes[0], false);
  assert.equal(out.recipes[0].starred, true);
});
