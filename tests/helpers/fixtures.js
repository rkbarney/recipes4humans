import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** Load one fixture directory: { name, dir, input, expected }. */
export function loadFixture(dir) {
  return {
    name: dir.split('/').slice(-2).join('/'),
    dir,
    input: readFileSync(join(dir, 'input.txt'), 'utf8'),
    expected: JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')),
  };
}

export const golden = () => loadFixture(join(root, 'golden'));

export function patterns() {
  const base = join(root, 'patterns');
  return readdirSync(base).sort().filter((d) => existsSync(join(base, d, 'input.txt'))).map((d) => loadFixture(join(base, d)));
}

/**
 * Split an input.txt into { title, yield, ingredients, steps }.
 * ingredients: lines with bullets removed; group headers ("For the sauce:") stay as plain lines.
 * steps: numbered lines ("1." or "1)") with the number removed; an unnumbered block is a one-element array.
 */
export function splitInput(text) {
  const lines = text.split('\n');
  const title = lines[0].trim();
  const yieldLine = lines.find((l) => /^yield:/i.test(l));
  const iStart = lines.findIndex((l) => /^ingredients\s*$/i.test(l.trim()));
  const sStart = lines.findIndex((l) => /^preparation\s*$/i.test(l.trim()));
  if (iStart < 0 || sStart < 0) throw new Error('input needs Ingredients and Preparation headings');
  const ingredients = lines.slice(iStart + 1, sStart).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^-\s+/, ''));
  const stepLines = lines.slice(sStart + 1).map((l) => l.trim()).filter(Boolean);
  const numbered = stepLines.every((l) => /^\d+[.)]\s+/.test(l));
  const steps = numbered ? stepLines.map((l) => l.replace(/^\d+[.)]\s+/, '')) : [stepLines.join(' ')];
  return { title, yield: yieldLine ? yieldLine.replace(/^yield:\s*/i, '') : undefined, ingredients, steps };
}
