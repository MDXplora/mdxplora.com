import { expect, test } from '@playwright/test';

const pages = ['/', '/hosted/', '/services/', '/cite/', '/contact/', '/privacy/', '/docs/', '/docs/api/'];

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

test('the release shown is the one conda-forge serves', async ({ page, request }) => {
  const conda = await request.get('https://api.anaconda.org/package/conda-forge/fastmdxplora');
  const { latest_version } = await conda.json();
  await page.goto('/');
  await expect(page.locator('.hero .pill')).toContainText(latest_version);
});

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

test('the Config tabs switch with the keyboard', async ({ page }) => {
  await page.goto('/');
  const gui = page.getByRole('tab', { name: 'GUI' });
  await gui.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'CLI' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-cli')).toBeVisible();
  await expect(page.locator('#panel-gui')).toBeHidden();
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
