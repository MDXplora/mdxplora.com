import { expect, type Locator } from '@playwright/test';
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

// The site speaks as "the MDXplora team". Its operator is named on the privacy page only, as the data controller.
//
// His name is written here as character codes, a form the check below does not read, so that this file, like every
// file but the privacy page, holds it in no form the check finds; each example of it in the tests is built from it.
export const OPERATOR = String.fromCharCode(65, 100, 101, 107, 117, 110, 108, 101, 32, 65, 105, 110, 97);
export const [GIVEN, FAMILY] = OPERATOR.split(' ');
// The short form of his given name, its last five letters.
export const SHORT = GIVEN.slice(3);

// A word in the text as it reads (see folded below): each letter in either case, an l also as a capital I, and an i
// also as an l. With the look-alike letters made Latin, a capital I of any script, or a palochka, stands for either.
const STANDS_FOR: Record<string, string> = { l: '[lLI]', i: '[iIl]' };
const spelled = (word: string) =>
  [...word]
    .map((letter) => STANDS_FOR[letter.toLowerCase()] ?? `[${letter.toLowerCase()}${letter.toUpperCase()}]`)
    .join('');
// A name is found as a word: a letter or mark on either side makes it part of another word, unless the case changes
// there, as in a handle that goes on with Lab. A digit is no part of a word, so a handle ending in a year is found. His
// given name, its short form and his family name are each found alone, so another person of the same name is found
// too. His family name is also a Finnish word, which the site, in English, has no use for, so it is refused in any
// sense.
const START = String.raw`(?:(?<![\p{L}\p{M}])|(?<=\p{Ll})(?=\p{Lu}))`;
const END = String.raw`(?:(?![\p{L}\p{M}])|(?<=\p{Ll})(?=\p{Lu}))`;
// And joined into a handle, either way round and with at most two characters between, as in an address: his given
// name, its short form or his initials, and his family name; or his given name or its short form and the first letter
// of his family name. His initials are the first letter of his given name, alone or with that of its short form; the
// second alone is not looked for, since it and his family name make a common word.
//
// A report masks his whole given name before its short form alone, which it ends with, is looked for, so that no part
// of it is shown: these are the patterns with the short form, and those without it alone.
const between = String.raw`[^\p{L}\p{M}\p{N}]{0,2}`;
const patterns = (given: string) => {
  const givenOrInitials = `(?:${given}|${spelled(GIVEN[0])}(?:${spelled(SHORT[0])})?)`;
  return [
    [new RegExp(`${START}(?:${given}|${spelled(FAMILY)})${END}`, 'uy'), 'his name'],
    [
      new RegExp(
        `${START}(?:${givenOrInitials}${between}${spelled(FAMILY)}|${spelled(FAMILY)}${between}${givenOrInitials}|` +
          `${given}${spelled(FAMILY[0])})${END}`,
        'uy',
      ),
      'a handle of his',
    ],
  ] as const;
};
const FOUND = patterns(`(?:${spelled(GIVEN.slice(0, 3))})?${spelled(SHORT)}`);
const FOUND_WHOLE = patterns(spelled(GIVEN));
// What is found, said without the name, and what finds it: all that the check looks for, or with whole set, all but
// the short form of his given name alone.
export type Found = 'his name' | 'a handle of his';
export type Finder = (text: string, whole?: boolean) => Found | undefined;
// Each is looked for only where it can start: up to his given name and two characters more before his family name or
// the short form of his given name, one of which every way of writing either holds.
const HOLDS = new RegExp(`(?=${spelled(FAMILY)}|${spelled(SHORT)})`, 'g');
const BACK = GIVEN.length + 2;
// A run of base64 is not read where base64 is written: drawn at random, its letters and digits spell his family name
// between a capital or a digit about once in 5 MB. That is the value of an integrity or policy hash, of the length its
// digest takes, the data of a data: address, after base64,, and any other run of twenty or more of its characters. A /
// parts the segments of a path, as in a link to a commit, so in any other run each segment between two is judged on
// its own. A run or segment is base64 when a digit, + or / is among its characters, which change between capitals,
// small letters and the rest at least twice in five places, as a word, a name or a handle written in them hardly ever
// does.
const BASE64 = new RegExp(
  [
    '(?<=sha256-)[A-Za-z0-9+/]{43}=',
    '(?<=sha384-)[A-Za-z0-9+/]{64}(?![A-Za-z0-9+/=])',
    '(?<=sha512-)[A-Za-z0-9+/]{86}==',
    '(?<=base64,)[A-Za-z0-9+/]+=*',
    '([A-Za-z0-9+/]{20,})',
  ].join('|'),
  'g',
);
const sortOf = (char: string) => (char >= 'a' && char <= 'z' ? 1 : char >= 'A' && char <= 'Z' ? 2 : 0);
function isBase64(run: string): boolean {
  run = run.replace(/=+$/, '');
  if (!/[0-9+/]/.test(run)) return false;
  let changes = 0;
  for (let i = 1; i < run.length; i++) if (sortOf(run[i]) !== sortOf(run[i - 1])) changes++;
  return changes >= 0.4 * (run.length - 1);
}
// Where a text is base64 and not read, each as its start and end.
function base64In(text: string): [number, number][] {
  const runs: [number, number][] = [];
  for (const { 0: run, 1: other, index } of text.matchAll(BASE64))
    for (const part of other === undefined ? [{ 0: run, index: 0 }] : run.matchAll(/[^/]+/g))
      if (isBase64(part[0])) runs.push([index + part.index, index + part.index + part[0].length]);
  return runs;
}
function found(text: string, whole = false): Found | undefined {
  const holds = [...text.matchAll(HOLDS)].map((m) => m.index);
  if (!holds.length) return undefined;
  const runs = base64In(text);
  const read = holds.filter((at) => !runs.some(([start, end]) => at >= start && at < end));
  for (const [pattern, kind] of whole ? FOUND_WHOLE : FOUND)
    for (const at of read)
      for (let start = Math.max(0, at - BACK); start <= at; start++) {
        pattern.lastIndex = start;
        if (pattern.test(text)) return kind;
      }
  return undefined;
}
// Text without the marks on its letters, so his name is found written with the tone marks of Yoruba, all or some of
// them: decomposed (NFD), without its combining marks, and composed again (NFC). His family name with only one mark
// is refused as it is without any: the site, in English, has no use for it. Text without its marks is folded again, so
// a look-alike letter with a mark, such as a Greek iota with tonos or a Cyrillic yi, is made Latin too.
const unmarked = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

// Text with its letters written out: character references, as HTML and XML write them (&#101;, &eacute;), then
// percent-encoding, as an address writes it (%41), then the backslash escapes of JavaScript, JSON and CSS (\u0041,
// \41). References are decoded as the text of a textarea is, so the markup around them is kept.
const textarea = parseFragment('<textarea></textarea>').childNodes[0] as DefaultTreeAdapterTypes.Element;
function decoded(text: string): string {
  const referenced = parseFragment(textarea, text, {})
    .childNodes.map((node) => ('value' in node ? node.value : ''))
    .join('');
  const byte = (hex: string) => String.fromCharCode(parseInt(hex, 16));
  const percent = referenced.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-9a-f]{2})/gi, (_, hex) => byte(hex));
    }
  });
  return percent.replace(
    /\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([0-9a-f]{1,6})\s?/gi,
    (escape, ...hex) => {
      const code = parseInt(hex.slice(0, 4).find(Boolean), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : escape;
    },
  );
}

// Letters of other scripts drawn as Latin letters are: those of his name, and the capital I and palochka that can
// stand for an l or an i.
const LOOK_ALIKES = new Map([
  // Cyrillic: a, A, d, e, E, k, K, i, I, and the palochka, drawn as l or I.
  ['\u0430', 'a'],
  ['\u0410', 'A'],
  ['\u0501', 'd'],
  ['\u0435', 'e'],
  ['\u0415', 'E'],
  ['\u043a', 'k'],
  ['\u041a', 'K'],
  ['\u0456', 'i'],
  ['\u0406', 'I'],
  ['\u04cf', 'l'],
  ['\u04c0', 'l'],
  // Greek: alpha, Alpha, Epsilon, kappa, Kappa, iota, Iota, Nu and upsilon.
  ['\u03b1', 'a'],
  ['\u0391', 'A'],
  ['\u0395', 'E'],
  ['\u03ba', 'k'],
  ['\u039a', 'K'],
  ['\u03b9', 'i'],
  ['\u0399', 'I'],
  ['\u039d', 'N'],
  ['\u03c5', 'u'],
  // The dotless i.
  ['\u0131', 'i'],
]);
const LOOK_ALIKE = new RegExp(`[${[...LOOK_ALIKES.keys()].join('')}]`, 'gu');
// Text as it reads: in its compatibility form (NFKC), so a fullwidth or styled letter is the letter, without the
// characters that are not shown, such as a soft hyphen, a zero width space or a variation selector, and with the
// look-alike letters above made Latin.
const folded = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(LOOK_ALIKE, (letter) => LOOK_ALIKES.get(letter)!);

// The text of markup without its tags and comments, as parse5 reads a page, and as a pattern reads tags in any other
// text, such as markup written in a script. An element that breaks the text, such as a block, a line break, a control,
// an image or the title, parts the text on either side of it; one that draws nothing where it is, a script, a style,
// a template, a noscript, a link or meta tag, or an element marked hidden, is taken out with all it holds, so the text
// on either side of it joins, and what it holds is read after the rest, on its own; any other, such as a span, a wbr,
// a ruby, an SVG tspan or a custom element, joins the text.
const BREAKING = new RegExp(
  `^(?:${[
    // The document, its head and its title.
    'html|head|body|title|base',
    // Blocks, lists and tables.
    'address|article|aside|blockquote|details|dialog|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]',
    'header|hgroup|hr|legend|li|main|menu|nav|ol|p|pre|search|section|summary|ul',
    'table|caption|colgroup|col|thead|tbody|tfoot|tr|th|td',
    // A line break, an image or other embedded content, and a control.
    'br|img|picture|source|track|video|audio|iframe|embed|object|canvas|svg|math',
    'input|button|select|option|optgroup|datalist|textarea|output|meter|progress',
    // SVG's own blocks of text.
    'text|desc|foreignObject',
  ].join('|')})$`,
  'i',
);
const DRAWS_NOTHING = /^(?:link|meta|style|script|noscript|template)$/i;
// Such an element in any other text: one of those that holds text, or any marked hidden, from its start tag to its end.
const HELD = new RegExp(
  [
    String.raw`<(style|script|noscript|template)\b[^<>]*>([\s\S]*?)<\/\1\s*>`,
    String.raw`<([a-z][^\s/<>]*)\s(?:[^<>]*\s)?hidden(?=[\s=/>])[^<>]*>([\s\S]*?)<\/\3\s*>`,
  ].join('|'),
  'gi',
);
function withoutMarkup(text: string): string[] {
  type Node = DefaultTreeAdapterTypes.Node;
  const drawsNothing = (node: Node) =>
    'tagName' in node && (DRAWS_NOTHING.test(node.tagName) || node.attrs.some((attr) => attr.name === 'hidden'));
  const inside = (node: Node): Node[] => [
    ...('content' in node ? [node.content] : []),
    ...('childNodes' in node ? [...node.childNodes].reverse() : []),
  ];
  const parsed: string[] = [];
  const apart: Node[] = [];
  const stack: (Node | string)[] = [parse(text)];
  while (stack.length || apart.length) {
    if (!stack.length) {
      parsed.push('\n');
      stack.push(...inside(apart.shift()!));
      continue;
    }
    const node = stack.pop()!;
    if (typeof node === 'string') {
      parsed.push(node);
      continue;
    }
    if (drawsNothing(node)) {
      apart.push(node);
      continue;
    }
    if (node.nodeName === '#text') parsed.push((node as DefaultTreeAdapterTypes.TextNode).value);
    if ('tagName' in node && BREAKING.test(node.tagName)) {
      parsed.push('\n');
      stack.push('\n');
    }
    stack.push(...inside(node));
  }
  const pieces: string[] = [];
  for (const held = [text]; held.length;)
    pieces.push(
      held.shift()!.replace(HELD, (_, _name, first?: string, _other?: string, second?: string) => {
        held.push(first ?? second ?? '');
        return '';
      }),
    );
  const tag = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][^\s/<>]*)[^<>]*>/gi;
  return [
    parsed.join(''),
    pieces.join('\n').replace(tag, (_, name?: string) => (name && BREAKING.test(name) ? '\n' : '')),
  ];
}

// The operator's name in a text, as written, decoded up to three times (an encoded reference, such as %26%23101;, is
// decoded twice), and without its markup before and after each decoding, so a tag written escaped, as \x3cb> or
// &lt;wbr&gt;, is taken out too; each of these as it is, folded, and folded without its marks.
export function namedIn(text: string, whole = false): Found | undefined {
  const named = (view: string) => {
    const read = folded(view);
    return (
      found(view, whole) ?? found(read, whole) ?? found(unmarked(read), whole) ?? found(folded(unmarked(read)), whole)
    );
  };
  // A decoded view is read without its markup when decoding made a tag, as it does when it adds a <.
  const tags = (view: string) => view.split('<').length;
  for (const base of [text, ...withoutMarkup(text)]) {
    let view = base;
    for (let pass = 0; pass <= 3; pass++) {
      const tagged = pass && base === text && tags(view) > tags(text);
      const kind = named(view) ?? (tagged ? withoutMarkup(view).map(named).find(Boolean) : undefined);
      if (kind) return kind;
      const next = decoded(view);
      if (next === view) break;
      view = next;
    }
  }
  return undefined;
}

// The operator's name in a file's bytes, such as an image's or a font's metadata (EXIF, XMP, a PNG's text), read as
// Latin-1, as they are and with zero bytes left out, so a name written in UTF-16, as a font's name table writes it, is
// found too.
export function namedInBytes(bytes: string, whole = false): Found | undefined {
  for (const read of [bytes, bytes.replaceAll('\0', '')].map(folded)) {
    const kind = found(read, whole);
    if (kind) return kind;
  }
  return undefined;
}

// The shortest part of a text that holds the operator's name. A part is read with a stand-in on either side for the
// character next to it, so its ends are not taken for the ends of a word, nor a word's ends for its own: Q, q, a
// combining mark or a space, for a capital, another letter, a mark or anything else. Q and q are no letters of his
// name, and a space joins no encoding or tag.
function locate(text: string, find: (text: string) => Found | undefined): [number, number] {
  const standIn = (char: string | undefined, before: boolean) =>
    char === undefined
      ? ''
      : /\p{Lu}/u.test(char)
        ? 'Q'
        : /\p{Ll}/u.test(char)
          ? 'q'
          : /\p{L}/u.test(char)
            ? before
              ? 'Q'
              : 'q'
            : /\p{M}/u.test(char)
              ? '\u0301'
              : ' ';
  const part = (start: number, end: number) =>
    find(
      standIn([...text.slice(Math.max(0, start - 2), start)].at(-1), true) +
        text.slice(start, end) +
        standIn([...text.slice(end, end + 2)][0], false),
    ) !== undefined;
  let [low, high] = [0, text.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (part(0, middle)) high = middle;
    else low = middle + 1;
  }
  const end = low;
  [low, high] = [0, end];
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (part(middle, end)) low = middle;
    else high = middle - 1;
  }
  return [low, end];
}
// Letters and digits shown as *, one for each UTF-16 unit, so the text keeps its length.
export const hidden = (text: string) => text.replace(/[\p{L}\p{N}]/gu, (char) => '*'.repeat(char.length));
// A word, and the characters that are not shown within it, and the zero bytes between the letters of text in UTF-16.
const WORD = /[\p{L}\p{M}\p{N}\p{Default_Ignorable_Code_Point}\0]+/gu;
// A word read loosely: folded, without its marks or zero bytes, in lower case, and an i and an l taken as one letter.
// A word that holds his given name, its short form or his family name read so, such as one the check does not find
// since it goes on in lower case after capitals, is masked too.
const loosely = (text: string) =>
  folded(unmarked(folded(text)))
    .replaceAll('\0', '')
    .toLowerCase()
    .replace(/[il]/g, '|');
const LOOSE_NAMES = [GIVEN, SHORT, FAMILY].map(loosely);
// Any three letters in a row of them, read so.
const LOOSE_PARTS = [
  ...new Set(LOOSE_NAMES.flatMap((name) => [...name.slice(2)].map((_, at) => name.slice(at, at + 3)))),
];
// A word beside a part masked, with at most two characters between that are not letters or digits, that holds three letters in a row
// of his given name, its short form or his family name, read loosely, is masked too, and so on along the text, so the
// rest of his name is not shown beside the part found, as in an address or a name written with a hyphen.
function besideMasked(text: string, shown: string): string {
  const isMask = (at: number) => shown[at] === '*' && text[at] !== '*';
  const isWord = (at: number) => /[\p{L}\p{M}\p{N}\p{Default_Ignorable_Code_Point}\0]/u.test(shown[at]);
  const beside = (from: number, step: number) => {
    for (let at = from, between = 0; at >= 0 && at < shown.length && between <= 2; at += step, between++) {
      if (isMask(at)) return true;
      if (isWord(at)) return false;
    }
    return false;
  };
  for (let before = ''; before !== shown;) {
    before = shown;
    shown = shown.replace(WORD, (word, at: number) => {
      const read = loosely(word);
      const near =
        LOOSE_PARTS.some((part) => read.includes(part)) && (beside(at - 1, -1) || beside(at + word.length, 1));
      return near ? hidden(word) : word;
    });
  }
  return shown;
}
// A text with each part that names the operator masked, and the whole word around it, its letters and digits shown as
// *, so a report does not print his name: his whole given name first, then the short form of it alone. It keeps its
// length.
export function masked(text: string, find: Finder = namedIn): string {
  let shown = text;
  for (const whole of [true, false])
    while (find(shown, whole) !== undefined) {
      let [start, end] = locate(shown, (part) => find(part, whole));
      start -= /[\p{L}\p{M}\p{N}]*$/u.exec(shown.slice(0, start))![0].length;
      end += /^[\p{L}\p{M}\p{N}]*/u.exec(shown.slice(end))![0].length;
      const next = shown.slice(0, start) + hidden(shown.slice(start, end)) + shown.slice(end);
      if (next === shown) return hidden(shown);
      shown = next;
    }
  shown = shown.replace(WORD, (word) =>
    LOOSE_NAMES.some((name) => loosely(word).includes(name)) ? hidden(word) : word,
  );
  return besideMasked(text, shown);
}

// How much text a report shows on either side of where he is named, and how much more it masks before it is cut: more
// than his name and a handle of his take written out with each letter encoded, so a mention the cut would split is
// masked in full.
const AROUND = 30;
const WIDER = 20 * (GIVEN.length + 2 + FAMILY.length);
// Where the operator's name is in a text, masked: what is found, its line, or its byte in a file read as bytes, the
// part that holds it and some text around it, any character outside printable ASCII escaped. Nothing when he is not
// named. Bytes are shown without their zero bytes, so text in UTF-16 reads as it is written, and are masked wherever
// either the finder that found him or the check of text, which decodes references and escapes, finds him.
export function whereNamed(text: string, find: Finder = namedIn): string | undefined {
  if (find(text) === undefined) return undefined;
  const whole = find(text, true) !== undefined;
  const kind = find(text, whole);
  const [start, end] = locate(text, (part) => find(part, whole));
  const from = Math.max(0, start - AROUND - WIDER);
  const window = text.slice(from, end + AROUND + WIDER);
  const kept = [...Array(window.length).keys()].filter((at) => find === namedIn || window[at] !== '\0');
  const plain = kept.map((at) => window[at]).join('');
  const wide =
    find === namedIn ? masked(plain) : masked(plain, (part, whole) => find(part, whole) ?? namedIn(part, whole));
  const shown = (start: number, end: number) =>
    kept
      .flatMap((at, i) => (at >= start - from && at < end - from ? [wide[i]] : []))
      .join('')
      .replace(/[^\x20-\x7e]|\\/gu, (char) => (char === '\\' ? '\\\\' : `\\u{${char.codePointAt(0)!.toString(16)}}`));
  const at = find === namedIn ? `on line ${text.slice(0, start).split('\n').length}` : `at byte ${start}`;
  return `${kind} ${at}, written "${shown(start, end)}", in "${shown(start - AROUND, end + AROUND)}"`;
}

// A test's report is printed, in the public log of each run too, so none shows the operator's name. Text that could
// hold it, of a page or a file, a path or a title, is masked in a report, and an expectation about such text reports
// what it looks for and where, masked, rather than the text received.
export function expectText(text: string | null | undefined, words: string | RegExp, where: string, holds = true) {
  const read = text ?? '';
  const match = typeof words === 'string' ? (read.includes(words) ? words : undefined) : read.match(words)?.[0];
  const said = `${where} ${holds ? 'says' : 'does not say'} ${words}`;
  expect(match !== undefined, masked(match !== undefined && !holds ? `${said}, as in "${match}"` : said)).toBe(holds);
}
// Whether a text is exactly what is expected, both shown masked.
export function expectExactly(text: string | null | undefined, expected: string, where: string) {
  expect(text === expected, masked(`${where} reads "${expected}", not "${text}"`)).toBe(true);
}
// The text of a part of a page, its spaces made single.
export const textOf = async (part: Locator) => ((await part.textContent()) ?? '').replace(/\s+/g, ' ');
