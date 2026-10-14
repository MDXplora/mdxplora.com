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
const text = ['--fg', '--fg-muted', '--fg-subtle', '--link', '--accent', '--positive', '--warning', '--danger'];

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
          return what.length
            ? [`${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}: ${what.join(', ')}`]
            : [];
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

// Green, amber and red say something passed, stopped or is wrong, so they are drawn only on the elements that say so:
// the preview's "Validated", the stopped run on the home page and a form field to correct. The colours of both themes
// are looked for, since the preview keeps its dark colours in the light theme.
const statusElements: Record<string, string[]> = {
  '--positive': ['.valid'],
  '--warning': ['.refusal', '.refusal-mark'],
  '--danger': ['[aria-invalid="true"]'],
};

test('status colours appear only where they say something', async ({ page }) => {
  for (const path of pages) {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
      await page.goto(path);
      const found = await page.evaluate((statusElements) => {
        const root = document.documentElement;
        const chosen = root.dataset.theme;
        const probe = document.createElement('span');
        document.body.append(probe);
        // Each colour is drawn opaque to read its red, green and blue, so a status colour is found at any alpha and in
        // any notation: rgba(), or the color(), oklab() or oklch() that a color-mix() computes to. Fully transparent
        // colours are skipped.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const pixel = (fill: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = 'transparent';
          context.fillStyle = fill;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data;
        };
        const channels = new Map<string, string | null>();
        const rgb = (colour: string) => {
          if (!channels.has(colour))
            channels.set(colour, pixel(colour)[3] ? pixel(`rgb(from ${colour} r g b / 1)`).slice(0, 3).join() : null);
          return channels.get(colour)!;
        };
        const status = new Map<string, string>();
        for (const theme of ['dark', 'light']) {
          root.dataset.theme = theme;
          for (const name of Object.keys(statusElements)) {
            probe.style.color = `var(${name})`;
            status.set(rgb(getComputedStyle(probe).color), name);
          }
        }
        root.dataset.theme = chosen;
        probe.remove();
        const out: string[] = [];
        for (const el of document.querySelectorAll('body *')) {
          for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(el, pseudo);
            if (pseudo && style.content === 'none') continue;
            const used = [
              style.color,
              style.backgroundColor,
              ...(['Top', 'Right', 'Bottom', 'Left'] as const)
                .filter((side) => parseFloat(style[`border${side}Width`]) > 0)
                .map((side) => style[`border${side}Color`]),
              ...(style.outlineStyle !== 'none' ? [style.outlineColor] : []),
              ...(style.boxShadow.match(/(?:rgba?|color|oklab|oklch|lab|lch)\([^()]*\)/g) ?? []),
              ...(el instanceof SVGElement ? [style.fill, style.stroke] : []),
              ...(style.textDecorationLine !== 'none' ? [style.textDecorationColor] : []),
            ];
            for (const colour of used) {
              const name = status.get(rgb(colour) ?? '');
              if (name && !statusElements[name].some((selector) => el.matches(selector)))
                out.push(`${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}${pseudo ?? ''}: ${name}`);
            }
          }
        }
        return [...new Set(out)];
      }, statusElements);
      expect(found, `${path} in ${theme}`).toEqual([]);
    }
  }
});

for (const theme of ['dark', 'light']) {
  test(`in the ${theme} theme, the stopped run has an amber edge and mark, and its words in the text's colours`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
    await page.goto('/');
    const token = await resolved(page, ['--warning', '--fg', '--fg-muted']);
    const refusal = page.locator('.refusal');
    const [edges, widths, mark, words] = await refusal.evaluate((box) => {
      const own = getComputedStyle(box);
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      return [
        sides.map((side) => own[`border${side}Color`]),
        sides.map((side) => own[`border${side}Width`]),
        getComputedStyle(box.querySelector('.refusal-mark')!).backgroundColor,
        [...box.querySelectorAll('.refusal-head, p')].map((el) => getComputedStyle(el).color),
      ];
    });
    for (const edge of edges) expect(colours(edge)[0], 'the edge').toEqual(token['--warning']);
    expect(widths).toEqual(['1px', '1px', '1px', '1px']);
    expect(colours(mark)[0], 'the mark').toEqual(token['--warning']);
    for (const colour of words) expect([token['--fg'], token['--fg-muted']]).toContainEqual(colours(colour)[0]);
    await expect(refusal).toContainText('Setup stopped');
  });
}

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

// The look, held in place: one blue accent, filled into the main button and marking the current page, square-ish
// controls, and no labels in spaced capitals.
const hue = ([r, g, b]: number[]) => {
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return NaN;
  const h = max === r ? (g - b) / span : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (h * 60 + 360) % 360;
};

for (const theme of ['dark', 'light']) {
  test(`in the ${theme} theme, the accent is blue and fills the main buttons`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
    for (const path of ['/', '/contact/', '/no-such-page/']) {
      await page.goto(path);
      const token = await resolved(page, ['--accent', '--link']);
      expect(hue(token['--accent']), `${path}: the accent's hue`).toBeGreaterThanOrEqual(205);
      expect(hue(token['--accent']), `${path}: the accent's hue`).toBeLessThanOrEqual(225);
      expect(token['--link'], 'links are in the accent').toEqual(token['--accent']);
      const fills = await page
        .locator('.button-primary')
        .evaluateAll((buttons) => buttons.map((b) => getComputedStyle(b).backgroundColor));
      expect(fills.length, path).toBeGreaterThan(0);
      for (const fill of fills) expect(colours(fill)[0], `${path}: a main button`).toEqual(token['--accent']);
    }
  });

  test(`in the ${theme} theme, the current page is marked in the link colour, in the bar and the phone menu`, async ({
    page,
    isMobile,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('mdxplora-theme', value), theme);
    await page.goto('/compute/');
    const token = await resolved(page, ['--link']);
    if (isMobile) await page.locator('.menu-toggle').click();
    const shown = isMobile ? '#mobile-menu nav' : '.site-header .links';
    const current = page.locator(`${shown} a[aria-current="page"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toBeVisible();
    await expect(current).toHaveText('Compute');
    // Both navigations, the one on screen and the other, mark the same page in the same colour.
    for (const nav of ['.site-header .links', '#mobile-menu nav']) {
      const colour = await page.locator(`${nav} a[aria-current="page"]`).evaluate((a) => getComputedStyle(a).color);
      expect(colours(colour)[0], `${nav}: the current page`).toEqual(token['--link']);
    }
  });
}

test('the phone menu says which page is open', async ({ page }) => {
  for (const [path, label] of [
    ['/compute/', 'Compute'],
    ['/services/', 'Services'],
    ['/contact/', 'Contact'],
  ]) {
    await page.goto(path);
    const current = page.locator('#mobile-menu a[aria-current="page"]');
    await expect(current, path).toHaveCount(1);
    await expect(current, path).toHaveText(label);
  }
  await page.goto('/privacy/');
  await expect(page.locator('#mobile-menu a[aria-current]')).toHaveCount(0);
});

test('every button has the controls’ corners', async ({ page }) => {
  for (const path of ['/', '/contact/', '/no-such-page/']) {
    await page.goto(path);
    const found = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.borderRadius = 'var(--radius-s)';
      document.body.append(probe);
      const control = getComputedStyle(probe).borderTopLeftRadius;
      probe.remove();
      return [...document.querySelectorAll('.button, button')].flatMap((el) => {
        const own = getComputedStyle(el);
        const corners = [
          own.borderTopLeftRadius,
          own.borderTopRightRadius,
          own.borderBottomRightRadius,
          own.borderBottomLeftRadius,
        ];
        return corners.every((corner) => corner === control) ? [] : [`${el.className}: ${corners.join(' ')}`];
      });
    });
    expect(found, path).toEqual([]);
  }
});

test('no heading has a label in capitals or spaced letters above it', async ({ page }) => {
  for (const path of pages) {
    await page.goto(path);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      // Text drawn in capitals, small capitals or with letters spaced out, by an element or by its ::before or ::after.
      for (const el of document.querySelectorAll('body *')) {
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(el, pseudo);
          const text = pseudo
            ? /^".*"$/.test(style.content)
              ? style.content.slice(1, -1)
              : ''
            : [...el.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('');
          if (!/\p{L}/u.test(text)) continue;
          const spaced = parseFloat(style.letterSpacing) > 0.02 * parseFloat(style.fontSize);
          if (style.textTransform === 'uppercase' || style.fontVariantCaps !== 'normal' || spaced)
            out.push(
              `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}${pseudo ?? ''}: ${text.trim().slice(0, 40)}`,
            );
        }
      }
      // Capitals typed as such: the line just above a heading is not a short label in capitals.
      for (const heading of document.querySelectorAll('h1, h2')) {
        const above = heading.previousElementSibling?.textContent?.trim() ?? '';
        if (above.length <= 40 && /\p{Lu}{2}/u.test(above) && above === above.toUpperCase())
          out.push(`above "${heading.textContent?.trim()}": ${above}`);
      }
      return out;
    });
    expect(found, path).toEqual([]);
  }
});
