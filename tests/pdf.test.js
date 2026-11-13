/**
 * PDF writer tests: structure, xref offsets, wrapping, WinAnsi encoding, escaping, determinism.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, textWidth, wrap, sanitize, USABLE_WIDTH } from '../js/pdf.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const doc = (blocks, extra = {}) => ({ title: 'Test card', blocks, ...extra });
const pageCount = (bytes) => (latin1(bytes).match(/\/Type \/Page /g) || []).length;
const tjCount = (bytes) => (latin1(bytes).match(/\) Tj/g) || []).length;
const many = (n) => Array.from({ length: n }, (_, i) => ({ type: 'p', label: `${i + 1}.`, text: 'Dice 1 onion.' }));

describe('pdf structure', () => {
  const bytes = buildPdf(doc([{ type: 'h', text: 'Gather' }, { type: 'p', text: 'Dice 1 onion.', label: '1.' }], { subtitle: 'Serves 2' }));
  const s = latin1(bytes);

  it('starts with %PDF- and ends with %%EOF', () => {
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
  });
  it('every xref offset points at "N 0 obj"', () => {
    const at = Number(/startxref\n(\d+)\n/.exec(s)[1]);
    assert.ok(s.slice(at).startsWith('xref\n'));
    const m = /xref\n0 (\d+)\n/.exec(s.slice(at));
    const count = Number(m[1]);
    const rows = s.slice(at + m[0].length).split('\n').slice(0, count);
    assert.equal(rows[0], '0000000000 65535 f ');
    for (let i = 1; i < count; i++) {
      assert.equal(rows[i].length, 19);
      assert.ok(s.slice(Number(rows[i].slice(0, 10))).startsWith(`${i} 0 obj`), `object ${i}`);
    }
    assert.match(s, new RegExp(`/Size ${count}`));
  });
  it('uses the standard fonts with WinAnsiEncoding', () => {
    assert.match(s, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
    assert.match(s, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  });
  it('stream /Length matches the stream bytes', () => {
    for (const m of s.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(m[1]), m[2].length);
  });
});

describe('pdf pagination', () => {
  it('page count grows when many blocks are added', () => {
    assert.equal(pageCount(buildPdf(doc(many(3)))), 1);
    assert.ok(pageCount(buildPdf(doc(many(200)))) >= 3);
  });
  it('/Count agrees with the number of page objects', () => {
    const bytes = buildPdf(doc(many(200)));
    assert.equal(Number(/\/Count (\d+)/.exec(latin1(bytes))[1]), pageCount(bytes));
  });
  it('keeps a heading with the line after it (no heading is last on a page)', () => {
    const blocks = [];
    for (let i = 0; i < 40; i++) blocks.push({ type: 'h', text: `Part ${i}` }, { type: 'p', text: 'Dice 1 onion.' });
    const bytes = buildPdf(doc(blocks));
    const s = latin1(bytes);
    for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
      const lines = m[1].split('\n').filter((l) => !/ Tj ET/.test(l) || !/ 8 Tf /.test(l)); // drop footer
      const last = lines[lines.length - 1];
      assert.ok(!/\/F2 12 Tf/.test(last), 'heading stranded at page bottom');
    }
  });
});

describe('pdf wrapping', () => {
  const long = 'Dice 1 onion and stir it with the oil until it is soft and golden. '.repeat(6);
  it('long text wraps into more lines than paragraphs', () => {
    const blocks = [{ type: 'p', text: long }, { type: 'p', text: long, label: 'a.', indent: 1 }];
    assert.ok(tjCount(buildPdf(doc(blocks))) > 2 + 2 + 1);
  });
  it('no wrapped line is wider than the available width', () => {
    for (const [font, size, width] of [['Helvetica', 10.5, USABLE_WIDTH], ['Helvetica', 10.5, 200], ['Helvetica-Bold', 12, 150]]) {
      for (const line of wrap(long, font, size, width)) assert.ok(textWidth(line, font, size) <= width, line);
    }
  });
  it('breaks over-long words', () => {
    const word = 'x'.repeat(300);
    const lines = wrap(word, 'Helvetica', 10.5, USABLE_WIDTH);
    assert.ok(lines.length > 1);
    for (const l of lines) assert.ok(textWidth(l, 'Helvetica', 10.5) <= USABLE_WIDTH);
    assert.equal(lines.join(''), word);
  });
  it('uses real glyph widths', () => {
    assert.equal(textWidth('Hello', 'Helvetica', 1000), 722 + 556 + 222 + 222 + 556);
    assert.equal(textWidth('A', 'Helvetica-Bold', 10), 7.22);
  });
});

describe('pdf encoding', () => {
  it('encodes ½ as byte 0xBD and ° as 0xB0', () => {
    const bytes = buildPdf(doc([{ type: 'p', text: 'Add ½ cup at 180°.' }]));
    assert.ok(bytes.includes(0xbd));
    assert.ok(bytes.includes(0xb0));
    assert.ok(latin1(bytes).includes('Add ½ cup at 180°.'));
  });
  it('encodes curly quotes, dashes, bullet and ellipsis to their WinAnsi bytes', () => {
    const s = latin1(buildPdf(doc([{ type: 'p', text: '‘a’ “b” – — • …' }])));
    assert.ok(s.includes('\x91a\x92 \x93b\x94 \x96 \x97 \x95 \x85'));
  });
  it('encodes é and ñ and ×', () => {
    const s = latin1(buildPdf(doc([{ type: 'p', text: 'café piña 2×3' }])));
    assert.ok(s.includes('caf\xe9 pi\xf1a 2\xd73'));
  });
  it('turns ⅓ into 1/3 and other fractions into ASCII', () => {
    assert.ok(latin1(buildPdf(doc([{ type: 'p', text: 'Add ⅓ cup.' }]))).includes('(Add 1/3 cup.)'));
    assert.equal(sanitize('⅔ ⅛ ⅜ ⅝ ⅞'), '2/3 1/8 3/8 5/8 7/8');
  });
  it('maps odd spaces and ligatures, and unknown characters to "?"', () => {
    assert.equal(sanitize('a b c d'), 'a b c d');
    assert.equal(sanitize('ﬂour ﬁne'), 'flour fine');
    assert.equal(sanitize('x中y'), 'x?y');
  });
  it('sanitize is idempotent', () => {
    const once = sanitize('½ ’ ⅓ 中 z');
    assert.equal(sanitize(once), once);
  });
  it('escapes parentheses and backslashes', () => {
    const s = latin1(buildPdf(doc([{ type: 'p', text: 'Dice (1) onion \\ done.' }])));
    assert.ok(s.includes('(Dice \\(1\\) onion \\\\ done.)'));
  });
});

describe('pdf determinism', () => {
  it('is identical across two calls', () => {
    const d = doc([{ type: 'h', text: 'Gather' }, ...many(80), { type: 'p', text: 'Salt to taste.', small: true }], { subtitle: 'Serves 4' });
    assert.deepEqual(buildPdf(d), buildPdf(d));
  });
});
