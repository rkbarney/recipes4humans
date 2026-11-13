#!/usr/bin/env node
// Checks which recipe sites the proxy can read. For each URL it fetches the page through the proxy,
// runs extractRecipe, and prints a table. No recipe text is written to disk.
//
// Usage: node scripts/probe-sites.js <proxy-url> [urls-file] [referer-origin]
//   urls-file       one recipe URL per line (default local-recipes/probe-urls.txt, which is git-ignored;
//                   blank lines and lines starting with # are skipped)
//   referer-origin  an origin the proxy allows (default http://localhost:8080)

import { readFileSync } from 'node:fs';
import { extractRecipe } from '../js/extract.js';

const [proxy, file = 'local-recipes/probe-urls.txt', referer = 'http://localhost:8080'] = process.argv.slice(2);
if (!proxy) {
  console.error('Usage: node scripts/probe-sites.js <proxy-url> [urls-file] [referer-origin]');
  process.exit(1);
}

let urls;
try {
  urls = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
} catch {
  console.error(`Could not read ${file}. Put one recipe URL per line in it (local-recipes/ is git-ignored).`);
  process.exit(1);
}

const rows = [];
for (const url of urls) {
  let site = url;
  try { site = new URL(url).hostname; } catch { /* keep the raw text */ }
  const row = { site, status: 'error', found: 'no', ingredients: 0, steps: 0 };
  try {
    const res = await fetch(`${proxy}?url=${encodeURIComponent(url)}`, {
      headers: { Referer: `${referer.replace(/\/$/, '')}/` },
      signal: AbortSignal.timeout(20000),
    });
    row.status = res.status;
    if (res.status === 200) {
      const r = extractRecipe(await res.text(), url);
      if (r) Object.assign(row, { found: 'yes', ingredients: r.ingredients.length, steps: r.steps.length });
    }
  } catch (err) {
    row.status = err && err.name === 'TimeoutError' ? 'timeout' : 'error';
  }
  rows.push(row);
}

const cols = [['site', 'Site'], ['status', 'HTTP'], ['found', 'Recipe data'], ['ingredients', 'Ingredients'], ['steps', 'Steps']];
const width = cols.map(([k, t]) => Math.max(t.length, ...rows.map((r) => String(r[k]).length)));
const line = (cells) => cells.map((c, i) => String(c).padEnd(width[i])).join('  ');
console.log(line(cols.map(([, t]) => t)));
console.log(line(width.map((w) => '-'.repeat(w))));
for (const r of rows) console.log(line(cols.map(([k]) => r[k])));
console.log(`\n${rows.filter((r) => r.found === 'yes').length} of ${rows.length} gave recipe data.`);
