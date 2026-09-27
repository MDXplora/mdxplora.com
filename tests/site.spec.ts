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

test('a chosen theme is remembered on the next page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the toggle sits in the header on wide screens');
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

test('an unknown address gets the not-found page', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible();
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

test("the browser's own colour follows the theme", async ({ page, isMobile }) => {
  test.skip(isMobile, 'the toggle sits in the header on wide screens');
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

  test('is a still picture when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('canvas.particle-field')).toHaveClass(/ready/);
    await expect.poll(() => state(page)).toBe('still');
  });
});
