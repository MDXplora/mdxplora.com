import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const pages = ['/', '/compute/', '/services/', '/contact/', '/privacy/'];

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
  // Give late scripts (the hero fluid, the form) a moment to run.
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
    const headline = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim();
    expect(alt, path).toContain(headline);

    // The image is addressed on the live domain; fetch the same path from this build.
    const response = await request.get(new URL(image!).pathname);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('image/png');
    const png = await response.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([1200, 630]);
    expect(png.length, `${path} stays small enough for chat apps`).toBeLessThan(400_000);
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
  for (const path of ['/', '/compute/', '/services/', '/contact/', '/privacy/', '/no-such-page/']) {
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

test('the privacy page answers Do Not Track and says what Formspree receives', async ({ page }) => {
  await page.goto('/privacy/');
  const prose = page.locator('.prose');
  await expect(prose).toContainText('Do Not Track');
  await expect(prose).toContainText('Global Privacy Control');
  await expect(prose).toContainText('your IP address and the name of your browser');
  await expect(prose).toContainText('With JavaScript turned off');
});

test('an unknown address gets the not-found page, which claims no address of its own', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
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
      expect(without['--bg']).toBe(scheme === 'light' ? '#fafbfe' : '#070b16');
      expect(without).toEqual(expected);
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
  await early.getByLabel('Compute you have now').selectOption('A workstation with a GPU');
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
    'compute you have now': 'A workstation with a GPU',
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
});

test("the browser's own colour follows the theme", async ({ page }) => {
  await page.goto('/');
  const colour = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  const background = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  expect(await colour()).toBe(await background());
  await page.locator('.theme-toggle').first().click();
  expect(await colour()).toBe(await background());
});

test.describe('the hero fluid', () => {
  const state = (page: import('@playwright/test').Page) =>
    page.locator('canvas.particle-field').getAttribute('data-state');

  test('runs while on screen and stops when scrolled away', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => state(page)).toBe('running');
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await expect.poll(() => state(page)).toBe('paused');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => state(page)).toBe('running');
  });

  test('says what it is', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.particle-caption')).toContainText('Lennard-Jones fluid');
    await expect(page.locator('.particle-caption')).toContainText('Droplets of 10 or more atoms');
  });

  test('is a still picture when motion is reduced, with nothing to pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('canvas.particle-field')).toHaveClass(/ready/);
    await expect.poll(() => state(page)).toBe('still');
    await expect(page.locator('.particle-toggle')).toBeHidden();
  });

  test('stops at once when motion is reduced while the page is open', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => state(page)).toBe('running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => state(page)).toBe('still');
    await expect(page.locator('.particle-toggle')).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => state(page)).toBe('running');
  });

  test('can be paused and played, and the choice is remembered (WCAG 2.2.2)', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => state(page)).toBe('running');
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await expect.poll(() => state(page)).toBe('held');
    await page.reload();
    await expect(page.locator('canvas.particle-field')).toHaveClass(/ready/);
    await expect.poll(() => state(page)).toBe('held');
    await page.getByRole('button', { name: 'Play animation' }).click();
    await expect.poll(() => state(page)).toBe('running');
    await page.reload();
    await expect.poll(() => state(page)).toBe('running');
  });

  test.describe(() => {
    // The spacing is added as a style of the test's own, which the page's policy would refuse.
    test.use({ bypassCSP: true });
    test('its caption follows the headline in reading order and never overlaps the hero', async ({ page }) => {
      await page.goto('/');
      const after = await page.evaluate(() => {
        const heading = document.querySelector('.hero h1')!;
        const caption = document.querySelector('.particle-caption')!;
        return Boolean(heading.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(after).toBe(true);
      // With the text spacing WCAG 1.4.12 asks a page to bear.
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }',
      });
      const overlap = await page.evaluate(() => {
        const note = document.querySelector('.particle-note')!.getBoundingClientRect();
        return [...document.querySelectorAll('.hero-inner > *')].some((el) => {
          const box = el.getBoundingClientRect();
          return box.bottom > note.top + 1 && box.top < note.bottom && box.right > note.left && box.left < note.right;
        });
      });
      expect(overlap).toBe(false);
    });
  });
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
  await expect(page.locator('footer a', { hasText: /^Sign in$/ })).toBeVisible();
  if (isMobile) {
    await page.locator('.menu-toggle').click();
    await expect(page.locator('#mobile-menu a', { hasText: /^Sign in$/ })).toBeVisible();
  } else {
    await expect(page.locator('.site-header .actions a', { hasText: /^Sign in$/ })).toBeVisible();
  }
});
