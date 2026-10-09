// Every internal link in the built site must lead to a page that exists, and a link to a part of a page (#name) to an
// element with that id. Links written as full addresses on this site (https://mdxplora.com/..., such as a page's
// canonical address and its preview image) count as internal. Read from href, src and content attributes, from each
// candidate in srcset and imagesrcset, and from the address values in structured data (JSON-LD), such as url and logo.
// A "{" in an internal link, other than in a URL template, is a placeholder left unfilled and is reported.
//
// External links are not fetched.
//
// Usage: node scripts/check-links.mjs [dist]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const SITE = 'https://mdxplora.com';

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pages(path);
    else if (name.endsWith('.html')) yield path;
  }
}

// The file an address is served from. An address without its trailing slash (/page) serves /page/index.html.
function target(path) {
  const file = join(DIST, path);
  if (path.endsWith('/') || (existsSync(file) && statSync(file).isDirectory())) return join(file, 'index.html');
  return file;
}

// The address on this site a link leads to, or nothing for a link elsewhere.
function onSite(link) {
  if (link.startsWith('#') || (link.startsWith('/') && !link.startsWith('//'))) return link;
  if (link === SITE || /^https:\/\/mdxplora\.com[/?#]/.test(link)) return link.slice(SITE.length) || '/';
  return undefined;
}

// The values in structured data that are addresses: those of the properties schema.org gives a URL, and any ending in
// "Url". An address may also sit inside the property's value, such as the urlTemplate of a potentialAction's target,
// or be the @id of a node given as the value, such as "item": {"@id": "https://mdxplora.com/x/", "name": "X"}, when
// that node gives no address of its own. An @id's fragment names a node in the graph, not an element, so only its page
// is checked. A urlTemplate, or a target written as one, is read up to its first placeholder; anywhere else, a "{" in
// an address on this site, even in its query, is reported as a placeholder left unfilled. Names, descriptions, the
// @context and the @id names of nodes elsewhere are not links.
const ADDRESS_KEYS = new Set([
  'url',
  'logo',
  'image',
  'sameAs',
  'mainEntityOfPage',
  'license',
  'codeRepository',
  'item',
  'target',
  'urlTemplate',
  'screenshot',
  'thumbnail',
  'hasMap',
  'relatedLink',
  'significantLink',
  'isBasedOn',
  'archivedAt',
  'citation',
]);
const isAddressKey = (key) => Boolean(key) && (ADDRESS_KEYS.has(key) || key.endsWith('Url'));

// Whether a node gives an address of its own, so that its @id is only its name. Only a url, contentUrl or embedUrl that
// is a string, and not empty or blank, is the node's own address; others, such as its image, logo, sameAs or license,
// are addresses of something else.
const OWN_ADDRESS_KEYS = ['url', 'contentUrl', 'embedUrl'];
const hasOwnAddress = (node) => OWN_ADDRESS_KEYS.some((k) => typeof node[k] === 'string' && node[k].trim() !== '');

// Each address as [written, checked]: these differ for a template with a placeholder, and for an @id with a fragment.
function* addresses(value, key) {
  const isAddress = isAddressKey(key);
  if (typeof value === 'string') {
    if (key === 'urlTemplate' || (key === 'target' && value.includes('{'))) {
      const base = templateBase(value);
      if (base !== undefined) yield [value, base];
    } else if (isAddress) yield [value, value];
  } else if (Array.isArray(value)) {
    for (const v of value) yield* addresses(v, key);
  } else if (value && typeof value === 'object') {
    const id = value['@id'];
    if (isAddress && typeof id === 'string' && !hasOwnAddress(value)) {
      const page = id.split('#')[0];
      if (page) yield [id, page];
    }
    for (const [k, v] of Object.entries(value)) if (k !== '@context') yield* addresses(v, k);
  }
}

// The part of a URL template (RFC 6570) that is known before it is filled in: the address up to the first placeholder,
// without a partial query value or fragment, when that placeholder is in the query or fragment (?q={q}, {?q}, #{name}).
// Nothing when a placeholder is in the path (/docs/{slug}), since the page is then not known.
function templateBase(template) {
  const cut = template.indexOf('{');
  if (cut === -1) return template;
  const before = template.slice(0, cut);
  const end = before.search(/[?#]/);
  if (end !== -1) return before.slice(0, end);
  return /^\{[?#]/.test(template.slice(cut)) ? before : undefined;
}

// The address of each candidate in a srcset, read as the HTML standard does: an address runs to the next space, so a
// data: address keeps its comma, and a comma ends a candidate only after its descriptors. In the descriptors a comma
// inside parentheses does not end the candidate, and the first ")" closes them, however many "(" came before. Only ASCII
// whitespace (space, tab, LF, FF, CR) separates; another space, such as U+00A0, is part of the address.
function* srcsetAddresses(value) {
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[ \t\n\f\r,]/.test(value[i])) i++;
    const start = i;
    while (i < value.length && !/[ \t\n\f\r]/.test(value[i])) i++;
    let address = value.slice(start, i);
    if (address.endsWith(',')) address = address.replace(/,+$/, '');
    else {
      let inParens = false;
      for (; i < value.length && !(value[i] === ',' && !inParens); i++) {
        if (value[i] === '(') inParens = true;
        else if (value[i] === ')') inParens = false;
      }
    }
    if (address) yield address;
  }
}

// The ids on each page, read once.
const ids = new Map();
function idsOf(file) {
  if (!ids.has(file)) {
    const html = readFileSync(file, 'utf8');
    ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return ids.get(file);
}

const broken = [];
let checked = 0;
for (const page of pages(DIST)) {
  const html = readFileSync(page, 'utf8');
  // Each link as written, and the part of it that is checked.
  const found = [
    ...[...html.matchAll(/\s(?:href|src)="(\/[^"]*|#[^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\s(?:href|src|content)="(https:\/\/mdxplora\.com(?:[/?#][^"]*)?)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\s(?:srcset|imagesrcset)="([^"]*)"/g)].flatMap((m) => [...srcsetAddresses(m[1])]),
  ].map((link) => [link, link]);
  for (const [, json] of html.matchAll(/<script[^>]*\stype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      found.push(...addresses(JSON.parse(json)));
    } catch {
      broken.push(`${relative(DIST, page)} → structured data that is not valid JSON`);
    }
  }
  // Each link as written, and the address on this site it leads to.
  const links = found.map(([written, link]) => [written, onSite(link)]).filter(([, href]) => href);
  for (const [written, href] of links) {
    checked++;
    // A template is checked up to its first placeholder, so a "{" left in what is checked is a placeholder never filled.
    if (href.includes('{')) {
      broken.push(`${relative(DIST, page)} → ${written} (a placeholder left in the address)`);
      continue;
    }
    const [beforeHash, fragment] = href.split('#');
    let path, id;
    try {
      path = decodeURIComponent(beforeHash.split('?')[0]);
      id = fragment && decodeURIComponent(fragment);
    } catch {
      broken.push(`${relative(DIST, page)} → ${written} (not a valid address)`);
      continue;
    }
    const file = path ? target(path) : page;
    if (!existsSync(file)) {
      broken.push(`${relative(DIST, page)} → ${written}`);
    } else if (id && file.endsWith('.html') && !idsOf(file).has(id)) {
      broken.push(`${relative(DIST, page)} → ${written} (no element with id "${id}")`);
    }
  }
}

const unique = [...new Set(broken)];
if (unique.length) {
  console.error(`check-links: ${unique.length} broken internal link(s):\n  ${unique.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-links: ${checked} internal links, all resolve`);
