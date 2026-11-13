/**
 * Stage 2: split steps into single actions (SPEC, "2. Step splitting").
 *
 * Pure and deterministic. Each step is cut into sentences, each sentence into clauses at ", then",
 * "and then", semicolons, and "and" / commas that precede a cooking verb. A clause is an action when
 * it starts (after an opening adverbial) with a cooking verb in imperative position; any other
 * sentence or clause becomes a note on the previous action. The recipe's own words are kept.
 */
import { COOKING_VERBS, AMBIGUOUS_VERBS } from './verbs.js';
import { splitSentences } from './steps-sentences.js';
import { parseDuration } from './steps-duration.js';

/** Words that open an adverbial phrase ending at a comma ("In a bowl, combine ..."). */
const OPENERS = new Set([
  'in', 'on', 'over', 'with', 'once', 'when', 'after', 'before', 'while', 'as', 'if', 'meanwhile', 'using',
  'working', 'for', 'to', 'at', 'from', 'by', 'during', 'now', 'first', 'next', 'finally', 'until', 'then',
  'again', 'also', 'instead', 'otherwise', 'afterwards', 'afterward', 'later', 'holding', 'keeping', 'starting',
]);
/** Openers that may be followed by the verb without a comma ("In a bowl combine the flour"). */
const COMMALESS_OPENERS = new Set(['in', 'on', 'over', 'with', 'once', 'when', 'after', 'while', 'before', 'as', 'for', 'at']);
/** Adverbs that may sit in front of a verb without a comma ("Gently fold", "Then add"). */
const ADVERBS = new Set(['then', 'next', 'now', 'also', 'first', 'finally', 'meanwhile', 'again', 'afterwards', 'later', 'soon', 'just', 'quickly', 'immediately']);
/** After an ambiguous word, these make it an imperative verb after "and" or a comma. */
const STRICT_NEXT = new Set([
  'the', 'a', 'an', 'your', 'it', 'them', 'each', 'both', 'all', 'any', 'this', 'that', 'some', 'every',
  'lightly', 'generously', 'liberally', 'well', 'evenly', 'together', 'off',
]);
/** Same, at the start of a sentence or after an opener, where more objects are plausible. */
const START_NEXT = new Set([...STRICT_NEXT, 'with', 'to', 'for', 'on', 'in', 'over', 'into', 'until', 'completely', 'slightly', 'briefly', 'before', 'at', 'about', 'if', 'as', 'when', 'once']);
/** Words that never start an instruction, even if an unknown word follows. */
const NOT_VERB_START = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'there', 'here', 'it', 'its', 'they', 'their', 'he', 'she', 'we',
  'you', 'your', 'i', 'my', 'our', 'one', 'all', 'some', 'most', 'any', 'each', 'both', 'every', 'everything',
  'everyone', 'enough', 'about', 'yield', 'makes', 'serves', 'makes:', 'note', 'tip', 'and', 'or', 'but', 'so',
  'if', 'when', 'once', 'after', 'before', 'while', 'as', 'until', 'because', 'since', 'for', 'to', 'in', 'on', 'at',
]);
/** An unknown word followed by one of these, at the start of a sentence, is taken as a verb ("Nestle the meatballs"). */
const FALLBACK_NEXT = new Set(['the', 'a', 'an', 'in', 'into', 'onto', 'to', 'with', 'over', 'on', 'it', 'them', 'each', 'your', 'half', 'about', 'all', 'gently']);
/** After a comma, "cut into ..." is a description of the ingredient, not a new instruction. */
const CUT_DESCRIPTION_NEXT = new Set(['into', 'in', 'to', 'up', 'crosswise', 'lengthwise', 'lengthways', 'diagonally']);

const isLy = (w) => /^[a-z]{3,}ly$/.test(w) && !COOKING_VERBS.has(w) && !AMBIGUOUS_VERBS.has(w);
const isAdverb = (w) => ADVERBS.has(w) || isLy(w);
const startsNumber = (w) => /^[\d½¼¾⅓⅔⅛]/.test(w);

// ---------------------------------------------------------------------------------------------
// Tokens

/** Tokenize text[s, e): words, commas, semicolons, and whole parenthesis groups as single tokens. */
function tokenize(text, s, e) {
  const toks = [];
  let i = s;
  while (i < e) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let depth = 0;
      let j = i;
      for (; j < e; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) { j++; break; }
      }
      toks.push({ type: 'paren', start: i, end: Math.min(j, e) });
      i = Math.min(j, e);
    } else if (c === ',' || c === ';') {
      toks.push({ type: c === ',' ? 'comma' : 'semi', start: i, end: i + 1 });
      i++;
    } else {
      let j = i;
      while (j < e && !/\s/.test(text[j]) && text[j] !== ';' && text[j] !== '(') {
        if (text[j] === ',' && !(/\d/.test(text[j - 1] ?? '') && /\d/.test(text[j + 1] ?? ''))) break;
        j++;
      }
      const raw = text.slice(i, j);
      const lower = raw.toLowerCase().replace(/^["'“‘]+/, '').replace(/[.!?:"'”’)]+$/, '');
      toks.push({ type: 'word', start: i, end: j, lower });
      i = j;
    }
  }
  return toks;
}

// ---------------------------------------------------------------------------------------------
// Verb detection

/**
 * Is T[j] a cooking verb in imperative position?
 * ctx 'start': first word of a clause; 'strict': after "and" or a comma (ambiguous words need an object).
 */
function verbAt(T, j, ctx) {
  const t = T[j];
  if (!t || t.type !== 'word') return false;
  const w = t.lower;
  if (COOKING_VERBS.has(w)) return true;
  if (!AMBIGUOUS_VERBS.has(w)) return false;
  const nx = T[j + 1];
  if (!nx) return ctx === 'start';
  if (nx.type !== 'word') return false;
  const nl = nx.lower;
  const set = ctx === 'start' ? START_NEXT : STRICT_NEXT;
  if (set.has(nl) || isLy(nl) || startsNumber(nl)) return true;
  if (w === 'dust' && nl === 'with') return true;
  if (nl === 'and') return verbAt(T, j + 2, 'strict');
  return false;
}

/** A sentence-initial word we do not know that is followed by an object-like word. */
function unknownVerbAt(T, j) {
  const t = T[j];
  if (!t || t.type !== 'word') return false;
  const w = t.lower;
  if (!/^[a-z][a-z-]*$/.test(w) || NOT_VERB_START.has(w) || w.endsWith('ing') || w.endsWith('ly')) return false;
  if (w.endsWith('s') && !w.endsWith('ss')) return false;
  const nx = T[j + 1];
  if (!nx || nx.type !== 'word') return false;
  return FALLBACK_NEXT.has(nx.lower) || startsNumber(nx.lower) || isLy(nx.lower);
}

/** Verb directly at i, skipping leading adverbs: used after an opener's comma and for "and"/comma splits. */
function directVerb(T, i, ctx, allowUnknown) {
  let j = i;
  while (T[j] && T[j].type === 'word' && isAdverb(T[j].lower) && !verbAt(T, j, ctx)) j++;
  if (verbAt(T, j, ctx)) return j;
  if (allowUnknown && unknownVerbAt(T, j)) return j;
  return -1;
}

/**
 * Index of the verb that makes the clause starting at i an instruction, or -1.
 * Skips adverbs and an opening adverbial ("In a medium bowl,", "Once the oil is hot,").
 */
function findVerb(T, i) {
  let j = i;
  for (;;) {
    const t = T[j];
    if (!t) return -1;
    if (t.type === 'comma') { j++; continue; }
    if (t.type !== 'word') return -1;
    const w = t.lower;
    if (verbAt(T, j, 'start')) return j;
    if (isAdverb(w) && !OPENERS.has(w)) { j++; continue; }
    if (OPENERS.has(w)) {
      let sawComma = false;
      for (let c = j + 1; c < T.length; c++) {
        const u = T[c];
        if (u.type === 'semi' || (u.type === 'word' && u.lower === 'then')) break;
        if (u.type === 'comma') {
          sawComma = true;
          const v = directVerb(T, c + 1, 'start', true);
          if (v >= 0) return v;
        }
      }
      if (!sawComma && COMMALESS_OPENERS.has(w)) {
        for (let c = j + 1; c < T.length; c++) {
          const u = T[c];
          if (u.type === 'semi' || (u.type === 'word' && u.lower === 'then')) break;
          if (u.type === 'word' && COOKING_VERBS.has(u.lower)) return c;
        }
      }
      if (w === 'then' || ADVERBS.has(w)) { j++; continue; }
      return -1;
    }
    return unknownVerbAt(T, j) ? j : -1;
  }
}

// ---------------------------------------------------------------------------------------------
// Clauses

/** Cut one sentence's tokens into clauses: [{a, b, instr}] with token ranges [a, b). */
function splitClauses(T) {
  const n = T.length;
  const clauses = [];
  let cs = 0;
  let v = findVerb(T, 0);
  let instr = v >= 0;
  let inUntil = false;
  let k = instr ? v + 1 : 0;

  const close = (e, next) => {
    if (e > cs) clauses.push({ a: cs, b: e, instr });
    cs = next;
    v = findVerb(T, cs);
    instr = v >= 0;
    inUntil = false;
    k = instr ? v + 1 : cs;
  };

  while (k < n) {
    const t = T[k];
    if (t.type === 'semi') { close(k, k + 1); continue; }
    if (t.type === 'word') {
      const w = t.lower;
      if (w === 'until' || w === 'till') { inUntil = true; k++; continue; }
      if (w === 'then' && k > cs) {
        if (findVerb(T, k + 1) >= 0) {
          let e = k;
          while (e > cs && (T[e - 1].type === 'comma' || T[e - 1].lower === 'and')) e--;
          close(e, k + 1);
          continue;
        }
      }
      // Inside an "until" clause "and" joins conditions; ", and <verb>" after it starts the next instruction.
      const afterComma = T[k - 1] && T[k - 1].type === 'comma';
      if (w === 'and' && k > cs && (!inUntil || afterComma) && !(T[k + 1] && T[k + 1].lower === 'then')) {
        if (directVerb(T, k + 1, 'strict', false) >= 0) {
          let e = k;
          if (T[e - 1] && T[e - 1].type === 'comma') e--;
          close(e, k + 1);
          continue;
        }
      }
    } else if (t.type === 'comma' && k > cs && !(T[k + 1] && T[k + 1].lower === 'then')) {
      const j = directVerb(T, k + 1, 'strict', false);
      if (j >= 0) {
        const w = T[j].lower;
        const nx = T[j + 1];
        const description = w === 'cut' && nx && nx.type === 'word' && CUT_DESCRIPTION_NEXT.has(nx.lower);
        const untilOk = !inUntil || (COOKING_VERBS.has(w) && nx && nx.type === 'word' && nx.lower !== 'and');
        if (!description && untilOk) { close(k, k + 1); continue; }
      }
    }
    k++;
  }
  if (n > cs) clauses.push({ a: cs, b: n, instr });
  return clauses;
}

// ---------------------------------------------------------------------------------------------
// Text assembly

/** Remove parenthesis groups from raw text; returns the rest and the groups' inner text. */
function stripParens(raw) {
  let out = '';
  const notes = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '(') {
      if (depth++ === 0) { out += raw.slice(from, i); from = i + 1; }
    } else if (raw[i] === ')' && depth > 0 && --depth === 0) {
      const inner = raw.slice(from, i).trim();
      if (inner) notes.push(inner);
      from = i + 1;
    }
  }
  out += depth > 0 ? '' : raw.slice(from);
  return { text: out, notes };
}

function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/\s+([,;.!?])/g, '$1').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
}

function actionText(clean) {
  let t = tidy(clean).replace(/[.!?]+$/, '').replace(/[\s,;:]+$/, '');
  if (!t) return '';
  t = t.replace(/[A-Za-zÀ-ɏ]/, (c) => c.toUpperCase());
  return `${t}.`;
}

function untilCue(text) {
  const m = /\b(?:until|till)\s+(.*)$/i.exec(text);
  if (!m) return undefined;
  let rest = m[1];
  const lead = /^\s*(?:until|till)\b/i.test(text);
  const cut = lead
    ? rest.indexOf(',')
    : rest.search(/,\s+(?:(?:about|around|roughly|approximately|approx\.?)\b|[a-z]+ing\b)/i);
  if (cut >= 0) rest = rest.slice(0, cut);
  rest = rest.replace(/[\s,;.!?]+$/, '').trim();
  return rest || undefined;
}

function noteText(raw) {
  let t = tidy(raw);
  const whole = stripParens(t);
  if (/^\(.*\)$/.test(t) && !whole.text.trim()) t = t.slice(1, -1).trim();
  return t;
}

// ---------------------------------------------------------------------------------------------

/**
 * Stage 2: split steps into single actions.
 * @param {string[]} steps  One entry per recipe step, leading numbers removed.
 * @returns {{actions: import('./types.js').Action[], flags: import('./types.js').Flag[]}}
 */
export function splitSteps(steps) {
  const actions = [];
  const flags = [];
  let pending = []; // notes that come before the first action of their step
  let stepHasAction = false;

  const addNote = (text) => {
    if (!text) return;
    if (stepHasAction) actions[actions.length - 1].notes.push(text);
    else pending.push(text);
  };

  steps.forEach((step, si) => {
    const text = String(step ?? '');
    stepHasAction = false;
    for (const sent of splitSentences(text)) {
      const T = tokenize(text, sent.start, sent.end);
      const clauses = splitClauses(T);
      if (!clauses.some((c) => c.instr)) {
        addNote(noteText(text.slice(sent.start, sent.end)));
        continue;
      }
      for (const c of clauses) {
        const a = T[c.a].start;
        const b = c.b === T.length ? sent.end : T[c.b - 1].end;
        const raw = text.slice(a, b);
        if (!c.instr) { addNote(noteText(raw)); continue; }
        const { text: stripped, notes } = stripParens(raw);
        const clean = tidy(stripped);
        const actionStr = actionText(clean);
        if (!actionStr) continue;
        const minutes = parseDuration(clean) ?? parseDuration(notes.join(' '));
        const until = untilCue(clean);
        const action = {
          id: `a${actions.length + 1}`,
          text: actionStr,
          original: { step: si + 1, start: sent.start, end: sent.end },
          uses: [],
          kind: 'hands-on',
          notes: [...pending, ...notes],
          meanwhile: [],
        };
        pending = [];
        stepHasAction = true;
        if (minutes) action.minutes = minutes;
        if (until) action.until = until;
        actions.push(action);
      }
    }
    // A step with no instruction at all: its sentences go to the previous action, or wait for the next one.
    if (!stepHasAction && pending.length && actions.length) {
      actions[actions.length - 1].notes.push(...pending);
      pending = [];
    }
  });
  return { actions, flags };
}
