// Reads schema.org Recipe data out of a page's JSON-LD blocks. Pure string work, so it runs in the
// browser and under node with no DOM. It never falls back to scraping the visible page.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', frac12: '½',
  frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', times: '×', eacute: 'é', egrave: 'è',
  agrave: 'à', ccedil: 'ç', ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, body) => {
    try {
      if (body[0] === '#') {
        const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
    } catch {
      return all;
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? all : v;
  });
}

/** Decode entities, turn block-level tags into line breaks, drop other tags. Keeps "\n". */
function cleanKeepBreaks(value) {
  if (typeof value !== 'string') return '';
  let s = decodeEntities(value);
  s = s.replace(/<\s*br\s*\/?\s*>|<\/\s*(p|li|div|h[1-6])\s*>/gi, '\n');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = decodeEntities(s); // text that was double-encoded, such as &amp;nbsp;
  return s.replace(/[ \t\r\f\v ]+/g, ' ').replace(/ *\n[ \n]*/g, '\n').trim();
}

function clean(value) {
  return cleanKeepBreaks(value).replace(/\s+/g, ' ').trim();
}

function parseJsonTolerant(raw) {
  let s = raw.replace(/^﻿/, '').trim();
  s = s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  s = s.replace(/^<!--/, '').replace(/-->$/, '').trim();
  try { return JSON.parse(s); } catch { /* try again below */ }
  try { return JSON.parse(s.replace(/[\u0000-\u001f]/g, ' ')); } catch { return undefined; }
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\btype\s*=\s*(?:"\s*application\/ld\+json\s*(?:;[^"]*)?"|'\s*application\/ld\+json\s*(?:;[^']*)?'|application\/ld\+json(?=[\s>/]|$))/i.test(m[1])) {
      const data = parseJsonTolerant(m[2]);
      if (data !== undefined) out.push(data);
    }
  }
  return out;
}

function hasRecipeType(node) {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === 'string' && /(^|[/#:])Recipe$/i.test(x.trim()));
}

/** First Recipe object in a parsed block: top-level object or array, or inside @graph. */
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (hasRecipeType(node)) return node;
  return node['@graph'] ? findRecipe(node['@graph'], depth + 1) : null;
}

function stringList(v) {
  if (typeof v === 'string') return [clean(v)].filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(stringList);
  return [];
}

function flattenSteps(v, depth = 0) {
  if (v == null || depth > 6) return [];
  if (typeof v === 'string') {
    return cleanKeepBreaks(v).split('\n').map((l) => l.trim()).filter(Boolean);
  }
  if (Array.isArray(v)) return v.flatMap((x) => flattenSteps(x, depth + 1));
  if (typeof v === 'object') {
    if (v.itemListElement) return flattenSteps(v.itemListElement, depth + 1);
    const text = typeof v.text === 'string' && v.text.trim() ? v.text : v.name;
    return flattenSteps(typeof text === 'string' ? text : '', depth + 1);
  }
  return [];
}

/**
 * @param {string} html page source
 * @param {string} url the page's address, returned as sourceUrl
 * @returns {{title: string, ingredients: string[], steps: string[], sourceUrl: string} | null}
 */
export function extractRecipe(html, url) {
  if (typeof html !== 'string' || !html) return null;
  for (const block of jsonLdBlocks(html)) {
    const node = findRecipe(block);
    if (!node) continue;
    const ingredients = stringList(node.recipeIngredient ?? node.ingredients);
    const steps = flattenSteps(node.recipeInstructions);
    if (!ingredients.length || !steps.length) continue;
    return {
      title: clean(typeof node.name === 'string' ? node.name : node.headline) || '',
      ingredients,
      steps,
      sourceUrl: url,
    };
  }
  return null;
}
