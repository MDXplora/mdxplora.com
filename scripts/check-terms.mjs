// Fail if any term this site must never contain appears in the source or the
// built pages.
//
// The terms themselves are not kept in this repository, so they are never
// published by it. They are read from, in order:
//   the BANNED_TERMS environment variable (one term per line; a CI secret), or
//   ~/.config/mdxplora/banned-terms.txt (one term per line; # starts a comment).
// Matching ignores case and accents. With no list available the check fails
// in CI and warns locally.
//
// Usage: node scripts/check-terms.mjs [dir ...]   (default: the repository and dist/)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.astro', 'test-results', 'playwright-report', '.lighthouseci']);
const TEXT = new Set([
  '.astro',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mdx',
  '.mjs',
  '.py',
  '.svg',
  '.ts',
  '.txt',
  '.xml',
  '.yml',
  '.yaml',
]);

function terms() {
  let raw = process.env.BANNED_TERMS;
  if (!raw) {
    const file = join(homedir(), '.config', 'mdxplora', 'banned-terms.txt');
    if (existsSync(file)) raw = readFileSync(file, 'utf8');
  }
  if (!raw) return null;
  return raw
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map(fold);
}

function fold(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* files(path);
    else if (TEXT.has(extname(name)) && stat.size < 5_000_000) yield path;
  }
}

const list = terms();
if (!list) {
  const message = 'no banned-terms list found (BANNED_TERMS, or ~/.config/mdxplora/banned-terms.txt)';
  if (process.env.CI) {
    console.error(`check-terms: ${message}`);
    process.exit(1);
  }
  console.warn(`check-terms: ${message}; skipped`);
  process.exit(0);
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2).map((d) => resolve(d)) : [ROOT];
const found = [];
for (const dir of dirs) {
  for (const path of files(dir)) {
    const lines = fold(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const term of list) if (line.includes(term)) found.push(`${relative(ROOT, path)}:${i + 1}`);
    });
  }
}

if (found.length) {
  // Where, but not which term: the log of a public repository is public too.
  console.error(`check-terms: a banned term appears in ${found.length} place(s):\n  ${found.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-terms: clean (${list.length} terms)`);
