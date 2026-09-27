// Every internal link in the built site must lead to a page that exists.
//
// The docs are already checked by starlight-links-validator during the build;
// this covers the rest of the site, including links from the pages into the
// docs. External links are not fetched.
//
// Usage: node scripts/check-links.mjs [dist]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pages(path);
    else if (name.endsWith('.html')) yield path;
  }
}

function target(href) {
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  if (path.endsWith('/')) return join(DIST, path, 'index.html');
  return join(DIST, path);
}

const broken = [];
let checked = 0;
for (const page of pages(DIST)) {
  const html = readFileSync(page, 'utf8');
  for (const match of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    const href = match[1];
    if (href.startsWith('//')) continue;
    checked++;
    if (!existsSync(target(href))) broken.push(`${relative(DIST, page)} → ${href}`);
  }
}

if (broken.length) {
  console.error(`check-links: ${broken.length} broken internal link(s):\n  ${[...new Set(broken)].join('\n  ')}`);
  process.exit(1);
}
console.log(`check-links: ${checked} internal links, all resolve`);
