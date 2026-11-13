/**
 * Minimal, pure, deterministic PDF writer for simple text documents (title, headings, wrapped paragraphs).
 * Standard 14 fonts only (Helvetica, Helvetica-Bold) with WinAnsiEncoding. No dependencies, no DOM, no Date.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const LEFT = MARGIN;
const RIGHT = PAGE_W - MARGIN;
const BOTTOM = PAGE_H - MARGIN;
export const USABLE_WIDTH = RIGHT - LEFT;

const INDENT_STEP = 14;
const LABEL_COL = 18;
const LABEL_GAP = 4;

// ---- Glyph widths (Adobe AFM, units per 1000) ----------------------------------------------------------------
// ASCII 32..126 in order.
const ASCII_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];
const ASCII_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// WinAnsi 0x80..0x9F (Unicode -> byte) and their widths [regular, bold].
const CP1252_HIGH = [
  [0x20ac, 0x80, 556, 556], [0x201a, 0x82, 222, 278], [0x0192, 0x83, 556, 556], [0x201e, 0x84, 333, 500],
  [0x2026, 0x85, 1000, 1000], [0x2020, 0x86, 556, 556], [0x2021, 0x87, 556, 556], [0x02c6, 0x88, 333, 333],
  [0x2030, 0x89, 1000, 1000], [0x0160, 0x8a, 667, 667], [0x2039, 0x8b, 333, 333], [0x0152, 0x8c, 1000, 1000],
  [0x017d, 0x8e, 611, 611], [0x2018, 0x91, 222, 278], [0x2019, 0x92, 222, 278], [0x201c, 0x93, 333, 500],
  [0x201d, 0x94, 333, 500], [0x2022, 0x95, 350, 350], [0x2013, 0x96, 556, 556], [0x2014, 0x97, 1000, 1000],
  [0x02dc, 0x98, 333, 333], [0x2122, 0x99, 1000, 1000], [0x0161, 0x9a, 500, 556], [0x203a, 0x9b, 333, 333],
  [0x0153, 0x9c, 944, 944], [0x017e, 0x9e, 500, 500], [0x0178, 0x9f, 667, 667],
];

// Latin-1 0xA0..0xFF widths [regular, bold], index = code - 0xA0.
const L1 = [];
function setL1(from, to, reg, bold = reg) {
  for (let c = from; c <= to; c++) L1[c - 0xa0] = [reg, bold];
}
setL1(0xa0, 0xa0, 278); setL1(0xa1, 0xa1, 333); setL1(0xa2, 0xa5, 556); setL1(0xa6, 0xa6, 260, 280);
setL1(0xa7, 0xa7, 556); setL1(0xa8, 0xa8, 333); setL1(0xa9, 0xa9, 737); setL1(0xaa, 0xaa, 370);
setL1(0xab, 0xab, 556); setL1(0xac, 0xac, 584); setL1(0xad, 0xad, 333); setL1(0xae, 0xae, 737);
setL1(0xaf, 0xaf, 333); setL1(0xb0, 0xb0, 400); setL1(0xb1, 0xb1, 584); setL1(0xb2, 0xb3, 333);
setL1(0xb4, 0xb4, 333); setL1(0xb5, 0xb5, 556, 611); setL1(0xb6, 0xb6, 537, 556); setL1(0xb7, 0xb7, 278);
setL1(0xb8, 0xb9, 333); setL1(0xba, 0xba, 365); setL1(0xbb, 0xbb, 556); setL1(0xbc, 0xbe, 834);
setL1(0xbf, 0xbf, 611);
setL1(0xc0, 0xc5, 667, 722); setL1(0xc6, 0xc6, 1000); setL1(0xc7, 0xc7, 722); setL1(0xc8, 0xcb, 667);
setL1(0xcc, 0xcf, 278); setL1(0xd0, 0xd1, 722); setL1(0xd2, 0xd6, 778); setL1(0xd7, 0xd7, 584);
setL1(0xd8, 0xd8, 778); setL1(0xd9, 0xdc, 722); setL1(0xdd, 0xdd, 667); setL1(0xde, 0xde, 667);
setL1(0xdf, 0xdf, 611); setL1(0xe0, 0xe5, 556); setL1(0xe6, 0xe6, 889); setL1(0xe7, 0xe7, 500, 556);
setL1(0xe8, 0xeb, 556); setL1(0xec, 0xef, 278); setL1(0xf0, 0xf0, 556, 611); setL1(0xf1, 0xf1, 556, 611);
setL1(0xf2, 0xf6, 556, 611); setL1(0xf7, 0xf7, 584); setL1(0xf8, 0xf8, 611); setL1(0xf9, 0xfc, 556, 611);
setL1(0xfd, 0xfd, 500, 556); setL1(0xfe, 0xfe, 556, 611); setL1(0xff, 0xff, 500, 556);

const HIGH_BY_UNICODE = new Map(CP1252_HIGH.map(([u, b, r, bo]) => [u, { byte: b, w: [r, bo] }]));

// Characters WinAnsi cannot encode but that have a sensible plain replacement.
const REPLACEMENTS = new Map([
  [0x2153, '1/3'], [0x2154, '2/3'], [0x2155, '1/5'], [0x2156, '2/5'], [0x2157, '3/5'], [0x2158, '4/5'],
  [0x2159, '1/6'], [0x215a, '5/6'], [0x215b, '1/8'], [0x215c, '3/8'], [0x215d, '5/8'], [0x215e, '7/8'],
  [0x2009, ' '], [0x2002, ' '], [0x2003, ' '], [0x2007, ' '], [0x2008, ' '], [0x200a, ' '], [0x202f, ' '],
  [0x2006, ' '], [0x2005, ' '], [0x2004, ' '], [0x205f, ' '], [0x3000, ' '], [0x200b, ''], [0x200c, ''],
  [0x200d, ''], [0xfeff, ''], [0x00ad, '-'],
  [0xfb01, 'fi'], [0xfb02, 'fl'], [0xfb00, 'ff'], [0xfb03, 'ffi'], [0xfb04, 'ffl'],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2212, '-'], [0x2015, '—'],
  [0x2032, "'"], [0x2033, '"'], [0x201b, '‘'], [0x201f, '“'],
]);

/** Map one Unicode char to its WinAnsi byte, or -1. */
function byteOf(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x20 && c <= 0x7e) return c;
  if (c >= 0xa1 && c <= 0xff) return c;
  if (c === 0xa0) return 0x20;
  const h = HIGH_BY_UNICODE.get(c);
  return h ? h.byte : -1;
}

/**
 * Normalise text to characters WinAnsi can encode: replaces common unencodable chars with ASCII,
 * collapses whitespace runs to a single space, and turns anything else into "?". Idempotent.
 */
export function sanitize(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c || c === 0xa0) {
      out += ' ';
    } else if (REPLACEMENTS.has(c)) {
      out += sanitize(REPLACEMENTS.get(c));
    } else if (c < 0x20 || c === 0x7f) {
      out += ' ';
    } else if (byteOf(ch) >= 0) {
      out += ch;
    } else if (c >= 0x300 && c <= 0x36f) {
      // combining marks: drop
    } else {
      out += '?';
    }
  }
  return out.replace(/ {2,}/g, ' ');
}

function glyphWidth(ch, bold) {
  const c = ch.codePointAt(0);
  if (c >= 0x20 && c <= 0x7e) return (bold ? ASCII_BOLD : ASCII_REG)[c - 0x20];
  if (c >= 0xa0 && c <= 0xff) return L1[c - 0xa0][bold ? 1 : 0];
  const h = HIGH_BY_UNICODE.get(c);
  if (h) return h.w[bold ? 1 : 0];
  return glyphWidth('?', bold);
}

/**
 * Width in points of a string set in the given font ('Helvetica' or 'Helvetica-Bold') at the given size.
 * The string is sanitised first, so the result matches what is drawn.
 */
export function textWidth(str, font, size) {
  const bold = font === 'Helvetica-Bold';
  let units = 0;
  for (const ch of sanitize(str)) units += glyphWidth(ch, bold);
  return (units * size) / 1000;
}

/**
 * Greedy word wrap to maxWidth points. Words wider than maxWidth are broken by character.
 * @returns {string[]} lines (sanitised text); at least one (possibly empty) line.
 */
export function wrap(text, font, size, maxWidth) {
  const words = sanitize(text).trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const w = (s) => textWidth(s, font, size);
  for (let word of words) {
    if (cur && w(cur + ' ' + word) <= maxWidth) {
      cur += ' ' + word;
      continue;
    }
    if (cur) {
      lines.push(cur);
      cur = '';
    }
    while (w(word) > maxWidth) {
      const chars = Array.from(word);
      let n = 1;
      while (n < chars.length && w(chars.slice(0, n + 1).join('')) <= maxWidth) n++;
      lines.push(chars.slice(0, n).join(''));
      word = chars.slice(n).join('');
    }
    cur = word;
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

// ---- PDF assembly --------------------------------------------------------------------------------------------

/** Escape a sanitised string as a PDF literal string; result is a "byte string" (each char = one byte). */
export function pdfString(str) {
  let out = '(';
  for (const ch of str) {
    const b = byteOf(ch);
    const code = b < 0 ? 0x3f : b;
    const c = String.fromCharCode(code);
    out += c === '(' || c === ')' || c === '\\' ? '\\' + c : c;
  }
  return out + ')';
}

const num = (n) => String(Math.round(n * 100) / 100);

/**
 * @param {{title: string, subtitle?: string, blocks: Array<
 *   {type: 'h', text: string} |
 *   {type: 'p', text: string, label?: string, indent?: number, small?: boolean}
 * >}} doc
 * @returns {Uint8Array}
 */
export function buildPdf(doc) {
  const pages = [[]];
  let y = MARGIN; // top of the next line, measured down from the page top

  const newPage = () => {
    pages.push([]);
    y = MARGIN;
  };
  const atTop = () => y === MARGIN;
  const put = (font, size, x, lineTop, text, grey = false) => {
    if (!text) return;
    const baseline = PAGE_H - (lineTop + size);
    pages[pages.length - 1].push(
      `${grey ? '0.35 g ' : ''}BT /${font === 'Helvetica-Bold' ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(baseline)} Td ${pdfString(text)} Tj ET${grey ? ' 0 g' : ''}`,
    );
  };

  /** Lay out wrapped lines, breaking pages as needed. */
  const emit = (lines, font, size, lead, x, opts = {}) => {
    lines.forEach((line, i) => {
      if (y + lead > BOTTOM && !atTop()) newPage();
      if (i === 0 && opts.label) {
        const lw = textWidth(opts.label, font, size);
        put(font, size, opts.labelRight - lw, y, sanitize(opts.label), opts.grey);
      }
      put(font, size, x, y, line, opts.grey);
      y += lead;
    });
  };

  const T = { size: 16, lead: 19.5 };
  const S = { size: 9, lead: 12 };
  const H = { size: 12, lead: 15.6, above: 9 };
  const P = { size: 10.5, lead: 13.65, after: 2.5 };
  const SM = { size: 8.5, lead: 11, after: 1.5 };

  emit(wrap(doc.title, 'Helvetica-Bold', T.size, USABLE_WIDTH), 'Helvetica-Bold', T.size, T.lead, LEFT);
  if (doc.subtitle) {
    y += 1;
    emit(wrap(doc.subtitle, 'Helvetica', S.size, USABLE_WIDTH), 'Helvetica', S.size, S.lead, LEFT, { grey: true });
  }
  y += 4;

  const blocks = doc.blocks || [];
  const firstLead = (b) => (!b ? 0 : b.type === 'h' ? H.lead : b.small ? SM.lead : P.lead);

  blocks.forEach((b, idx) => {
    if (b.type === 'h') {
      const need = (atTop() ? 0 : H.above) + H.lead + firstLead(blocks[idx + 1]);
      if (y + need > BOTTOM && !atTop()) newPage();
      if (!atTop()) y += H.above;
      emit(wrap(b.text, 'Helvetica-Bold', H.size, USABLE_WIDTH), 'Helvetica-Bold', H.size, H.lead, LEFT);
      return;
    }
    const m = b.small ? SM : P;
    const level = Math.max(0, Math.min(6, Math.floor(b.indent || 0)));
    const left = LEFT + level * INDENT_STEP;
    const hasLabel = b.label != null && b.label !== '';
    const textX = hasLabel ? left + LABEL_COL + LABEL_GAP : left;
    const lines = wrap(b.text, 'Helvetica', m.size, RIGHT - textX);
    emit(lines, 'Helvetica', m.size, m.lead, textX, {
      label: hasLabel ? b.label : null,
      labelRight: left + LABEL_COL,
      grey: !!b.small,
    });
    y += m.after;
  });

  // Footer page numbers.
  const n = pages.length;
  pages.forEach((ops, i) => {
    const t = `${i + 1} / ${n}`;
    const x = PAGE_W / 2 - textWidth(t, 'Helvetica', 8) / 2;
    ops.push(`0.35 g BT /F1 8 Tf ${num(x)} ${num(28)} Td ${pdfString(t)} Tj ET 0 g`);
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then (page, content) pairs.
  const objs = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((ops, i) => {
    const stream = ops.join('\n');
    objs[5 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
