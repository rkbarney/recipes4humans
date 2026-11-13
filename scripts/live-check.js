#!/usr/bin/env node
// Live check: the whole link-import path against real sites, run on your own computer.
//   link -> deployed Worker -> extractRecipe -> rewrite engine -> invariant checks
//
// Usage: npm run live            (or: node scripts/live-check.js [urls-file] [--keep-going])
//   urls-file  one recipe URL per line (default local-recipes/probe-urls.txt; blank lines and lines
//              starting with # are skipped). The first URL is the control: it must work, or the run fails.
//
// It needs the network, so it is not part of `npm test`. The Worker address comes from js/config.js and
// the Referer is the GitHub Pages origin, the same as the app sends.
//
// Output (all under local-recipes/, which is git-ignored, so no recipe text is ever committed):
//   live/NN-site.txt   each recipe that was read, in the format scripts/stress.js reads
//   live-report.md     the table below plus the invariant check, with counts only, no recipe text
//
// Exit code 1 when the control fails, any recipe made the engine throw, or an invariant is violated.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../js/config.js';
import { extractRecipe } from '../js/extract.js';
import { rewriteParts } from '../js/engine/index.js';

const PROXY = process.env.PROXY_URL || CONFIG.proxyUrl; // PROXY_URL is only for testing this script
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(root, 'local-recipes/probe-urls.txt');
const ORIGIN = 'https://rkbarney.github.io/';
const outDir = join(root, 'local-recipes/live');

if (!PROXY) {
  console.error('js/config.js has no proxyUrl. Deploy the Worker first (worker/README.md).');
  process.exit(1);
}

let urls;
try {
  urls = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
} catch {
  console.error(`Could not read ${file}. One recipe URL per line.`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function why(status) {
  if (status === 200) return '';
  if (status === 404) return 'link is wrong (404)';
  if (status === 403 || status === 401) return 'site refused the Worker';
  if (status === 429) return 'rate limited';
  if (status === 'timeout') return 'took over 20 s';
  if (status === 'error') return 'could not reach the Worker';
  if (status >= 500) return 'site or Worker error';
  return '';
}

const rows = [];
let n = 0;
for (const url of urls) {
  n += 1;
  let site = url;
  try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
  const row = { site, status: 'error', recipe: 'no', ing: 0, steps: 0, engine: '-', flags: '-', note: '' };
  try {
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`, {
      headers: { Referer: ORIGIN },
      signal: AbortSignal.timeout(20000),
    });
    row.status = res.status;
    const body = await res.text();
    if (res.status === 200) {
      let found = null;
      try { found = extractRecipe(body, url); } catch (err) { row.note = `extract threw: ${err.message}`; }
      if (!found) {
        row.note ||= /<script[^>]+ld\+json/i.test(body) ? 'page has JSON-LD but no Recipe in it' : 'no recipe data in the page';
      } else {
        row.recipe = 'yes';
        row.ing = found.ingredients.length;
        row.steps = found.steps.length;
        try {
          const r = rewriteParts({ ingredients: found.ingredients, steps: found.steps, title: found.title, sourceUrl: found.sourceUrl });
          const counts = {};
          for (const f of r.flags) counts[f.code] = (counts[f.code] || 0) + 1;
          row.engine = 'ok';
          row.flags = Object.entries(counts).map(([c, k]) => `${c}:${k}`).join(' ') || 'none';
        } catch (err) {
          row.engine = 'THREW';
          row.note = `engine threw: ${err.message}`;
        }
        const name = `${String(n).padStart(2, '0')}-${site.replace(/[^a-z0-9]+/gi, '-')}.txt`;
        writeFileSync(join(outDir, name), [url, found.title || site, '', 'Ingredients', ...found.ingredients, '', 'Directions', ...found.steps, ''].join('\n'));
      }
    } else {
      row.note = why(row.status);
    }
  } catch (err) {
    row.status = err && err.name === 'TimeoutError' ? 'timeout' : 'error';
    row.note = why(row.status);
  }
  rows.push(row);
  console.log(`${String(row.status).padEnd(7)} ${row.recipe === 'yes' ? 'recipe' : 'no recipe'.padEnd(9)} ${site}${row.note ? '  (' + row.note + ')' : ''}`);
}

// Invariants, using the stress script on what was read.
let stress = { stdout: '(no recipes were read, so nothing to check)', status: 0 };
if (rows.some((r) => r.recipe === 'yes')) {
  stress = spawnSync(process.execPath, [join(root, 'scripts/stress.js'), outDir, '--summary'], { encoding: 'utf8' });
  stress.stdout = (stress.stdout || '') + (stress.stderr || '');
}

const cols = [['site', 'Site'], ['status', 'HTTP'], ['recipe', 'Recipe data'], ['ing', 'Ingredients'], ['steps', 'Steps'], ['engine', 'Engine'], ['flags', 'Flags'], ['note', 'Note']];
const md = [
  `# Live check ${new Date().toISOString()}`,
  `Worker: ${PROXY}`,
  '',
  `| ${cols.map(([, t]) => t).join(' | ')} |`,
  `|${cols.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${cols.map(([k]) => String(r[k])).join(' | ')} |`),
  '',
  `${rows.filter((r) => r.recipe === 'yes').length} of ${rows.length} gave recipe data.`,
  '',
  '## Invariant check (scripts/stress.js)',
  '```',
  stress.stdout.trim(),
  '```',
  '',
].join('\n');
writeFileSync(join(root, 'local-recipes/live-report.md'), md);

const control = rows[0];
const controlOk = control && control.recipe === 'yes';
const threw = rows.some((r) => r.engine === 'THREW');
console.log(`\n${rows.filter((r) => r.recipe === 'yes').length} of ${rows.length} gave recipe data. Report: local-recipes/live-report.md`);
if (!controlOk) console.log('FAIL: the control link did not work, so the Worker or the extractor is broken.');
if (threw) console.log('FAIL: the engine threw on a real recipe.');
if (stress.status !== 0) console.log('FAIL: an invariant check failed (see the report).');
process.exit(!controlOk || threw || stress.status !== 0 ? 1 : 0);
