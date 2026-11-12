/**
 * Runs the engine on each pattern fixture and compares with expected.json.
 * Skipped (todo) until the engine exists. To un-skip: set ENGINE_READY = true.
 */
import { describe, it } from 'node:test';
import { patterns, splitInput } from './helpers/fixtures.js';
import { rewriteParts } from '../js/engine/index.js';
import { checkResult } from './helpers/check.js';

const ENGINE_READY = false;

describe('pattern recipes', { todo: !ENGINE_READY }, () => {
  for (const fx of patterns()) {
    it(fx.name, () => {
      const { ingredients, steps } = splitInput(fx.input);
      checkResult(rewriteParts({ ingredients, steps }), fx.expected);
    });
  }
});
