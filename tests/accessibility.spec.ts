import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Every page, in both themes, against WCAG 2.2 level AA as far as a machine can check it.
const pages = ['/', '/compute/', '/services/', '/contact/', '/privacy/', '/no-such-page/'];

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
