/**
 * Stage 2 (step splitter) tests: one group per bullet of SPEC "2. Step splitting", plus the helpers
 * and a count check against every fixture.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { splitSteps } from '../js/engine/steps.js';
import { splitSentences } from '../js/engine/steps-sentences.js';
import { parseDuration } from '../js/engine/steps-duration.js';
import { isCookingVerb, isAmbiguousVerb, isWaitingVerb } from '../js/engine/verbs.js';
import { golden, patterns, splitInput } from './helpers/fixtures.js';

const texts = (step) => splitSteps(Array.isArray(step) ? step : [step]).actions.map((a) => a.text);
const sentences = (s) => splitSentences(s).map((x) => s.slice(x.start, x.end));

describe('sentence splitting', () => {
  it('splits plain sentences', () => {
    assert.deepEqual(sentences('Heat the oil. Add the onion! Stir well.'), ['Heat the oil.', 'Add the onion!', 'Stir well.']);
  });
  it('protects fractions, mixed numbers and decimals', () => {
    assert.deepEqual(sentences('Add 1 ½ cups milk and 1/2 tsp salt. Stir in 1.5 cups flour.'), ['Add 1 ½ cups milk and 1/2 tsp salt.', 'Stir in 1.5 cups flour.']);
    assert.deepEqual(sentences('Shape into 25 balls, 1½ inches each. Chill.'), ['Shape into 25 balls, 1½ inches each.', 'Chill.']);
  });
  it('protects abbreviations', () => {
    assert.deepEqual(sentences('Add approx. 2 tbsp. butter and 8 oz. chocolate. Melt.'), ['Add approx. 2 tbsp. butter and 8 oz. chocolate.', 'Melt.']);
    assert.deepEqual(sentences('Add 1 lb. ground beef. Stir.'), ['Add 1 lb. ground beef.', 'Stir.']);
    assert.deepEqual(sentences('Use a No. 2 pan. Heat it.'), ['Use a No. 2 pan.', 'Heat it.']);
    assert.deepEqual(sentences('Cook for 5 min. then stir.'), ['Cook for 5 min. then stir.']);
  });
  it('lets a unit abbreviation end a sentence only before a capital letter', () => {
    assert.deepEqual(sentences('Cook 5 min. Stir.'), ['Cook 5 min.', 'Stir.']);
  });
  it('protects temperatures', () => {
    assert.deepEqual(sentences('Bake at 350°F. for 20 minutes. Cool.'), ['Bake at 350°F. for 20 minutes.', 'Cool.']);
    assert.deepEqual(sentences('Heat to 180°C. Add the oil.'), ['Heat to 180°C.', 'Add the oil.']);
    assert.deepEqual(sentences('Preheat to 350 F. Bake.'), ['Preheat to 350 F.', 'Bake.']);
  });
  it('does not end a sentence inside parentheses', () => {
    assert.deepEqual(sentences('Stir (this takes 2 min. or so) and wait. Serve.'), ['Stir (this takes 2 min. or so) and wait.', 'Serve.']);
    assert.deepEqual(sentences('Stir (about 5 min. Keep going.) Serve.'), ['Stir (about 5 min. Keep going.)', 'Serve.']);
    assert.deepEqual(sentences('Stir (about 5 min. Keep going.), then serve.'), ['Stir (about 5 min. Keep going.), then serve.']);
  });
  it('trims whitespace and handles text without a final period', () => {
    const s = '  Mix well.   Serve  ';
    assert.deepEqual(splitSentences(s).map((x) => s.slice(x.start, x.end)), ['Mix well.', 'Serve']);
    assert.deepEqual(splitSentences('   '), []);
  });
});

describe('splitting inside a sentence', () => {
  it('splits at ", then"', () => {
    assert.deepEqual(texts('Bring to a boil, then reduce the heat.'), ['Bring to a boil.', 'Reduce the heat.']);
  });
  it('splits at " then " at a clause start and at "and then"', () => {
    assert.deepEqual(texts('Whisk the eggs then pour in the milk.'), ['Whisk the eggs.', 'Pour in the milk.']);
    assert.deepEqual(texts('Stir the sauce and then add the cream.'), ['Stir the sauce.', 'Add the cream.']);
    assert.deepEqual(texts('Stir the sauce, and then add the cream.'), ['Stir the sauce.', 'Add the cream.']);
  });
  it('does not split "then" that is not followed by an instruction', () => {
    assert.deepEqual(texts('Simmer until thick, then it is done.'), ['Simmer until thick, then it is done.']);
  });
  it('splits at a semicolon', () => {
    assert.deepEqual(texts('Add the onion; cook 4 minutes.'), ['Add the onion.', 'Cook 4 minutes.']);
  });
  it('splits at "and" or ", and" before a cooking verb', () => {
    assert.deepEqual(texts('Drain and toss with the sauce.'), ['Drain.', 'Toss with the sauce.']);
    assert.deepEqual(texts('Heat the oil over medium, and add the onion.'), ['Heat the oil over medium.', 'Add the onion.']);
    assert.deepEqual(texts('Add the spices and stir for 1 minute.'), ['Add the spices.', 'Stir for 1 minute.']);
  });
  it('allows an adverb between "and" and the verb', () => {
    assert.deepEqual(texts('Add the cream and gently fold in the cheese.'), ['Add the cream.', 'Gently fold in the cheese.']);
  });
  it('makes each verb-led clause of a comma list its own action', () => {
    assert.deepEqual(texts('Add the onion, season with salt, and cook 2 minutes.'), ['Add the onion.', 'Season with salt.', 'Cook 2 minutes.']);
    assert.deepEqual(texts('Drain the pasta, reserve 1 cup of the water, return it to the pot.'), ['Drain the pasta.', 'Reserve 1 cup of the water.', 'Return it to the pot.']);
  });
  it('handles clauses in any mix of the separators', () => {
    assert.deepEqual(
      texts('Add the garlic, paprika and cumin, stir for 30 seconds, then pour in the broth; bring to a simmer and cook 10 minutes.'),
      ['Add the garlic, paprika and cumin.', 'Stir for 30 seconds.', 'Pour in the broth.', 'Bring to a simmer.', 'Cook 10 minutes.'],
    );
  });
  it('does not split a separator inside parentheses', () => {
    assert.deepEqual(texts('Add the rice (rinsed; then drained) and cook.'), ['Add the rice.', 'Cook.']);
  });
});

describe('not splitting', () => {
  it('keeps "and" that joins nouns or adjectives', () => {
    assert.deepEqual(texts('Season with salt and pepper.'), ['Season with salt and pepper.']);
    assert.deepEqual(texts('Cook until golden and crisp.'), ['Cook until golden and crisp.']);
    assert.deepEqual(texts('Stir in the cumin and salt.'), ['Stir in the cumin and salt.']);
    assert.deepEqual(texts('Stir the cornstarch into the water and the soy sauce.'), ['Stir the cornstarch into the water and the soy sauce.']);
    assert.deepEqual(texts('Whisk the flour, sugar, baking powder and salt in a large bowl.'), ['Whisk the flour, sugar, baking powder and salt in a large bowl.']);
    assert.deepEqual(texts('Mix the butter and cream.'), ['Mix the butter and cream.']);
  });
  it('keeps everything inside an "until" clause', () => {
    assert.deepEqual(texts('Simmer until the oats have softened and the meatballs are cooked through.'), ['Simmer until the oats have softened and the meatballs are cooked through.']);
    assert.deepEqual(texts('Cook until the onions soften and brown.'), ['Cook until the onions soften and brown.']);
    assert.deepEqual(texts('Bake until the skin is crisp and the juices run clear.'), ['Bake until the skin is crisp and the juices run clear.']);
  });
  it('splits at ", and <verb>" after an until clause, but not at a plain "and" inside it', () => {
    assert.deepEqual(texts('Pour in the milk, whisking until smooth, and simmer until thickened, about 5 minutes.'),
      ['Pour in the milk, whisking until smooth.', 'Simmer until thickened, about 5 minutes.']);
    assert.deepEqual(texts('Cook until golden and crisp, and serve.'), ['Cook until golden and crisp.', 'Serve.']);
    assert.deepEqual(texts('Simmer until the oats have softened, and the meatballs are cooked through.'), ['Simmer until the oats have softened, and the meatballs are cooked through.']);
  });
  it('splits at ", then" and after the until clause ends', () => {
    assert.deepEqual(texts('Simmer until thick, then stir in the cream.'), ['Simmer until thick.', 'Stir in the cream.']);
    assert.deepEqual(texts('Cook until soft, stir in the garlic.'), ['Cook until soft.', 'Stir in the garlic.']);
  });
  it('keeps participle clauses with their action', () => {
    assert.deepEqual(texts('Simmer 20 minutes, stirring occasionally.'), ['Simmer 20 minutes, stirring occasionally.']);
    assert.deepEqual(texts('Nestle the meatballs in the pot, pushing the onions to the sides.'), ['Nestle the meatballs in the pot, pushing the onions to the sides.']);
    assert.deepEqual(texts('Pour in the broth, tilting the pot to distribute it.'), ['Pour in the broth, tilting the pot to distribute it.']);
  });
  it('keeps heat levels, "about N minutes" and "stirring" attached', () => {
    assert.deepEqual(texts('Cook over medium-high heat for about 5 minutes, stirring often.'), ['Cook over medium-high heat for about 5 minutes, stirring often.']);
  });
  it('does not treat noun uses of verb-like words as verbs', () => {
    assert.deepEqual(texts('Reserve the cooking liquid and cook the pasta.'), ['Reserve the cooking liquid.', 'Cook the pasta.']);
    assert.deepEqual(texts('Stir in a pinch of ground pepper.'), ['Stir in a pinch of ground pepper.']);
    assert.deepEqual(texts('Add the salt, pepper, oil and flour to the bowl.'), ['Add the salt, pepper, oil and flour to the bowl.']);
    assert.deepEqual(texts('Whisk in the zest, juice and cream.'), ['Whisk in the zest, juice and cream.']);
    assert.deepEqual(texts('Add the milk and dry ingredients.'), ['Add the milk and dry ingredients.']);
    assert.deepEqual(texts('Season to taste.'), ['Season to taste.']);
    assert.deepEqual(texts('Add the cumin and season to taste.'), ['Add the cumin.', 'Season to taste.']);
  });
  it('treats an ambiguous word as a verb only in imperative position', () => {
    assert.deepEqual(texts('Add the onions and salt the water.'), ['Add the onions.', 'Salt the water.']);
    assert.deepEqual(texts('Dust with flour.'), ['Dust with flour.']);
    assert.deepEqual(texts('Oil the pan and dice the onion.'), ['Oil the pan.', 'Dice the onion.']);
    assert.deepEqual(texts('Cut the potatoes, dice the onion.'), ['Cut the potatoes.', 'Dice the onion.']);
  });
  it('does not split ", cut into" after an ingredient', () => {
    assert.deepEqual(texts('Add the potatoes, cut into 1-inch cubes, and stir.'), ['Add the potatoes, cut into 1-inch cubes.', 'Stir.']);
  });
  it('exposes the lexicon', () => {
    assert.ok(isCookingVerb('Simmer') && isCookingVerb('salt'));
    assert.ok(isAmbiguousVerb('pepper') && !isAmbiguousVerb('simmer'));
    assert.ok(isWaitingVerb('bake') && !isWaitingVerb('stir'));
    assert.ok(!isCookingVerb('stirring') && !isCookingVerb('ground'));
  });
});

describe('opening adverbials', () => {
  it('keeps the adverbial with its action', () => {
    assert.deepEqual(texts('In a medium bowl, combine the flour and sugar.'), ['In a medium bowl, combine the flour and sugar.']);
    assert.deepEqual(texts('Meanwhile, heat the oil.'), ['Meanwhile, heat the oil.']);
    assert.deepEqual(texts('Once the oil is hot, add the onion.'), ['Once the oil is hot, add the onion.']);
    assert.deepEqual(texts('Working in batches, sear the steak.'), ['Working in batches, sear the steak.']);
    assert.deepEqual(texts('In a large, heavy pot, heat the oil.'), ['In a large, heavy pot, heat the oil.']);
    assert.deepEqual(texts('With wet hands, shape into 25 balls, 1½ inches each.'), ['With wet hands, shape into 25 balls, 1½ inches each.']);
  });
  it('still splits later clauses of the same sentence', () => {
    assert.deepEqual(texts('In a bowl, combine the flour and sugar, then add the eggs.'), ['In a bowl, combine the flour and sugar.', 'Add the eggs.']);
    assert.deepEqual(texts('Once the oil is hot, add the onion and cook 3 minutes.'), ['Once the oil is hot, add the onion.', 'Cook 3 minutes.']);
  });
  it('accepts an opener without a comma, and a leading adverb', () => {
    assert.deepEqual(texts('In a bowl combine the flour and sugar.'), ['In a bowl combine the flour and sugar.']);
    assert.deepEqual(texts('Gently fold in the cheese.'), ['Gently fold in the cheese.']);
  });
  it('a sentence that is only an adverbial clause is a note', () => {
    const { actions } = splitSteps(['Stir well. Meanwhile, the sauce will thicken.']);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].notes, ['Meanwhile, the sauce will thicken.']);
  });
});

describe('parentheses and notes', () => {
  it('moves a parenthesis to the notes of its action', () => {
    const { actions } = splitSteps(['Combine gently (hands work best) without overworking the meat.']);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].text, 'Combine gently without overworking the meat.');
    assert.deepEqual(actions[0].notes, ['hands work best']);
  });
  it('puts a parenthesis on the clause that contains it', () => {
    const { actions } = splitSteps(['Add the dill (reserve 2 tbsp), then stir (gently).']);
    assert.deepEqual(actions.map((a) => a.text), ['Add the dill.', 'Stir.']);
    assert.deepEqual(actions.map((a) => a.notes), [['reserve 2 tbsp'], ['gently']]);
  });
  it('appends an instruction-free sentence to the previous action', () => {
    const { actions } = splitSteps(['Shape into about 25 balls. You will have about 25 balls. This makes enough for four.']);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].notes, ['You will have about 25 balls.', 'This makes enough for four.']);
  });
  it('appends it across steps, and to the next action when there is no previous one', () => {
    const a = splitSteps(['Stir.', 'It will be thick.']).actions;
    assert.deepEqual(a[0].notes, ['It will be thick.']);
    const b = splitSteps(['Makes 4 servings.', 'Stir.']).actions;
    assert.equal(b.length, 1);
    assert.deepEqual(b[0].notes, ['Makes 4 servings.']);
  });
  it('a sentence before the first action of a step is a note on that action, not on the previous step', () => {
    const { actions } = splitSteps(['Stir the soup.', 'The pot will be hot. Add the salt.']);
    assert.deepEqual(actions.map((a) => a.text), ['Stir the soup.', 'Add the salt.']);
    assert.deepEqual(actions.map((a) => a.notes), [[], ['The pot will be hot.']]);
  });
  it('a step with no instruction at all adds its sentences to the previous action', () => {
    const { actions } = splitSteps(['Stir the soup.', 'It smells good. It will be hot.']);
    assert.equal(actions[0].notes[0], 'It smells good.');
  });
  it('turns an instruction-free clause after a semicolon into a note', () => {
    const { actions } = splitSteps(['Cook the rice; the water should be absorbed.']);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].notes, ['the water should be absorbed.']);
  });
  it('unwraps a sentence that is entirely parenthetical', () => {
    const { actions } = splitSteps(['Stir. (This takes a while.)']);
    assert.deepEqual(actions[0].notes, ['This takes a while.']);
  });
});

describe('wording and shape', () => {
  it('capitalises and ends each action with a period, keeping the recipe words', () => {
    assert.deepEqual(texts('crack the eggs in a bowl and whisk em with the milk'), ['Crack the eggs in a bowl.', 'Whisk em with the milk.']);
    assert.deepEqual(texts('Enjoy!'), ['Enjoy.']);
    assert.deepEqual(texts('Add the dill, tilting the pan'), ['Add the dill, tilting the pan.']);
  });
  it('numbers ids a1..aN in recipe order across steps', () => {
    const { actions, flags } = splitSteps(['Heat the oil. Add the onion.', 'Stir.']);
    assert.deepEqual(actions.map((a) => a.id), ['a1', 'a2', 'a3']);
    assert.deepEqual(actions.map((a) => a.original.step), [1, 1, 2]);
    assert.deepEqual(flags, []);
    for (const a of actions) {
      assert.equal(a.kind, 'hands-on');
      assert.deepEqual(a.uses, []);
      assert.deepEqual(a.meanwhile, []);
    }
  });
  it('is deterministic and handles empty input', () => {
    assert.deepEqual(splitSteps([]), { actions: [], flags: [] });
    assert.deepEqual(splitSteps(['', '   ']).actions, []);
    const s = ['Heat the oil, then add the onion and cook 2 minutes.'];
    assert.deepEqual(splitSteps(s), splitSteps(s));
  });
});

describe('durations', () => {
  const d = (s) => parseDuration(s);
  it('reads minutes, ranges and abbreviations', () => {
    assert.deepEqual(d('Cook 5 minutes'), [5, 5]);
    assert.deepEqual(d('Cook 5 to 7 minutes'), [5, 7]);
    assert.deepEqual(d('Cook 5-7 minutes'), [5, 7]);
    assert.deepEqual(d('Cook 5–7 min.'), [5, 7]);
    assert.deepEqual(d('Cook 3 min'), [3, 3]);
    assert.deepEqual(d('Cook 2 or 3 minutes'), [2, 3]);
  });
  it('converts seconds and hours', () => {
    assert.deepEqual(d('Stir 30 seconds'), [0.5, 0.5]);
    assert.deepEqual(d('Stir 30 to 45 sec'), [0.5, 0.75]);
    assert.deepEqual(d('Simmer 2 hours'), [120, 120]);
    assert.deepEqual(d('Simmer 1 to 2 hrs'), [60, 120]);
    assert.deepEqual(d('Simmer 1 hour 30 minutes'), [90, 90]);
  });
  it('reads words, fractions and "an hour"', () => {
    assert.deepEqual(d('Rest for an hour'), [60, 60]);
    assert.deepEqual(d('Rest for half an hour'), [30, 30]);
    assert.deepEqual(d('Rest for an hour and a half'), [90, 90]);
    assert.deepEqual(d('Bake 1 ½ hours'), [90, 90]);
    assert.deepEqual(d('Bake 1½ hours'), [90, 90]);
    assert.deepEqual(d('Bake 1 1/2 hours'), [90, 90]);
    assert.deepEqual(d('Cook for a minute'), [1, 1]);
    assert.deepEqual(d('Cook for two minutes'), [2, 2]);
  });
  it('treats overnight as 480 to 720 minutes', () => {
    assert.deepEqual(d('Chill overnight'), [480, 720]);
  });
  it('ignores about, around and roughly, and non-durations', () => {
    assert.deepEqual(d('Cook about 2 minutes'), [2, 2]);
    assert.deepEqual(d('Cook around 4 minutes'), [4, 4]);
    assert.deepEqual(d('Cook roughly 10 minutes'), [10, 10]);
    assert.equal(d('Shape into 25 balls, 1½ inches each'), undefined);
    assert.equal(d('Bake at 350°F until golden'), undefined);
  });
  it('stores [min, max] on the action, with the until cue', () => {
    const [a] = splitSteps(['Brown the meatballs for about 5 to 7 minutes, until golden on two sides.']).actions;
    assert.deepEqual(a.minutes, [5, 7]);
    assert.equal(a.until, 'golden on two sides');
  });
  it('records seconds as fractions of a minute and leaves minutes unset when none is stated', () => {
    const [a, b] = splitSteps(['Stir about 30 seconds until fragrant. Serve.']).actions;
    assert.deepEqual(a.minutes, [0.5, 0.5]);
    assert.equal(b.minutes, undefined);
    assert.equal(b.until, undefined);
  });
  it('uses a duration in a parenthesis when the clause has none', () => {
    const [a] = splitSteps(['Bake (20 to 25 minutes) until golden.']).actions;
    assert.deepEqual(a.minutes, [20, 25]);
  });
});

describe('until cue', () => {
  it('is the text after "until", without a trailing duration or participle clause', () => {
    const u = (s) => splitSteps([s]).actions[0].until;
    assert.equal(u('Simmer until the sauce thickens and coats a spoon.'), 'the sauce thickens and coats a spoon');
    assert.equal(u('Cook until golden, about 5 minutes.'), 'golden');
    assert.equal(u('Cook until golden, stirring occasionally.'), 'golden');
    assert.equal(u('stir slowly till just set, about 3 min'), 'just set');
    assert.equal(u('Cook 5 minutes.'), undefined);
  });
});

describe('original offsets', () => {
  it('point at the source sentence in the step string', () => {
    const step = 'Heat the oil.  Add the onion; cook 4 minutes (stirring), then add salt. You will smell it.';
    const { actions } = splitSteps([step]);
    assert.deepEqual(actions.map((a) => step.slice(a.original.start, a.original.end)), [
      'Heat the oil.',
      'Add the onion; cook 4 minutes (stirring), then add salt.',
      'Add the onion; cook 4 minutes (stirring), then add salt.',
      'Add the onion; cook 4 minutes (stirring), then add salt.',
    ]);
  });
  it('are relative to their own step, and the step index is 1-based', () => {
    const steps = ['Stir.', '  Pour it in. Serve.'];
    const { actions } = splitSteps(steps);
    assert.deepEqual(actions.map((a) => [a.original.step, steps[a.original.step - 1].slice(a.original.start, a.original.end)]), [
      [1, 'Stir.'], [2, 'Pour it in.'], [2, 'Serve.'],
    ]);
  });
  it('stay correct with abbreviations, parentheses and multi-byte characters', () => {
    const step = 'Add 1½ tbsp. butter (see note. really). Bake at 350°F. Cool.';
    const { actions } = splitSteps([step]);
    assert.deepEqual(actions.map((a) => step.slice(a.original.start, a.original.end)), [
      'Add 1½ tbsp. butter (see note. really).', 'Bake at 350°F.', 'Cool.',
    ]);
  });
});

// Step-derived action counts implied by each fixture's expected.json: all actions minus the prep
// actions that come from ingredient lines (stage 5), plus nothing deferred (deferred actions are
// always ingredient prep). Fixture 08 is the one disagreement with the splitting rules.
const STEP_DERIVED = {
  golden: 14, // 3 prep (bowl, combine gently, shape) + 11 cook
  '01-oven-bake-preheat': 4, // rub, preheat, bake, spoon (mince garlic is ingredient prep)
  '02-braise-long-simmer': 7,
  '03-stir-fry-high-heat': 7, // stir, heat, stir-fry, add, stir-fry, pour, serve
  '04-grouped-ingredients': 5, // whisk, boil, drain, toss, top
  '05-divided-no-amounts': 5,
  '06-us-and-metric': 5, // whisk, whisk in, heat, ladle, cook (melt butter is ingredient prep)
  '07-to-taste-unmeasured': 7,
  // expected.json has 6 cook + 1 ingredient prep = 6 step actions; the rules give 7: "Add the lentils
  // and the broth, bring to a boil, then reduce the heat" is a comma list of three verb clauses.
  '08-one-block-instructions': 7,
  '09-collective-word': 5,
  '10-loose-casual': 7,
  '11-bundled-steps': 15,
};

describe('fixtures', () => {
  const all = [golden(), ...patterns()];
  for (const fx of all) {
    const key = fx.name.split('/').pop();
    it(`${fx.name}: ${STEP_DERIVED[key]} step-derived actions`, () => {
      const { steps } = splitInput(fx.input);
      const { actions } = splitSteps(steps);
      assert.equal(actions.length, STEP_DERIVED[key]);
      actions.forEach((a, i) => assert.equal(a.id, `a${i + 1}`));
      for (const a of actions) {
        assert.match(a.text, /^[^a-z]*[A-Z0-9¼-¾⅐-⅞].*\.$/s);
        const sentence = steps[a.original.step - 1].slice(a.original.start, a.original.end);
        assert.ok(sentence.length > 0 && sentence === sentence.trim());
      }
    });
  }
  it('every fixture is covered by a count', () => {
    for (const fx of all) assert.ok(fx.name.split('/').pop() in STEP_DERIVED, fx.name);
  });
  it('every minutes range in expected.json is produced by some action', () => {
    for (const fx of all) {
      const { steps } = splitInput(fx.input);
      const got = splitSteps(steps).actions.filter((a) => a.minutes).map((a) => a.minutes);
      for (const m of fx.expected.actions.filter((x) => x.minutes).map((x) => x.minutes)) {
        assert.ok(got.some((g) => g[0] === m[0] && g[1] === m[1]), `${fx.name}: ${m}`);
      }
    }
  });
  it('golden: steps 2 to 4 are cut at the points of the expected cook list', () => {
    const { steps } = splitInput(golden().input);
    const cook = splitSteps(steps).actions.filter((a) => a.original.step >= 2).map((a) => a.text.toLowerCase());
    const want = golden().expected.actions.filter((a) => a.stage === 'cook');
    assert.equal(cook.length, want.length);
    assert.match(cook[4], /^brown the meatballs/);
    assert.match(cook[7], /^simmer about 4 minutes/);
    assert.match(cook[10], /^ladle into bowls/);
  });
});
