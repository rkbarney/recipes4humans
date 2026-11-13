/**
 * Duration extraction for step text. Returns minutes as [min, max].
 */

const FR = '[½¼¾⅓⅔⅛⅜⅝⅞]';
const FR_VALUE = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60,
};
const WORD_ALT = Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|');
const NUM = `(?:\\d+\\s*${FR}|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|${FR}|\\b(?:${WORD_ALT})\\b)(?:\\s+and\\s+a\\s+half)?`;
const RANGE = `(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?`;
const UNIT = '[\\s-]?(hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b';
const DURATION_SRC = `(?<![\\w])${RANGE}${UNIT}`;

function toNumber(raw) {
  let s = raw.trim().toLowerCase();
  let extra = 0;
  const half = /\s+and\s+a\s+half$/.exec(s);
  if (half) { extra = 0.5; s = s.slice(0, half.index); }
  if (s in WORDS) return WORDS[s] + extra;
  let m = new RegExp(`^(\\d+)\\s*(${FR})$`).exec(s);
  if (m) return Number(m[1]) + FR_VALUE[m[2]] + extra;
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]) + extra;
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]) + extra;
  if (s in FR_VALUE) return FR_VALUE[s] + extra;
  return Number(s) + extra;
}

const factor = (unit) => (/^h/i.test(unit) ? 60 : /^s/i.test(unit) ? 1 / 60 : 1);
const round = (x) => Math.round(x * 100) / 100;

/**
 * Find the first duration in text: "N minutes", "N to M minutes", "N-M min", seconds, hours, "an hour",
 * "1 ½ hours", "1 hour 30 minutes", "half an hour", "overnight" (480 to 720 minutes).
 * "about", "around" and "roughly" are ignored. Returns undefined when there is none.
 * @param {string} text
 * @returns {[number, number] | undefined} minutes
 */
export function parseDuration(text) {
  const candidates = [];
  let m;
  if ((m = /\bhalf an hour\b/i.exec(text))) candidates.push({ index: m.index, value: [30, 30] });
  if ((m = /\ban hour and a half\b/i.exec(text))) candidates.push({ index: m.index, value: [90, 90] });
  if ((m = /\bovernight\b/i.exec(text))) candidates.push({ index: m.index, value: [480, 720] });
  const re = new RegExp(DURATION_SRC, 'gi');
  m = re.exec(text);
  if (m) {
    const f = factor(m[3]);
    const lo = toNumber(m[1]) * f;
    const hi = m[2] === undefined ? lo : toNumber(m[2]) * f;
    let value = [lo, hi];
    if (f === 60) {
      // "1 hour 30 minutes": add a trailing minutes part.
      const rest = text.slice(m.index + m[0].length);
      const more = new RegExp(`^\\s*(?:,\\s*)?(?:and\\s+)?${RANGE}${UNIT}`, 'i').exec(rest);
      if (more && factor(more[3]) < 60) {
        const g = factor(more[3]);
        const a = toNumber(more[1]) * g;
        const b = more[2] === undefined ? a : toNumber(more[2]) * g;
        value = [lo + a, hi + b];
      }
    }
    candidates.push({ index: m.index, value });
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => a.index - b.index);
  const [lo, hi] = candidates[0].value;
  return [round(lo), round(Math.max(lo, hi))];
}
