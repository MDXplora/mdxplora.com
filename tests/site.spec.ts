import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, deflateSync, inflateSync } from 'node:zlib';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import ts from 'typescript';
import {
  FAMILY,
  GIVEN,
  OPERATOR,
  SHORT,
  expectExactly,
  expectText,
  masked,
  namedIn,
  namedInBytes,
  textOf,
  whereNamed,
} from './lib/operator-name';

const pages = ['/', '/compute/', '/services/', '/early-access/', '/contact/', '/privacy/'];

for (const path of pages) {
  test(`${path} loads cleanly and fits the screen`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(0);
    expect(
      errors.map((error) => masked(error)),
      path,
    ).toEqual([]);
  });
}

test('every page carries the security policy and nothing on it breaks the policy', async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (v: string) => violations.push(v));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`,
      ),
    ),
  );
  for (const path of [...pages, '/no-such-page/']) {
    await page.goto(path);
    const policy = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", 'script-src ']) {
      expectText(policy, directive, `the policy of ${path}`);
    }
    expectText(
      policy,
      'unsafe-inline',
      `the policy of ${path}, which allows no inline code by blanket permission,`,
      false,
    );
    // Every inline script the page runs is allowed by its own hash, wherever it sits in the page.
    const inline = await page.locator('script:not([src]):not([type="application/ld+json"])').allTextContents();
    for (const source of inline) {
      const hash = `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
      expectText(policy, hash, masked(`the policy of ${path}, for ${source.slice(0, 60)},`));
    }
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
  }
  // Give late scripts (the form) a moment to run.
  await page.goto('/');
  await page.waitForTimeout(500);
  expect(violations.map((violation) => masked(violation))).toEqual([]);
});

test('visits are counted only when configured, only on the live site, and the privacy page says which', async ({
  page,
}) => {
  const beaconRequests: string[] = [];
  page.on('request', (r) => r.url().includes('cloudflareinsights.com') && beaconRequests.push(r.url()));
  await page.goto('/privacy/');
  const loader = page.locator('script[data-token]');
  const policy = (await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content')) ?? '';
  const prose = page.locator('.prose');

  // The privacy page names the operator, so its text is never printed.
  const said = await textOf(prose);
  if ((await loader.count()) === 0) {
    expectText(policy, 'cloudflareinsights', 'the policy', false);
    expectText(said, 'runs no analytics', 'the privacy page');
    expectText(said, 'Visit counts', 'the privacy page', false);
  } else {
    await expect(loader).toHaveAttribute('data-host', 'mdxplora.com');
    expectText(policy, 'https://static.cloudflareinsights.com/beacon.min.js', 'the policy');
    expectText(policy, /connect-src [^;]*https:\/\/cloudflareinsights\.com/, 'the policy');
    expectText(said, 'Visit counts', 'the privacy page');
    expectText(said, 'runs no analytics', 'the privacy page', false);
  }
  // This test serves the site from localhost, which must never be counted.
  await page.goto('/');
  await page.waitForTimeout(300);
  expect(beaconRequests.map((address) => masked(address))).toEqual([]);
  if ((await loader.count()) === 0) return;

  // On the live domain (answered here from this build), the counter loads and the policy lets it report.
  await page.route('https://mdxplora.com/**', async (route) =>
    route.fulfill({ response: await page.request.get(new URL(route.request().url()).pathname) }),
  );
  await page.route('https://static.cloudflareinsights.com/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "fetch('https://cloudflareinsights.com/cdn-cgi/rum', { method: 'POST', body: document.currentScript.dataset.cfBeacon });",
    }),
  );
  let reported = '';
  await page.route('https://cloudflareinsights.com/**', async (route) => {
    reported = route.request().postData() ?? '';
    await route.fulfill({ status: 204 });
  });
  await page.goto('https://mdxplora.com/');
  await expect.poll(() => reported).toContain('"token"');
});

test('each page has its own link preview image, matching its headline', async ({ page, request }) => {
  for (const path of pages) {
    await page.goto(path);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    const alt = await page.locator('meta[property="og:image:alt"]').getAttribute('content');
    const twitterAlt = await page.locator('meta[name="twitter:image:alt"]').getAttribute('content');
    const headline = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim();
    expectExactly(alt, `MDXplora: ${headline}`, `the link preview image's alt text on ${path}`);
    expectExactly(twitterAlt, alt ?? '', `the alt text for X on ${path}`);

    // The image is addressed on the live domain; fetch the same path from this build.
    const response = await request.get(new URL(image!).pathname);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('image/png');
    const png = await response.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([1200, 630]);
    expect(png.length, `${path} stays small enough for chat apps`).toBeLessThan(400_000);
  }
});

// Our GPUs and the connector to your own machines are planned. Said as available today: "runs on our GPUs".
const describesCompute = /own workstation or cluster|(?:GPUs|compute) we provide|our GPUs/i;
const availableToday = /(?<!will )\bruns? (?:with the same settings )?on (?:our GPUs|(?:GPUs|compute) we provide)/i;

test('a page that describes the service says it is planned', async ({ page }) => {
  const status = 'MDXplora is being built and opens to early-access groups in stages.';
  for (const path of pages) {
    await page.goto(path);
    // All of the text, the answers in closed questions too, which innerText leaves out.
    const text = await page.locator('main').evaluate((main) => {
      const copy = main.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('script, style').forEach((el) => el.remove());
      copy.querySelectorAll('p, li, summary, figcaption, h1, h2, h3').forEach((el) => el.append(' '));
      return (copy.textContent ?? '').replace(/\s+/g, ' ');
    });
    const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    if (describesCompute.test(text)) {
      expectText(text, status, path);
    }
    for (const said of [text, description]) {
      expectText(said, availableToday, path, false);
      expectText(said, /early access is open\b|\bis in early access\b|in one command/i, path, false);
      // A study on the service is planned, and MDXplora validates its Config rather than checking it.
      expectText(said, /\bstudy is reproducible\b|\bchecked before it runs\b/i, path, false);
    }
  }
});

// The title and text each link preview image draws, read from the source as TypeScript reads it, since the browser
// tests cannot import it (it reads the build's settings). Each card is a string, or a property of `site` given as one
// in src/data/site.ts; a card written in any other way fails here, so none goes unread.
const CARD = 'each card is exactly { slug, title, text }, each a string or, for the title or text, site.<key>';
function drawnCards(
  cardsFile = readFileSync('src/data/cards.ts', 'utf8'),
  siteFile = readFileSync('src/data/site.ts', 'utf8'),
): { slug: string; title: string; text: string }[] {
  // The value a file declares for a name at its top level, without `as const` or `satisfies`.
  const declared = (source: string, name: string) => {
    let value = ts
      .createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true)
      .statements.filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)?.initializer;
    while (
      value &&
      (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))
    )
      value = value.expression;
    return value;
  };
  const fields = (node: ts.Node | undefined) =>
    new Map(
      node && ts.isObjectLiteralExpression(node)
        ? node.properties.map((property) => [
            ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
              ? property.name.text
              : property.getText(),
            ts.isPropertyAssignment(property) ? property.initializer : undefined,
          ])
        : [],
    );
  const site = fields(declared(siteFile, 'site'));
  const cards = declared(cardsFile, 'cards');
  if (!cards || !ts.isArrayLiteralExpression(cards)) throw new Error('src/data/cards.ts declares its cards as a list');
  const string = (node: ts.Expression | undefined, where: string): string => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
    if (node && ts.isPropertyAccessExpression(node) && node.expression.getText() === 'site') {
      const value = site.get(node.name.text);
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) return value.text;
      throw new Error(masked(`${where}: ${node.getText()} is a string in the site object in src/data/site.ts`));
    }
    throw new Error(masked(`${CARD}, and in ${where}, ${node?.getText()} is not`));
  };
  const found = cards.elements.map((card) => {
    const field = fields(card);
    if ([...field.keys()].sort().join() !== 'slug,text,title')
      throw new Error(masked(`${CARD}, and this one is not: ${card.getText()}`));
    const slug = string(field.get('slug'), 'a card');
    const where = `the card ${slug}`;
    return { slug, title: string(field.get('title'), where), text: string(field.get('text'), where) };
  });
  expect(found.length, 'cards read from src/data/cards.ts').toBeGreaterThan(2);
  return found;
}

test('a card is read as TypeScript reads it, or fails saying how it must be written', () => {
  const site = "export const site = {\n  tagline: 'A \\x41', // drawn on the home card\n  count: 2,\n} as const;";
  const list = (...cards: string[]) =>
    `export const cards = [\n${cards.map((card) => `  ${card},\n`).join('')}] as const satisfies readonly Card[];`;
  const fine = ["{ slug: 'a', title: site.tagline, text: 'One' }", "{ slug: 'b', title: 'B', text: 'Two' }"];
  // Escapes, comments and either kind of quote, and the fields in any order.
  const more = [
    "{ slug: 'c', title: \"C's\", /* drawn small */ text: '\\u{44}\\\n' }",
    "{ text: `E`, slug: 'e', // the last\n title: 'E' }",
  ];
  expect(drawnCards(list(...fine, ...more), site)).toEqual([
    { slug: 'a', title: 'A A', text: 'One' },
    { slug: 'b', title: 'B', text: 'Two' },
    { slug: 'c', title: "C's", text: 'D' },
    { slug: 'e', title: 'E', text: 'E' },
  ]);
  for (const [odd, said] of [
    ["{ slug: 'c', title: 'C' }", 'site.<key>, and this one is not: {'],
    ["{ slug: 'c', title: 'C', text: 'Three', alt: 'More' }", 'site.<key>, and this one is not: {'],
    ['...more', 'site.<key>, and this one is not: ...more'],
    ["{ slug: 'c', title: 'C', ...more }", 'site.<key>, and this one is not: {'],
    ["{ slug: 'c', title: `C${x}`, text: 'Three' }", 'and in the card c, `C${x}` is not'],
    ["{ slug: 'c', title: 'C' + 'D', text: 'Three' }", "and in the card c, 'C' + 'D' is not"],
    ["{ slug: 'c', title: other.tagline, text: 'Three' }", 'and in the card c, other.tagline is not'],
    ["{ slug: 'c', title: site.missing, text: 'Three' }", 'the card c: site.missing is a string in the site object'],
    ["{ slug: 'c', title: site.count, text: 'Three' }", 'the card c: site.count is a string in the site object'],
  ])
    expect(() => drawnCards(list(...fine, odd), site), odd).toThrow(said);
  expect(() => drawnCards('export const cards = make();', site)).toThrow('declares its cards as a list');
});

test('a link preview image says what is planned', () => {
  // The image is shown on other sites, without the note on the page.
  for (const { slug, text } of drawnCards()) {
    if (describesCompute.test(text)) expectText(text, /\bwill\b|planned/, `the card ${slug}`);
    expectText(text, availableToday, `the card ${slug}`, false);
  }
});

test('the README says what is planned', () => {
  const readme = readFileSync('README.md', 'utf8');
  const opening = readme.split('\n\n')[2];
  expectText(opening, 'MDXplora is being built and opens to early-access groups in stages.', "the README's opening");
  expectText(readme, /\bis in early access\b/i, 'the README', false);
  // The ways to start are planned too.
  const ways = readme.split('## Three ways to start')[1].split('\n## ')[0];
  const items = ways.split('\n- ').slice(1);
  expect(items.length, 'ways to start in the README').toBe(3);
  for (const item of items) expectText(item, /\bwill\b/, `the README's way to start "${item.slice(0, 40)}"`);
});

test('the answer to "Can I use MDXplora today?" says it plainly', async ({ page }) => {
  await page.goto('/');
  const answer = (await page.locator('details', { hasText: 'Can I use MDXplora today?' }).locator('p').textContent())!;
  expectText(answer, 'MDXplora is being built and opens to early-access groups in stages', 'the answer');
  expect(answer.match(/\bgroups\b/g)?.length, 'says "groups" once').toBe(1);
});

test('a Config written by the Agent or built in the form is validated, in those words', async ({ page }) => {
  await page.goto('/');
  const describe = await textOf(page.locator('.card', { has: page.getByRole('heading', { name: 'Describe it' }) }));
  expectText(describe, 'validates it', 'the card Describe it');
  expectText(describe, /\bchecks?\b/, 'the card Describe it', false);
  const build = await textOf(page.locator('.card', { has: page.getByRole('heading', { name: 'Build it' }) }));
  expectText(build, 'validates each one as you go', 'the card Build it');
  expectText(build, /\bcheck(?:s|ed)?\b/, 'the card Build it', false);
  const readme = readFileSync('README.md', 'utf8');
  expectText(readme, /\*\*Describe it\.\*\*[^\n]*\n?[^\n]*validates? it/, 'the README');
  expectText(readme, /\*\*Build it\.\*\*[^\n]*\n?[^\n]*validate each one as you go/, 'the README');
});

test('DEVELOPMENT.md names every check script', () => {
  const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts);
  const development = readFileSync('DEVELOPMENT.md', 'utf8');
  for (const name of scripts.filter((name) => name.startsWith('check'))) {
    expectText(development, `npm run ${name} `, 'DEVELOPMENT.md');
  }
});

test('Dependabot leaves fflate on 0.7 while the override holds it there', () => {
  const pinned = JSON.parse(readFileSync('package.json', 'utf8')).overrides.satori.fflate;
  const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
  if (pinned.startsWith('0.7.')) {
    expectText(dependabot, /- dependency-name: fflate\n\s+versions: \['>= 0\.8\.0'\]/, '.github/dependabot.yml');
  }
});

test('a chosen theme is remembered on the next page', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.theme-toggle').first().click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.goto('/services/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
});

test('the engine is named only where results must cite it, and nothing links to its repository', async ({ page }) => {
  for (const path of ['/', '/compute/', '/services/', '/early-access/', '/contact/', '/privacy/', '/no-such-page/']) {
    await page.goto(path);
    const elsewhere = await page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelector('#cite')?.remove();
      copy.querySelectorAll('script').forEach((el) => el.remove());
      return copy.textContent ?? '';
    });
    expectText(elsewhere, 'FastMDXplora', `${path} outside the citation`, false);
    const repositoryLinks = await page.locator('a[href^="https://github.com/"]').count();
    expect(repositoryLinks, path).toBe(0);
  }
});

// Until a legal entity is formed, MDXplora is the platform: no page, no part of a page's head, no form answer and no
// file served beside the pages calls it a company or speaks of customers or commerce. The README and DEVELOPMENT.md
// are read by visitors too, and everything under src/, comments included, is published with the repository.
//
// The check is stricter than the rule: it refuses these words about anyone and in any sense, so "products" is refused
// even as a chemist uses it ("reaction products", "a dot product"), and so is "CO." for carbon monoxide ("bound CO.").
// Write around it.
const commerceWords =
  /\b(compan(?:y|ies)|customers?|commerc\w*|corp|corporat\w*|incorporated|LLC|Ltd|enterprises?|business\w*|engagements?|products?|marketing)\b/gi;
// "Co." and "Inc" (with or without its dot) are company forms only with a capital, or all in capitals, and outside an
// address, so they are matched with case, and not after a dot, @, /, hyphen, letter or digit: "Acme Inc", "ACME INC."
// and "Smith & Co." are found, while example.co.uk, t.co, acme-inc.com and o'neil&co@example.org are not. Older engines
// have no inline case flag, so this is a second pattern.
const companyForms = /(?<![.@/\-\p{L}\p{N}])(?:Co\.|CO\.|Inc\b|INC\b)/gu;

// Each word found, with a little of the text around it.
function commerceFound(text: string): string[] {
  return [commerceWords, companyForms].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m) => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)),
  );
}

test('the check for commercial words finds them, and only them', () => {
  for (const words of [
    'Company',
    'A company',
    'a customer',
    'commercial use',
    'used commercially',
    'e-commerce',
    'Example Labs LLC',
    'Example Ltd',
    'Acme Inc.',
    'Acme Inc',
    'ACME INC.',
    'ACME INC',
    'Acme Corp',
    'Acme Corp.',
    'Smith & Co.',
    'Smith &Co.',
    'SMITH & CO.',
    'bound CO.',
    'Product',
    'reaction products',
    'How an engagement works',
    'Marketing',
  ])
    expect(commerceFound(words), words).not.toEqual([]);
  for (const words of [
    'companion',
    'accompany',
    'corpus',
    'production',
    'the platform',
    'In industry',
    'include',
    'Include',
    'incoming',
    'Incoming',
    'INCLUDE',
    'INCOMING',
    'inc',
    'co-authored',
    'Co-authored',
    'example.co.uk',
    'https://t.co/x',
    'example.Co.uk',
    'EXAMPLE.CO.UK',
    'HTTPS://T.CO/X',
    'O’NEIL&CO@EXAMPLE.ORG',
    'MAIL@CO.EXAMPLE',
    '/INC/',
    'TACO.',
    'HTTPS://ACME-INC.COM',
    'https://acme-Inc.example',
    'X2CO.',
    'R2Inc',
    'o’neil&co@example.org',
    "o'neil&co@example.org",
    'mail@Co.example',
    '/Inc/',
    'market',
  ])
    expect(commerceFound(words), words).toEqual([]);
});

// Every page the sitemap lists, so a new page is read too. Each page this file tests is among them.
async function sitemapPages(request: APIRequestContext): Promise<string[]> {
  const locations = async (path: string) =>
    [...(await (await request.get(path)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const listed = (await Promise.all((await locations('/sitemap-index.xml')).map(locations))).flat();
  for (const path of pages)
    expect(listed.includes(path), masked(`${path} is among the pages in the sitemap, ${listed.join(', ')}`)).toBe(true);
  return listed;
}

// The regular files under a folder, hidden ones included. A link is not followed.
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

// The text files under a folder, known by their extension or by having none, as CNAME and .nvmrc have, so an image or a
// font is not read as text.
const TEXT_FILE = /\.(?:astro|ts|tsx|js|jsx|mjs|css|md|mdx|json|webmanifest|yml|yaml|xml|svg|html|txt)$|^\.?[^.]+$/i;
function textFiles(dir: string): string[] {
  return filesUnder(dir).filter((path) => TEXT_FILE.test(basename(path)));
}

test('the word test reads the text files under a folder, and not images, fonts, links or folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'text-files-'));
  try {
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'notes.md'));
    writeFileSync(join(dir, 'page.astro'), 'text');
    writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg/>');
    writeFileSync(join(dir, 'assets', 'photo.png'), 'Adobe Inc.');
    writeFileSync(join(dir, 'assets', 'font.woff2'), 'lTd');
    writeFileSync(join(dir, 'notes.md', 'plan.MD'), 'text');
    writeFileSync(join(dir, 'CNAME'), 'example.org');
    writeFileSync(join(dir, '.nvmrc'), '22');
    mkdirSync(join(dir, '.well-known'));
    writeFileSync(join(dir, '.well-known', 'humans.txt'), 'text');
    symlinkSync(join(dir, 'page.astro'), join(dir, 'link.ts'));
    symlinkSync(join(dir, 'assets'), join(dir, 'linked'));
    expect(
      textFiles(dir)
        .sort()
        .map((file) => masked(file)),
    ).toEqual(
      [
        join(dir, 'assets', 'logo.svg'),
        join(dir, 'notes.md', 'plan.MD'),
        join(dir, 'page.astro'),
        join(dir, 'CNAME'),
        join(dir, '.nvmrc'),
        join(dir, '.well-known', 'humans.txt'),
      ]
        .sort()
        .map((file) => masked(file)),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing calls MDXplora a company or speaks of customers', async ({ page, request }) => {
  for (const path of [...(await sitemapPages(request)), '/no-such-page/']) {
    const response = await page.goto(path);
    expect(response?.status(), masked(path)).toBe(path === '/no-such-page/' ? 404 : 200);
    expect(
      commerceFound(await page.content()).map((found) => masked(found)),
      masked(path),
    ).toEqual([]);
  }
  for (const path of ['/.well-known/security.txt', '/manifest.webmanifest', '/robots.txt']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(
      commerceFound(await response.text()).map((found) => masked(found)),
      path,
    ).toEqual([]);
  }
  const source = textFiles('src');
  expect(source.includes(join('src', 'data', 'cards.ts')), 'src/data/cards.ts is read').toBe(true);
  expect(source.length, 'text files read under src/').toBeGreaterThanOrEqual(26);
  for (const file of ['README.md', 'DEVELOPMENT.md', ...source])
    expect(
      commerceFound(readFileSync(file, 'utf8')).map((found) => masked(found)),
      masked(file),
    ).toEqual([]);
});

// The site speaks as "the MDXplora team". Its operator is named on the privacy page only, as the data controller;
// the check that finds his name, and masks it in a report, is in lib/operator-name.ts.

// The address of each stylesheet a page links to, as written: a link whose rel holds the word stylesheet.
function stylesheetsOf(html: string): string[] {
  const found: string[] = [];
  const stack: DefaultTreeAdapterTypes.Node[] = [parse(html)];
  while (stack.length) {
    const node = stack.pop()!;
    if ('attrs' in node && node.tagName === 'link') {
      const attribute = (name: string) => node.attrs.find((a) => a.name === name)?.value;
      const href = attribute('href');
      if (href && /(?:^|[\t\n\f\r ])stylesheet(?:$|[\t\n\f\r ])/i.test(attribute('rel') ?? '')) found.push(href);
    }
    if ('childNodes' in node) stack.push(...node.childNodes);
  }
  return found;
}

// The text an image or a font holds compressed, each with where it is: the zTXt, compressed iTXt and iCCP chunks of
// a PNG, at the start or inside another file, as an icon holds one, inflated; a WOFF font's tables and metadata, which
// zlib compresses, inflated; and a WOFF2 font's tables and metadata, which Brotli compresses. A font collection is not
// read.
const PNG = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1');
function compressedIn(bytes: Buffer): { where: string; text: Buffer; utf8?: boolean }[] {
  const out: { where: string; text: Buffer; utf8?: boolean }[] = [];
  for (let png = bytes.indexOf(PNG); png >= 0; png = bytes.indexOf(PNG, png + 1)) {
    for (let at = png + 8; at + 12 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) {
      const type = bytes.toString('latin1', at + 4, at + 8);
      if (type === 'IEND' || at + 12 + bytes.readUInt32BE(at) > bytes.length) break;
      const data = bytes.subarray(at + 8, at + 8 + bytes.readUInt32BE(at));
      // Its keyword, ended by a zero byte, then the compression method, or for iTXt a flag, the method, a language
      // and a translated keyword.
      const keyword = data.indexOf(0);
      const where = `its ${type} chunk at byte ${at}, inflated`;
      if (type === 'zTXt' || type === 'iCCP') out.push({ where, text: inflateSync(data.subarray(keyword + 2)) });
      if (type === 'iTXt' && data[keyword + 1] === 1) {
        const translated = data.indexOf(0, data.indexOf(0, keyword + 3) + 1);
        out.push({ where, text: inflateSync(data.subarray(translated + 1)), utf8: true });
      }
    }
  }
  if (bytes.toString('latin1', 0, 4) === 'wOFF') {
    // The table directory, after a header of 44 bytes: for each table its tag, offset, length and length once
    // inflated, and a checksum. A table shorter than once inflated is compressed.
    for (let table = 0; table < bytes.readUInt16BE(12); table++) {
      const at = 44 + 20 * table;
      const [offset, length, inflated] = [4, 8, 12].map((field) => bytes.readUInt32BE(at + field));
      if (length < inflated)
        out.push({
          where: `its ${bytes.toString('latin1', at, at + 4)} table, inflated`,
          text: inflateSync(bytes.subarray(offset, offset + length)),
        });
    }
    const [metaOffset, metaLength] = [bytes.readUInt32BE(24), bytes.readUInt32BE(28)];
    if (metaLength)
      out.push({
        where: 'its metadata, inflated',
        text: inflateSync(bytes.subarray(metaOffset, metaOffset + metaLength)),
        utf8: true,
      });
  }
  if (bytes.toString('latin1', 0, 4) === 'wOF2') {
    if (bytes.toString('latin1', 4, 8) === 'ttcf') throw new Error('a WOFF2 font collection is not read here');
    // The table directory: for each table its flags, a tag unless the flags name a known one, its length and, for a
    // table transformed (glyf and loca unless their transform is 3, any other unless it is 0), the transformed length.
    let at = 48;
    const base128 = () => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        const byte = bytes[at++];
        value = value * 128 + (byte & 0x7f);
        if (byte < 0x80) return value;
      }
      throw new Error('a WOFF2 length is longer than five bytes');
    };
    for (let table = 0; table < bytes.readUInt16BE(12); table++) {
      const flags = bytes[at++];
      if ((flags & 0x3f) === 0x3f) at += 4;
      base128();
      const glyfOrLoca = (flags & 0x3f) === 10 || (flags & 0x3f) === 11;
      if (glyfOrLoca ? flags >> 6 !== 3 : flags >> 6 !== 0) base128();
    }
    out.push({
      where: 'its tables, decompressed',
      text: brotliDecompressSync(bytes.subarray(at, at + bytes.readUInt32BE(20))),
    });
    const [metaOffset, metaLength] = [bytes.readUInt32BE(28), bytes.readUInt32BE(32)];
    if (metaLength)
      out.push({
        where: 'its metadata, decompressed',
        text: brotliDecompressSync(bytes.subarray(metaOffset, metaOffset + metaLength)),
        utf8: true,
      });
  }
  return out;
}

// Images and fonts, read as bytes, as UTF-8 text, as metadata in XMP is written, and the text they hold compressed. Any
// other file of the build or the repository is read as text, and as bytes, so text in UTF-16 is found too. A link git
// tracks is read as the path it holds.
const BINARY_FILE = /\.(?:png|ico|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i;
const isKnownKind = (file: string) => TEXT_FILE.test(basename(file)) || BINARY_FILE.test(file);
const isLink = (file: string) => lstatSync(file).isSymbolicLink();
// The runs of text in bytes read as UTF-8, each of four characters or more and on its own line: what lies between
// controls other than a tab or line break, and bytes that are not UTF-8.
const textIn = (bytes: Buffer) => (bytes.toString('utf8').match(/(?:[^\p{Cc}\ufffd]|[\t\n\r]){4,}/gu) ?? []).join('\n');
function whereNamedInBytes(bytes: Buffer): string | undefined {
  const raw = whereNamed(bytes.toString('latin1'), namedInBytes);
  if (raw) return raw;
  const text = whereNamed(textIn(bytes));
  if (text) return `${text}, in its text read as UTF-8`;
  for (const { where, text, utf8 } of compressedIn(bytes)) {
    const inside =
      whereNamed(text.toString('latin1'), namedInBytes) ?? (utf8 ? whereNamed(text.toString('utf8')) : undefined);
    if (inside) return `${inside}, in ${where}`;
  }
  return undefined;
}
function whereNamedInFile(file: string): string | undefined {
  try {
    if (isLink(file)) return whereNamed(readlinkSync(file));
    const bytes = readFileSync(file);
    if (BINARY_FILE.test(file)) return whereNamedInBytes(bytes);
    return whereNamed(bytes.toString('utf8')) ?? whereNamed(bytes.toString('latin1'), namedInBytes);
  } catch (error) {
    throw new Error(`${masked(file)}: ${masked((error as Error).message)}`);
  }
}
// Where a file's path, as given, names the operator, any of its folders included, or else the file itself, found
// from the folder given.
function whereNamedInPathOrFile(file: string, cwd = '.'): string | undefined {
  const inPath = whereNamed(file);
  return inPath ? `in its path, ${inPath}` : whereNamedInFile(join(cwd, file));
}
// The files git tracks, as it lists them, but those deleted and not yet removed from git, and any that is neither a
// regular file nor a link.
function trackedFiles(cwd = '.'): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter((file) => {
      const status = file && lstatSync(join(cwd, file), { throwIfNoEntry: false });
      return status && (status.isFile() || status.isSymbolicLink());
    });
}

// Examples of his name are built from it: a word with one of its letters written another way, or something put
// between two of its letters. A word is cut where neither part is the short form of his given name or his family
// name, which are found alone.
const written = (word: string, at: number, as: (letter: string) => string) =>
  word.slice(0, at) + as(word.at(at)!) + word.slice(at).slice(1);
const cut = (word: string, at: number, between: string) => word.slice(0, at) + between + word.slice(at);
const hex = (letter: string, digits = 2) => letter.codePointAt(0)!.toString(16).padStart(digits, '0');
const decimal = (letter: string) => `&#${letter.codePointAt(0)};`;
const percent = (letter: string) => `%${hex(letter).toUpperCase()}`;
const capital = (word: string) => word[0].toUpperCase() + word.slice(1);
const [givenLower, familyLower] = [GIVEN.toLowerCase(), FAMILY.toLowerCase()];
// These tests check the masking itself, so they cannot rely on it: an example, a text or a report that names him is
// shown with all its letters and digits as *, and an expectation of one shows nothing else.
const starred = (text = '') => text.replace(/[\p{L}\p{N}]/gu, '*');
const example = (text: string, i: number) => `example ${i + 1}, ${starred(text)}`;
function expectReport(report: string | undefined, expected: string | RegExp | undefined, where = 'the report') {
  const holds = expected instanceof RegExp ? expected.test(report ?? '') : report === expected;
  expect(holds, `${where} is ${report === undefined ? 'nothing' : `"${starred(report)}"`}`).toBe(true);
}

// His name with the tone marks of Yoruba, as each letter takes them: acute, or high, on the e, u and last e of his
// given name, and grave, or low, on each letter of his family name but its n.
const MARKS = [GIVEN, FAMILY].map((word, w) =>
  [...word].map((_, at) => (w === 0 ? ([2, 4, 7].includes(at) ? '\u0301' : '') : at === 2 ? '' : '\u0300')),
);
const toned = (word: number, which = (_: number) => true) =>
  [...[GIVEN, FAMILY][word]].map((letter, at) => letter + (which(at) ? MARKS[word][at] : '')).join('');
// Ordinary words and other people's names that are spelled much as his name or a handle of his is, which the check
// must not take for him. Those that hold his family name are built from it, as every example of it is.
const ORDINARY = [
  ...['R', 'Z', 'Sh', 'T', 'Ukr'].map((start) => start + familyLower),
  'mainland',
  `cont${familyLower.slice(0, 3)}able`,
  'Alina',
  'Elina',
  'Adebayo',
  'Adele',
  'Adeola',
  'Ainhoa',
  `k${familyLower}`,
];

test('the check for the operator finds his name in any case, and only as a word', () => {
  for (const [i, text] of [
    OPERATOR,
    GIVEN.toUpperCase(),
    familyLower,
    `Dr ${FAMILY}.`,
    `${GIVEN}’s`,
    // Ended by digits, as a handle is.
    `${givenLower}123@example.org`,
    `${familyLower}2026`,
    // The short form of his given name alone, as a word and in an address, and another person of that name too.
    `Thanks, ${capital(SHORT)}.`,
    `Dr ${capital(SHORT)}`,
    `Ask ${capital(SHORT)}`,
    `@${SHORT}2026`,
    `${SHORT}@example.org`,
    `${capital(SHORT)} Okafor`,
    // His family name, also a Finnish word, is refused in that sense too.
    `${capital(familyLower)} ja ikuisesti`,
    // With the tone marks of Yoruba, composed and decomposed, all or some of them, and his family name with one.
    `${toned(0)} ${toned(1)}`.normalize('NFC'),
    `${toned(0)} ${toned(1)}`.normalize('NFD'),
    toned(0, (at) => at === 2).normalize('NFC'),
    toned(1, (at) => at < 2).normalize('NFC'),
    `${FAMILY.slice(0, 3)}\u00e1`,
    `${FAMILY}\u0301`,
  ].entries())
    expect(namedIn(text), example(text, i)).toBe('his name');
  for (const [i, text] of [
    `${FAMILY}ra`,
    'MDXplora team',
    `${GIVEN}s`,
    `${SHORT}s`,
    `e\u0301${familyLower}`,
    `${toned(1)}ra`.normalize('NFC'),
    `${toned(0)}s`.normalize('NFC'),
    ...ORDINARY,
    ORDINARY.join(' '),
    ORDINARY.map((word) => word.toUpperCase()).join(', '),
  ].entries())
    expect(namedIn(text), example(text, i)).toBeUndefined();
});

test('the check for the operator finds a handle of his initials and family name, either way round', () => {
  const initial = givenLower[0];
  const initials = initial + SHORT[0];
  for (const [i, text] of [
    `${initial}${familyLower}@example.edu`,
    `${initial}.${familyLower}`,
    `${initials}${familyLower}`,
    `${initial}${familyLower}`,
    `${familyLower}${initial}`,
    `${familyLower}_${initials}`,
    `${initials.toUpperCase()}${familyLower}2026`,
    `${capital(initial)}${capital(familyLower)}Lab`,
    // His given name or its short form, and the first letter of his family name.
    `${givenLower}${familyLower[0]}@example.org`,
    `${SHORT}${familyLower[0]}@example.org`,
    `${SHORT}${familyLower[0]}2026`,
  ].entries())
    expect(namedIn(text), example(text, i)).toBeDefined();
  // Neither a bare second initial, nor his initials inside a longer word.
  for (const [i, text] of [
    `${SHORT[0]}${familyLower}`,
    `${SHORT[0]}.${familyLower}ra`,
    `x${initial}${familyLower}ra`,
    `${familyLower}${initial}ra`,
    `${SHORT}${familyLower[0]}ra`,
  ].entries())
    expect(namedIn(text), example(text, i)).toBeUndefined();
});

test('the check for the operator finds his name written with references, percent-encoding or escapes', () => {
  for (const [i, text] of [
    written(GIVEN, -1, decimal),
    written(GIVEN, -1, (letter) => `&#x${hex(letter)};`),
    written(FAMILY, 0, decimal),
    written(GIVEN, 0, percent),
    written(GIVEN, 4, percent),
    [...FAMILY].map(percent).join(''),
    written(GIVEN, 4, (letter) => `\\u${hex(letter, 4)}`),
    written(GIVEN, 4, (letter) => `\\u{${hex(letter)}}`),
    written(GIVEN, 4, (letter) => `\\x${hex(letter)}`),
    written(FAMILY, 0, (letter) => `\\${hex(letter)} `),
    written(FAMILY, 3, (letter) => `\\${hex(letter, 6)}`),
    // Encoded twice: a reference percent-encoded or escaped, and a percent-encoding escaped.
    written(GIVEN, -1, (letter) => `%26%23${letter.codePointAt(0)};`),
    written(FAMILY, 0, (letter) => `%26%23${letter.codePointAt(0)};`),
    written(GIVEN, -1, (letter) => `\\26#${letter.codePointAt(0)};`),
    written(GIVEN, -1, (letter) => `\\x25${hex(letter)}`),
    // A letter with a mark, as a reference.
    written(FAMILY, 0, () => '&Aacute;'),
    written(FAMILY, 3, () => '&#xe0;'),
  ].entries())
    expect(namedIn(text), example(text, i)).toBeDefined();
  for (const [i, text] of [
    written(`${FAMILY}ra`, 1, decimal),
    written(`${FAMILY}ra`, 0, percent),
    'cont&#97;inable',
    written(`${FAMILY}ra`, 0, (letter) => `\\${hex(letter)} `),
    written(`${FAMILY}ra`, 0, () => '&Aacute;'),
    'MDXplora team',
    '%E9',
    written(`${GIVEN}s`, 7, (letter) => `%26%23${letter.codePointAt(0)};`),
    written(`${FAMILY}ra`, 0, (letter) => `%26%23${letter.codePointAt(0)};`),
  ].entries())
    expect(namedIn(text), example(text, i)).toBeUndefined();
});

test('the check for the operator finds his name with hidden characters, inside markup or in look-alike letters', () => {
  for (const [i, text] of [
    // A soft hyphen, as a reference and as it is; a zero width space, as it is and as references.
    cut(GIVEN, 5, '&shy;'),
    cut(GIVEN, 5, '\u00ad'),
    cut(GIVEN, 5, '\u200b'),
    cut(GIVEN, 5, '&#8203;'),
    cut(GIVEN, 5, '&ZeroWidthSpace;'),
    cut(FAMILY, 2, '\u2060'),
    cut(FAMILY, 2, '\ufe0f'),
    // Split by tags or a comment: of phrasing content, a word break, a ruby, SVG text or a custom element.
    `${cut(GIVEN, 5, '<b>')}</b>`,
    `<span>${cut(GIVEN, 5, '</span>')}`,
    cut(GIVEN, 5, '<!-- -->'),
    `<title>x</title><p>${cut(GIVEN, 5, '<b>')}</b></p>`,
    `<!doctype html><title>x</title><p><span>${cut(GIVEN, 5, '</span>')}</p>`,
    `<p title="a>b">${cut(cut(GIVEN, 5, '</i>'), 3, '<i>')}</p>`,
    `const card = '<p>${cut(GIVEN, 5, '<b>')}</b></p>';`,
    cut(GIVEN, 5, '<wbr>'),
    `<nobr>${cut(GIVEN, 5, '</nobr>')}`,
    `<ruby><rb>${cut(GIVEN, 5, '</rb><rb>')}</rb><rt></rt></ruby>`,
    `<svg><text>${cut(GIVEN, 5, '<tspan>')}</tspan></text></svg>`,
    `<svg><text><textPath href="#a">${cut(GIVEN, 5, '</textPath>')}</text></svg>`,
    `<p>${cut(GIVEN, 5, '<team-name>')}</team-name></p>`,
    `const card = '${cut(GIVEN, 5, '<x-y>')}</x-y>';`,
    // Split by markup that draws nothing there, with what it holds: a script, a style, a template, a noscript, a link
    // or meta tag, or an element marked hidden; in a page, and in markup a script writes.
    cut(GIVEN, 5, '<script></script>'),
    `<p>${cut(GIVEN, 5, '<script>let shown = 1;</script>')}</p>`,
    `<p>${cut(GIVEN, 5, '<style>p { color: red }</style>')}</p>`,
    `<p>${cut(GIVEN, 5, '<template><b>Draft</b></template>')}</p>`,
    `<p>${cut(GIVEN, 5, '<noscript>Turn scripts on</noscript>')}</p>`,
    `<p>${cut(GIVEN, 5, '<link itemprop="url" href="/">')}</p>`,
    `<p>${cut(GIVEN, 5, '<meta itemprop="name" content="Draft">')}</p>`,
    `<p>${cut(GIVEN, 5, '<span hidden>Draft</span>')}</p>`,
    `<div>${cut(GIVEN, 5, '<div class="note" hidden="">Draft</div>')}</div>`,
    `const card = '${cut(GIVEN, 5, '<style>b { color: red }</style>')}';`,
    `const card = '${cut(GIVEN, 5, '<span class="note" hidden>Draft</span>')}';`,
    // An element marked hidden that holds another of its kind, read as a page is; and markup a script writes.
    `<p>${cut(GIVEN, 5, '<span hidden><span>Draft</span> one</span>')}</p>`,
    `<script>card.innerHTML = '${cut(GIVEN, 5, '<style>b { color: red }</style>')}';</script>`,
    // Markup that is itself written encoded: escaped in a script, and as references.
    `const card = '${cut(GIVEN, 5, '\\x3cb>')}</b>';`,
    `const card = '${cut(GIVEN, 5, '\\u003cwbr\\u003e')}';`,
    cut(GIVEN, 5, '&lt;wbr&gt;'),
    `&lt;p&gt;${cut(GIVEN, 5, '&lt;b&gt;')}&lt;/b&gt;&lt;/p&gt;`,
    cut(FAMILY, 2, '%3Cwbr%3E'),
    // Fullwidth, and with a Cyrillic or Greek letter for a Latin one.
    [...FAMILY].map((letter) => String.fromCodePoint(letter.codePointAt(0)! + 0xfee0)).join(''),
    written(FAMILY, 0, () => '\u0410'),
    written(GIVEN, 2, () => '\u0435'),
    written(
      written(FAMILY, 0, () => '\u0391'),
      1,
      () => '\u03b9',
    ),
    // A capital I, Latin, Cyrillic or Greek, for an l, and a palochka for an i.
    written(GIVEN, 6, () => 'I'),
    written(GIVEN, 6, () => '\u0406'),
    written(GIVEN, 6, () => '\u0399'),
    written(
      written(
        written(FAMILY, 0, () => '\u0410'),
        1,
        () => '\u04c0',
      ),
      3,
      () => '\u0430',
    ),
    written(FAMILY, 1, () => '\u04cf'),
    // Joined into a handle, either way round, and among other words.
    GIVEN + FAMILY,
    SHORT + familyLower,
    familyLower + givenLower,
    FAMILY + GIVEN,
    `https://example.org/${GIVEN}_${FAMILY}`,
    `mailto:${SHORT}.${familyLower}@example.org`,
    `${GIVEN}${FAMILY}Lab`,
    // A name in letters and digits much as base64 is written, but not as it is.
    `const ${givenLower}${FAMILY}Lab2026Site = 1;`,
  ].entries())
    expect(namedIn(text), example(text, i)).toBeDefined();
  for (const [i, text] of [
    `${capital(SHORT)}s, ${FAMILY}ra`,
    `${SHORT}${familyLower}ra`,
    `${FAMILY.slice(0, 3)}\u00e1ra`,
    `${FAMILY}\u0301ra`,
    `${FAMILY.slice(0, 3)}&aacute;ra`,
    [...`${FAMILY}ra`].map((letter) => String.fromCodePoint(letter.codePointAt(0)! + 0xfee0)).join(''),
    written(`${FAMILY}ra`, 0, () => '\u0410'),
    `${cut(GIVEN.slice(0, 6), 3, '<b>')}</b>`,
    `${cut(GIVEN, 5, '&shy;')}s`,
    // Parted by an element that breaks the text.
    cut(GIVEN, 5, '</p><p>'),
    cut(GIVEN, 5, '<br>'),
    cut(GIVEN, 5, '<div>'),
    cut(GIVEN, 5, '</li><li>'),
    `<table><tr><td>${cut(GIVEN, 5, '</td><td>')}</td></tr></table>`,
    cut(GIVEN, 5, '<button>'),
    `const card = '${cut(GIVEN, 5, '<br>')}';`,
    `<title>x</title><p>${cut(GIVEN, 5, '<b>')}s</b></p>`,
    cut(GIVEN, 5, '&lt;br&gt;'),
    `const card = '${cut(GIVEN, 5, '\\x3cbr>')}';`,
    // What a hidden element holds is not read as part of the text around it.
    `<p>${GIVEN.slice(0, 5)}<span hidden>${GIVEN.slice(5)}</span>s</p>`,
    // In base64, as an integrity or policy hash or a data: address writes it, where letters and digits drawn at
    // random spell his family name between a capital or a digit, and between + or /.
    `"integrity": "sha512-q8Rz3${FAMILY}7Jk2Lm9Pq+Xw4Ty6Bv1Nc0Ds5Fg8Hj2Kl3Zx7Cv4Bn6Mq0Wp5Ee1Rt8Yu3Io=="`,
    `script-src 'sha256-Jx9k${FAMILY}Qz3Lm8Pq2Rt7Vw5Yb1Nc4Df6Gh0Kj=';`,
    `url(data:font/woff2;base64,d09GMgABAAAAA3x+${FAMILY}/k2Lm9Pq4Xw7Ty1Bv6Nc0Ds5Fg8Hj)`,
  ].entries())
    expect(namedIn(text), example(text, i)).toBeUndefined();
});

test('a report of where the operator is named masks his name, and finds where it is', () => {
  // Found once decoded, he is reported as written, masked, with the text around him; his whole given name, not only
  // the short form it ends with.
  const softened = cut(GIVEN, 3, '&shy;');
  expectReport(
    whereNamed(`<p>Our team.</p>\n<p>${softened} wrote this.</p>`),
    'his name on line 2, written "***&***;*****", in "<p>Our team.</p>\\u{a}<p>***&***;***** wrote this.</p>"',
  );
  expectReport(
    whereNamed(`id: ${cut(GIVEN, 3, '\u200b')}`),
    'his name on line 1, written "***\\u{200b}*****", in "id: ***\\u{200b}*****"',
  );
  // Each time he is named in the text around him is masked too.
  expectReport(whereNamed(`By ${OPERATOR}.`), 'his name on line 1, written "********", in "By ******** ****."');
  expectReport(whereNamed(`Thanks, ${capital(SHORT)}.`), 'his name on line 1, written "*****", in "Thanks, *****."');
  // A word that only begins as his name does is not taken for it, before or after him, though it is masked.
  expectReport(
    whereNamed(`${capital(SHORT)}s, ${FAMILY}ra and ${FAMILY}`),
    `his name on line 1, written "****", in "******, ****** and ****"`,
  );
  expectReport(whereNamed(`${FAMILY}ra\n${FAMILY}`), /^his name on line 2, written "\*{4}"/);
  expectReport(whereNamed('MDXplora team'), undefined);
  expectReport(masked(`${GIVEN}${FAMILY}, ${FAMILY}`), '************, ****', 'the text masked');
  expectReport(masked(`${cut(GIVEN, 3, '&shy;')}.${familyLower}@x.org`), '***&***;*****.****@x.org', 'the text masked');
  // The whole word around him is masked, and any word that holds his name loosely read, such as one in capitals
  // that goes on in lower case.
  expectReport(
    masked(`x${FAMILY}2026q, ${FAMILY.toUpperCase()}lab and ${toned(1)}ra.`.normalize('NFC')),
    '**********, ******* and ******.',
    'the text masked',
  );
  expectReport(masked('MDXplora team, main lab'), 'MDXplora team, main lab', 'the text masked');
});

// Three letters in a row of his given or family name, or of a handle of his, in any case, as a report shows them or
// with its escapes and zero bytes left out, as text in UTF-16 would show them.
const handles = [
  GIVEN + FAMILY,
  FAMILY + GIVEN,
  GIVEN[0] + SHORT[0] + FAMILY,
  FAMILY + GIVEN[0] + SHORT[0],
  GIVEN + FAMILY[0],
];
const PARTS = new Set(
  [GIVEN, FAMILY, ...handles].flatMap((word) =>
    [...word.toLowerCase()].slice(2).map((_, at) => word.toLowerCase().slice(at, at + 3)),
  ),
);
const leaks = (report = '') => {
  const views = [report, report.replace(/\\u\{[0-9a-f]+\}|\0/g, '')].map((view) => view.toLowerCase());
  return [...PARTS].filter((part) => views.some((view) => view.includes(part)));
};

test('a report never shows part of his name, wherever the text around him is cut', () => {
  // Other mentions of him at each distance from the one found, up to past the text shown, in any form found, and in
  // a form the check misses beside it.
  const others = [
    GIVEN + FAMILY,
    FAMILY,
    capital(SHORT),
    cut(GIVEN, 3, '&shy;'),
    `${cut(GIVEN, 3, '<b>')}</b>.${familyLower}`,
    `${GIVEN[0]}.${familyLower}`,
    `${FAMILY.toUpperCase()}lab`,
    `${SHORT}s`,
    `${toned(0)} ${toned(1)}`.normalize('NFD'),
    [...GIVEN].map(decimal).join(''),
  ];
  for (const other of others)
    for (let gap = 0; gap <= 20; gap++) {
      const filler = ' x'.repeat(gap);
      for (const text of [
        `${GIVEN}${filler} ${other}`,
        `${other}${filler} ${GIVEN}`,
        `${other}${filler} ${FAMILY}${filler} ${other}`,
      ]) {
        const reports = [whereNamed(text), masked(text), whereNamed(text, namedInBytes)];
        expect(reports[0] !== undefined, example(other, gap)).toBe(true);
        for (const report of reports) expect(leaks(report).length, `${example(text, gap)}: ${starred(report)}`).toBe(0);
      }
    }
  // Nor in a file read as bytes, where the text around him is not text, or is text in UTF-16 or with references.
  const referenced = written(GIVEN, 3, (letter) => `&#x${hex(letter).toUpperCase()};`);
  const bytes = Buffer.concat([Buffer.alloc(30, 0x80), Buffer.from(`${FAMILY}\0\x01${GIVEN}${FAMILY}`, 'latin1')]);
  const dir = mkdtempSync(join(tmpdir(), 'leaks-'));
  try {
    const files: [string, Buffer][] = [
      ['bytes.png', bytes],
      // Text in UTF-16, of either byte order, in a file read as text and in one read as bytes, with a mention the check
      // misses beside one it finds.
      ...['utf16le', 'utf16be'].flatMap((order): [string, Buffer][] => {
        const notes = Buffer.from(`Notes by ${capital(SHORT)}s and ${capital(SHORT)} ${FAMILY}`, 'utf16le');
        const ordered = order === 'utf16le' ? notes : Buffer.from(notes).swap16();
        return [
          [`notes-${order}.md`, ordered],
          [`notes-${order}.woff`, ordered],
        ];
      }),
      // The XMP of a JPEG, with a letter of his given name as a reference, beside his family name.
      [
        'photo.jpg',
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]),
          Buffer.from(`http://ns.adobe.com/xap/1.0/\0<dc:creator>${referenced} ${FAMILY}</dc:creator>`),
        ]),
      ],
    ];
    for (const [name, content] of files) {
      writeFileSync(join(dir, name), content);
      const report = whereNamedInFile(join(dir, name));
      expect(report !== undefined, `${name} is found to name him`).toBe(true);
      expect(leaks(report).length, `${name}: ${starred(report)}`).toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A PNG of the chunks given, each a type and its data.
function png(...chunks: [string, Buffer][]): Buffer {
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    ...chunks.map(([type, data]) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    }),
  ]);
}
// A WOFF font of one name table, compressed, and its metadata, as given.
function woff(name: Buffer, metadata?: Buffer): Buffer {
  const table = deflateSync(name);
  const meta = metadata ? deflateSync(metadata) : Buffer.alloc(0);
  const header = Buffer.alloc(44 + 20);
  header.write('wOFF', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(1, 12);
  // The name table's entry: its tag, offset, length, and length once inflated.
  header.write('name', 44, 'latin1');
  header.writeUInt32BE(64, 48);
  header.writeUInt32BE(table.length, 52);
  header.writeUInt32BE(name.length, 56);
  if (metadata) {
    header.writeUInt32BE(64 + table.length, 24);
    header.writeUInt32BE(meta.length, 28);
  }
  return Buffer.concat([header, table, meta]);
}
// An icon of one image, a PNG, as given.
function ico(image: Buffer): Buffer {
  const header = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);
  header.writeUInt32LE(image.length, 14);
  return Buffer.concat([header, image]);
}
// A WOFF2 font of one name table, and its metadata, as given.
function woff2(name: Buffer, metadata?: Buffer): Buffer {
  const tables = brotliCompressSync(name);
  const meta = metadata ? brotliCompressSync(metadata) : Buffer.alloc(0);
  // The directory: the name table's flags (its known tag, 5, untransformed), then its length in UIntBase128.
  const directory = Buffer.from([
    5,
    ...(name.length < 128 ? [name.length] : [0x80 | (name.length >> 7), name.length & 0x7f]),
  ]);
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(1, 12);
  header.writeUInt32BE(tables.length, 20);
  if (metadata) {
    header.writeUInt32BE(48 + directory.length + tables.length, 28);
    header.writeUInt32BE(meta.length, 32);
  }
  return Buffer.concat([header, directory, tables, meta]);
}

test('the check for the operator finds his name in the bytes of an image or a font, and says where', () => {
  const author = Buffer.from(`Author\0${OPERATOR}`, 'latin1');
  expect(namedInBytes(`\x89PNG\r\n\x1a\n\0\0\0\x19tEXt${author.toString('latin1')}\x8a\x1f`)).toBe('his name');
  expect(namedInBytes([...FAMILY].map((letter) => `\0${letter}`).join('') + '\0\x01')).toBe('his name');
  expect(namedInBytes('\x89PNG\r\n\x1a\nIHDR\0\0\0\x10tEXtSoftware\0MDXplora')).toBeUndefined();
  // A binary file is reported by its byte, not its line.
  expectReport(whereNamedInBytes(png(['tEXt', author])), /^his name at byte 23, written "\*{8}"/);
  // Text in UTF-16 is shown as it reads, without its zero bytes.
  expectReport(
    whereNamedInBytes(Buffer.from(`Notes by ${OPERATOR}.`, 'utf16le')),
    'his name at byte 18, written "********", in "Notes by ******** ****."',
  );
  // Text a PNG holds compressed, in a zTXt or iTXt chunk, or in its colour profile, which its bytes do not show.
  const compressed = (file: Buffer) => {
    expect(namedInBytes(file.toString('latin1')), 'named in the bytes as they are').toBeUndefined();
    return whereNamedInBytes(file);
  };
  const deflated = (text: string) => deflateSync(Buffer.from(text, 'utf8'));
  expectReport(
    compressed(png(['zTXt', Buffer.concat([Buffer.from('Author\0\0'), deflated(OPERATOR)])])),
    /^his name at byte 0, written "\*{8}", in "\*{8} \*{4}", in its zTXt chunk at byte 8, inflated$/,
  );
  const itxt = (text: string) => Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\x01\0en\0\0'), deflated(text)]);
  expectReport(
    compressed(png(['iTXt', itxt(`<dc:creator>${cut(GIVEN, 5, '&#173;')}</dc:creator>`)])),
    /in its iTXt chunk at byte 8, inflated$/,
  );
  expectReport(
    compressed(png(['iCCP', Buffer.concat([Buffer.from('ICC\0\0'), deflated(`cprt ${FAMILY}`)])])),
    /in its iCCP chunk at byte 8, inflated$/,
  );
  expectReport(
    compressed(png(['zTXt', Buffer.concat([Buffer.from('Software\0\0'), deflated('MDXplora')])])),
    undefined,
  );
  // A font's tables and metadata, which WOFF2 compresses: a name in UTF-16, as the name table writes it, and in XML.
  const utf16 = (text: string) => Buffer.from(text, 'utf16le').swap16();
  expectReport(
    compressed(woff2(Buffer.concat([Buffer.alloc(200), utf16(`Designer: ${OPERATOR}`)]))),
    /in its tables, decompressed$/,
  );
  expectReport(
    compressed(
      woff2(Buffer.alloc(10), Buffer.from(`<metadata>${' '.repeat(200)}<vendor name="${OPERATOR}"/></metadata>`)),
    ),
    /in its metadata, decompressed$/,
  );
  expectReport(whereNamedInBytes(woff2(utf16('Inter Variable'))), undefined);
  // And those WOFF compresses, with zlib.
  expectReport(
    compressed(woff(Buffer.concat([Buffer.alloc(200), utf16(`Designer: ${OPERATOR}`)]))),
    /in its name table, inflated$/,
  );
  expectReport(
    compressed(
      woff(Buffer.alloc(10), Buffer.from(`<metadata>${' '.repeat(200)}<vendor name="${OPERATOR}"/></metadata>`)),
    ),
    /in its metadata, inflated$/,
  );
  expectReport(whereNamedInBytes(woff(utf16('Inter'))), undefined);
  // A PNG inside another file, as an icon holds one.
  expectReport(
    compressed(ico(png(['zTXt', Buffer.concat([Buffer.from('Author\0\0'), deflated(OPERATOR)])]))),
    /in its zTXt chunk at byte 30, inflated$/,
  );
  // Metadata in UTF-8, read as text: with a character not shown, as a PNG's iTXt holds it uncompressed, or with a
  // reference, as in the XMP of a JPEG.
  const plain = Buffer.from(`XML:com.adobe.xmp\0\0\0en\0\0<dc:creator>${cut(GIVEN, 5, '\u200b')}</dc:creator>`);
  expectReport(compressed(png(['iTXt', plain])), /^his name on line \d+, .*, in its text read as UTF-8$/);
  const xmp = `http://ns.adobe.com/xap/1.0/\0<dc:creator>${cut(GIVEN, 5, '&#173;')}</dc:creator>`;
  expectReport(
    compressed(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]), Buffer.from(xmp)])),
    /^his name on line \d+, .*, in its text read as UTF-8$/,
  );
  // A font the site serves decompresses in full: the family names in its name table are read.
  const inter = readdirSync('node_modules/@fontsource-variable/inter/files').find((file) => file.endsWith('.woff2'))!;
  const [tables] = compressedIn(readFileSync(join('node_modules/@fontsource-variable/inter/files', inter)));
  expect(tables.text.includes(utf16('Inter')), inter).toBe(true);
  const [name] = compressedIn(readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff')).filter(
    ({ where }) => where === 'its name table, inflated',
  );
  expect(name.text.includes(utf16('Inter')), 'a WOFF font').toBe(true);
});

test('the check for the operator reads files of a known kind, and only those git tracks and that are there', () => {
  for (const file of ['x.png', 'a/b.ts', 'CNAME', '.nvmrc', 'font.woff2', 'icon.ICO'])
    expect(isKnownKind(file), file).toBe(true);
  for (const file of ['x.pdf', 'a/b.zip', 'notes.docx']) expect(isKnownKind(file), file).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), 'tracked-'));
  try {
    for (const file of ['kept.ts', 'deleted.ts', 'staged.ts']) writeFileSync(join(dir, file), 'text');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    // One deleted from the working tree only, and one whose deletion is staged.
    rmSync(join(dir, 'deleted.ts'));
    execFileSync('git', ['rm', '-qf', 'staged.ts'], { cwd: dir });
    expect(trackedFiles(dir)).toEqual(['kept.ts']);
    // A link, read as the path it holds, even when that path is not there; a path that names him, in a file's name
    // or a folder's; and text in UTF-16, here after the start of a comment, so that no reading of the file as markup
    // finds him.
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, `${givenLower}-${familyLower}`));
    const named = [
      `docs/${givenLower[0]}${familyLower}-notes.md`,
      `${givenLower}-${familyLower}/plan.md`,
      'docs/link.md',
      'docs/.DS_Store',
    ];
    for (const file of named.slice(0, 2)) writeFileSync(join(dir, file), 'Notes on the site.');
    symlinkSync(`../${FAMILY}/notes.md`, join(dir, 'docs', 'link.md'));
    const utf16 = Buffer.from(`\0\x01Bud1${OPERATOR}`, 'utf16le');
    writeFileSync(join(dir, 'docs', '.DS_Store'), Buffer.concat([Buffer.from('<!-- '), utf16]));
    symlinkSync('kept.ts', join(dir, 'kept.pdf'));
    execFileSync('git', ['add', '.'], { cwd: dir });
    expectReport(
      trackedFiles(dir).sort().join(', '),
      [...named, 'kept.pdf', 'kept.ts'].sort().join(', '),
      'the files tracked',
    );
    expect(isLink(join(dir, 'kept.pdf')) && !isLink(join(dir, 'kept.ts'))).toBe(true);
    for (const file of named) expect(whereNamedInPathOrFile(file, dir) !== undefined, starred(file)).toBe(true);
    expectReport(whereNamedInPathOrFile(named[0], dir), /^in its path, a handle of his on line 1/);
    for (const file of ['kept.pdf', 'kept.ts']) expectReport(whereNamedInPathOrFile(file, dir), undefined, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the operator is named on the privacy page, and nowhere else', async ({ request }) => {
  test.skip(test.info().project.name !== 'desktop', 'the files and pages read here are the same at any width');
  for (const path of [...(await sitemapPages(request)), '/no-such-page/']) {
    const shown = masked(path);
    const response = await request.get(path);
    expect(response.status(), shown).toBe(path === '/no-such-page/' ? 404 : 200);
    const html = await response.text();
    const [head, body] = html.split(/<\/head>/i);
    expect(body, `${shown} has a head and a body`).toBeDefined();
    // The head holds the metadata, the structured data and the link preview image's alt text.
    expect(whereNamed(head), `${shown}: metadata`).toBeUndefined();
    if (path === '/privacy/')
      expect(body.includes(`${OPERATOR} is responsible for the personal data`), `${shown} names its controller`).toBe(
        true,
      );
    else expect(whereNamed(body), shown).toBeUndefined();
    // Every stylesheet the page links to, wherever it is served from. Styles inlined in the page are read above.
    for (const href of stylesheetsOf(html)) {
      const sheet = await request.get(new URL(href, response.url()).href);
      expect(sheet.ok(), masked(`${path}: ${href}`)).toBe(true);
      expect(whereNamed(await sheet.text()), masked(`${path}: ${href}`)).toBeUndefined();
    }
  }
  // Every file of the build, as it is served: the pages, the sitemaps, the stylesheets and any script, the icons, the
  // images and fonts, and all that is copied from public/, such as CNAME, robots.txt or a humans.txt, and the path of
  // each. The privacy page itself is left out, its head having been read above, but not its path. A file of no known
  // kind fails here, so that it is read.
  const built = filesUnder('dist');
  expect(
    built.filter((file) => !isKnownKind(file)).map((file) => masked(file)),
    'built files of no known kind',
  ).toEqual([]);
  for (const file of ['404.html', 'CNAME', join('og', 'home.png')])
    expect(
      built.includes(join('dist', file)),
      `the build holds ${file}, looked for only to show its files were found`,
    ).toBe(true);
  const privacyPage = join('dist', 'privacy', 'index.html');
  expect(whereNamed(privacyPage), 'the path of the privacy page').toBeUndefined();
  for (const file of built.filter((file) => file !== privacyPage))
    expect(whereNamedInPathOrFile(file), masked(file)).toBeUndefined();
  // The source, published with the repository: every file git tracks, comments included, from the workflows and
  // settings to the scripts and tests, this file among them, and the path of each. Left out is the privacy page's
  // source, which names him, but not its path. A tracked file of no known kind fails here, as a built one does; a link
  // is read as the path it holds, whatever its name.
  const privacySource = 'src/pages/privacy.astro';
  const tracked = trackedFiles();
  expect(
    tracked.filter((file) => !isKnownKind(file) && !isLink(file)).map((file) => masked(file)),
    'tracked files of no known kind',
  ).toEqual([]);
  for (const file of ['README.md', 'src/data/cards.ts', 'tests/site.spec.ts'])
    expect(tracked.includes(file), `git tracks ${file}, looked for only to show its files were found`).toBe(true);
  expect(tracked.includes(privacySource), 'the privacy page, left out here, is where it was').toBe(true);
  expect(whereNamed(privacySource), 'the path of the privacy page').toBeUndefined();
  for (const file of tracked.filter((file) => file !== privacySource))
    expect(whereNamedInPathOrFile(file), masked(file)).toBeUndefined();
});

test('no link preview image draws the operator by name', () => {
  // The image's words are drawn as pixels, so they are read from the source as TypeScript reads it, which the scan of
  // the source above does not do in full: it reads no line continuation or identity escape, such as \k.
  for (const { slug, title, text } of drawnCards())
    for (const words of [title, text]) expect(whereNamed(words), masked(`${slug}: ${words}`)).toBeUndefined();
});

test('the privacy page answers Do Not Track and says what Formspree receives', async ({ page }) => {
  await page.goto('/privacy/');
  // The page names the operator, so its text is never printed.
  const said = await textOf(page.locator('.prose'));
  for (const words of [
    'Do Not Track',
    'Global Privacy Control',
    'your IP address and the name of your browser',
    'With JavaScript turned off',
    // Mail written to the address directly takes the same route as the form's.
    "Everything sent to info@mdxplora.com, from the form or written to it directly, is forwarded by Cloudflare Email Routing to our mailbox in Google's Gmail.",
    // Who is responsible for that data, and how long messages are kept.
    'You can reach him at info@mdxplora.com.',
    'We keep messages for one year after our last contact with you, then delete them.',
  ])
    expectText(said, words, 'the privacy page');
  expect(
    said.includes(`${OPERATOR} is responsible for the personal data this site collects`),
    'names its controller',
  ).toBe(true);
});

test('the privacy page names everything the site keeps in the browser', async ({ page }) => {
  // Each key the site stores, and the words the privacy page uses for it. A new key fails here until it is described.
  const described: Record<string, string> = {
    'mdxplora-theme': 'light and dark',
  };
  const stored = new Set<string>();
  for (const file of readdirSync('src', { recursive: true, encoding: 'utf8' })) {
    if (!/\.(astro|ts)$/.test(file)) continue;
    const text = readFileSync(join('src', file), 'utf8');
    if (text.includes('localStorage.setItem')) for (const m of text.matchAll(/'(mdxplora-[a-z-]+)'/g)) stored.add(m[1]);
  }
  expect(
    [...stored].sort().map((key) => masked(key)),
    'the keys the site stores',
  ).toEqual(Object.keys(described).sort());
  await page.goto('/privacy/');
  const said = await textOf(page.locator('.prose'));
  for (const words of Object.values(described)) expectText(said, words, 'the privacy page');
});

test('the setting an earlier version stored for its animation is deleted, and the theme kept', async ({ page }) => {
  await page.goto('/privacy/');
  await page.evaluate(() => {
    localStorage.setItem('mdxplora-fluid', 'paused');
    localStorage.setItem('mdxplora-theme', 'light');
  });
  await page.goto('/');
  const kept = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(kept.map((key) => masked(key))).toEqual(['mdxplora-theme']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

// Headings say plainly what their section holds: in sentence case, as one phrase, with no full stop or colon. After
// the first word, only names and the software's own terms take a capital. A heading that opens with code, such as
// the pipeline's phases on the home page, gives the name as the software spells it, so it may start in lower case.
// A short abbreviation followed by a word does not end a sentence.
const headingNames = new Set(['MDXplora', 'FastMDXplora', 'Config', 'Configs', 'Manifest', 'MD', 'GPU', 'GPUs']);
const headingPhrases = ['Do Not Track'];
const headingAbbreviations = /(?<![\p{L}\p{N}.])(?:vs|e\.g|i\.e|cf|approx)\.(?=\s+\p{L})/giu;

function headingFaults(heading: string, opensWithCode = false): string[] {
  const faults: string[] = [];
  if (/^\p{Ll}/u.test(heading) && !opensWithCode) faults.push('starts in lower case');
  if (/[.!?:]$/.test(heading)) faults.push('ends in punctuation');
  if (/[.!?]\s+\p{L}/u.test(heading.replace(headingAbbreviations, ''))) faults.push('more than one sentence');
  const words = headingPhrases
    .reduce((text, phrase) => text.replaceAll(phrase, ''), heading)
    .split(/\s+/)
    .slice(1);
  for (const word of words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')))
    if (/^\p{Lu}/u.test(word) && !headingNames.has(word)) faults.push(`"${word}" in capitals`);
  return faults;
}

test('the heading check finds title case and punctuation', () => {
  for (const heading of [
    'Where Studies Will Run',
    'Prefer email?',
    'Before you ask.',
    'A Config goes in. A Manifest',
    'how a study runs',
    'Questions:',
    'How a study runs. one file in',
    'setup and simulation',
    'setup',
    'Proteins vs. membranes. then the rest',
    'Choose a canvas. then begin',
    'Set the length, etc. then run',
    'Ends with e.g.',
  ])
    expect(headingFaults(heading), heading).not.toEqual([]);
  for (const heading of [
    'Where studies will run',
    'Agree the Config',
    'What MDXplora refuses',
    'Do Not Track',
    'Proteins vs. membranes',
    'Small systems, e.g. peptides',
    'One file, i.e. the Config',
    'Compare cf. the Manifest',
  ])
    expect(headingFaults(heading), heading).toEqual([]);
  // A heading that opens with code may start in lower case, and is otherwise checked as usual.
  for (const heading of ['setup Runs First', 'setup.', 'setup. then simulation'])
    expect(headingFaults(heading, true), heading).not.toEqual([]);
  for (const heading of ['setup', 'simulation', 'analysis', 'report', 'Config'])
    expect(headingFaults(heading, true), heading).toEqual([]);
});

test('every heading is a plain phrase without a full stop', async ({ page }) => {
  for (const path of [...pages, '/no-such-page/']) {
    await page.goto(path);
    const headings = await page.locator('h1, h2, h3').evaluateAll((all) =>
      all.map((h) => {
        // The first child that is not blank text or a comment.
        const first = [...h.childNodes].find(
          (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
        );
        return {
          text: (h.textContent ?? '').replace(/\s+/g, ' ').trim(),
          opensWithCode: first?.nodeName === 'CODE',
        };
      }),
    );
    expect(headings.length, path).toBeGreaterThan(0);
    for (const { text, opensWithCode } of headings)
      expect(
        headingFaults(text, opensWithCode).map((fault) => masked(fault)),
        masked(`${path}: ${text}`),
      ).toEqual([]);
  }
  // Each stage of the pipeline is headed by its name as code, and nothing else.
  await page.goto('/');
  const stages = await page
    .locator('.pipeline h3')
    .evaluateAll((all) =>
      all.map((h) =>
        h.children.length === 1 &&
        h.firstElementChild?.nodeName === 'CODE' &&
        h.textContent?.trim() === h.firstElementChild.textContent
          ? h.firstElementChild.textContent
          : h.outerHTML,
      ),
    );
  expect(stages.map((stage) => masked(stage ?? ''))).toEqual([
    'Config',
    'setup',
    'simulation',
    'analysis',
    'report',
    'Manifest',
  ]);
  expectExactly(await textOf(page.locator('h1')), 'From question to publishable molecular dynamics', 'the headline');
  expectExactly(await textOf(page.locator('main a[href="/services/"]')), 'About our services', 'the link to services');
});

test('the title each link preview image draws is a plain phrase without a full stop', () => {
  // The image heads its card on other sites, in plain type with no code, so its title is held to the same rules.
  for (const { slug, title } of drawnCards())
    expect(
      headingFaults(title).map((fault) => masked(fault)),
      masked(`${slug}: ${title}`),
    ).toEqual([]);
});

test('an unknown address gets the not-found page, which claims no address of its own', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
});

test('on a short page the footer reaches the bottom of the window', async ({ page }) => {
  for (const height of [720, 1200]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto('/no-such-page/');
    const [bottom, window, end] = await page.evaluate(() => [
      document.querySelector('.site-footer')!.getBoundingClientRect().bottom + scrollY,
      innerHeight,
      document.documentElement.scrollHeight,
    ]);
    expect(bottom, `at ${height} px: the footer ends at the page's end`).toBeCloseTo(end, 0);
    expect(bottom, `at ${height} px: and at or below the window's`).toBeGreaterThanOrEqual(window - 0.5);
  }
});

test('the phone menu closes with Escape, back to its button, and when the window widens', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the menu is for narrow screens');
  await page.goto('/');
  const toggle = page.locator('.menu-toggle');
  await toggle.click();
  await expect(page.locator('#mobile-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-menu')).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#mobile-menu')).toBeHidden();
  await page.setViewportSize({ width: 412, height: 800 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('a link from another page chooses the contact topic', async ({ page }) => {
  await page.goto('/contact/?topic=training');
  await expect(page.locator('select[name="topic"]')).toHaveValue('training');
  await expect(page.locator('input[name="_gotcha"]')).not.toBeInViewport();
});

// Records what the contact form sends and answers as Formspree would, so nothing leaves the test.
async function captureForm(page: Page) {
  const sent: Record<string, string>[] = [];
  await page.route('https://formspree.io/**', async (route) => {
    const fields: Record<string, string> = {};
    const body = route.request().postData() ?? '';
    for (const [, name, value] of body.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) fields[name] = value;
    sent.push(fields);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return sent;
}

// The form's outcome, once it says the words given, which are reported without what it said instead.
async function expectStatus(page: Page, words: string) {
  await expect
    .poll(async () => (await textOf(page.locator('.status'))).includes(words), { message: `the form says "${words}"` })
    .toBe(true);
}

async function fillContact(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByLabel('Email', { exact: true }).fill('ada@example.org');
  await page.getByLabel('Message', { exact: true }).fill('A short test message.');
}

test('a message arrives with a subject naming its topic and sender', async ({ page }) => {
  const sent = await captureForm(page);
  await page.goto('/contact/?topic=training');
  await fillContact(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expectStatus(page, 'Thank you');
  expect(sent.length, 'messages sent').toBe(1);
  expectExactly(sent[0]._subject, 'MDXplora website: Training enquiry from Ada Lovelace', 'the subject sent');
  expect(sent[0].topic).toBe('training');
  // The outcome sits beside the button, in the form's own style, not that of the planned note.
  await expect(page.locator('.status')).toHaveCSS('border-left-width', '0px');
  await expect(page.locator('.status')).toHaveCSS('padding-left', '0px');
});

test('a form sent incomplete says what is missing, marks it, and focus lands on the outcome', async ({ page }) => {
  const sent = await captureForm(page);
  await page.goto('/contact/');
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByLabel('Email', { exact: true }).fill('not an address');
  await page.getByRole('button', { name: 'Send' }).click();
  await expectStatus(page, 'Please fill in');
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveAttribute('aria-invalid');
  expect(sent.length, 'messages sent').toBe(0);

  await fillContact(page);
  await expect(page.getByLabel('Email', { exact: true })).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: 'Send' }).click();
  await expectStatus(page, 'Thank you');
  await expect(page.locator('.status')).toBeFocused();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every page can be reached from the header, and the buttons that need scripts are gone', async ({ page }) => {
    await page.goto('/');
    for (const label of ['How it works', 'Compute', 'Services', 'Contact']) {
      await expect(page.locator('.site-header .links').getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.locator('.menu-toggle')).toBeHidden();
    await expect(page.locator('.theme-toggle')).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the ${scheme} system colours are followed, as with JavaScript`, async ({ page, browser }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const tokens = () =>
        page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            [...document.styleSheets]
              .flatMap((sheet) => [...sheet.cssRules])
              .flatMap((rule) => (rule instanceof CSSStyleRule ? [...rule.style] : []))
              .filter((name) => name.startsWith('--'))
              .map((name) => [name, style.getPropertyValue(name).trim()]),
          );
        });
      const without = await tokens();
      const scripted = await browser.newContext({ colorScheme: scheme, javaScriptEnabled: true });
      const other = await scripted.newPage();
      await other.goto(page.url());
      const withScripts = await other.evaluate(() => document.documentElement.dataset.theme);
      expect(withScripts).toBe(scheme);
      const expected = await other.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .flatMap((rule) => (rule instanceof CSSStyleRule ? [...rule.style] : []))
            .filter((name) => name.startsWith('--'))
            .map((name) => [name, style.getPropertyValue(name).trim()]),
        );
      });
      await scripted.close();
      expect(without['--bg']).toBe(scheme === 'light' ? '#faf9f5' : '#1c1c1d');
      const names = [...new Set([...Object.keys(without), ...Object.keys(expected)])];
      expect(
        names
          .filter((token) => without[token] !== expected[token])
          .map((token) => masked(`${token} is ${without[token]}, and with scripts ${expected[token]}`)),
      ).toEqual([]);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`the browser's own colour is the ${scheme} ground when the system is ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      // The first tag whose media query holds is the one the browser uses.
      const [used, ground] = await page.evaluate(() => [
        [...document.querySelectorAll('meta[name="theme-color"]')]
          .find((meta) => matchMedia(meta.getAttribute('media') || 'all').matches)
          ?.getAttribute('content'),
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      ]);
      expect(ground).toBe(scheme === 'light' ? '#faf9f5' : '#1c1c1d');
      expect(used).toBe(ground);
    });
  }

  test('the browser checks the form before it is posted', async ({ page }) => {
    await page.goto('/contact/');
    expect(await page.locator('form.form').evaluate((form: HTMLFormElement) => form.noValidate)).toBe(false);
  });
});

test('early-access questions show for that topic only, and are sent only with it', async ({ page }) => {
  const sent = await captureForm(page);
  await page.goto('/contact/?topic=early-access');
  const early = page.getByRole('group', { name: /About your work/ });
  await expect(early).toBeVisible();
  await early.getByLabel('Where you work').selectOption('An academic research group');
  const compute = early.getByLabel('Compute you have now');
  expect((await compute.locator('option').allTextContents()).map((option) => masked(option.trim()))).toEqual([
    'Choose one',
    'None yet',
    'A workstation with a GPU',
    'A cluster (at a university, a national centre or in industry)',
    'Cloud GPUs',
    'Not sure',
  ]);
  await compute.selectOption('A cluster (at a university, a national centre or in industry)');
  await early.getByLabel('What you want to simulate').fill('A small protein in water.');

  await page.getByLabel('What is it about?').selectOption('support');
  await expect(early).toBeHidden();
  await page.getByLabel('What is it about?').selectOption('early-access');
  await expect(early).toBeVisible();

  await fillContact(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expectStatus(page, 'Thank you');
  for (const [field, value] of Object.entries({
    _subject: 'MDXplora website: Early access request from Ada Lovelace',
    'where you work': 'An academic research group',
    'compute you have now': 'A cluster (at a university, a national centre or in industry)',
    'what you want to simulate': 'A small protein in water.',
  }))
    expectExactly(sent[0]?.[field], value, `the field "${field}" sent`);

  // A different topic sends none of them.
  await page.getByLabel('What is it about?').selectOption('support');
  await fillContact(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent.length).toBe(2);
  for (const field of ['where you work', 'what you want to simulate'])
    expect(field in sent[1], `the field "${field}" is sent`).toBe(false);
});

test('security reports have somewhere to go (RFC 9116)', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  const fields = Object.fromEntries(
    (await response.text())
      .trim()
      .split('\n')
      .map((line) => line.split(/: (.*)/s).slice(0, 2)),
  );
  expectExactly(fields.Contact, 'mailto:info@mdxplora.com', 'its contact');
  expectExactly(fields.Canonical, 'https://mdxplora.com/.well-known/security.txt', 'its address');
  const daysLeft = (Date.parse(fields.Expires) - Date.now()) / 86_400_000;
  expect(daysLeft, 'expires in the future, less than a year ahead').toBeGreaterThan(0);
  expect(daysLeft).toBeLessThan(365);
});

// JSON a page or the build gives, read, or an error that says where without what it holds.
function parsed(json: string, where: string) {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(masked(`${where} is not JSON: ${(error as Error).message}`));
  }
}

test('the icons, the manifest and the structured data all resolve', async ({ page, request }) => {
  const png = async (path: string) => {
    const response = await request.get(path);
    expect(response.status(), masked(path)).toBe(200);
    const body = await response.body();
    return [body.readUInt32BE(16), body.readUInt32BE(20)];
  };
  expect(await png('/apple-touch-icon.png')).toEqual([180, 180]);

  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  expect((await ico.body()).readUInt16LE(4), 'images in favicon.ico').toBe(3);

  const manifest = parsed(await (await request.get('/manifest.webmanifest')).text(), 'the manifest');
  expectExactly(manifest.name, 'MDXplora', "the manifest's name");
  for (const icon of manifest.icons) {
    const [w, h] = icon.sizes.split('x').map(Number);
    expect(await png(icon.src), masked(icon.src)).toEqual([w, h]);
  }

  await page.goto('/');
  const data = (await page.locator('script[type="application/ld+json"]').textContent()) ?? '';
  const graph = parsed(data, 'the structured data')['@graph'];
  const organization = graph.find((node: { '@type': string }) => node['@type'] === 'Organization');
  expectExactly(organization.name, 'MDXplora', "the structured data's organisation");
  expect(await png(new URL(organization.logo).pathname)).toEqual([512, 512]);
});

test('the browser icon is the current mark, at an address that changes with it', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  expectText(href, /^\/favicon\.svg\?v=[0-9a-f]{8}$/, `the address ${href}`);
  const svg = await (await request.get(href!)).text();
  expect(svg.match(/<circle/g)?.length, 'the droplet has seven atoms').toBe(7);
  expectText(svg, /<rect [^>]*fill="#155ad1"/, 'the icon, in white on solid blue,');
  expectText(svg, /gradient/i, 'the icon', false);
});

// The smallest gap between two atoms of the droplet, in pixels when its 32-unit grid is drawn `size` pixels wide.
function atomGap(circles: { cx: number; cy: number; r: number }[], size: number): number {
  let gap = Infinity;
  for (const [i, a] of circles.entries())
    for (const b of circles.slice(i + 1)) gap = Math.min(gap, Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r);
  return (gap * size) / 32;
}
const circlesIn = (svg: string) =>
  [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map(([, cx, cy, r]) => ({
    cx: +cx,
    cy: +cy,
    r: +r,
  }));

test('the droplet reads as seven atoms in the header, the footer and the browser tab', async ({ page, request }) => {
  await page.goto('/');
  for (const where of ['.site-header .logo svg', '.site-footer .logo svg']) {
    const [size, svg] = await page
      .locator(where)
      .evaluate((el) => [el.getBoundingClientRect().width, el.innerHTML] as const);
    const circles = circlesIn(svg);
    expect(circles, where).toHaveLength(7);
    expect(atomGap(circles, size), `${where}: pixels between atoms`).toBeGreaterThanOrEqual(1.25);
  }
  // In a tab the icon is 16 px wide; the gaps stay a pixel there.
  const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  const icon = circlesIn(await (await request.get(href!)).text());
  expect(icon).toHaveLength(7);
  expect(atomGap(icon, 16), 'pixels between atoms at 16 px').toBeGreaterThanOrEqual(0.95);
});

test('the browser icons carry the small atoms, at an address that changes with them', async ({ page, request }) => {
  await page.goto('/');
  const svgHref = (await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href'))!;
  const icoHref = (await page.locator('link[rel="icon"][sizes="32x32"]').getAttribute('href'))!;
  const touchHref = (await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))!;
  const svg = await (await request.get(svgHref)).text();
  // The fingerprint of the other icons, with the tab's own drawing added.
  const iconVersion = new URL(touchHref, page.url()).searchParams.get('v')!;
  const expected = createHash('sha256')
    .update(iconVersion + svg)
    .digest('hex')
    .slice(0, 8);
  for (const href of [svgHref, icoHref])
    expect(new URL(href, page.url()).searchParams.get('v'), masked(href)).toBe(expected);

  // favicon.ico holds the SVG's drawing at 16 and 32 px, and the full mark at 48.
  const ico = await (await request.get(icoHref)).body();
  const images = new Map<number, Buffer>();
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + 16 * i;
    const [length, offset] = [ico.readUInt32LE(entry + 8), ico.readUInt32LE(entry + 12)];
    images.set(ico[entry] || 256, ico.subarray(offset, offset + length));
  }
  const drawn = (size: number) =>
    Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  for (const size of [16, 32]) expect(images.get(size)!.equals(drawn(size)), `${size} px`).toBe(true);
  expect(images.get(48)!.equals(drawn(48)), '48 px').toBe(false);
});

test("the browser's own colour follows the theme", async ({ page }) => {
  await page.goto('/');
  // Every theme-color tag, whichever scheme the system is in.
  const colours = () =>
    page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((m) => m.getAttribute('content')));
  const background = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(await colours()).toEqual([await background(), await background()]);
  await page.locator('.theme-toggle').first().click();
  expect(await colours()).toEqual([await background(), await background()]);
});

// Before the first paint, the theme script sets the browser's colour to the ground of the theme it chose, from the
// stored choice or the system's, so the address bar never shows another colour first.
for (const theme of ['light', 'dark'] as const) {
  for (const from of ['stored', 'system'] as const) {
    test(`before paint, the browser's colour is the ${theme} ground (${from} choice)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: from === 'system' ? theme : theme === 'light' ? 'dark' : 'light' });
      if (from === 'stored') await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
      // The first value the page gives the meta tag, recorded as it is set.
      await page.addInitScript(() => {
        const seen = window as unknown as { firstThemeColour?: string };
        new MutationObserver((changes, observer) => {
          for (const change of changes) {
            const el = change.target as Element;
            if (el.matches?.('meta[name="theme-color"]') && change.attributeName === 'content') {
              seen.firstThemeColour = el.getAttribute('content') ?? '';
              observer.disconnect();
              return;
            }
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['content'] });
      });
      await page.goto('/');
      const [first, ground, chosen, used] = await page.evaluate(() => [
        (window as unknown as { firstThemeColour?: string }).firstThemeColour,
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        document.documentElement.dataset.theme,
        // The tag the browser uses: the first whose media query holds.
        [...document.querySelectorAll('meta[name="theme-color"]')]
          .find((meta) => matchMedia(meta.getAttribute('media') || 'all').matches)
          ?.getAttribute('content'),
      ]);
      expect(chosen).toBe(theme);
      expect(first).toBe(ground);
      expect(used, 'the tag the browser uses').toBe(ground);
    });
  }
}

// Nothing moves unless a person moves it: no animation on load or on scrolling, and the hero is the headline and
// the preview of the platform.
test('the home page moves only when asked', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(300);
  const running = await page.evaluate(() =>
    document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.target?.toString() ?? 'animation'),
  );
  expect(running).toEqual([]);
  await expect(page.locator('canvas')).toHaveCount(0);
  const order = await page.evaluate(() => {
    const heading = document.querySelector('.hero h1')!;
    const preview = document.querySelector('.hero figure.preview')!;
    return Boolean(heading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order, 'the preview follows the headline').toBe(true);
  expectExactly(
    await textOf(page.locator('.hero figure.preview figcaption')),
    'A preview of MDXplora as planned.',
    "the preview's caption",
  );
});

test('"Your data stays yours" sits under the text about compute, not alone in a column', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Where studies will run' }) });
  const [head, owned] = await Promise.all(
    ['.section-head', '.owned'].map((part) =>
      section.locator(part).evaluate((el) => el.getBoundingClientRect().toJSON()),
    ),
  );
  expectExactly(await textOf(section.locator('.owned h3')), 'Your data stays yours', 'the heading');
  expect(Math.abs(owned.left - head.left), 'in line with the text').toBeLessThanOrEqual(1);
  expect(owned.top, 'below the text').toBeGreaterThanOrEqual(head.bottom);
  expect(owned.width, 'no wider than the text').toBeLessThanOrEqual(head.width + 1);
});

test('sign-in appears only when the service address is set, and leads there', async ({ page, isMobile }) => {
  await page.goto('/');
  const everywhere = page.locator('a', { hasText: /^Sign in$/ });
  const count = await everywhere.count();
  if (count === 0) {
    // Unset: nothing points at a service that is not running.
    await expect(page.locator('a[href^="https://app."]')).toHaveCount(0);
    return;
  }
  // Header, phone menu and footer, all to the same https address.
  expect(count).toBe(3);
  const targets = new Set(await everywhere.evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href)));
  expect(targets.size).toBe(1);
  const [target] = [...targets];
  expectText(target, /^https:\/\/[a-z0-9.-]+\/$/, `the address ${target}`);
  // In the footer, it is the last of the platform's links.
  await expect(page.locator('footer a', { hasText: /^Sign in$/ })).toHaveCount(1);
  const platform = page.locator('footer nav[aria-label="Platform"] a');
  expectExactly(await textOf(platform.last()), 'Sign in', "the platform's last link");
  await expect(platform.last()).toBeVisible();
  if (isMobile) {
    await page.locator('.menu-toggle').click();
    await expect(page.locator('#mobile-menu a', { hasText: /^Sign in$/ })).toBeVisible();
  } else {
    await expect(page.locator('.site-header .actions a', { hasText: /^Sign in$/ })).toBeVisible();
  }
});

// WCAG 2.2 SC 2.4.11 with larger text: the room kept above a focused element or a linked section follows the header's
// own height, so nothing is hidden under the header or left far below it. Without JavaScript the phone header grows
// with the text; at the narrowest width it is the tallest.
const largerText = [
  { label: 'with JavaScript', javaScriptEnabled: true, fontSize: '32px' },
  { label: 'without JavaScript, at the narrowest width', javaScriptEnabled: false, fontSize: '40px', narrow: true },
];

for (const { label, javaScriptEnabled, fontSize, narrow } of largerText) {
  test.describe(`with text at ${fontSize}, ${label}`, () => {
    // A phone's browser would zoom out on text this large at 320 px; a plain window keeps the layout to measure.
    test.use({ javaScriptEnabled, ...(narrow ? { viewport: { width: 320, height: 640 }, isMobile: false } : {}) });

    test('a linked section and every focused element sit just clear of the header', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), fontSize);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe(fontSize);
      const below = (selector: string) =>
        page.evaluate((selector) => {
          const el = document.querySelector(selector)!;
          const header = document.querySelector('.site-header')!.getBoundingClientRect();
          return Math.round(el.getBoundingClientRect().top - Math.max(0, header.bottom));
        }, selector);

      await page.evaluate(() => (location.hash = 'faq'));
      await expect.poll(() => below('#faq'), 'not far below the header').toBeLessThanOrEqual(24);
      expect(await below('#faq'), 'not under the header').toBeGreaterThanOrEqual(0);

      // Back up the page with Shift+Tab: nothing focused is under the header.
      await page.locator('footer a').last().focus();
      const hidden: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Shift+Tab');
        const name = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const header = document.querySelector('.site-header')!;
          if (!el || header.contains(el) || el === document.body || el.matches('.skip-link')) return null;
          const under = el.getBoundingClientRect().top < header.getBoundingClientRect().bottom - 1;
          return under ? el.outerHTML.slice(0, 60) : null;
        });
        if (name) hidden.push(masked(name));
      }
      expect(hidden).toEqual([]);
    });
  });
}
