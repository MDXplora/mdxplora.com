import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';

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
    expect(errors).toEqual([]);
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
      expect(policy, path).toContain(directive);
    }
    expect(policy, `${path} allows no inline code by blanket permission`).not.toContain('unsafe-inline');
    // Every inline script the page runs is allowed by its own hash, wherever it sits in the page.
    const inline = await page.locator('script:not([src]):not([type="application/ld+json"])').allTextContents();
    for (const source of inline) {
      const hash = `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
      expect(policy, `${path}: ${source.slice(0, 60)}`).toContain(hash);
    }
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
  }
  // Give late scripts (the form) a moment to run.
  await page.goto('/');
  await page.waitForTimeout(500);
  expect(violations).toEqual([]);
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

  if ((await loader.count()) === 0) {
    expect(policy).not.toContain('cloudflareinsights');
    await expect(prose).toContainText('runs no analytics');
    await expect(prose).not.toContainText('Visit counts');
  } else {
    await expect(loader).toHaveAttribute('data-host', 'mdxplora.com');
    expect(policy).toContain('https://static.cloudflareinsights.com/beacon.min.js');
    expect(policy).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
    await expect(prose).toContainText('Visit counts');
    await expect(prose).not.toContainText('runs no analytics');
  }
  // This test serves the site from localhost, which must never be counted.
  await page.goto('/');
  await page.waitForTimeout(300);
  expect(beaconRequests).toEqual([]);
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
    expect(alt, path).toBe(`MDXplora: ${headline}`);
    expect(twitterAlt, path).toBe(alt);

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
      expect(text, path).toContain(status);
    }
    for (const said of [text, description]) {
      expect(said, path).not.toMatch(availableToday);
      expect(said, path).not.toMatch(/early access is open\b|\bis in early access\b|in one command/i);
      // A study on the service is planned, and MDXplora validates its Config rather than checking it.
      expect(said, path).not.toMatch(/\bstudy is reproducible\b|\bchecked before it runs\b/i);
    }
  }
});

test('a link preview image says what is planned', () => {
  // The image is shown on other sites, without the note on the page. Read from the source, which the
  // browser tests cannot import (it reads the build's settings).
  const texts = [...readFileSync('src/data/cards.ts', 'utf8').matchAll(/\btext: '([^']+)'/g)].map((m) => m[1]);
  expect(texts.length).toBeGreaterThan(2);
  for (const text of texts) {
    if (describesCompute.test(text)) expect(text).toMatch(/\bwill\b|planned/);
    expect(text).not.toMatch(availableToday);
  }
});

test('the README says what is planned', () => {
  const readme = readFileSync('README.md', 'utf8');
  const opening = readme.split('\n\n')[2];
  expect(opening).toContain('MDXplora is being built and opens to early-access groups in stages.');
  expect(readme).not.toMatch(/\bis in early access\b/i);
  // The ways to start are planned too.
  const ways = readme.split('## Three ways to start')[1].split('\n## ')[0];
  const items = ways.split('\n- ').slice(1);
  expect(items).toHaveLength(3);
  for (const item of items) expect(item).toMatch(/\bwill\b/);
});

test('the answer to "Can I use MDXplora today?" says it plainly', async ({ page }) => {
  await page.goto('/');
  const answer = (await page.locator('details', { hasText: 'Can I use MDXplora today?' }).locator('p').textContent())!;
  expect(answer).toContain('MDXplora is being built and opens to early-access groups in stages');
  expect(answer.match(/\bgroups\b/g), 'says "groups" once').toHaveLength(1);
});

test('a Config written by the Agent or built in the form is validated, in those words', async ({ page }) => {
  await page.goto('/');
  const describe = page.locator('.card', { has: page.getByRole('heading', { name: 'Describe it' }) });
  await expect(describe).toContainText('validates it');
  await expect(describe).not.toContainText(/\bchecks?\b/);
  const build = page.locator('.card', { has: page.getByRole('heading', { name: 'Build it' }) });
  await expect(build).toContainText('validates each one as you go');
  await expect(build).not.toContainText(/\bcheck(?:s|ed)?\b/);
  const readme = readFileSync('README.md', 'utf8');
  expect(readme).toMatch(/\*\*Describe it\.\*\*[^\n]*\n?[^\n]*validates? it/);
  expect(readme).toMatch(/\*\*Build it\.\*\*[^\n]*\n?[^\n]*validate each one as you go/);
});

test('DEVELOPMENT.md names every check script', () => {
  const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts);
  const development = readFileSync('DEVELOPMENT.md', 'utf8');
  for (const name of scripts.filter((name) => name.startsWith('check'))) {
    expect(development).toContain(`npm run ${name} `);
  }
});

test('Dependabot leaves fflate on 0.7 while the override holds it there', () => {
  const pinned = JSON.parse(readFileSync('package.json', 'utf8')).overrides.satori.fflate;
  const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
  if (pinned.startsWith('0.7.')) {
    expect(dependabot).toMatch(/- dependency-name: fflate\n\s+versions: \['>= 0\.8\.0'\]/);
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
    expect(elsewhere, path).not.toContain('FastMDXplora');
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
  for (const path of pages) expect(listed, 'pages in the sitemap').toContain(path);
  return listed;
}

// The text files under a folder, known by their extension, so an image or a font is not read as text. A link is not
// followed, and only regular files are read.
const TEXT_FILE = /\.(?:astro|ts|js|mjs|css|md|mdx|json|svg|html|txt)$/i;
function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return entry.isFile() && TEXT_FILE.test(entry.name) ? [path] : [];
  });
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
    symlinkSync(join(dir, 'page.astro'), join(dir, 'link.ts'));
    symlinkSync(join(dir, 'assets'), join(dir, 'linked'));
    expect(textFiles(dir).sort()).toEqual(
      [join(dir, 'assets', 'logo.svg'), join(dir, 'notes.md', 'plan.MD'), join(dir, 'page.astro')].sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing calls MDXplora a company or speaks of customers', async ({ page, request }) => {
  for (const path of [...(await sitemapPages(request)), '/no-such-page/']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(path === '/no-such-page/' ? 404 : 200);
    expect(commerceFound(await page.content()), path).toEqual([]);
  }
  for (const path of ['/.well-known/security.txt', '/manifest.webmanifest', '/robots.txt']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(commerceFound(await response.text()), path).toEqual([]);
  }
  const source = textFiles('src');
  expect(source).toContain(join('src', 'data', 'cards.ts'));
  expect(source.length, 'text files read under src/').toBeGreaterThanOrEqual(26);
  for (const file of ['README.md', 'DEVELOPMENT.md', ...source])
    expect(commerceFound(readFileSync(file, 'utf8')), file).toEqual([]);
});

// The site speaks as "the MDXplora team". Its operator is named on the privacy page only, as the data controller.
const operatorName = /(?<![\p{L}\p{N}])(?:adekunle|aina)(?![\p{L}\p{N}])/iu;

test('the check for the operator finds his name in any case, and only as a word', () => {
  for (const text of ['Adekunle Aina', 'ADEKUNLE', 'aina', 'Dr Aina.', 'Adekunle’s'])
    expect(operatorName.test(text), text).toBe(true);
  for (const text of ['Ainara', 'containable', 'MDXplora team', 'Adekunles'])
    expect(operatorName.test(text), text).toBe(false);
});

test('the operator is named on the privacy page, and nowhere else', async ({ request }) => {
  for (const path of [...(await sitemapPages(request)), '/no-such-page/']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(path === '/no-such-page/' ? 404 : 200);
    const html = await response.text();
    const [head, body] = html.split(/<\/head>/i);
    expect(body, `${path} has a head and a body`).toBeDefined();
    // The head holds the metadata, the structured data and the link preview image's alt text.
    expect(head.match(operatorName)?.[0], `${path}: metadata`).toBeUndefined();
    if (path === '/privacy/') expect(body, path).toContain('Adekunle Aina is responsible for the personal data');
    else expect(body.match(operatorName)?.[0], path).toBeUndefined();
  }
  for (const path of ['/.well-known/security.txt', '/manifest.webmanifest', '/robots.txt']) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect((await response.text()).match(operatorName)?.[0], path).toBeUndefined();
  }
});

test('the privacy page answers Do Not Track and says what Formspree receives', async ({ page }) => {
  await page.goto('/privacy/');
  const prose = page.locator('.prose');
  await expect(prose).toContainText('Do Not Track');
  await expect(prose).toContainText('Global Privacy Control');
  await expect(prose).toContainText('your IP address and the name of your browser');
  await expect(prose).toContainText('With JavaScript turned off');
  // Mail written to the address directly takes the same route as the form's.
  await expect(prose).toContainText(
    "Everything sent to info@mdxplora.com, from the form or written to it directly, is forwarded by Cloudflare Email Routing to our mailbox in Google's Gmail.",
  );
  // The page names who is responsible for that data, and how long messages are kept.
  await expect(prose).toContainText('Adekunle Aina is responsible for the personal data this site collects');
  await expect(prose).toContainText('You can reach him at info@mdxplora.com.');
  await expect(prose).toContainText('We keep messages for one year after our last contact with you, then delete them.');
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
  expect([...stored].sort()).toEqual(Object.keys(described).sort());
  await page.goto('/privacy/');
  for (const words of Object.values(described)) await expect(page.locator('.prose')).toContainText(words);
});

test('the setting an earlier version stored for its animation is deleted, and the theme kept', async ({ page }) => {
  await page.goto('/privacy/');
  await page.evaluate(() => {
    localStorage.setItem('mdxplora-fluid', 'paused');
    localStorage.setItem('mdxplora-theme', 'light');
  });
  await page.goto('/');
  const kept = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(kept).toEqual(['mdxplora-theme']);
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
      expect(headingFaults(text, opensWithCode), `${path}: ${text}`).toEqual([]);
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
  expect(stages).toEqual(['Config', 'setup', 'simulation', 'analysis', 'report', 'Manifest']);
  await expect(page.locator('h1')).toHaveText('From question to publishable molecular dynamics');
  await expect(page.locator('main a[href="/services/"]')).toHaveText('About our services');
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
  await expect(page.locator('.status')).toContainText('Thank you');
  expect(sent).toHaveLength(1);
  expect(sent[0]._subject).toBe('MDXplora website: Training enquiry from Ada Lovelace');
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
  await expect(page.locator('.status')).toContainText('Please fill in');
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveAttribute('aria-invalid');
  expect(sent).toHaveLength(0);

  await fillContact(page);
  await expect(page.getByLabel('Email', { exact: true })).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.status')).toContainText('Thank you');
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
      expect(without).toEqual(expected);
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
  await expect(compute.locator('option')).toHaveText([
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
  await expect(page.locator('.status')).toContainText('Thank you');
  expect(sent[0]).toMatchObject({
    _subject: 'MDXplora website: Early access request from Ada Lovelace',
    'where you work': 'An academic research group',
    'compute you have now': 'A cluster (at a university, a national centre or in industry)',
    'what you want to simulate': 'A small protein in water.',
  });

  // A different topic sends none of them.
  await page.getByLabel('What is it about?').selectOption('support');
  await fillContact(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(Object.keys(sent[1])).not.toContain('where you work');
  expect(Object.keys(sent[1])).not.toContain('what you want to simulate');
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
  expect(fields.Contact).toBe('mailto:info@mdxplora.com');
  expect(fields.Canonical).toBe('https://mdxplora.com/.well-known/security.txt');
  const daysLeft = (Date.parse(fields.Expires) - Date.now()) / 86_400_000;
  expect(daysLeft, 'expires in the future, less than a year ahead').toBeGreaterThan(0);
  expect(daysLeft).toBeLessThan(365);
});

test('the icons, the manifest and the structured data all resolve', async ({ page, request }) => {
  const png = async (path: string) => {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const body = await response.body();
    return [body.readUInt32BE(16), body.readUInt32BE(20)];
  };
  expect(await png('/apple-touch-icon.png')).toEqual([180, 180]);

  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  expect((await ico.body()).readUInt16LE(4), 'images in favicon.ico').toBe(3);

  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('MDXplora');
  for (const icon of manifest.icons) {
    const [w, h] = icon.sizes.split('x').map(Number);
    expect(await png(icon.src), icon.src).toEqual([w, h]);
  }

  await page.goto('/');
  const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)['@graph'];
  const organization = graph.find((node: { '@type': string }) => node['@type'] === 'Organization');
  expect(organization.name).toBe('MDXplora');
  expect(await png(new URL(organization.logo).pathname)).toEqual([512, 512]);
});

test('the browser icon is the current mark, at an address that changes with it', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
  expect(href).toMatch(/^\/favicon\.svg\?v=[0-9a-f]{8}$/);
  const svg = await (await request.get(href!)).text();
  expect(svg.match(/<circle/g)?.length, 'the droplet has seven atoms').toBe(7);
  expect(svg, 'in white on solid blue').toMatch(/<rect [^>]*fill="#155ad1"/);
  expect(svg).not.toMatch(/gradient/i);
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
  for (const href of [svgHref, icoHref]) expect(new URL(href, page.url()).searchParams.get('v'), href).toBe(expected);

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
  await expect(page.locator('.hero figure.preview figcaption')).toHaveText('A preview of MDXplora as planned.');
});

test('"Your data stays yours" sits under the text about compute, not alone in a column', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Where studies will run' }) });
  const [head, owned] = await Promise.all(
    ['.section-head', '.owned'].map((part) =>
      section.locator(part).evaluate((el) => el.getBoundingClientRect().toJSON()),
    ),
  );
  await expect(section.locator('.owned h3')).toHaveText('Your data stays yours');
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
  expect(target).toMatch(/^https:\/\/[a-z0-9.-]+\/$/);
  // In the footer, it is the last of the platform's links.
  await expect(page.locator('footer a', { hasText: /^Sign in$/ })).toHaveCount(1);
  const platform = page.locator('footer nav[aria-label="Platform"] a');
  await expect(platform.last()).toHaveText('Sign in');
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
        if (name) hidden.push(name);
      }
      expect(hidden).toEqual([]);
    });
  });
}
