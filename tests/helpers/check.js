/**
 * Compares an engine Rewrite with an expected.json (see tests/fixtures/README.md).
 * Wording is not compared; only structure, amounts, notes, meanwhile placement and flags.
 */
import assert from 'node:assert';
import { parseAmount } from './amounts.js';

const norm = (s) => s.toLowerCase().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');

const UNIT_WORDS = {
  tsp: ['tsp', 'teaspoon', 'teaspoons'], tbsp: ['tbsp', 'tablespoon', 'tablespoons'], cup: ['cup', 'cups'],
  oz: ['oz', 'ounce', 'ounces'], lb: ['lb', 'lbs', 'pound', 'pounds'], g: ['g', 'gram', 'grams'], ml: ['ml'],
  clove: ['clove', 'cloves'], can: ['can', 'cans'], slice: ['slice', 'slices'], pinch: ['pinch'],
};
const FR = { 0.5: '½', 0.25: '¼', 0.75: '¾', [1 / 3]: '⅓' };

/** Regex for "qty [unit] up to 3 descriptor words key" in already-normalized action text. */
function amountRegex({ qty, unit, key }) {
  const whole = Math.floor(qty + 1e-9);
  const frac = qty - whole;
  const forms = new Set();
  const fracChar = Object.entries(FR).find(([v]) => Math.abs(Number(v) - frac) < 1e-6)?.[1];
  if (frac < 1e-9) forms.add(String(whole));
  else if (fracChar) { forms.add(whole ? `${whole}\\s*${fracChar}` : fracChar); }
  else forms.add(String(qty));
  const q = `(?:${[...forms].join('|')})`;
  const u = unit ? `\\s*(?:${(UNIT_WORDS[unit] ?? [unit]).join('|')})\\b\\.?` : '';
  const k = key.toLowerCase().split(' ').pop().replace(/s$/, '');
  return new RegExp(`${q}${u}(?:\\s+[\\w-]+){0,3}?\\s+[\\w-]*${k}`);
}

export function checkResult(result, expected) {
  const actions = [...result.prep.map((a) => ({ ...a, stage: 'prep' })), ...result.cook.map((a) => ({ ...a, stage: 'cook' }))];
  assert.equal(result.prep.length, expected.counts.prep, 'prep action count');
  assert.equal(result.cook.length, expected.counts.cook, 'cook action count');
  const byId = new Map();
  for (const a of [...result.prep, ...result.cook, ...(result.deferred || [])]) byId.set(a.id, a);

  expected.actions.forEach((ea, i) => {
    const a = actions[i];
    const where = `action ${i + 1} (${ea.stage}) "${a.text}"`;
    assert.equal(a.stage, ea.stage, where);
    const text = norm(a.text);
    for (const w of ea.contains) assert.ok(text.includes(w.toLowerCase()), `${where} should contain "${w}"`);
    for (const s of ea.amounts) assert.match(text, amountRegex(parseAmount(s)), `${where} should show "${s}"`);
    for (const s of ea.notAmounts) assert.doesNotMatch(text, amountRegex(parseAmount(s)), `${where} must not show "${s}"`);
    for (const k of ea.noAmountFor ?? []) assert.doesNotMatch(text, new RegExp(`\\d\\s*(?:[a-z.]+\\s+){0,2}${k}`), `${where} must not insert an amount for ${k}`);
    if (ea.kind) assert.equal(a.kind, ea.kind, where);
    if (ea.minutes) assert.deepEqual(a.minutes, ea.minutes, where);
    if (ea.noteContains) {
      const notes = norm(a.notes.join(' '));
      for (const w of ea.noteContains) assert.ok(notes.includes(w), `${where} notes should contain "${w}"`);
    }
    // meanwhile: exact set of placed prep actions, each matched by its "contains" words.
    assert.equal(a.meanwhile.length, ea.meanwhile.length, `${where} meanwhile count`);
    ea.meanwhile.forEach((m, j) => {
      const placed = byId.get(a.meanwhile[j]);
      assert.ok(placed, `${where} meanwhile id ${a.meanwhile[j]} exists`);
      for (const w of m.contains) assert.ok(norm(placed.text).includes(w), `meanwhile "${placed.text}" should contain "${w}"`);
    });
  });

  // Split ingredients: portions compared in order on qty, unit, prep and tag.
  for (const s of expected.split) {
    const ing = result.ingredients.find((x) => norm(`${x.name} ${x.alternates.join(' ')}`).includes(s.ingredient.toLowerCase()));
    assert.ok(ing, `ingredient ${s.ingredient} in result`);
    if (s.unresolved) continue;
    assert.equal(ing.portions.length, s.portions.length, `${s.ingredient} portion count`);
    s.portions.forEach((p, j) => {
      const got = ing.portions[j];
      if (p.qty !== undefined) assert.deepEqual(got.qty, p.qty, `${s.ingredient} portion ${j + 1} qty`);
      if (p.unit !== undefined) assert.equal(got.unit, p.unit, `${s.ingredient} portion ${j + 1} unit`);
      if (p.prep !== undefined) assert.ok(got.prep && norm(got.prep).includes(p.prep.split(' ')[0].slice(0, 4)), `${s.ingredient} portion ${j + 1} prep`);
      if (p.tag !== undefined) assert.equal(got.tag, p.tag);
    });
  }

  // Groups.
  for (const [name, group] of Object.entries(expected.groups ?? {})) {
    const ing = result.ingredients.find((x) => norm(x.name).includes(name));
    assert.ok(ing && ing.group && norm(ing.group).includes(norm(group.replace(/^for the /i, ''))), `${name} group`);
  }

  // Flags: each expected flag must be present; with flagsExact (default true) nothing else may be.
  for (const f of expected.flags) {
    const hit = result.flags.find((g) => g.code === f.code
      && (!f.ingredient || (byIngredient(result, g.ingredientId)?.name ?? '').toLowerCase().includes(f.ingredient))
      && (!f.actionContains || f.actionContains.every((w) => norm(byId.get(g.actionId)?.text ?? '').includes(w))));
    assert.ok(hit, `expected flag ${JSON.stringify(f)}`);
  }
  if (expected.flagsExact !== false) assert.equal(result.flags.length, expected.flags.length, `flags: ${JSON.stringify(result.flags)}`);
}

function byIngredient(result, id) {
  return result.ingredients.find((i) => i.id === id);
}
