/**
 * Stage 4: resolve the amount for each use and insert it into the action text (SPEC, "4. Amount resolution").
 *
 * Principle: a wrong amount is worse than a missing one. An amount is inserted only when it is the full
 * line amount of an ingredient used once, a stated amount repeated, or plain arithmetic on amounts the
 * recipe itself gives. Anything else is left as written and flagged.
 */
import {
  formatQuantity, addQuantities, subtractQuantities, convertQuantity, parseAmount,
} from './quantity.js';
import { stem, DERIVED_PREP, showQuantity } from './text-utils.js';

/** @typedef {import('./types.js').Flag} Flag */

const clone = (o) => JSON.parse(JSON.stringify(o));
const EPS = 1e-6;
const PARTIAL = new Set(['some', 'most']);
const FRACTIONAL = new Set(['half', 'third', 'quarter', 'two-thirds', 'three-quarters']);
const REMAINING = new Set(['remaining', 'rest']);

const fmt = (q) => showQuantity(q.qty, q.unit, formatQuantity);

/** "lemon" for 2 lemons: the word as the step wrote it, in the plural when the amount is more than one and has no unit. */
function plural(word, q) {
  const n = Array.isArray(q.qty) ? q.qty[1] : q.qty;
  if (q.unit || n <= 1 || /s$/i.test(word)) return word;
  if (/(?:ch|sh|x|[^aeiou]o)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
const toQ = (p) => (p && p.qty !== undefined ? { qty: p.qty, ...(p.unit ? { unit: p.unit } : {}) } : null);
const bounds = (q) => (Array.isArray(q.qty) ? q.qty : [q.qty, q.qty]);

/** Sum of quantities, or null when any are missing or cannot be added (g and cups). */
function sumQ(list) {
  let t = null;
  for (const q of list) {
    if (!q) return null;
    t = t ? addQuantities(t, q) : q;
    if (!t) return null;
  }
  return t;
}

/** Are two quantities the same amount? true, false, or null when they cannot be compared. */
function sameQ(a, b) {
  if (!a || !b) return null;
  let y = b;
  if (a.unit !== b.unit) {
    y = convertQuantity(b, a.unit);
    if (!y) return null;
  }
  const [al, ah] = bounds(a);
  const [bl, bh] = bounds(y);
  return Math.abs(al - bl) < EPS && Math.abs(ah - bh) < EPS;
}

function scaleQ(q, f) {
  const round = (n) => Math.round(n * 1e9) / 1e9;
  const [lo, hi] = bounds(q);
  return { qty: lo === hi ? round(lo * f) : [round(lo * f), round(hi * f)], ...(q.unit ? { unit: q.unit } : {}) };
}

/** Reserve amount named in the action's notes or after the mention ("reserve about 2 tablespoons for garnish"). */
function reserveFor(m, action) {
  const re = /\b(?:reserv(?:e|ing)|keep(?:ing)?|set(?:ting)? aside|hold(?:ing)? back|sav(?:e|ing)|leav(?:e|ing))\s+(?:about\s+|around\s+|roughly\s+|approximately\s+)?([\d½¼¾⅓⅔⅛⅜⅝⅞][\d\s\/.½¼¾⅓⅔⅛⅜⅝⅞]*?)\s*([A-Za-z]+)/i;
  const sources = [...(action.notes || []), action.text.slice(m.end)];
  for (const s of sources) {
    const x = re.exec(s);
    if (!x) continue;
    const a = parseAmount(`${x[1].trim()} ${x[2]}`);
    if (a && a.unit) return { qty: a.qty, unit: a.unit };
  }
  return null;
}

/** Index of the portion a prep word or derived noun picks ("grated" picks "grated, then squeezed dry"), or -1. */
function boundPortion(m, portions) {
  const word = m.prepWord || m.derived;
  if (!word) return -1;
  const key = stem(word);
  return portions.findIndex((p) => p.prep && p.prep.toLowerCase().split(/[^a-z]+/).filter(Boolean).some((w) => stem(w) === key));
}

// ---------------------------------------------------------------------------------------------

/**
 * Resolve one ingredient. Returns the new portions, one assignment per mention (portion index and an
 * optional insertion) and flags.
 */
function resolveIngredient(ing, ms, actionById) {
  const flags = [];
  const assign = new Map(); // mention -> { portion, insert }
  const line = ing.portions.filter((p) => p.tag !== 'serving');
  const serving = ing.portions.filter((p) => p.tag === 'serving');
  const measured = line.some((p) => p.qty !== undefined);
  const name = ing.name;
  const unresolvedFlag = (m, message) => {
    if (!flags.some((f) => f.code === 'split-unresolved')) {
      flags.push({ actionId: m.actionId, ingredientId: ing.id, code: 'split-unresolved', message });
    }
  };
  const mismatch = (m, message) => flags.push({ actionId: m && m.actionId, ingredientId: ing.id, code: 'amounts-mismatch', message });
  const splitMsg = `The recipe does not say how to split the ${name} between steps, so no amount was added where that is unclear.`;

  // ---- classify every mention
  let seenMain = 0;
  const kinds = ms.map((m) => {
    let kind = 'main';
    if (!line.length && serving.length) kind = 'serving';
    else if (m.seasoning) kind = 'season';
    else if (m.coating && ms.length > 1) kind = 'extra';
    else if (m.quantifier === 'more') kind = serving.length ? 'serving' : 'extra';
    else if (m.serving && serving.length && seenMain > 0) kind = 'serving';
    if (kind === 'main') seenMain++;
    return kind;
  });
  // A single use that is a seasoning use is just a use: "season with the salt" with 1 tsp listed.
  if (ms.length === 1 && kinds[0] === 'season') kinds[0] = 'main';
  const mains = ms.filter((_, i) => kinds[i] === 'main');
  const others = ms.map((m, i) => ({ m, kind: kinds[i] })).filter((x) => x.kind !== 'main');

  let portions = [];
  const noteFor = (kind, m) => (kind === 'season' ? 'more to season' : kind === 'extra' ? 'more' : m.quantifier === 'rest' ? 'the rest' : 'some');
  const prepOfLine = line.length === 1 ? line[0].prep : undefined;
  const withPrep = (p) => (prepOfLine && p.prep === undefined ? { ...p, prep: prepOfLine } : p);

  const finish = ({ skipRest = false } = {}) => {
    // serving, seasoning and extra uses
    const servingUses = others.filter((x) => x.kind === 'serving');
    if (serving.length) {
      const sp = clone(serving[0]);
      const extra = serving.slice(1).map(clone);
      portions.push(sp, ...extra);
      const idx = portions.indexOf(sp);
      for (const x of servingUses) assign.set(x.m, { portion: idx });
    }
    const rest = skipRest ? [] : others.filter((x) => x.kind === 'season' || x.kind === 'extra');
    if (rest.length) {
      const kind = rest.some((x) => x.kind === 'season') ? 'season' : 'extra';
      portions.push({ note: noteFor(kind, rest[0].m) });
      const idx = portions.length - 1;
      for (const x of rest) assign.set(x.m, { portion: idx });
    }
    // usedIn: the first action to use each portion
    portions.forEach((p, idx) => {
      const users = ms.filter((m) => assign.get(m) && assign.get(m).portion === idx);
      if (users.length) p.usedIn = users[0].actionId;
    });
    return { portions, assign, flags };
  };

  // ============================================================ no amount on the ingredient line
  if (!measured) {
    const base = line.length ? clone(line[0]) : null;
    const lineRaw = String(ing.raw || '');
    if (/^\s*[-*•]?\s*(?:\d|[½¼¾⅓⅔⅛⅜⅝⅞])/.test(lineRaw)) {
      flags.push({ ingredientId: ing.id, code: 'unparseable-quantity', message: `Could not read the amount in "${lineRaw.trim()}", so no amount was added for it.` });
    }
    // A stated amount ("1 teaspoon salt") is a portion of its own. Every other use shares one note portion.
    const stated = mains.filter((m) => m.stated && !m.unsure);
    const loose = [...mains.filter((m) => !stated.includes(m)), ...others.filter((x) => x.kind === 'season' || x.kind === 'extra').map((x) => x.m)]
      .sort((a, b) => ms.indexOf(a) - ms.indexOf(b));
    stated.forEach((m) => {
      portions.push(withPrep({ qty: m.stated.qty, ...(m.stated.unit ? { unit: m.stated.unit } : {}) }));
      assign.set(m, { portion: portions.length - 1 });
    });
    if (loose.length) {
      if (portions.length) portions.push({ note: loose.some((m) => m.seasoning) ? 'more to season' : 'more' });
      else if (base) portions.push(base);
      else if (!serving.length) portions.push({});
      const idx = portions.length - 1;
      if (idx >= 0) for (const m of loose) assign.set(m, { portion: idx });
    }
    if (!portions.length && base) portions.push(base);
    if (!portions.length && !serving.length) portions.push({});
    return finish({ skipRest: true });
  }

  // ============================================================ a measured ingredient
  const T = sumQ(line.map(toQ));
  const alt = line.length === 1 && line[0].alt ? line[0].alt : null;
  const totalText = T ? `${fmt(T)}${alt ? ` (${fmt(alt)})` : ''}` : null;

  // Several portions that each carry their own prep (half diced, half grated): uses pick a portion by prep word.
  const prepSplit = line.length >= 2 && line.every((p) => p.prep);
  if (prepSplit) {
    portions = clone(line);
    const bound = new Set();
    for (const m of mains) {
      const idx = boundPortion(m, portions);
      if (idx >= 0) {
        assign.set(m, { portion: idx });
        bound.add(idx);
      } else if (bound.size === portions.length) {
        // Every portion is already spoken for: this is the cook referring back ("push the onions aside").
      } else {
        unresolvedFlag(m, `"${name}" is split into portions with different prep, and this step does not say which one it uses, so no amount was added.`);
      }
    }
    return finish();
  }

  const splitMode = ing.divided || mains.some((m) => m.quantifier && m.quantifier !== 'more');
  const hasStated = mains.some((m) => m.stated);
  const isPlain = (m) => !m.stated && !m.unsure && !m.quantifier;

  /**
   * How to show an amount on a mention. In front of the noun phrase, except where that would misread:
   * "the lemon juice" gets "(from 1 lemon)", and a "some of" first use gets the total in parentheses.
   */
  const insertFor = (m, text) => {
    const word = actionById.get(m.actionId).text.slice(m.start, m.end);
    if (m.derived === 'part') return null; // "the egg whites": the amount of whole eggs does not describe them
    if ((m.derived !== undefined || m.prepWord) && !(T && T.unit)) return { mode: 'paren', text: `from ${text} ${plural(word, T)}` };
    if (m.quantifier) {
      return { mode: 'paren', text: `${text} ${word} in all` };
    }
    // A word that is only part of the name ("chicken" for "chicken breasts") is not pluralised: "4 chickens" would be another thing.
    const noun = T && !T.unit && text === totalText && !m.partial ? plural(word, T) : word;
    return { mode: 'inline', text, ...(noun !== word ? { noun } : {}) };
  };

  const stay = () => {
    // Keep the line portions, and give the first one the first use.
    portions = line.map((p) => clone(p));
    return portions;
  };

  // ---- path 1: not divided, no quantifier words
  if (!splitMode) {
    if (!hasStated) {
      stay();
      mains.forEach((m, i) => {
        if (i === 0 && isPlain(m)) {
          assign.set(m, { portion: 0, insert: totalText ? insertFor(m, totalText) : undefined });
          if (!totalText) unresolvedFlag(m, `Could not add up the amounts for ${name}, so no amount was added.`);
        } else assign.set(m, { portion: 0 });
      });
      return finish();
    }
    // Some uses state their amount.
    const statedPortions = [];
    let used = null;
    let known = true;
    let seenStated = false;
    for (const m of mains) {
      if (m.stated && !m.unsure) {
        const q = { qty: m.stated.qty, ...(m.stated.unit ? { unit: m.stated.unit } : {}) };
        statedPortions.push(withPrep(q));
        assign.set(m, { portion: statedPortions.length - 1 });
        used = used ? addQuantities(used, q) : q;
        if (!used) known = false;
        seenStated = true;
      } else if (m.unsure) {
        known = false;
        statedPortions.push(withPrep({}));
        assign.set(m, { portion: statedPortions.length - 1 });
        seenStated = true;
      } else if (!seenStated) {
        unresolvedFlag(m, splitMsg);
        statedPortions.push(withPrep({}));
        assign.set(m, { portion: statedPortions.length - 1 });
      } else {
        // A plain mention after a stated one refers back to it.
        assign.set(m, { portion: statedPortions.length - 1 });
      }
    }
    portions = statedPortions;
    const comparable = known && !flags.some((f) => f.code === 'split-unresolved');
    if (comparable && used && T) {
      const eq = sameQ(used, T);
      const eqAlt = alt ? sameQ(used, alt) : null;
      if (eq === false && eqAlt !== true) {
        mismatch(mains[mains.length - 1], `The steps use ${fmt(used)} of the ${name}, but the ingredient list says ${fmt(T)}.`);
      }
    }
    return finish();
  }

  // ---- path 2: divided or quantifier words
  const reserves = new Map(mains.map((m) => [m, m.quantifier === 'most' || m.quantifier === 'some' ? reserveFor(m, actionById.get(m.actionId)) : null]));
  const computed = mains.some((m) => reserves.get(m) || FRACTIONAL.has(m.quantifier));
  const noAmounts = !hasStated && !computed;

  if (noAmounts) {
    if (mains.length >= 2) {
      // The recipe never says how to split: show the total on the first use and flag.
      mains.forEach((m, i) => {
        const note = m.quantifier === 'most' ? 'most of it' : m.quantifier === 'rest' || m.quantifier === 'remaining' ? 'the rest' : 'some';
        portions.push(withPrep({ note }));
        const portion = portions.length - 1;
        if (i === 0 && totalText && !REMAINING.has(m.quantifier) && !m.unsure) assign.set(m, { portion, insert: insertFor(m, totalText) });
        else assign.set(m, { portion });
      });
      unresolvedFlag(mains[0], `The recipe does not say how to split the ${name}; the total is shown on its first use only.`);
    } else if (mains.length === 1) {
      const m = mains[0];
      if (REMAINING.has(m.quantifier)) {
        portions.push(withPrep({ note: 'the rest' }));
        assign.set(m, { portion: 0 });
        unresolvedFlag(m, `The step says "${m.quantifier === 'rest' ? 'the rest' : 'the remaining'}" of the ${name}, but no earlier step uses it.`);
      } else if (PARTIAL.has(m.quantifier)) {
        portions.push(withPrep({ note: m.quantifier === 'most' ? 'most of it' : 'some' }));
        assign.set(m, { portion: 0 });
      } else {
        stay();
        assign.set(m, { portion: 0 });
        unresolvedFlag(m, `The ingredient list says "divided" but only one step uses the ${name}, so no amount was added.`);
      }
    }
    if (!portions.length) stay();
    return finish();
  }

  // Stated amounts and arithmetic.
  let used = null;
  let known = true;
  let unresolved = false;
  const addUsed = (q) => {
    if (!known) return;
    used = used ? addQuantities(used, q) : q;
    if (!used) known = false;
  };
  for (const m of mains) {
    const action = actionById.get(m.actionId);
    const push = (p) => { portions.push(withPrep(p)); return portions.length - 1; };
    if (m.stated && !m.unsure) {
      const q = { qty: m.stated.qty, ...(m.stated.unit ? { unit: m.stated.unit } : {}) };
      if (REMAINING.has(m.quantifier) && known && used && T) {
        const exp = subtractQuantities(T, used);
        if (exp && sameQ(exp, q) === false) mismatch(m, `The step says ${fmt(q)} of the ${name} is left, but the earlier steps leave ${fmt(exp)}.`);
        if (!exp) mismatch(m, `The earlier steps already use more ${name} than the list gives.`);
      }
      assign.set(m, { portion: push(q) });
      addUsed(q);
    } else if (m.unsure && !m.quantifier) {
      known = false;
      assign.set(m, { portion: push({}) });
    } else if (REMAINING.has(m.quantifier)) {
      const exp = known && used && T ? subtractQuantities(T, used) : null;
      if (exp && bounds(exp)[0] > EPS) {
        assign.set(m, { portion: push(exp), insert: m.quantifier === 'remaining' ? { mode: 'inline', text: fmt(exp) } : { mode: 'paren', text: fmt(exp) } });
        addUsed(exp);
      } else {
        assign.set(m, { portion: push({ note: 'the rest' }) });
        unresolved = true;
        unresolvedFlag(m, `Could not work out how much of the ${name} is left for this step, so no amount was added.`);
      }
    } else if (FRACTIONAL.has(m.quantifier)) {
      if (T && m.fraction) {
        const q = scaleQ(T, m.fraction);
        assign.set(m, { portion: push(q), insert: { mode: 'paren', text: fmt(q) } });
        addUsed(q);
      } else {
        assign.set(m, { portion: push({ note: 'some' }) });
        unresolved = true;
        unresolvedFlag(m, splitMsg);
      }
    } else if (PARTIAL.has(m.quantifier)) {
      const r = reserves.get(m);
      if (r && T) {
        const left = subtractQuantities(T, r);
        // The reserve was read from the action's own notes or text, so it is already shown there: no insertion.
        assign.set(m, { portion: push({ note: m.quantifier === 'most' ? 'most of it' : 'some' }) });
        if (left) addUsed(left); else known = false;
      } else {
        assign.set(m, { portion: push({ note: m.quantifier === 'most' ? 'most of it' : 'some' }) });
        known = false;
        unresolved = true;
        unresolvedFlag(m, splitMsg);
      }
    } else {
      // A plain mention. After the full amount has been used it is a reference; otherwise it is unclear.
      if (known && used && T && sameQ(used, T) === true) assign.set(m, { portion: Math.max(0, portions.length - 1) });
      else {
        assign.set(m, { portion: push({}) });
        unresolved = true;
        unresolvedFlag(m, splitMsg);
      }
    }
  }
  if (!portions.length) stay();
  if (!unresolved && known && used && T) {
    const eq = sameQ(used, T);
    const eqAlt = alt ? sameQ(used, alt) : null;
    if (eq === false && eqAlt !== true) {
      mismatch(mains[mains.length - 1], `The steps use ${fmt(used)} of the ${name}, but the ingredient list says ${fmt(T)}.`);
    }
  }
  return finish();
}

// ---------------------------------------------------------------------------------------------

/**
 * Stage 4: resolve the amount for each use and insert it into the action text.
 * @param {import("./types.js").ParsedIngredient[]} ingredients
 * @param {import("./types.js").Action[]} actions
 * @param {import("./types.js").Mention[]} mentions  Output of matchIngredients.
 * @returns {{ingredients: import("./types.js").ParsedIngredient[], actions: import("./types.js").Action[], flags: import("./types.js").Flag[]}}
 *   Ingredients with portions completed (usedIn set); actions with text amounts inserted and uses filled.
 *   Flags: amounts-mismatch, split-unresolved, unparseable-quantity.
 */
export function resolveAmounts(ingredients, actions, mentions) {
  const outIngs = clone(ingredients);
  const outActs = clone(actions);
  const actionById = new Map(outActs.map((a) => [a.id, a]));
  const order = new Map(outActs.map((a, i) => [a.id, i]));
  const flags = [];
  const edits = new Map(outActs.map((a) => [a.id, []]));
  const uses = new Map(outActs.map((a) => [a.id, []]));

  for (const ing of outIngs) {
    const ms = mentions
      .filter((m) => m.ingredientId === ing.id && !m.inUntil && actionById.has(m.actionId))
      .sort((a, b) => order.get(a.actionId) - order.get(b.actionId) || a.start - b.start);

    // Total of the line's own amount, for display.
    const own = ing.portions.filter((p) => p.tag !== 'serving' && p.qty !== undefined);
    if (own.length) {
      const sum = own.length > 1 && own.every((p) => p.prep) ? sumQ(own.map((p) => ({ qty: p.qty, ...(p.unit ? { unit: p.unit } : {}) }))) : null;
      let total;
      if (sum) total = fmt(sum);
      else {
        total = own.map((p) => showQuantity(p.qty, p.unit, formatQuantity)).join(' plus ');
        if (own.length === 1 && own[0].alt) total += ` (${fmt(own[0].alt)})`;
      }
      ing.total = total;
    }

    const res = resolveIngredient(ing, ms, actionById);
    ing.portions = res.portions;
    flags.push(...res.flags);

    for (const m of ms) {
      const a = res.assign.get(m);
      if (!a) continue;
      uses.get(m.actionId).push({ start: m.start, use: { ingredientId: ing.id, portion: a.portion } });
      if (a.insert) edits.get(m.actionId).push(editFor(m, a.insert, actionById.get(m.actionId).text));
    }
  }

  for (const a of outActs) {
    a.uses = uses.get(a.id).sort((x, y) => x.start - y.start).map((x) => x.use);
    const list = edits.get(a.id).sort((x, y) => y.from - x.from);
    for (const e of list) a.text = a.text.slice(0, e.from) + e.text + a.text.slice(e.to);
  }
  return { ingredients: outIngs, actions: outActs, flags };
}

/** The text change for one insertion. Amounts go in front of the noun phrase, or in parentheses after it. */
function editFor(m, insert, actionText) {
  if (insert.mode === 'paren') {
    const at = m.derivedEnd ?? m.end;
    const text = insert.text;
    return { from: at, to: at, text: ` (${text})` };
  }
  const from = m.article && !m.quantifier ? m.article.start : m.lead;
  if (insert.noun) {
    // "Chop 3 tomatoes": the noun takes the plural when the amount has no unit.
    const keep = actionText.slice(m.lead, m.start);
    return { from, to: m.end, text: `${insert.text} ${keep}${insert.noun}` };
  }
  return { from, to: m.lead, text: `${insert.text} ` };
}

// Kept for tests: how a derived noun maps to a prep word.
export { DERIVED_PREP };
