/**
 * Runs the engine on the golden fixture and compares with expected.json.
 * Skipped (todo) until the engine exists. To un-skip: set ENGINE_READY = true.
 */
import { describe, it } from 'node:test';
import { golden, splitInput } from './helpers/fixtures.js';
import { rewriteParts } from '../js/engine/index.js';
import { checkResult } from './helpers/check.js';

const ENGINE_READY = true;

describe('golden recipe', { todo: !ENGINE_READY }, () => {
  it('matches expected.json on structure', () => {
    const fx = golden();
    const { ingredients, steps } = splitInput(fx.input);
    checkResult(rewriteParts({ ingredients, steps }), fx.expected);
  });
});
