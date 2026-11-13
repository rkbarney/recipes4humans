/**
 * Stage 3 (matching) tests: one group per bullet of SPEC "3. Matching" and per matching decision.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matched, flagCodes } from './helpers/engine.js';

const names = (r) => r.mentions.map((m) => r.ingredients.find((i) => i.id === m.ingredientId).name);
const on = (r, id) => r.mentions.filter((m) => m.actionId === id);

describe('spec 3: head noun, longest name first', () => {
  it('matches the full head, then the last word of the head ("broth" for "chicken broth")', () => {
    const r = matched(['4 cups chicken broth', '1 cup olive oil'], ['Pour in the broth and the oil.']);
    assert.deepEqual(names(r), ['chicken broth', 'olive oil']);
  });
  it('tries "red-pepper flakes" before "pepper" and consumes its text, so it is one mention', () => {
    const r = matched(['½ teaspoon red-pepper flakes', 'Black pepper'], ['Add the red-pepper flakes.']);
    assert.deepEqual(names(r), ['red-pepper flakes']);
    assert.equal(r.mentions.length, 1);
    assert.deepEqual(flagCodes(r.flags), ['unused-ingredient'], 'black pepper is the only thing left over');
  });
  it('matches simple plurals both ways', () => {
    assert.deepEqual(names(matched(['3 tomatoes'], ['Add the tomato.'])), ['tomatoes']);
    assert.deepEqual(names(matched(['1 egg'], ['Crack the eggs.'])), ['egg']);
  });
  it('matches any of the alternates ("chicken or turkey")', () => {
    const r = matched(['1 pound ground chicken or turkey'], ['Brown the turkey.']);
    assert.equal(r.mentions.length, 1);
  });
  it('falls back to another word of the name, exactly as written ("the chicken" for "chicken thighs")', () => {
    assert.deepEqual(names(matched(['6 bone-in chicken thighs'], ['Rub the chicken with oil.'])), ['bone-in chicken thighs']);
    assert.deepEqual(names(matched(['Fresh basil leaves, for serving'], ['Garnish with the basil.'])), ['Fresh basil leaves']);
  });
  it('does not let "beef" stand for "beef broth", nor "garlic" for "garlic powder"', () => {
    const r = matched(['2 pounds beef chuck roast', '2 cups beef broth', '1 teaspoon garlic powder'], ['Brown the beef.', 'Add the garlic.']);
    assert.deepEqual(names(r), ['beef chuck roast']);
    assert.ok(flagCodes(r.flags).includes('unused-ingredient'));
  });
  it('does not take a colour word of a hyphenated name for the ingredient ("red onion" is not red-pepper flakes)', () => {
    const r = matched(['1 teaspoon red-pepper flakes', '1 red onion'], ['Add the red onion.']);
    assert.deepEqual(names(r), ['red onion']);
  });
  it('records offsets into the action text', () => {
    const r = matched(['1 tablespoon cumin'], ['Add the cumin now.']);
    const m = r.mentions[0];
    assert.equal(r.actions[0].text.slice(m.start, m.end), 'cumin');
  });
  it('a verb at the start of the action is not an ingredient: "Oil the pan"', () => {
    const r = matched(['2 tablespoons olive oil', '1 tablespoon butter'], ['Oil the pan. Butter the dish.']);
    assert.deepEqual(r.mentions, []);
    assert.deepEqual(flagCodes(r.flags), [], 'the ingredients are used, so they are not reported as unused');
  });
});

describe('matching decisions: two ingredients for one word', () => {
  it('flags "sugar" when sugar and brown sugar are both listed, and inserts nothing', () => {
    const r = matched(['1 cup sugar', '1 cup brown sugar'], ['Stir in the sugar.']);
    assert.deepEqual(r.mentions, []);
    const f = r.flags.find((x) => x.code === 'ambiguous-ingredient');
    assert.ok(f);
    assert.equal(f.actionId, 'a1');
  });
  it('uses the distinguishing descriptor when the step has it ("brown sugar")', () => {
    const r = matched(['1 cup sugar', '1 cup brown sugar'], ['Stir in the brown sugar.']);
    assert.deepEqual(names(r), ['brown sugar']);
    assert.deepEqual(flagCodes(r.flags), ['unused-ingredient']);
  });
  it('flags "pepper" when black pepper and red-pepper flakes are both listed', () => {
    const r = matched(['Black pepper', '1 pinch red-pepper flakes'], ['Season with pepper.']);
    assert.deepEqual(r.mentions, []);
    assert.ok(r.flags.some((f) => f.code === 'ambiguous-ingredient'));
  });
  it('resolves "black pepper" by its descriptor in the same recipe', () => {
    const r = matched(['Black pepper', '1 pinch red-pepper flakes'], ['Top with black pepper and red-pepper flakes.']);
    assert.deepEqual(names(r), ['Black pepper', 'red-pepper flakes']);
    assert.ok(!flagCodes(r.flags).includes('ambiguous-ingredient'));
  });
  it('flags a head shared as last word ("pepper" for bell pepper and black pepper)', () => {
    const r = matched(['1 bell pepper', 'Black pepper'], ['Add the pepper.']);
    assert.ok(r.flags.some((f) => f.code === 'ambiguous-ingredient'));
  });
  it('flags "milk" for milk and coconut milk', () => {
    const r = matched(['1 cup milk', '1 can coconut milk'], ['Add the milk.']);
    assert.ok(r.flags.some((f) => f.code === 'ambiguous-ingredient'));
    assert.equal(r.mentions.length, 0);
  });
});

describe('spec 3: things made earlier are not ingredients', () => {
  it('"the meatballs", "the sauce", "the dough", "the mixture", "the batter", "the marinade", "the dressing", "the filling"', () => {
    const r = matched(['1 cup soy sauce', '1 cup flour'], ['Add the meatballs. Pour in the sauce. Roll the dough. Stir the mixture. Pour the batter. Add the marinade, the dressing and the filling.']);
    assert.deepEqual(r.mentions, [], '"the sauce" is not soy sauce');
    assert.ok(!flagCodes(r.flags).includes('unknown-ingredient'), 'and it is not an unknown ingredient either');
  });
  it('still matches a full "soy sauce"', () => {
    assert.deepEqual(names(matched(['2 tablespoons soy sauce'], ['Add the soy sauce.'])), ['soy sauce']);
  });
  it('an ingredient named exactly that is an ingredient', () => {
    assert.deepEqual(names(matched(['1 cup dressing'], ['Add the dressing.'])), ['dressing']);
  });
  it('treats the name of an ingredient group as a made product ("For the dressing:")', () => {
    const r = matched(['For the dressing:', '2 tablespoons olive oil', 'For the salad:', '1 cup kale'], ['Toss the kale with the dressing.']);
    assert.deepEqual(names(r), ['kale']);
  });
  it('but a group named for its own ingredient keeps that ingredient ("For the noodles: rice noodles")', () => {
    const r = matched(['For the noodles:', '8 ounces rice noodles'], ['Boil the noodles.']);
    assert.deepEqual(names(r), ['rice noodles']);
  });
});

describe('spec 3: collective words', () => {
  it('records a collective word and flags it, with no mention', () => {
    const r = matched(['1 teaspoon cumin'], ['Add the spices.']);
    assert.deepEqual(r.collective, [{ actionId: 'a1', word: 'spices' }]);
    assert.deepEqual(r.mentions, []);
    assert.ok(flagCodes(r.flags).includes('collective-word'));
  });
  it('knows "dry ingredients" and "seasonings"', () => {
    const r = matched(['1 cup flour'], ['Whisk the dry ingredients. Add the seasonings.']);
    assert.deepEqual(r.collective.map((c) => c.word), ['dry ingredients', 'seasonings']);
  });
  it('an ingredient literally named "herbs" is matched, not flagged', () => {
    const r = matched(['2 tablespoons herbs'], ['Add the herbs.']);
    assert.equal(r.mentions.length, 1);
    assert.deepEqual(r.collective, []);
  });
});

describe('spec 3 and decisions: an amount already in the step', () => {
  it('records a stated amount ("¼ cup oats", "1 teaspoon salt")', () => {
    const r = matched(['¾ cup oats, divided', 'Salt'], ['Add ¼ cup oats and 1 teaspoon salt.']);
    assert.deepEqual(r.mentions.map((m) => m.stated.qty), [0.25, 1]);
    assert.equal(r.mentions[0].stated.unit, 'cup');
    assert.equal(r.mentions[1].stated.unit, 'tsp');
  });
  it('reads "the remaining ½ cup oats" as a stated amount with the quantifier "remaining"', () => {
    const r = matched(['¾ cup oats'], ['Add the remaining ½ cup oats.']);
    assert.equal(r.mentions[0].quantifier, 'remaining');
    assert.deepEqual([r.mentions[0].stated.qty, r.mentions[0].stated.unit], [0.5, 'cup']);
  });
  it('reads "5 ounces of the cheddar" as stated', () => {
    const r = matched(['6 ounces cheddar'], ['Stir in 5 ounces of the cheddar.']);
    assert.deepEqual([r.mentions[0].stated.qty, r.mentions[0].stated.unit], [5, 'oz']);
  });
  it('"a lemon" is left alone: unsure, not a stated amount to compare with the total', () => {
    const m = matched(['2 lemons'], ['Cut a lemon in half.']).mentions[0];
    assert.equal(m.unsure, true);
    assert.equal(m.stated, undefined);
  });
  it('a number the engine cannot read as an amount for this noun makes the mention unsure ("2 more tablespoons butter", "a pot of water", "a can of beans")', () => {
    assert.equal(matched(['4 tablespoons butter'], ['Add 2 more tablespoons butter.']).mentions[0].unsure, true, 'conservative: no amount is inserted');
    assert.equal(matched(['2 cups water'], ['Bring a pot of water to a boil.']).mentions[0].unsure, true);
    assert.equal(matched(['1 can beans'], ['Add a can of beans.']).mentions[0].unsure, true);
  });
});

describe('spec 3 and decisions: prep words next to the mention', () => {
  it('records a prep word before the noun ("the grated onion")', () => {
    const r = matched(['1 onion (½ diced, ½ grated)'], ['Add the grated onion.']);
    assert.equal(r.mentions[0].prepWord, 'grated');
  });
  it('maps derived nouns: "lemon juice" is juiced, "lemon wedges" is wedges', () => {
    const r = matched(['2 lemons (1 juiced, 1 cut into wedges)'], ['Stir in the lemon juice. Serve with lemon wedges.']);
    assert.deepEqual(r.mentions.map((m) => m.derived), ['juiced', 'wedges']);
  });
  it('a derived noun that is part of the ingredient name is not derived ("lemon juice" listed as an ingredient)', () => {
    const r = matched(['2 tablespoons lemon juice'], ['Stir in the lemon juice.']);
    assert.equal(r.mentions[0].derived, undefined);
  });
  it('ignores a prep word the ingredient has no portion for', () => {
    const r = matched(['1 onion'], ['Add the chopped onion.']);
    assert.equal(r.mentions[0].prepWord, undefined);
  });
  it('"the egg whites" is a part of the ingredient', () => {
    assert.equal(matched(['4 eggs'], ['Whip the egg whites.']).mentions[0].derived, 'part');
  });
  it('puts the start of the noun phrase in front of its descriptors ("ground turmeric")', () => {
    const r = matched(['1 tablespoon ground turmeric'], ['Add the ground turmeric.']);
    const m = r.mentions[0];
    assert.equal(r.actions[0].text.slice(m.lead, m.end), 'ground turmeric');
    assert.equal(r.actions[0].text.slice(m.article.start, m.article.end), 'the ');
  });
});

describe('spec 3 and decisions: quantifiers, until clauses, notes, seasoning, serving', () => {
  const q = (step, line = '4 tablespoons butter') => matched([line], [step]).mentions[0];
  it('reads remaining, the rest of, most of, half, a third, some, more', () => {
    assert.equal(q('Add the remaining butter.').quantifier, 'remaining');
    assert.equal(q('Add the rest of the butter.').quantifier, 'rest');
    assert.equal(q('Add most of the butter.').quantifier, 'most');
    const half = q('Add half the butter.');
    assert.deepEqual([half.quantifier, half.fraction], ['half', 0.5]);
    assert.equal(q('Add a third of the butter.').fraction, 1 / 3);
    assert.equal(q('Add some of the butter.').quantifier, 'some');
    assert.equal(q('Add a little butter.').quantifier, 'some');
    assert.equal(q('Add more butter.').quantifier, 'more');
  });
  it('marks a mention inside an "until" clause and does not look at notes', () => {
    const r = matched(['1 cup oats', '1 cup broth'], ['Simmer until the oats have softened (the broth should reduce).']);
    assert.equal(on(r, 'a1').length, 1);
    assert.equal(on(r, 'a1')[0].inUntil, true);
    assert.deepEqual(names(r), ['oats'], 'the note mentions broth, which is not scanned');
  });
  it('marks seasoning uses', () => {
    assert.equal(matched(['Salt'], ['Season with salt.']).mentions[0].seasoning, true);
    assert.equal(matched(['Salt'], ['Add salt to taste.']).mentions[0].seasoning, true);
    assert.equal(matched(['Salt'], ['Stir in the salt.']).mentions[0].seasoning, undefined);
  });
  it('marks serving and garnish context', () => {
    assert.equal(matched(['Parsley'], ['Sprinkle with the parsley.']).mentions[0].serving, true);
    assert.equal(matched(['Parsley'], ['Chop the parsley.']).mentions[0].serving, undefined);
  });
});

describe('flags from stage 3', () => {
  it('unused-ingredient: listed but never named', () => {
    const r = matched(['1 cup rice', '1 cup saffron'], ['Cook the rice.']);
    const f = r.flags.filter((x) => x.code === 'unused-ingredient');
    assert.equal(f.length, 1);
    assert.equal(f[0].ingredientId, 'i2');
  });
  it('unknown-ingredient: added in a step but not listed', () => {
    const r = matched(['1 cup rice'], ['Add the rice and the cream.']);
    const f = r.flags.find((x) => x.code === 'unknown-ingredient');
    assert.ok(f);
    assert.match(f.message, /cream/);
  });
  it('does not call water, a pronoun or equipment unknown', () => {
    const r = matched(['1 cup rice'], ['Add water to the pot. Add the rice. Stir in it.']);
    assert.ok(!flagCodes(r.flags).includes('unknown-ingredient'));
  });
  it('is deterministic and does not change its input', () => {
    const a = matched(['1 cup rice', '2 tablespoons butter'], ['Add the rice and butter.']);
    const before = JSON.stringify([a.ingredients, a.actions]);
    const again = matched(['1 cup rice', '2 tablespoons butter'], ['Add the rice and butter.']);
    assert.deepEqual(a.mentions, again.mentions);
    assert.equal(JSON.stringify([a.ingredients, a.actions]), before);
  });
});
