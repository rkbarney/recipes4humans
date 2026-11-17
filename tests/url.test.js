import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHttpUrl } from '../js/url.js';

test('isHttpUrl accepts only http and https addresses', () => {
  assert.equal(isHttpUrl('https://example.com/r?a=1'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'ftp://x.com/a', 'example.com', '', '   ', null, undefined, 5, {}]) {
    assert.equal(isHttpUrl(bad), false, String(bad));
  }
});
