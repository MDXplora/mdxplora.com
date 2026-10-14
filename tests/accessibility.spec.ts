import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

// What axe cannot measure: the theme's colours on every ground of the theme, not only where they sit today, and a
// form field's edge.
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

// Each token as the browser resolves it, in rgb().
async function resolved(page: Page, names: string[]): Promise<Record<string, number[]>> {
  const values = await page.evaluate((names) => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const out = Object.fromEntries(
      names.map((name) => {
        probe.style.color = `var(${name})`;
        return [name, getComputedStyle(probe).color];
      }),
    );
    probe.remove();
    return out;
  }, names);
  return Object.fromEntries(Object.entries(values).map(([name, css]) => [name, colours(css)[0]]));
}

const grounds = ['--bg', '--bg-raised', '--bg-sunken', '--surface', '--surface-hover'];
const text = ['--fg', '--fg-muted', '--fg-subtle', '--link', '--accent', '--positive', '--danger'];

for (const theme of ['dark', 'light']) {
  test(`in the ${theme} theme, text and the accent keep 4.5:1 on every ground, and form fields 3:1`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
    await page.goto('/');
    const token = await resolved(page, [...grounds, ...text, '--accent-fg', '--accent-hover']);
    for (const ground of grounds)
      for (const name of text)
        expect(contrast(token[name], token[ground]), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    // The words on a filled blue button, at rest and under the pointer.
    for (const fill of ['--accent', '--accent-hover'])
      expect(contrast(token['--accent-fg'], token[fill]), `on ${fill}`).toBeGreaterThanOrEqual(4.5);

    await page.goto('/contact/');
    const [edge, fill, card] = await page.locator('input[name="name"]').evaluate((el) => {
      const own = getComputedStyle(el);
      return [own.borderTopColor, own.backgroundColor, getComputedStyle(el.closest('.card')!).backgroundColor];
    });
    expect(contrast(colours(edge)[0], colours(card)[0])).toBeGreaterThanOrEqual(3);
    expect(contrast(colours(edge)[0], colours(fill)[0])).toBeGreaterThanOrEqual(3);
  });
}

test('the focus ring is visible, in the accent, on every kind of control', async ({ page }) => {
  await page.goto('/contact/');
  for (const selector of ['.site-header a.home', 'a.button-primary', '.theme-toggle', 'input[name="name"]']) {
    const target = page.locator(selector).first();
    if (!(await target.isVisible())) continue;
    await target.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const [style, width, accent] = await target.evaluate((el) => {
      const own = getComputedStyle(el);
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return [own.outlineStyle, parseFloat(own.outlineWidth), own.outlineColor === accent];
    });
    expect(style, selector).toBe('solid');
    expect(width, selector).toBeGreaterThanOrEqual(2);
    expect(accent, selector).toBe(true);
  }
});

test('no page draws a gradient, a glow or a shadow behind its text', async ({ page }) => {
  for (const path of [...pages]) {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
      await page.goto(path);
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('*')].flatMap((el) => {
          const style = getComputedStyle(el);
          const what = [
            style.backgroundImage.includes('gradient') && 'gradient',
            style.textShadow !== 'none' && 'text shadow',
            style.boxShadow !== 'none' && 'shadow',
            style.backdropFilter !== 'none' && 'backdrop filter',
          ].filter(Boolean);
          return what.length ? [`${el.tagName.toLowerCase()}.${el.className}: ${what.join(', ')}`] : [];
        }),
      );
      expect(found, `${path} in ${theme}`).toEqual([]);
    }
  }
});

test('the header is solid, on the page ground, with a hairline beneath and nothing blurred', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 600));
  const [background, ground, filter, border, borderStyle] = await page.locator('.site-header').evaluate((el) => {
    const own = getComputedStyle(el);
    return [
      own.backgroundColor,
      getComputedStyle(document.body).backgroundColor,
      own.backdropFilter,
      own.borderBottomWidth,
      own.borderBottomStyle,
    ];
  });
  expect(background).toBe(ground);
  expect(background).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
  expect(filter).toBe('none');
  expect(border).toBe('1px');
  expect(borderStyle).toBe('solid');
  const sheets = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href));
  const css = (await Promise.all(sheets.map(async (href) => (await request.get(href)).text()))).join('\n');
  expect(css).not.toContain('backdrop-filter');
});

// WCAG 2.2 SC 2.4.11, which axe does not check: going back up a page with Shift+Tab, no focused element ends up
// under the sticky header.
const focusPages = ['/', '/compute/', '/services/', '/early-access/', '/contact/', '/privacy/'];

async function hiddenUnderHeader(page: Page, path: string): Promise<string[]> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await page.locator('footer a').last().focus();
  const hidden: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Shift+Tab');
    const where = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const header = document.querySelector('.site-header');
      if (!el || !header || header.contains(el) || el === document.body || el.matches('.skip-link')) return null;
      const box = el.getBoundingClientRect();
      return { top: box.top, under: header.getBoundingClientRect().bottom, name: el.outerHTML.slice(0, 80) };
    });
    if (where && where.top < where.under - 1) hidden.push(`${where.name} (top ${Math.round(where.top)})`);
  }
  return hidden;
}

for (const path of focusPages) {
  test(`${path}: focus is never hidden under the sticky header`, async ({ page }) => {
    expect(await hiddenUnderHeader(page, path)).toEqual([]);
  });
}

// Without JavaScript the phone header shows its links, on as many rows as they need, so it is taller.
test.describe('without JavaScript, at the narrowest width', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  for (const path of focusPages) {
    test(`${path}: focus is never hidden under the taller header`, async ({ page }) => {
      expect(await hiddenUnderHeader(page, path)).toEqual([]);
    });
  }
});
