#!/usr/bin/env node
// Stress pass: runs the rewrite engine on every .txt file in a folder and reports what happened.
// The folder is meant to be git-ignored (local-recipes/stress/): its recipes are never committed.
//
// Usage: node scripts/stress.js <folder> [--summary]
//   Each file: an optional first line with the source URL (a line starting with http), then the recipe
//   text with "Ingredients" and a steps heading, as rewrite() reads it.
//   --summary  print only the per-recipe counts and the invariant violations, not the rewritten text.
//
// Per recipe it prints whether the engine threw, counts, flags by code and the Gather/Prep/Cook text,
// then checks invariants that are independent of the engine's own number parsing:
//   TEXT       every sentence of the input steps appears in the output (action text or notes)
//   AMOUNT     an amount that is in the output but not in the recipe's own sentence must be derivable
//              from the line of an ingredient that action uses (the line's amounts, a plus-sum, a
//              fraction of the total, the total minus another amount, or a unit conversion)
//   TWICE      the amounts inserted for one ingredient never add up to more than its total
//   ORDER      cook actions stay in the recipe's own order
//   WINDOW     a meanwhile only sits on a waiting action, and a waiting action has a stated time of at
//              least 3 minutes or is an oven preheat or a pot of water coming to a boil
//
// Exit code 1 when any recipe threw or any invariant is violated.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rewrite } from '../js/engine/index.js';
import { splitSentences } from '../js/engine/steps-sentences.js';
import { gatherLine, numberSteps } from '../js/ui.js';

const args = process.argv.slice(2);
const summaryOnly = args.includes('--summary');
const folder = args.find((a) => !a.startsWith('--'));
if (!folder) {
  console.error('Usage: node scripts/stress.js <folder> [--summary]');
  process.exit(1);
}

// ------------------------------------------------------------------ small independent number reader

const GLYPH = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const NUM = '(?:\\d+\\s*[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])';
const UNIT_WORDS = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tbsp: 'tbsp', tbs: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', litre: 'l', liter: 'l', pinch: 'pinch', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', stick: 'stick', sticks: 'stick', slice: 'slice', slices: 'slice', package: 'package', packages: 'package',
  bunch: 'bunch', dash: 'dash', tin: 'can',
};
// Base units for conversion: tsp for spoons and cups; g; ml.
const TO_BASE = { tsp: ['vol', 1], tbsp: ['vol', 3], cup: ['vol', 48], oz: ['wt', 28.3495], lb: ['wt', 453.592], g: ['wt', 1], kg: ['wt', 1000], ml: ['ml', 1], l: ['ml', 1000] };

function num(s) {
  s = s.trim();
  let m;
  if ((m = /^(\d+)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/.exec(s))) return Number(m[1]) + GLYPH[m[2]];
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s))) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if ((m = /^(\d+)\/(\d+)$/.exec(s))) return Number(m[1]) / Number(m[2]);
  if (s in GLYPH) return GLYPH[s];
  return Number(s);
}

/** Every "quantity [unit]" in a text: [{lo, hi, unit, text, at}]. Unit is '' for a bare count. */
function amountsIn(text) {
  const out = [];
  const re = new RegExp(`(?<![\\w.])(${NUM})(?:\\s*(?:-|–|to)\\s*(${NUM}))?(?:\\s*([A-Za-z]+))?`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const lo = num(m[1]);
    const hi = m[2] ? num(m[2]) : lo;
    const w = (m[3] || '').toLowerCase();
    const afterWord = text[m.index + m[0].length];
    const unit = w === 'c' && afterWord === '.' ? 'cup' : (UNIT_WORDS[w] ?? '');
    // A bare number is only an amount when a word follows (a count); degrees and times are skipped below.
    if (!unit && !m[3]) continue;
    if (!unit && /^(?:minutes?|mins?|seconds?|secs?|hours?|hrs?|inch(?:es)?|degrees?|f|c|x|times|pm|am|th|st|nd|rd)$/.test(w)) continue;
    if (/°/.test(text.slice(m.index + m[0].length - 1, m.index + m[0].length + 1))) continue;
    out.push({ lo, hi, unit, text: m[0].trim(), at: m.index });
  }
  return out;
}

const close = (a, b) => Math.abs(a - b) <= 1e-6 + 1e-3 * Math.max(Math.abs(a), Math.abs(b));

/** Does an amount equal a candidate {lo, hi, unit}, allowing a unit conversion within a family? */
function sameAmount(a, c) {
  if (a.unit === c.unit) return close(a.lo, c.lo) && close(a.hi, c.hi);
  const x = TO_BASE[a.unit];
  const y = TO_BASE[c.unit];
  if (!x || !y || x[0] !== y[0]) return false;
  return close(a.lo * x[1], c.lo * y[1]) && close(a.hi * x[1], c.hi * y[1]);
}

/** Amounts a line can legitimately produce: its own amounts, sums, fractions, differences. */
function derivable(raw) {
  // A size word between the number and the unit ("4 large cloves") does not change the amount.
  const line = raw.replace(/^\s*[-*•]\s*/, '').replace(/(\d|[½¼¾⅓⅔⅛])\s+(?:small|medium|large|big|heaping|scant|generous)\s+/gi, '$1 ');
  const own = amountsIn(line).map((a) => ({ lo: a.lo, hi: a.hi, unit: a.unit }));
  // "Dash of nutmeg", "Pinch of salt": a unit word with no number means one of it.
  const lead = /^\s*(dash|pinch)\b/i.exec(line);
  if (lead) own.push({ lo: 1, hi: 1, unit: UNIT_WORDS[lead[1].toLowerCase()] });
  // "2 (14.5-oz.) cans tomatoes": a count of containers and the size of each.
  const pack = /(\d+)\s*\(\s*(?:(\d+(?:\.\d+)?)\s*(?:-|to)\s*)?(\d+(?:\.\d+)?)[\s-]*(oz|ounces?|g|grams?|ml|lbs?|pounds?)\.?\s*\)\s*(cans?|packages?|jars?|boxes|box|bottles?|bags?|sticks?)/i.exec(line);
  if (pack) {
    const kind = UNIT_WORDS[pack[5].toLowerCase()] ?? pack[5].toLowerCase().replace(/e?s$/, '');
    own.push({ lo: Number(pack[1]), hi: Number(pack[1]), unit: kind });
    const size = UNIT_WORDS[pack[4].toLowerCase()];
    if (size) {
      if (pack[2]) own.push({ lo: Number(pack[2]), hi: Number(pack[2]), unit: size });
      own.push({ lo: Number(pack[3]), hi: Number(pack[3]), unit: size });
    }
  }
  // "1 (1o-oz.) package": a typo in the size still leaves the count of packages.
  const typo = /(\d+)\s*\([^)]*\)\s*(cans?|packages?|jars?|boxes|box|bottles?|bags?)/i.exec(line);
  if (typo && !pack) own.push({ lo: Number(typo[1]), hi: Number(typo[1]), unit: UNIT_WORDS[typo[2].toLowerCase()] ?? typo[2].toLowerCase().replace(/e?s$/, '') });
  const set = [...own];
  const add = (lo, hi, unit) => set.push({ lo, hi, unit });
  // Totals per unit family: the sum of all same-unit amounts (a "plus" line), and each amount of the line.
  const byUnit = new Map();
  for (const a of own) byUnit.set(a.unit, [...(byUnit.get(a.unit) || []), a]);
  const totals = [];
  for (const [unit, list] of byUnit) {
    const lo = list.reduce((s, a) => s + a.lo, 0);
    const hi = list.reduce((s, a) => s + a.hi, 0);
    add(lo, hi, unit);
    totals.push({ lo, hi, unit });
  }
  // Pairs of different units on one line ("1 stick (113 g)") are dual units: each is a total of its own.
  const bases = [...own, ...totals];
  for (const t of bases) {
    for (const f of [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4, 1 / 8]) add(t.lo * f, t.hi * f, t.unit);
    for (const o of bases) if (o !== t && o.unit === t.unit && t.lo - o.hi > 0) add(t.lo - o.hi, t.hi - o.lo, t.unit);
  }
  return set;
}

const isDerivable = (a, raw) => derivable(raw).some((c) => sameAmount(a, c));

// ------------------------------------------------------------------ checks

const words = (t) => (t.toLowerCase().match(/[a-zà-ɏ]+/g) ?? [])
  .filter((w) => !['the', 'a', 'an', 'and', 'then'].includes(w))
  .map((w) => w.replace(/(?:es|s)$/, ''));

function checkText(r) {
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
      if (lost.length) out.push(`TEXT step ${i + 1}: "${step.slice(sp.start, sp.end).slice(0, 70)}" lost: ${lost.join(', ')}`);
    }
  });
  return out;
}

function checkAmounts(r) {
  const out = [];
  const byId = new Map(r.ingredients.map((i) => [i.id, i]));
  const inserted = []; // {ing, amount, portions: Set}
  for (const a of [...r.prep, ...r.cook, ...r.deferred]) {
    let stated = [];
    if (a.original.step >= 1) {
      const sentence = r.steps[a.original.step - 1].slice(a.original.start, a.original.end);
      stated = amountsIn(sentence);
    }
    const used = [...new Set((a.uses || []).map((u) => u.ingredientId))].map((id) => byId.get(id)).filter(Boolean);
    // The notes were part of the recipe sentence, so amounts in them are not inserted.
    const noteAmounts = amountsIn((a.notes || []).join(' '));
    const pool = [...stated, ...noteAmounts];
    for (const am of amountsIn(a.text)) {
      const k = pool.findIndex((s) => s.lo === am.lo && s.hi === am.hi && s.unit === am.unit);
      if (k >= 0) { pool.splice(k, 1); continue; }
      let cands = used.filter((ing) => isDerivable(am, ing.raw));
      if (am.unit === '') {
        // For a bare count the matched text already includes the word after the number ("1 onion").
        const next = am.text.replace(/^[\d\s½¼¾⅓⅔⅛./–-]+/, '');
        const key = next ? words(next)[0] : null;
        const nameMatches = (ing) => words(`${ing.head || ''} ${ing.name || ''}`).includes(key);
        const named = key ? used.filter(nameMatches) : [];
        if (named.length) cands = cands.filter((c) => named.includes(c));
        else if (key) {
          // "the chopped onion (from 1 onion)": the count names an ingredient the action does not list as used.
          const other = [...byId.values()].filter((ing) => nameMatches(ing) && isDerivable(am, ing.raw));
          if (other.length) continue;
        }
      }
      if (cands.length > 1) {
        // Prefer the ingredient whose name follows the amount in the text, then one whose line states the amount.
        const after = a.text.slice(am.at + am.text.length).toLowerCase().split(/\s+/).slice(0, 6).join(' ');
        const near = cands.filter((ing) => new RegExp(`\\b${(ing.head || ing.name).toLowerCase().split(' ').pop().replace(/s$/, '')}`).test(after));
        if (near.length) cands = near;
        const direct = cands.filter((ing) => amountsIn(ing.raw).some((o) => sameAmount(am, o)));
        if (direct.length) cands = direct;
      }
      if (!cands.length) {
        out.push(`AMOUNT ${a.id} "${a.text.slice(0, 90)}": "${am.text}" is not derivable from ${used.length ? used.map((u) => `"${u.raw}"`).join(' / ') : 'any ingredient the action uses'}`);
        continue;
      }
      const ing = cands[0];
      if (a.id.startsWith('p') && a.original && a.original.ingredientId) continue; // restates the line's own amount
      inserted.push({ ing, am, action: a.id, portions: new Set((a.uses || []).filter((u) => u.ingredientId === ing.id).map((u) => u.portion)) });
    }
  }
  // TWICE: per ingredient, distinct (portion, amount) records summed per unit family must not exceed the total.
  const per = new Map();
  for (const rec of inserted) per.set(rec.ing.id, [...(per.get(rec.ing.id) || []), rec]);
  for (const [id, recs] of per) {
    const ing = byId.get(id);
    const own = amountsIn(ing.raw.replace(/^\s*[-*•]\s*/, ''));
    if (!own.length) continue;
    const seen = [];
    const firstUnit = own[0].unit;
    for (const rec of recs) {
      // "200 g (7 oz)": the second unit of a dual amount is the same quantity, not another use.
      if (rec.am.unit !== firstUnit && own.some((o) => o.unit === rec.am.unit && sameAmount(rec.am, o)) && recs.some((x) => x !== rec && x.action === rec.action && x.am.unit === firstUnit)) continue;
      if (seen.some((s) => sameAmount(s.am, rec.am) && [...s.portions].some((p) => rec.portions.has(p)))) continue;
      seen.push(rec);
    }
    const fam = (u) => (TO_BASE[u] ? TO_BASE[u][0] : u);
    const sums = new Map();
    for (const rec of seen) {
      const base = TO_BASE[rec.am.unit] ? TO_BASE[rec.am.unit][1] : 1;
      sums.set(fam(rec.am.unit), (sums.get(fam(rec.am.unit)) || 0) + rec.am.hi * base);
    }
    // The total in each family: the line's own amounts of that family, the first of dual units only.
    for (const [family, sum] of sums) {
      const inFamily = own.filter((o) => fam(o.unit) === family);
      if (!inFamily.length) continue;
      const totals = new Set();
      const sameUnit = new Map();
      for (const o of inFamily) sameUnit.set(o.unit, (sameUnit.get(o.unit) || 0) + o.hi * (TO_BASE[o.unit] ? TO_BASE[o.unit][1] : 1));
      for (const v of sameUnit.values()) totals.add(v);
      const max = Math.max(...totals);
      if (sum > max * (1 + 1e-3) + 1e-6) out.push(`TWICE "${ing.raw}": inserted amounts add up to more than the total (${seen.map((s) => `${s.action}:${s.am.text}`).join(', ')})`);
    }
  }
  return out;
}

function checkOrder(r) {
  const out = [];
  let prev = null;
  for (const a of r.cook) {
    if (prev && (a.original.step < prev.original.step || (a.original.step === prev.original.step && a.original.start < prev.original.start))) {
      out.push(`ORDER ${a.id} comes after ${prev.id} but is earlier in the recipe`);
    }
    if (prev && Number(a.id.slice(1)) < Number(prev.id.slice(1))) out.push(`ORDER cook ids out of order: ${prev.id}, ${a.id}`);
    prev = a;
  }
  return out;
}

function checkWindows(r) {
  const out = [];
  const known = new Set([...r.prep, ...r.deferred].map((a) => a.id));
  for (const a of r.cook) {
    if (a.meanwhile.length && a.kind !== 'waiting') out.push(`WINDOW ${a.id} has a meanwhile but is not a waiting action: "${a.text}"`);
    for (const id of a.meanwhile) if (!known.has(id)) out.push(`WINDOW ${a.id} points at an unknown action ${id}`);
    if (a.kind === 'waiting') {
      const min = a.minutes ? a.minutes[0] : undefined;
      const preheat = /\bpreheat/i.test(a.text) && (/\boven\b/i.test(a.text) || !/\b(?:skillet|pan|pot|grill|griddle|wok|saucepan)\b/i.test(a.text));
      const boil = /\bbring\b/i.test(a.text) && /\bwater\b/i.test(a.text) && /\bboil\b/i.test(a.text);
      if (!preheat && !boil && !(min >= 3)) out.push(`WINDOW ${a.id} is waiting without a stated time of 3 minutes or more: "${a.text}"`);
    }
  }
  for (const a of r.deferred) if (!r.cook.some((c) => c.meanwhile.includes(a.id))) out.push(`WINDOW deferred ${a.id} is in no window`);
  return out;
}

// ------------------------------------------------------------------ run

const files = readdirSync(folder).filter((f) => f.endsWith('.txt')).sort();
const totals = { recipes: 0, threw: 0, violations: 0, ingredients: 0, withAmount: 0, uses: 0, usesCovered: 0, measuredUses: 0, measuredCovered: 0 };
const violationsByKind = {};

for (const file of files) {
  totals.recipes++;
  let text = readFileSync(join(folder, file), 'utf8');
  let source = '';
  if (/^\s*https?:\/\//.test(text)) {
    const at = text.indexOf('\n');
    source = text.slice(0, at).trim();
    text = text.slice(at + 1);
  }
  console.log(`\n${'='.repeat(78)}\n${file}${source ? `  (${source})` : ''}`);
  let r;
  try {
    r = rewrite(text);
  } catch (e) {
    totals.threw++;
    console.log(`THREW: ${e.code ? `[${e.code}] ` : ''}${e.message}`);
    continue;
  }
  const num = numberSteps(r);
  const flagCounts = {};
  for (const f of r.flags) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;

  // Coverage: an ingredient use is covered when its portion carries an amount or a stated use (a note),
  // or a flag names that action or ingredient. Unmeasured ingredients are counted apart.
  const flaggedIng = new Set(r.flags.filter((f) => f.ingredientId).map((f) => f.ingredientId));
  let withAmount = 0;
  r.ingredients.forEach((ing) => {
    if ((ing.portions || []).some((p) => p.qty !== undefined || p.note)) withAmount++;
  });
  let uses = 0;
  let covered = 0;
  let measuredUses = 0;
  let measuredCovered = 0;
  const seenUse = new Set();
  for (const a of [...r.prep, ...r.cook, ...r.deferred]) {
    for (const u of a.uses || []) {
      const key = `${a.id}|${u.ingredientId}|${u.portion}`;
      if (seenUse.has(key)) continue;
      seenUse.add(key);
      const ing = r.ingredients.find((i) => i.id === u.ingredientId);
      const p = ing && ing.portions[u.portion];
      const ok = (p && (p.qty !== undefined || p.note)) || flaggedIng.has(u.ingredientId) || r.flags.some((f) => f.actionId === a.id && f.ingredientId === u.ingredientId);
      const measured = ing && /^\s*[-*•]?\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|about|one|two|three)/i.test(ing.raw);
      uses++;
      if (ok) covered++;
      if (measured) { measuredUses++; if (ok) measuredCovered++; }
    }
  }
  totals.ingredients += r.ingredients.length;
  totals.withAmount += withAmount;
  totals.uses += uses;
  totals.usesCovered += covered;
  totals.measuredUses += measuredUses;
  totals.measuredCovered += measuredCovered;

  const violations = [...checkText(r), ...checkAmounts(r), ...checkOrder(r), ...checkWindows(r)];
  totals.violations += violations.length;
  for (const v of violations) violationsByKind[v.split(' ')[0]] = (violationsByKind[v.split(' ')[0]] || 0) + 1;

  console.log(`threw: no | prep ${r.prep.length} | cook ${r.cook.length} | deferred ${r.deferred.length} | ingredients ${r.ingredients.length} (with an amount or stated use: ${withAmount}) | uses ${uses} (covered ${covered}; of measured ingredients ${measuredCovered}/${measuredUses})`);
  console.log(`flags: ${Object.keys(flagCounts).length ? Object.entries(flagCounts).map(([k, v]) => `${k} x${v}`).join(', ') : 'none'}`);
  console.log(`invariants: ${violations.length ? `${violations.length} VIOLATION(S)` : 'ok'}`);
  for (const v of violations) console.log(`  ! ${v}`);
  if (summaryOnly) continue;

  const flagAt = (a) => r.flags.filter((f) => f.actionId === a.id).map((f) => f.code);
  console.log('\nGather');
  for (const ing of r.ingredients) {
    const fl = r.flags.filter((f) => f.ingredientId === ing.id && !f.actionId).map((f) => f.code);
    console.log(`  - ${gatherLine(ing, num)}${fl.length ? `   [${fl.join(', ')}]` : ''}`);
  }
  console.log('\nPrep');
  for (const a of r.prep) {
    console.log(`  ${num.numbers.get(a.id)}. ${a.text}${a.notes.length ? `   [note: ${a.notes.join(' | ')}]` : ''}${flagAt(a).length ? `   {${flagAt(a).join(', ')}}` : ''}`);
  }
  console.log('\nCook');
  const byId = new Map([...r.prep, ...r.deferred].map((a) => [a.id, a]));
  for (const a of r.cook) {
    console.log(`  ${num.numbers.get(a.id)}. ${a.text}${a.notes.length ? `   [note: ${a.notes.join(' | ')}]` : ''}${flagAt(a).length ? `   {${flagAt(a).join(', ')}}` : ''}`);
    if (a.kind === 'waiting') console.log(`      (waiting${a.minutes ? ` ${a.minutes.join('-')} min` : ''}${a.meanwhile.length ? `; meanwhile: ${a.meanwhile.map((id) => byId.get(id)?.text).join(' / ')}` : ''})`);
  }
  const ingFlags = r.flags.filter((f) => !f.actionId);
  if (ingFlags.length) {
    console.log('\nOther flags');
    for (const f of ingFlags) console.log(`  - ${f.code}: ${f.message}`);
  }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
console.log(`\n${'='.repeat(78)}\nSUMMARY`);
console.log(`recipes ${totals.recipes}, threw ${totals.threw}`);
console.log(`ingredients ${totals.ingredients}, with an amount or stated use ${totals.withAmount} (${pct(totals.withAmount, totals.ingredients)})`);
console.log(`ingredient uses ${totals.uses}, with an amount, a stated use or a flag ${totals.usesCovered} (${pct(totals.usesCovered, totals.uses)}); on measured ingredients ${totals.measuredCovered}/${totals.measuredUses} (${pct(totals.measuredCovered, totals.measuredUses)})`);
console.log(`invariant violations ${totals.violations}${Object.keys(violationsByKind).length ? ` (${Object.entries(violationsByKind).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
process.exit(totals.threw || totals.violations ? 1 : 0);
