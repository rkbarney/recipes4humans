/**
 * Validates every fixture: expected.json is well formed, and every amount it expects occurs in,
 * or can be derived from, the fixture's own input. Does not run the engine.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { golden, patterns, splitInput } from './helpers/fixtures.js';
import { parseAmount, isDerivable } from './helpers/amounts.js';

const FLAG_CODES = ['unused-ingredient', 'unknown-ingredient', 'amounts-mismatch', 'split-unresolved', 'collective-word', 'unparseable-quantity', 'ambiguous-ingredient'];
const isStrArray = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string' && s.length > 0);
const isQty = (q) => (typeof q === 'number' && q > 0) || (Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && n > 0));
const stem = (w) => w.toLowerCase().replace(/s$/, '');
const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(stem);

function validate(fx) {
  const { expected: e, input } = fx;
  const parts = splitInput(input);
  const ingredientText = parts.ingredients.join('\n');
  const ingredientWords = new Set(words(ingredientText));

  assert.equal(typeof e.name, 'string');
  assert.ok(Number.isInteger(e.counts?.prep) && Number.isInteger(e.counts?.cook), 'counts.prep and counts.cook are integers');
  assert.ok(Array.isArray(e.actions) && e.actions.length > 0, 'actions is a non-empty array');
  assert.ok(Array.isArray(e.split), 'split is an array');
  assert.ok(Array.isArray(e.flags), 'flags is an array');
  assert.ok(e.flagsExact === undefined || typeof e.flagsExact === 'boolean');

  // Actions: prep first, then cook; counts match.
  let seenCook = false;
  for (const a of e.actions) {
    assert.ok(['prep', 'cook'].includes(a.stage), `stage: ${a.stage}`);
    if (a.stage === 'cook') seenCook = true;
    else assert.ok(!seenCook, 'prep actions come before cook actions');
    assert.ok(isStrArray(a.contains) && a.contains.length > 0, 'contains is a non-empty string array');
    for (const k of ['amounts', 'notAmounts']) {
      assert.ok(isStrArray(a[k]), `${k} is a string array`);
      for (const s of a[k]) {
        const p = parseAmount(s);
        assert.ok(p && p.key, `amount "${s}" needs a quantity and an ingredient key`);
        for (const w of words(p.key)) assert.ok(ingredientWords.has(w), `key "${p.key}" in "${s}" is not in the ingredient list`);
        if (k === 'amounts') {
          assert.ok(isDerivable(input, p), `amount "${s}" does not occur in, and cannot be derived from, the input`);
        }
      }
    }
    assert.ok(a.kind === undefined || ['hands-on', 'waiting'].includes(a.kind));
    if (a.noteContains !== undefined) assert.ok(isStrArray(a.noteContains));
    if (a.noAmountFor !== undefined) assert.ok(isStrArray(a.noAmountFor));
    if (a.minutes !== undefined) assert.ok(isQty(a.minutes) && a.minutes.length === 2);
    assert.ok(Array.isArray(a.meanwhile), 'meanwhile is an array');
    for (const m of a.meanwhile) assert.ok(isStrArray(m.contains) && m.contains.length > 0);
    if (a.meanwhile.length) assert.equal(a.stage, 'cook', 'only cook actions have a meanwhile');
  }
  assert.equal(e.actions.filter((a) => a.stage === 'prep').length, e.counts.prep);
  assert.equal(e.actions.filter((a) => a.stage === 'cook').length, e.counts.cook);

  // Split ingredients.
  for (const s of e.split) {
    assert.equal(typeof s.ingredient, 'string');
    assert.ok(ingredientWords.has(stem(s.ingredient)), `split ingredient "${s.ingredient}" is not in the ingredient list`);
    if (s.unresolved) { assert.equal(s.unresolved, true); continue; }
    assert.ok(Array.isArray(s.portions) && s.portions.length >= 2, 'a split has at least two portions');
    for (const p of s.portions) {
      assert.ok(p.qty !== undefined || p.tag || p.note, 'portion has a qty, a tag or a note');
      if (p.qty !== undefined) {
        assert.ok(isQty(p.qty));
        const qs = Array.isArray(p.qty) ? p.qty : [p.qty];
        for (const q of qs) assert.ok(isDerivable(input, { qty: q, unit: p.unit ?? '' }), `portion ${q} ${p.unit ?? ''} of ${s.ingredient} is not derivable from the input`);
      }
      assert.ok(p.tag === undefined || p.tag === 'serving');
    }
  }

  // Flags.
  for (const f of e.flags) {
    assert.ok(FLAG_CODES.includes(f.code), `flag code ${f.code}`);
    if (f.ingredient) assert.ok(ingredientWords.has(stem(f.ingredient)));
    if (f.actionContains) assert.ok(isStrArray(f.actionContains));
  }

  // Groups: each header named in the expectation exists in the input.
  if (e.groups) {
    const headers = parts.ingredients.filter((l) => /:\s*$/.test(l)).map((l) => l.replace(/:\s*$/, ''));
    for (const [ing, group] of Object.entries(e.groups)) {
      for (const w of words(ing)) assert.ok(ingredientWords.has(w), `${ing} is in the ingredient list`);
      assert.ok(headers.includes(group), `group "${group}" is a header in the input`);
    }
  }
  return parts;
}

describe('golden fixture', () => {
  const fx = golden();
  it('is well formed', () => {
    const parts = validate(fx);
    assert.equal(parts.ingredients.length, 13, '13 ingredient lines');
    assert.equal(parts.steps.length, 4, '4 numbered steps');
    assert.deepEqual(fx.expected.counts, { prep: 6, cook: 11 });
    assert.deepEqual(fx.expected.flags, []);
    assert.ok(parts.yield);
  });
  it('has the three meanwhile-bearing facts of the target', () => {
    const waiting = fx.expected.actions.filter((a) => a.meanwhile.length);
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].meanwhile.length, 2);
  });
});

describe('pattern fixtures', () => {
  const all = patterns();
  it('has eleven patterns', () => assert.equal(all.length, 11));
  for (const fx of all) {
    it(`${fx.name} is well formed`, () => {
      const parts = validate(fx);
      const lines = parts.ingredients.filter((l) => !/:\s*$/.test(l));
      assert.ok(lines.length >= 6 && lines.length <= 10, `${lines.length} ingredient lines`);
      if (parts.steps.length > 1) assert.ok(parts.steps.length >= 3 && parts.steps.length <= 5, `${parts.steps.length} steps`);
    });
  }
});
