import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity, parseQuantityPrefix, parseAmount, formatQuantity, formatNumber, normalizeUnit, matchUnitPrefix,
  addQuantities, subtractQuantities, convertUnit, convertQuantity,
} from '../js/engine/quantity.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

describe('parseQuantity', () => {
  it('whole numbers and decimals', () => {
    assert.equal(parseQuantity('3'), 3);
    assert.equal(parseQuantity('1.5'), 1.5);
    assert.equal(parseQuantity('.25'), 0.25);
  });
  it('unicode and typed fractions', () => {
    assert.equal(parseQuantity('½'), 0.5);
    near(parseQuantity('⅓'), 1 / 3);
    assert.equal(parseQuantity('¾'), 0.75);
    assert.equal(parseQuantity('1/4'), 0.25);
  });
  it('mixed numbers', () => {
    assert.equal(parseQuantity('1 ½'), 1.5);
    assert.equal(parseQuantity('1½'), 1.5);
    assert.equal(parseQuantity('1 1/2'), 1.5);
    assert.equal(parseQuantity('1-1/2'), 1.5);
    near(parseQuantity('2 2/3'), 2 + 2 / 3);
  });
  it('ranges', () => {
    assert.deepEqual(parseQuantity('5 to 7'), [5, 7]);
    assert.deepEqual(parseQuantity('5-7'), [5, 7]);
    assert.deepEqual(parseQuantity('5 – 7'), [5, 7]);
    assert.deepEqual(parseQuantity('1 or 2'), [1, 2]);
    assert.deepEqual(parseQuantity('½ to 1'), [0.5, 1]);
    assert.equal(parseQuantity('3-3'), 3);
  });
  it('number words', () => {
    assert.equal(parseQuantity('two'), 2);
  });
  it('returns null for anything it does not fully understand', () => {
    for (const s of ['', 'abc', '0', '1/0', '7 to 5', '1 cup', '1,5', '-3', '2x']) assert.equal(parseQuantity(s), null, s);
  });
  it('prefix parse reports how much text it used', () => {
    assert.deepEqual(parseQuantityPrefix('1½ cups flour'), { qty: 1.5, length: 2 });
    assert.deepEqual(parseQuantityPrefix('5 to 7 minutes'), { qty: [5, 7], length: 6 });
    assert.equal(parseQuantityPrefix('onion'), null);
  });
});

describe('units', () => {
  it('normalizes full words, plurals and abbreviations', () => {
    const table = {
      tbsp: ['tablespoon', 'tablespoons', 'tbsp', 'Tbsp.', 'T', 'tbs'],
      tsp: ['teaspoon', 'teaspoons', 'tsp', 'tsp.', 't'],
      cup: ['cup', 'cups', 'c', 'C', 'c.'],
      oz: ['ounce', 'ounces', 'oz', 'oz.'],
      lb: ['pound', 'pounds', 'lb', 'lbs', 'lb.'],
      g: ['gram', 'grams', 'g'],
      kg: ['kilogram', 'kg'],
      ml: ['milliliter', 'milliliters', 'ml', 'mL'],
      l: ['liter', 'liters', 'l', 'L'],
      pinch: ['pinch', 'pinches'], dash: ['dash'], clove: ['clove', 'cloves'], can: ['can', 'cans'], stick: ['stick', 'sticks'],
      sprig: ['sprig', 'sprigs'], bunch: ['bunch', 'bunches'], slice: ['slice', 'slices'], piece: ['piece', 'pieces'],
      head: ['head', 'heads'], stalk: ['stalk', 'stalks'],
    };
    for (const [unit, words] of Object.entries(table)) for (const w of words) assert.equal(normalizeUnit(w), unit, w);
  });
  it('rejects non-units', () => {
    for (const w of ['large', 'small', 'onion', 'x', '']) assert.equal(normalizeUnit(w), undefined, w);
  });
  it('matches a unit at the start of text', () => {
    assert.deepEqual(matchUnitPrefix('tbsp. cumin'), { unit: 'tbsp', length: 5 });
    assert.deepEqual(matchUnitPrefix('cups flour'), { unit: 'cup', length: 4 });
    assert.deepEqual(matchUnitPrefix('fl oz milk'), { unit: 'fl oz', length: 5 });
    assert.equal(matchUnitPrefix('tomatoes'), null);
  });
  it('parseAmount reads quantity plus unit', () => {
    assert.deepEqual(parseAmount('240 ml'), { qty: 240, unit: 'ml' });
    assert.deepEqual(parseAmount('14-ounce'), { qty: 14, unit: 'oz' });
    assert.deepEqual(parseAmount('1½ cups'), { qty: 1.5, unit: 'cup' });
    assert.equal(parseAmount('about 6 oz'), null);
  });
});

describe('formatQuantity', () => {
  it('formats fractions, mixed numbers and units', () => {
    assert.equal(formatQuantity(0.25, 'cup'), '¼ cup');
    assert.equal(formatQuantity(1, 'tbsp'), '1 tbsp');
    assert.equal(formatQuantity(1.5, 'cup'), '1½ cup');
    assert.equal(formatQuantity(1 / 3, 'cup'), '⅓ cup');
    assert.equal(formatQuantity(2 / 3), '⅔');
    assert.equal(formatQuantity(0.75, 'cup'), '¾ cup');
    assert.equal(formatQuantity(0.125, 'tsp'), '⅛ tsp');
    assert.equal(formatQuantity(25, 'g'), '25 g');
    assert.equal(formatQuantity(2), '2');
  });
  it('formats ranges, objects and odd decimals', () => {
    assert.equal(formatQuantity([5, 7], 'min'), '5 to 7 min');
    assert.equal(formatQuantity({ qty: 0.5, unit: 'tsp' }), '½ tsp');
    assert.equal(formatNumber(0.1), '0.1');
    assert.equal(formatNumber(0.1 + 0.2), '0.3');
    assert.equal(formatNumber(2.9999999999), '3');
  });
  it('round-trips with parseQuantity', () => {
    for (const n of [0.25, 0.5, 1.5, 2.75, 1 / 3, 3]) near(parseQuantity(formatNumber(n)), n);
  });
});

describe('arithmetic and conversion', () => {
  it('adds and subtracts the same unit', () => {
    assert.deepEqual(addQuantities({ qty: 0.25, unit: 'cup' }, { qty: 0.5, unit: 'cup' }), { qty: 0.75, unit: 'cup' });
    assert.deepEqual(subtractQuantities({ qty: 0.75, unit: 'cup' }, { qty: 0.25, unit: 'cup' }), { qty: 0.5, unit: 'cup' });
    assert.deepEqual(addQuantities({ qty: 2 }, { qty: 1 }), { qty: 3 });
  });
  it('is exact for fractions that are not binary', () => {
    const r = addQuantities({ qty: 0.1, unit: 'g' }, { qty: 0.2, unit: 'g' });
    assert.equal(r.qty, 0.3);
  });
  it('converts tsp, tbsp and cup so totals can be checked', () => {
    assert.equal(convertUnit(1, 'tbsp', 'tsp'), 3);
    assert.equal(convertUnit(1, 'cup', 'tbsp'), 16);
    assert.equal(convertUnit(0.25, 'cup', 'tbsp'), 4);
    assert.equal(convertUnit(48, 'tsp', 'cup'), 1);
    assert.equal(convertUnit(1, 'g', 'cup'), null);
    assert.deepEqual(convertQuantity({ qty: 2, unit: 'tbsp' }, 'tsp'), { qty: 6, unit: 'tsp' });
    assert.equal(convertQuantity({ qty: 2, unit: 'g' }, 'tsp'), null);
  });
  it('combines mixed volume units in the smaller unit', () => {
    assert.deepEqual(addQuantities({ qty: 0.5, unit: 'tsp' }, { qty: 1, unit: 'tbsp' }), { qty: 3.5, unit: 'tsp' });
    assert.deepEqual(subtractQuantities({ qty: 0.25, unit: 'cup' }, { qty: 2, unit: 'tbsp' }), { qty: 2, unit: 'tbsp' });
  });
  it('refuses incompatible units and negative results', () => {
    assert.equal(addQuantities({ qty: 1, unit: 'cup' }, { qty: 100, unit: 'g' }), null);
    assert.equal(addQuantities({ qty: 1, unit: 'cup' }, { qty: 1 }), null);
    assert.equal(addQuantities({ qty: 190, unit: 'g' }, { qty: 7, unit: 'oz' }), null);
    assert.equal(subtractQuantities({ qty: 1, unit: 'cup' }, { qty: 2, unit: 'cup' }), null);
  });
  it('subtracting everything leaves zero', () => {
    assert.deepEqual(subtractQuantities({ qty: 1, unit: 'cup' }, { qty: 1, unit: 'cup' }), { qty: 0, unit: 'cup' });
  });
  it('handles ranges end to end', () => {
    assert.deepEqual(addQuantities({ qty: [1, 2], unit: 'cup' }, { qty: 1, unit: 'cup' }), { qty: [2, 3], unit: 'cup' });
    assert.deepEqual(subtractQuantities({ qty: 3, unit: 'cup' }, { qty: [1, 2], unit: 'cup' }), { qty: [1, 2], unit: 'cup' });
  });
});
