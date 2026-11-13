/**
 * Cooking-verb lexicon shared by the engine stages (step splitter first; prep and waiting-window
 * detection reuse it). All entries are lowercase base (imperative) forms; -ing, -ed and -s forms
 * are deliberately absent, so participle clauses ("stirring occasionally") never look like verbs.
 */

/** Verbs that are rarely anything else, so a clause may start with them. */
export const COOKING_VERBS = new Set([
  'add', 'adjust', 'allow', 'arrange', 'bake', 'baste', 'beat', 'blanch', 'blend', 'blitz', 'boil',
  'braise', 'bring', 'broil', 'brown', 'brush', 'caramelize', 'carve', 'char', 'check', 'chill',
  'chop', 'clean', 'coat', 'combine', 'continue', 'cook', 'core', 'cover', 'crack', 'crimp',
  'crisp', 'crumble', 'crush', 'cube', 'cut', 'deep-fry', 'deglaze', 'devein', 'dip', 'discard',
  'dish', 'dissolve', 'divide', 'dot', 'drain', 'drizzle', 'drop', 'emulsify', 'enjoy', 'fill',
  'finish', 'flatten', 'flip', 'fluff', 'fold', 'form', 'freeze', 'fry', 'garnish', 'gather',
  'glaze', 'grate', 'grease', 'grill', 'grind', 'halve', 'heat', 'hold', 'hull', 'incorporate',
  'insert', 'julienne', 'keep', 'knead', 'ladle', 'layer', 'let', 'lift', 'line', 'lower',
  'marinate', 'mash', 'measure', 'melt', 'microwave', 'mince', 'mix', 'mold', 'nestle', 'open',
  'pan-fry', 'pat', 'peel', 'pierce', 'pile', 'pit', 'place', 'plate', 'pound', 'pour', 'preheat',
  'press', 'proof', 'pulse', 'puree', 'purée', 'push', 'put', 'quarter', 'reduce', 'refrigerate',
  'reheat', 'remove', 'repeat', 'reserve', 'rest', 'return', 'rinse', 'rise', 'roast', 'roll',
  'rub', 'sauté', 'saute', 'scatter', 'scoop', 'score', 'scrape', 'scrub', 'seal', 'sear', 'season',
  'seed', 'separate', 'serve', 'set', 'shake', 'shape', 'shave', 'shred', 'sift', 'simmer', 'skim',
  'slice', 'smash', 'snip', 'soak', 'soften', 'spoon', 'spread', 'sprinkle', 'squeeze', 'stack',
  'stand', 'steam', 'steep', 'stem', 'stir', 'stir-fry', 'strain', 'stuff', 'submerge', 'sweat',
  'swirl', 'taste', 'tear', 'tent', 'thaw', 'thicken', 'tilt', 'toast', 'top', 'toss', 'transfer',
  'trim', 'try', 'turn', 'uncover', 'unmold', 'wait', 'wash', 'whip', 'whisk', 'wipe', 'wrap',
  // Found missing in real recipes: an instruction that starts with one of these was filed as a note.
  'begin', 'dredge', 'drape', 'grab', 'move', 'plunge', 'prick', 'punch', 'run', 'scald', 'slash', 'start', 'stop', 'tuck',
]);

/**
 * Words that are also common nouns or adjectives in recipes. Only a verb at the start of a clause
 * in imperative position: the word after it must look like an object ("Salt the water",
 * "Dust with flour", "Oil a pan"), never "and" + noun, a comma or the end of the clause.
 */
export const AMBIGUOUS_VERBS = new Set([
  'butter', 'cool', 'cream', 'dice', 'dry', 'dust', 'flour', 'juice', 'oil', 'pepper', 'pinch',
  'salt', 'warm', 'zest',
]);

/** Verbs after which a dish is waiting (SPEC, "6. Waiting windows"). */
export const WAITING_VERBS = new Set([
  'simmer', 'bake', 'roast', 'boil', 'rest', 'marinate', 'chill', 'brown', 'reduce', 'soak', 'rise',
]);

const lc = (w) => String(w).toLowerCase();

/** True for any verb in the lexicon, clear or ambiguous. */
export function isCookingVerb(word) {
  const w = lc(word);
  return COOKING_VERBS.has(w) || AMBIGUOUS_VERBS.has(w);
}

/** True for a word that may be a noun or modifier (so it needs imperative position to count). */
export function isAmbiguousVerb(word) {
  return AMBIGUOUS_VERBS.has(lc(word));
}

/** True for a waiting-list verb. */
export function isWaitingVerb(word) {
  return WAITING_VERBS.has(lc(word));
}
