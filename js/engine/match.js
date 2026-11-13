/**
 * Stage 3: find ingredient mentions inside each action (SPEC, "3. Matching").
 *
 * Principle: a wrong amount is worse than a missing one. Every doubt here ends in "no mention" plus a
 * flag, never in a guess. Mentions carry what stage 4 needs to place an amount: where the noun phrase
 * starts, whether the step already states an amount, and quantifier words such as "the remaining".
 */
import { parseQuantityPrefix, matchUnitPrefix } from './quantity.js';
import { parseIngredients } from './ingredients.js';
import { COOKING_VERBS, isCookingVerb } from './verbs.js';
import {
  tokenize, singular, stem, STOPWORDS, DERIVED_PREP, isPrepWord, leadVerb, FRACTION_GLYPHS,
} from './text-utils.js';

/** Things made by an earlier step: never an ingredient (unless an ingredient is named exactly that). */
const PRODUCT_WORDS = new Set(['meatball', 'sauce', 'dough', 'mixture', 'batter', 'marinade', 'dressing', 'filling']);

/** Words after an ingredient that name a part of it ("egg whites"): the whole amount does not apply to the part. */
const PART_WORDS = new Set(['whites', 'white', 'yolks', 'yolk', 'shells', 'stems', 'leaves', 'seeds', 'cores', 'rinds', 'rind', 'skins', 'skin']);

/** Plural-only words that stand for several ingredients. Version 1 flags them and inserts nothing. */
const COLLECTIVE_SINGLE = new Set(['spices', 'seasonings', 'herbs', 'aromatics', 'toppings', 'vegetables', 'veggies']);
const COLLECTIVE_ADJ = new Set(['dry', 'wet', 'remaining', 'other', 'rest', 'all']);

const UNIT_STOP = (w) => !!matchUnitPrefix(w);

/**
 * Last words of names such as "beef broth", "garlic powder" and "lemon juice": the first word flavours the
 * thing, it is not the thing. Those first words never stand for the ingredient on their own (tier 3).
 */
const FLAVOURED_NOUNS = new Set([
  'broth', 'stock', 'sauce', 'wine', 'juice', 'oil', 'vinegar', 'paste', 'powder', 'flakes', 'extract', 'seasoning',
  'syrup', 'cream', 'milk', 'butter', 'water', 'liqueur', 'bouillon', 'zest', 'salt', 'spice', 'mix', 'blend', 'rub',
]);

/** Words too loose to stand for an ingredient on their own. */
const LOOSE_WORDS = new Set([
  'red', 'green', 'yellow', 'white', 'black', 'brown', 'golden', 'small', 'medium', 'large', 'baby', 'dried', 'fresh', 'sweet', 'hot',
  'cold', 'whole', 'light', 'dark', 'extra', 'plain', 'ground', 'sharp', 'mild', 'thick', 'thin', 'soft', 'hard', 'wild',
]);

const NUMBER_WORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']);

/** Words that may stand in an object list without being an ingredient (stage 3 "unknown-ingredient" check). */
const NOT_INGREDIENT = new Set([
  'water', 'ice', 'everything', 'mixture', 'it', 'them', 'together', 'well', 'gently', 'pot', 'pan', 'skillet', 'bowl',
  'oven', 'heat', 'rest', 'remaining', 'enough', 'needed', 'taste', 'more', 'extra', 'liquid', 'juices', 'juice', 'sides',
  'side', 'top', 'bottom', 'cup', 'cups', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'half', 'quarter', 'third',
]);
const OBJECT_VERBS = new Set(['add', 'stir', 'fold', 'whisk', 'mix', 'toss', 'pour', 'beat']);
const OBJECT_STOP = new Set([
  'to', 'into', 'over', 'on', 'onto', 'for', 'until', 'till', 'while', 'so', 'using', 'when', 'once', 'if', 'as', 'at',
  'from', 'than', 'before', 'after', 'then', 'in', 'with',
]);
const SKIP_IN_OBJECT = new Set([...STOPWORDS, 'cooked', 'raw', 'fresh', 'extra', 'enough', 'additional', 'another', 'both']);

/** Compare helper: the words of a name as singulars. */
function wordsOf(text) {
  return tokenize(text).filter((t) => t.type === 'w').map((t) => singular(t.lower));
}

/** The head of an alternate name ("turkey"), found by running stage 1 on it. */
function headOf(name) {
  try {
    const r = parseIngredients([name]);
    return r.ingredients[0]?.head || name.toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

// ---------------------------------------------------------------------------- ingredient index

/**
 * Every phrase that can refer to an ingredient: its full head (tier 1), the last word of the head (tier 2)
 * and its other words (tier 3). Alternates ("chicken or turkey") get the same treatment.
 */
function buildIndex(ingredients) {
  const phrases = [];
  const info = ingredients.map((ing, idx) => {
    const heads = [ing.head, ...(ing.alternates || []).map(headOf)].filter(Boolean);
    const hyphenWords = new Set();
    const descriptorWords = new Set((ing.descriptors || []).flatMap((d) => wordsOf(d)));
    for (const head of heads) {
      const toks = tokenize(head).filter((t) => t.type === 'w');
      const words = toks.map((t) => singular(t.lower));
      if (!words.length) continue;
      toks.forEach((t, k) => { if (t.hy && words.length > 1) hyphenWords.add(words[k]); });
      phrases.push({ idx, words, tier: 1 });
      if (words.length > 1) {
        phrases.push({ idx, words: [words[words.length - 1]], tier: 2 });
        const seen = new Set([words[words.length - 1]]);
        // Tier 3: another word of the name, matched only exactly as written ("chicken" for "chicken thighs").
        // Never a colour or size word, and never a part of a hyphenated name ("red-pepper").
        const flavoured = FLAVOURED_NOUNS.has(words[words.length - 1]);
        if (!flavoured) toks.slice(0, -1).forEach((t, k) => {
          const w = words[k];
          if (w.length < 3 || STOPWORDS.has(w) || seen.has(w) || t.hy || LOOSE_WORDS.has(t.lower)) return;
          seen.add(w);
          phrases.push({ idx, words: [w], raw: t.lower, tier: 3 });
        });
      }
    }
    return { ing, idx, hyphenWords, descriptorWords };
  });
  return { phrases, info };
}

/** Words that name a group ("For the sauce:" gives "sauce"), with the ingredient indexes in that group. */
function groupProducts(ingredients) {
  const groups = new Map();
  ingredients.forEach((ing, idx) => {
    if (!ing.group) return;
    const words = wordsOf(ing.group.replace(/^\s*for\s+(?:the\s+)?/i, '').replace(/^the\s+/i, ''));
    if (!words.length) return;
    const key = words[words.length - 1];
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(idx);
  });
  return groups;
}

// ---------------------------------------------------------------------------- one action

/** Index of the "until"/"till" word, as a character offset, or -1. */
function untilOffset(text) {
  const m = /\b(?:until|till)\b/i.exec(text);
  return m ? m.index : -1;
}

/** A stated amount directly before position `end` of text ("¼ cup ", "2 tablespoons of the "). */
function statedBefore(text, end) {
  let pre = text.slice(0, end);
  const ofThe = /\s+of\s+(?:the\s+)?$/i.exec(pre);
  if (ofThe) pre = pre.slice(0, ofThe.index + 1);
  pre = pre.replace(/\s+$/, '');
  const starts = [];
  const re = new RegExp(`(?<![\\w.\\/])(?:\\d|[${FRACTION_GLYPHS}]|(?:${[...NUMBER_WORDS].join('|')})\\b)`, 'gi');
  let m;
  while ((m = re.exec(pre)) !== null) starts.push(m.index);
  for (const j of starts) {
    const s = pre.slice(j);
    const q = parseQuantityPrefix(s);
    if (!q) continue;
    const rest = s.slice(q.length).replace(/^[\s-]+/, '');
    if (rest === '') return { qty: q.qty, start: j, end: pre.length };
    const u = matchUnitPrefix(rest);
    if (u && u.length === rest.length) return { qty: q.qty, unit: u.unit, start: j, end: pre.length };
  }
  return null;
}

const FRACTION_QUANT = [
  [/\b(?:half|one[- ]half)(?:\s+of)?(?:\s+the)?\s*$/i, 'half', 1 / 2],
  [/\b(?:a|one)[- ]third(?:\s+of)?(?:\s+the)?\s*$/i, 'third', 1 / 3],
  [/\btwo[- ]thirds(?:\s+of)?(?:\s+the)?\s*$/i, 'two-thirds', 2 / 3],
  [/\b(?:a|one)[- ](?:quarter|fourth)(?:\s+of)?(?:\s+the)?\s*$/i, 'quarter', 1 / 4],
  [/\bthree[- ]quarters(?:\s+of)?(?:\s+the)?\s*$/i, 'three-quarters', 3 / 4],
];

/** Quantifier word(s) just before a position: { quantifier, fraction? } or null. */
function quantifierBefore(text, end) {
  const pre = text.slice(0, end);
  if (/\b(?:remaining|remainder(?:\s+of)?|other\s+half(?:\s+of)?|rest\s+of|the\s+rest)(?:\s+the)?\s*$/i.test(pre)) {
    return { quantifier: /\bremaining\s*$/i.test(pre) || /\bremaining\s+the\s*$/i.test(pre) ? 'remaining' : 'rest' };
  }
  if (/\bmost\s+of(?:\s+the)?\s*$/i.test(pre)) return { quantifier: 'most' };
  for (const [re, quantifier, fraction] of FRACTION_QUANT) if (re.test(pre)) return { quantifier, fraction };
  if (/\b(?:some|a\s+little|a\s+bit|a\s+few|a\s+couple|a\s+splash|a\s+drizzle|a\s+handful|a\s+pinch|a\s+dash|a\s+sprinkle|a\s+touch|a\s+knob|a\s+glug|a\s+squeeze)(?:\s+of)?(?:\s+the)?\s*$/i.test(pre)) {
    return { quantifier: 'some' };
  }
  if (/\b(?:more|extra|additional|another)(?:\s+of)?(?:\s+the)?\s*$/i.test(pre)) return { quantifier: 'more' };
  return null;
}

/** Does one of the ingredient's portions carry this prep word ("grated" for "grated, then squeezed dry")? */
function portionPrepMatches(ing, word) {
  const key = stem(word);
  return (ing.portions || []).some((p) => p.prep && p.prep.toLowerCase().split(/[^a-z]+/).filter(Boolean).some((w) => stem(w) === key));
}

// ---------------------------------------------------------------------------- stage entry point

/**
 * Stage 3: find ingredient mentions inside each action.
 * @param {import("./types.js").ParsedIngredient[]} ingredients  Output of parseIngredients.
 * @param {import("./types.js").Action[]} actions                Output of splitSteps.
 * @returns {{mentions: import("./types.js").Mention[], collective: import("./types.js").CollectiveMention[], flags: import("./types.js").Flag[]}}
 *   Mentions in action order. Flags: unknown-ingredient, unused-ingredient, collective-word, ambiguous-ingredient.
 */
export function matchIngredients(ingredients, actions) {
  const { phrases, info } = buildIndex(ingredients);
  const groups = groupProducts(ingredients);
  const mentions = [];
  const collective = [];
  const flags = [];
  const mentioned = new Set();

  for (const action of actions) {
    const text = action.text;
    const toks = tokenize(text);
    const consumed = new Array(toks.length).fill(false);
    const untilAt = untilOffset(text);
    const found = [];
    // "Oil the pan", "Salt the water", "Cream the butter": a verb at the start of the action is not an ingredient.
    const lv = leadVerb(text);
    const verbAt = toks.findIndex((t) => t.type === 'w' && t.lower === lv);

    const wordRun = (i, n) => {
      for (let k = 0; k < n; k++) {
        const t = toks[i + k];
        if (!t || t.type !== 'w' || consumed[i + k]) return false;
      }
      return true;
    };
    const sameWords = (i, p) => (p.raw !== undefined ? toks[i].lower === p.raw : p.words.every((w, k) => singular(toks[i + k].lower) === w));

    const maxN = Math.max(1, ...phrases.map((p) => p.words.length));
    for (let n = maxN; n >= 1; n--) {
      for (let i = 0; i + n <= toks.length; i++) {
        if (!wordRun(i, n)) continue;
        const cands = phrases.filter((p) => p.words.length === n && sameWords(i, p));
        if (!cands.length) continue;
        const bestTier = Math.min(...cands.map((c) => c.tier));
        const word = n === 1 ? singular(toks[i].lower) : null;
        if (n === 1 && i === verbAt && isCookingVerb(toks[i].lower)) {
          // The step does use the ingredient, but this word is the instruction, so there is no phrase to put an amount in.
          for (const c of cands) mentioned.add(c.idx);
          consumed[i] = true;
          continue;
        }
        // A made-earlier word ("the sauce") is a product unless an ingredient is named exactly that.
        if (n === 1 && bestTier > 1 && isProduct(word, groups, cands)) {
          consumed[i] = true;
          continue;
        }
        let set = new Set(cands.filter((c) => c.tier === bestTier).map((c) => c.idx));
        if (n === 1 && bestTier <= 2) {
          // Another ingredient that shares this word as its head or last word, or inside a hyphenated name.
          for (const c of phrases) if (c.words.length === 1 && c.words[0] === word && c.tier <= 2) set.add(c.idx);
          for (const inf of info) if (inf.hyphenWords.has(word)) set.add(inf.idx);
        }
        for (let k = 0; k < n; k++) consumed[i + k] = true;
        found.push({ i, n, tier: bestTier, set: [...set].sort((a, b) => a - b) });
      }
    }
    found.sort((a, b) => a.i - b.i);

    for (const f of found) {
      let chosen = null;
      if (f.set.length === 1) chosen = f.set[0];
      else chosen = resolveByDescriptors(f, toks, info);
      const first = toks[f.i];
      const last = toks[f.i + f.n - 1];
      if (chosen === null) {
        for (const idx of f.set) mentioned.add(idx);
        const names = f.set.map((idx) => `"${ingredients[idx].name}"`).join(' and ');
        flags.push({
          actionId: action.id,
          code: 'ambiguous-ingredient',
          message: `"${text.slice(first.start, last.end)}" could mean ${names}, so no amount was added here.`,
        });
        continue;
      }
      mentioned.add(chosen);
      mentions.push(buildMention(action, toks, consumed, f, chosen, ingredients[chosen], info[chosen], untilAt));
    }

    // Collective words that no ingredient claimed.
    toks.forEach((t, i) => {
      if (t.type !== 'w' || consumed[i]) return;
      let word = null;
      if (COLLECTIVE_SINGLE.has(t.lower)) word = t.lower;
      else if (t.lower === 'ingredients') {
        const prev = toks[i - 1];
        word = prev && prev.type === 'w' && COLLECTIVE_ADJ.has(prev.lower) ? `${prev.lower} ingredients` : 'ingredients';
        if (word === 'ingredients') return;
      }
      if (!word) return;
      consumed[i] = true;
      collective.push({ actionId: action.id, word });
      flags.push({
        actionId: action.id,
        code: 'collective-word',
        message: `"${word}" stands for several ingredients; the amounts are in the ingredient list, not added here.`,
      });
    });

    flagUnknown(action, toks, consumed, flags, groups);
  }

  ingredients.forEach((ing, idx) => {
    if (mentioned.has(idx)) return;
    flags.push({
      ingredientId: ing.id,
      code: 'unused-ingredient',
      message: `"${ing.name}" is in the ingredient list but no step names it.`,
    });
  });

  mentions.sort((a, b) => actions.findIndex((x) => x.id === a.actionId) - actions.findIndex((x) => x.id === b.actionId) || a.start - b.start);
  return { mentions, collective, flags };
}

/** Is a single word a made-earlier product here? */
function isProduct(word, groups, cands) {
  if (PRODUCT_WORDS.has(word)) return true;
  const members = groups.get(word);
  if (!members) return false;
  // A group named for one of its own ingredients ("For the noodles: rice noodles") is that ingredient.
  return !cands.some((c) => members.has(c.idx));
}

/** Pick one candidate when the words just before the mention are one candidate's descriptors ("brown sugar"). */
function resolveByDescriptors(f, toks, info) {
  const before = new Set();
  for (let k = f.i - 1; k >= 0 && before.size < 4; k--) {
    const t = toks[k];
    if (t.type !== 'w' || t.start < 0) break;
    if (STOPWORDS.has(t.lower)) break;
    before.add(singular(t.lower));
  }
  const hits = f.set.filter((idx) => [...info[idx].descriptorWords].some((w) => before.has(singular(w))));
  return hits.length === 1 ? hits[0] : null;
}

const COATING = /\b(?:grease[ds]?|greasing|oil(?:ed|ing)?|butter(?:ed|ing)?|spray(?:ed|ing)?|coat(?:ed|ing)?|brush(?:ed|ing)?|dust(?:ed|ing)?)\b[^.;]*\b(?:pans?|skillets?|sheets?|dish(?:es)?|tins?|bowls?|griddle|grates?|plates?|mou?lds?|trays?|pots?|woks?)\b[^.;]*\bwith\s+(?:(?:the\s+)?[\w-]+\s+(?:or|and)\s+)?(?:the\s+)?$/i;

/** Everything stage 4 needs to know about one mention. */
function buildMention(action, toks, consumed, f, ingredientId, ing, inf, untilAt) {
  const text = action.text;
  const first = toks[f.i];
  const last = toks[f.i + f.n - 1];
  const m = { actionId: action.id, ingredientId: ing.id, start: first.start, end: last.end };

  // Modifiers directly before the noun: descriptors, prep words, unknown adjectives. They stay in the
  // text, and an inserted amount goes in front of them.
  let k = f.i - 1;
  let absorbed = 0;
  let lead = first.start;
  while (k >= 0 && absorbed < 3) {
    const t = toks[k];
    if (t.type !== 'w' || consumed[k]) break;
    const ownDescriptor = inf.descriptorWords.has(singular(t.lower)); // "brown sugar": brown is a verb, here a descriptor
    if (STOPWORDS.has(t.lower) || (COOKING_VERBS.has(t.lower) && !ownDescriptor) || UNIT_STOP(t.text)) break;
    lead = t.start;
    if (isPrepWord(t.lower) && !m.prepWord) m.prepWord = t.lower;
    k--;
    absorbed++;
  }
  // A hyphenated modifier ("all-purpose") is one word: an inserted amount never lands inside it.
  for (let j = k + 1; j > 0 && toks[j].hy && toks[j - 1].hy && toks[j].start === toks[j - 1].end + 1 && !consumed[j - 1]; j--) {
    lead = toks[j - 1].start;
    k = j - 2;
  }
  m.lead = lead;
  // Only one word of a longer name ('chicken' for 'chicken breasts'): a count would name the wrong thing.
  if (f.tier === 3 && f.n === 1) m.partial = true;

  // Derived prep noun right after the mention ("lemon juice", "lemon wedges").
  const nx = toks[f.i + f.n];
  if (nx && nx.type === 'w' && !consumed[f.i + f.n] && toks[f.i + f.n].start - last.end <= 1
    && (Object.hasOwn(DERIVED_PREP, nx.lower) || PART_WORDS.has(nx.lower))) {
    m.derived = Object.hasOwn(DERIVED_PREP, nx.lower) ? DERIVED_PREP[nx.lower] : 'part';
    m.derivedEnd = nx.end;
    consumed[f.i + f.n] = true;
  }
  if (m.prepWord && !portionPrepMatches(ing, m.prepWord)) delete m.prepWord;

  // "the" in front of the noun phrase is replaced when an amount is inserted.
  const before = toks[k];
  let articleA = null;
  if (before && before.type === 'w' && ['the', 'your', 'a', 'an'].includes(before.lower)) {
    const prevT = toks[k - 1];
    const ofBefore = prevT && prevT.type === 'w' && prevT.lower === 'of';
    if (!ofBefore) m.article = { start: before.start, end: lead };
    if (before.lower === 'a' || before.lower === 'an') articleA = { qty: 1, start: before.start, end: lead };
  }

  // A stated amount, then a quantifier before it or before the noun phrase.
  const stated = statedBefore(text, lead);
  let quantEnd = lead;
  if (stated) {
    m.stated = stated;
    quantEnd = stated.start;
  } else if (articleA) {
    // "a lemon": the step already says how many. Do not compare it with the total, and do not replace it.
    m.unsure = true;
  } else {
    // A unit or a number just before the noun phrase that we could not read as an amount: leave it alone.
    const pre = text.slice(0, lead).replace(/\s+(?:of\s+)?(?:the\s+)?$/i, '');
    const lastWord = /([A-Za-z]+|\d[\d.\/]*|[½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(pre);
    if (lastWord && (UNIT_STOP(lastWord[1]) || /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(lastWord[1]) || NUMBER_WORDS.has(lastWord[1].toLowerCase()))) m.unsure = true;
  }
  const q = quantifierBefore(text, quantEnd);
  // "a pot of water", "the juice of the lemon": the amount belongs to the thing before "of", not to this noun.
  if (!stated && !q && /\bof\s+(?:the\s+)?$/i.test(text.slice(0, lead))) m.unsure = true;
  if (q) {
    m.quantifier = q.quantifier;
    if (q.fraction) m.fraction = q.fraction;
    // The quantifier owns the article ("the remaining butter"): keep it.
    if (m.quantifier !== 'more') delete m.article;
  }

  const upto = text.slice(0, m.start);
  if (/\bseason(?:ing)?\b/i.test(upto) || /^\W*(?:to taste|as needed|if needed)/i.test(text.slice(m.derivedEnd ?? m.end))) m.seasoning = true;
  if (/\b(?:serve|serving|garnish|garnishing|topping|top|sprinkle|sprinkling|finish|finishing)\b/i.test(upto)
    || ['serve', 'garnish', 'top', 'sprinkle', 'finish'].includes(leadVerb(text))) m.serving = true;
  // "grease the pan with butter": a thin coat, not the amount the dish itself needs.
  if (!m.stated && !m.quantifier && COATING.test(text.slice(0, lead))) m.coating = true;
  if (untilAt >= 0 && m.start > untilAt) m.inUntil = true;
  return m;
}

/**
 * "Add the pasta" when no ingredient is named pasta: the words of an object list that no ingredient claimed.
 * Only after a few verbs that introduce ingredients, and only for plain nouns.
 */
function flagUnknown(action, toks, consumed, flags, groups) {
  const verb = leadVerb(action.text);
  if (!OBJECT_VERBS.has(verb)) return;
  const v = toks.findIndex((t) => t.type === 'w' && t.lower === verb);
  if (v < 0) return;
  let i = v + 1;
  if (verb !== 'add') {
    // "stir in the cream": only the particle form introduces an ingredient.
    if (!(toks[i] && toks[i].type === 'w' && toks[i].lower === 'in')) return;
    i++;
  }
  const items = [[]];
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'p') {
      if (t.text === ',') { items.push([]); continue; }
      break;
    }
    if (t.type === 'w' && (OBJECT_STOP.has(t.lower) || /ing$/.test(t.lower))) break;
    if (t.type === 'w' && (t.lower === 'and' || t.lower === 'or')) { items.push([]); continue; }
    items[items.length - 1].push(i);
  }
  for (const item of items) {
    const words = item.filter((j) => toks[j].type === 'w');
    if (!words.length) continue;
    if (item.some((j) => consumed[j])) continue;
    if (item.some((j) => toks[j].type === 'n')) continue;
    const content = words.filter((j) => !SKIP_IN_OBJECT.has(toks[j].lower) && !UNIT_STOP(toks[j].text) && !NOT_INGREDIENT.has(toks[j].lower));
    if (!content.length || content.length < words.length - 4) continue;
    if (words.some((j) => NOT_INGREDIENT.has(toks[j].lower) || COOKING_VERBS.has(toks[j].lower))) continue;
    if (words.some((j) => PRODUCT_WORDS.has(singular(toks[j].lower)) || groups.has(singular(toks[j].lower)))) continue;
    const label = content.map((j) => toks[j].text).join(' ');
    flags.push({
      actionId: action.id,
      code: 'unknown-ingredient',
      message: `"${label}" is used here but is not in the ingredient list.`,
    });
  }
}
