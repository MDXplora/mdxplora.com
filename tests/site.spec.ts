import { expect, test } from '@playwright/test';

const pages = ['/', '/compute/', '/services/', '/contact/', '/privacy/', '/docs/', '/docs/api/'];

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

test('a theme chosen on the site carries into the docs', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the toggle sits in the header on wide screens');
  await page.goto('/');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('.theme-toggle').first().click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.goto('/docs/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
});

test('the site is about MDXplora: the engine is named only in the footer and the answers', async ({ page }) => {
  for (const path of ['/', '/compute/', '/services/', '/contact/', '/privacy/']) {
    await page.goto(path);
    const elsewhere = await page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('footer, #faq').forEach((el) => el.remove());
      return copy.textContent ?? '';
    });
    expect(elsewhere, path).not.toContain('FastMDXplora');
  }
});

test('a link from another page chooses the contact topic', async ({ page }) => {
  await page.goto('/contact/?topic=training');
  await expect(page.locator('select[name="topic"]')).toHaveValue('training');
  await expect(page.locator('input[name="_gotcha"]')).not.toBeInViewport();
});

test('the docs are searchable and list every page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the sidebar is behind the menu on phones');
  await page.goto('/docs/');
  await expect(page.locator('site-search button').first()).toBeVisible();
  const links = await page.locator('.sidebar-content a').count();
  expect(links).toBeGreaterThan(20);
});
