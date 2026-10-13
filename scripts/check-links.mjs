// Every internal link in the built site must lead to a page that exists, and a link to a part of a page (#name) to an
// element with that id. Links written as full addresses on this site (https://mdxplora.com/..., such as a page's
// canonical address and its preview image) count as internal. Read from href, src and content attributes, from each
// candidate in srcset and imagesrcset, and from the address values in structured data (JSON-LD), such as url and logo.
//
// Each page is read with parse5, which follows the HTML standard. Scripting is off, so the content of a noscript is
// read as markup, as a browser with JavaScript off reads it: its links are real for those visitors. Links are read from
// the attributes above on every element, and ids from every element, with character references decoded (/a&amp;b/ is
// /a&b/) and whether the value is in double quotes, single quotes or none. Nothing in a comment, or in the text of a
// script, a style or another element that holds only text, is read. Structured data is the text of an HTML script whose
// type is application/ld+json, compared as a MIME type is: only the part before any ";", without the ASCII whitespace
// around it, in any ASCII case. It is read as JSON.
//
// The content of a template and of a noscript is read too, and its links are checked. But an id on a template or a
// noscript, or on any element inside one, counts for no link. A link cannot reach a template or its content: a script
// must first copy the content into the page. Where a template's shadowrootmode is open or closed, a browser shows its
// content as a shadow root of the element around it, but a link cannot reach into a shadow root either; where it cannot
// attach one, as on an a element, which cannot host one, or on an element that has a shadow root already, the template
// stays a template. A noscript and its content are shown only with JavaScript off. So one exception: an id on or inside
// a noscript counts for a link inside a noscript, on the same page or another, since with JavaScript off both are there.
// This holds only when neither the link nor the id is inside a template.
//
// Not read: xlink:href, which svg once used for links.
//
// Where parse5 8.0.1 and Chromium differ, as far as is known and it matters here. Check this list again when parse5 is
// updated.
// - Inside a select, parse5 drops each start tag other than option, optgroup, hr, script and template (input, keygen,
//   textarea and select end the select first), while Chromium keeps those elements. So an HTML select whose source
//   between its start and end tags holds "<" and a letter, other than in a comment, a script or a template inside the
//   select, or as the start of an option, optgroup, hr, script or template, is reported: such content is not supported
//   here, and the markup must be changed. This errs towards reporting, so "<" in an attribute value there is reported
//   too. A select inside a template is read the same way.
// - In <svg><desc><b></desc></svg></b></desc><style>...</style>, parse5 reads the style as text and Chromium as svg, so
//   a link in it is not checked. No parse error shows this, so it is not reported.
// - In a table in a template, parse5 drops a form start tag, as the standard says, and Chromium keeps it. An id inside
//   a template counts for no link anyway, so this changes only the reason given for a link to the form's id.
//
// A page whose parse ends inside a comment, a tag, a CDATA section or the text of an element that holds only text, or
// that has a plaintext element, is reported: what follows is then read as text, and on a built page that is a fault. So
// is a page whose head holds a noscript with content that belongs in the body: with JavaScript off that content is in
// the body, and with it on it is only text, so browsers read it differently and the markup must be changed.
//
// A "{", or "%7B" as it is written when encoded, in an internal link is a placeholder left unfilled and is reported.
// Exempt are only the parts that are not checked at all: in a URL template (a urlTemplate, or a target written as one),
// the whole query and fragment when its first placeholder is in either, and all of it when that placeholder is in the
// path; and the fragment of an @id in structured data.
//
// The tree is walked without recursion, so a page nested however deep is read in full. Structured data nested too deep
// to read, some thousands of levels, is reported.
//
// External links are not fetched.
//
// Usage: node scripts/check-links.mjs [dist]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'parse5';

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
// is checked. Of a urlTemplate, or a target written as one, only the part known before it is filled in is checked (see
// templateBase); anywhere else, a "{" in an address on this site, even in its query, is reported as a placeholder left
// unfilled, though not in the fragment of an @id, which is not checked. Names, descriptions, the @context and the @id
// names of nodes elsewhere are not links.
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

// The part of a URL template (RFC 6570) that is known before it is filled in. When the first placeholder is in the
// query or fragment (?q={q}, {?q}, #{name}), that is the address without its query and fragment, so nothing in them is
// checked, even before the placeholder (/about/?x=1&q={q} is checked as /about/). Nothing when a placeholder is in the
// path (/docs/{slug}), since the page is then not known.
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

const HTML = 'http://www.w3.org/1999/xhtml';
// The parse errors that make a page reported, and what is said of it.
const endsInside = (what) => `the page ends inside ${what}, so what follows is not read`;
const PARSE_ERRORS = {
  'eof-in-comment': endsInside('a comment'),
  'eof-in-tag': endsInside('a tag'),
  'eof-in-cdata': endsInside('a CDATA section'),
  'eof-in-element-that-can-contain-only-text': endsInside(
    'the text of an element that holds only text, such as a script or a style',
  ),
  'disallowed-content-in-noscript-in-head':
    'a noscript in the head holds content that belongs in the body, which browsers read differently with JavaScript ' +
    'on and off, so change the markup',
};
// The start tags parse5 keeps inside a select. It keeps a template too, but that is skipped with its content below.
const SELECT_KEEPS = new Set(['option', 'optgroup', 'hr', 'script']);

// Whether a script's type is that of structured data: its essence, the part before any ";", compared without the ASCII
// whitespace around it and in any ASCII case, as a MIME type is compared.
const isStructuredData = (type) =>
  type !== undefined &&
  type
    .split(';')[0]
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'application/ld+json';

// What each page holds, read once: each link as [written, checked, whether it is inside a noscript and not inside a
// template], its ids, the ids a visitor may not see (see the header), and what is wrong with the page itself.
const read = new Map();
function readPage(file) {
  if (read.has(file)) return read.get(file);
  const source = readFileSync(file, 'utf8');
  const found = [];
  const ids = new Set();
  // Ids on or inside a noscript and not inside a template, and ids on or inside a template.
  const noscriptIds = new Set();
  const templateIds = new Set();
  const problems = [];
  // The source of each select after its start tag, and the source of each comment, script and template, since a tag in
  // one of these is not a tag of the select around it.
  const selects = [];
  const skipped = [];
  const onParseError = ({ code }) => {
    if (Object.hasOwn(PARSE_ERRORS, code)) problems.push(PARSE_ERRORS[code]);
  };
  // Each node, with whether it is inside a template, and whether inside a noscript.
  const tree = parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true, onParseError });
  const stack = [{ node: tree, inTemplate: false, inNoscript: false }];
  while (stack.length) {
    const { node, inTemplate, inNoscript } = stack.pop();
    const noscriptOnly = inNoscript && !inTemplate;
    const at = node.sourceCodeLocation;
    // The name of an HTML element; an svg or math element of the same name is another element.
    const html = node.namespaceURI === HTML ? node.tagName : undefined;
    if (node.tagName) {
      // An attribute in a namespace, such as xlink:href in svg, is left out.
      const attributes = new Map(node.attrs.filter((a) => !a.namespace).map((a) => [a.name, a.value]));
      const id = attributes.get('id');
      // Whether the element is a template or inside one, and whether a noscript or inside one.
      const onTemplate = inTemplate || html === 'template';
      const onNoscript = inNoscript || html === 'noscript';
      if (id) (onTemplate ? templateIds : onNoscript ? noscriptIds : ids).add(id);
      const add = (link) => found.push([link, link, noscriptOnly]);
      for (const key of ['href', 'src']) if (attributes.has(key)) add(attributes.get(key));
      const content = attributes.get('content');
      if (content && /^https:\/\/mdxplora\.com(?:[/?#]|$)/.test(content)) add(content);
      for (const key of ['srcset', 'imagesrcset'])
        if (attributes.has(key)) for (const link of srcsetAddresses(attributes.get(key))) add(link);
      if (html === 'script' && isStructuredData(attributes.get('type'))) {
        try {
          // One at a time: spreading a long list into push overflows the stack.
          for (const [written, link] of addresses(JSON.parse(node.childNodes.map((text) => text.value).join(''))))
            found.push([written, link, noscriptOnly]);
        } catch (error) {
          // Data nested too deep to follow overflows the stack, which is not bad JSON.
          problems.push(
            error instanceof RangeError
              ? 'structured data nested too deep to read'
              : 'structured data that is not valid JSON',
          );
        }
      }
      if (html === 'plaintext') problems.push(endsInside('a plaintext element'));
      if (html === 'select' && at?.startTag) selects.push([at.startTag.endOffset, at.endOffset]);
      if (at && (html === 'script' || html === 'template')) skipped.push([at.startOffset, at.endOffset]);
    } else if (at && node.nodeName === '#comment') skipped.push([at.startOffset, at.endOffset]);
    // The children are taken in order, then the content of a template.
    if (node.content) stack.push({ node: node.content, inTemplate: true, inNoscript });
    const inside = { inTemplate, inNoscript: inNoscript || html === 'noscript' };
    for (const child of [...(node.childNodes ?? [])].reverse()) stack.push({ node: child, ...inside });
  }
  // Inside a select, parse5 drops a start tag it does not keep, though Chromium keeps the element.
  for (const [from, to] of selects) {
    const tags = new Set();
    for (const tag of source.slice(from, to).matchAll(/<([A-Za-z][^\t\n\f\r />]*)/g)) {
      const offset = from + tag.index;
      const name = tag[1].toLowerCase();
      // Only a comment, script or template that starts inside the select is skipped, not a template around it.
      if (!SELECT_KEEPS.has(name) && !skipped.some(([start, end]) => from <= start && start <= offset && offset < end))
        tags.add(`<${name}>`);
    }
    if (tags.size)
      problems.push(`a select holds ${[...tags].join(', ')}, which is not supported here, so change the markup`);
  }
  read.set(file, { found, ids, noscriptIds, templateIds, problems });
  return read.get(file);
}

const broken = [];
let checked = 0;
for (const page of pages(DIST)) {
  const { found, problems } = readPage(page);
  for (const problem of problems) broken.push(`${relative(DIST, page)} → ${problem}`);
  // Each link as written, the address on this site it leads to, and whether it is inside a noscript.
  const links = found
    .map(([written, link, inNoscript]) => [written, onSite(link), inNoscript])
    .filter(([, href]) => href);
  for (const [written, href, inNoscript] of links) {
    checked++;
    // A template is checked without the query and fragment its first placeholder is in, or not at all (see
    // templateBase), so a "{" left in what is checked, or "%7B" as it is encoded, is a placeholder never filled.
    if (/\{|%7b/i.test(href)) {
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
    } else if (id && file.endsWith('.html')) {
      const to = readPage(file);
      // With JavaScript off, a link inside a noscript and an id inside a noscript are both there.
      if (to.ids.has(id) || (inNoscript && to.noscriptIds.has(id))) continue;
      let reason = `no element with id "${id}"`;
      if (to.noscriptIds.has(id))
        reason = `the id "${id}" is only on or inside a noscript, which a visitor sees only with JavaScript off`;
      else if (to.templateIds.has(id))
        reason = `the id "${id}" is only on or inside a template, which a link cannot reach`;
      broken.push(`${relative(DIST, page)} → ${written} (${reason})`);
    }
  }
}

const unique = [...new Set(broken)];
if (unique.length) {
  console.error(`check-links: ${unique.length} broken internal link(s):\n  ${unique.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-links: ${checked} internal links, all resolve`);
