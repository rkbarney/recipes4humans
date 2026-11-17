// The service worker's offline file list is typed by hand. This test fails when a shipped file is
// missing from it (it would not work offline) or when it names a file that no longer exists.
// service-worker.js uses `self`, so it is read as text rather than imported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every file under a folder (recursively) whose name passes `keep`, as paths relative to the repo root. */
function filesUnder(dir, keep = () => true) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(rel, keep));
    else if (keep(name)) out.push(rel.split(sep).join('/'));
  }
  return out;
}

/** The files listed in SHELL_URLS, without the `base + ` prefix ('' stands for the site root). */
function listedFiles() {
  const src = readFileSync(join(root, 'service-worker.js'), 'utf8');
  const block = src.match(/const SHELL_URLS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'could not find SHELL_URLS in service-worker.js');
  return block[1].split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    if (line === 'base,') return '';
    const m = line.match(/^base \+ '([^']+)',$/);
    assert.ok(m, `unexpected SHELL_URLS line: ${line}`);
    return m[1];
  });
}

test('service worker lists every shipped file', () => {
  const listed = new Set(listedFiles());
  const shipped = [
    ...filesUnder('js', (n) => n.endsWith('.js')),
    ...filesUnder('css'),
    ...filesUnder('icons'),
    'index.html', 'privacy.html', 'manifest.json',
  ];
  const missing = shipped.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `add to SHELL_URLS in service-worker.js (and bump CACHE_NAME): ${missing.join(', ')}`);
});

test('service worker lists no file that does not exist', () => {
  const gone = listedFiles().filter((f) => f !== '' && !existsSync(join(root, f)));
  assert.deepEqual(gone, []);
});

test('service worker list has no duplicates and includes the site root', () => {
  const files = listedFiles();
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.includes(''));
});

test('build script copies every top-level shipped file and folder', () => {
  const script = readFileSync(join(root, 'scripts/build-site.sh'), 'utf8');
  const top = new Set(listedFiles().filter((f) => f).map((f) => f.split('/')[0]));
  for (const entry of top) assert.ok(new RegExp(`\\b${entry.replace('.', '\\.')}\\b`).test(script), `build-site.sh does not copy ${entry}`);
});
