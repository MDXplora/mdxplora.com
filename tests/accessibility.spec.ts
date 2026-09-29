import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Every page, in both themes, against WCAG 2.2 level AA as far as a machine can check it.
const pages = ['/', '/compute/', '/services/', '/early-access/', '/contact/', '/privacy/', '/no-such-page/'];

for (const theme of ['dark', 'light']) {
  for (const path of pages) {
    test(`${path} in the ${theme} theme meets WCAG AA`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      const found = violations.map(
        (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
      expect(found).toEqual([]);
    });
  }
}

// What axe cannot measure: text drawn in a gradient, white text on one, and a form field's edge.
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const colours = (css: string) => [...css.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)].map((m) => m.slice(1, 4).map(Number));
// Every point of a gradient between its stops, as the browser draws it.
const along = (stops: number[][]) =>
  stops
    .slice(1)
    .flatMap((to, i) =>
      Array.from({ length: 11 }, (_, k) => stops[i].map((c, j) => Math.round(c + ((to[j] - c) * k) / 10))),
    );

for (const theme of ['dark', 'light']) {
  test(`in the ${theme} theme, gradients and form fields keep their contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
    await page.goto('/');
    const ground = colours(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))[0];
    const heading = await page.locator('.hero .gradient-text').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(colours(heading)).toHaveLength(3);
    for (const point of along(colours(heading)))
      expect(contrast(point, ground), `${point}`).toBeGreaterThanOrEqual(4.5);

    await page.goto('/compute/');
    const badge = await page
      .locator('.step-number')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(colours(badge)).toHaveLength(3);
    for (const point of along(colours(badge))) expect(contrast(point, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);

    await page.goto('/contact/');
    const [edge, fill, card] = await page.locator('input[name="name"]').evaluate((el) => {
      const own = getComputedStyle(el);
      return [own.borderTopColor, own.backgroundColor, getComputedStyle(el.closest('.card')!).backgroundColor];
    });
    expect(contrast(colours(edge)[0], colours(card)[0])).toBeGreaterThanOrEqual(3);
    expect(contrast(colours(edge)[0], colours(fill)[0])).toBeGreaterThanOrEqual(3);
  });
}

test('the header blurs what scrolls under it, with the prefix older Safari reads kept too', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const filter = await page.locator('.site-header').evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(filter).toContain('blur');
  const sheets = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href));
  const css = (await Promise.all(sheets.map(async (href) => (await request.get(href)).text()))).join('\n');
  expect(css).toMatch(/[^-]backdrop-filter:\s*saturate/);
  expect(css).toContain('-webkit-backdrop-filter:saturate');
});
