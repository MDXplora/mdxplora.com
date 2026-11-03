import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectExactly, expectText, masked, textOf } from './lib/operator-name';

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
      const found = violations.map((v) =>
        masked(`${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
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
      expect(
        found.map((one) => masked(one)),
        `${path} in ${theme}`,
      ).toEqual([]);
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
  expectText(css, 'backdrop-filter', 'the style sheets', false);
});

// Green, amber and red say something passed, stopped or is wrong, so they are drawn only on the elements that say so:
// the preview's "Validated", the stopped run on the home page and a form field to correct. The colours of both themes
// are looked for, since the preview keeps its dark colours in the light theme. Every property counts, of the root, the
// body and each element in it, and of its generated content, its list marker where one is drawn, and a field's
// placeholder, a selection or a first letter or line that a rule styles: a colour, a shadow, a gradient or a filter.
// So does what a rule gives an element hovered, focused, pressed or linked to (:target). A colour mixed from a status
// colour's token, as by color-mix() or a relative colour, counts as that status colour. A status colour written out
// in full and then mixed is not found: draw it from its token.
const statusElements: Record<string, string[]> = {
  '--positive': ['.valid'],
  '--warning': ['.refusal', '.refusal-mark'],
  '--danger': ['[aria-invalid="true"]'],
};

// Each use of a status colour where it says nothing: the properties that show it and how they were found, and the
// rule that sets it, for a part a rule styles; and the parts of the page that show it. Run in the page.
type StatusUse = { use: string; parts: string[] };
function statusColoursShown(statusElements: Record<string, string[]>): StatusUse[] {
  const root = document.documentElement;
  const chosen = root.dataset.theme;
  // Transitions are off, so each colour takes its new value at once. A style sheet made here, unlike a style element,
  // is allowed by the security policy.
  const noTransitions =
    '*, ::before, ::after, ::marker, ::placeholder, ::selection, ::first-letter, ::first-line ' +
    '{ transition: none !important; }';
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(noTransitions);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const probe = document.createElement('span');
  document.body.append(probe);
  // Each colour is drawn opaque to read its red, green and blue, so a status colour is found at any alpha and in any
  // notation: rgba(), or the color(), oklab() or oklch() that a color-mix() computes to. Fully transparent colours are
  // skipped.
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
  if (chosen === undefined) delete root.dataset.theme;
  else root.dataset.theme = chosen;
  probe.remove();

  // The selectors of a list, split at the commas outside brackets and quotes, so :is(input, textarea) is one.
  const selectorsIn = (list: string) => {
    const found: string[] = [];
    let [depth, quote, start] = [0, '', 0];
    for (let i = 0; i < list.length; i++) {
      const char = list[i];
      if (char === '\\') i++;
      else if (quote) quote = char === quote ? '' : quote;
      else if (char === '"' || char === "'") quote = char;
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === ',' && !depth) {
        found.push(list.slice(start, i).trim());
        start = i + 1;
      }
    }
    return [...found, list.slice(start).trim()];
  };
  // How specific a selector is, as one number: its ids, then its classes, attributes and pseudo-classes, then its types
  // and pseudo-elements, as the cascade counts them. :is(), :not() and :has() count as their most specific selector,
  // :where() as nothing, and :nth-child() as a pseudo-class and the selector after its "of".
  const specificity = (selector: string): number => {
    const [id, kind, type] = [1e6, 1e3, 1];
    const name = /^(?:\\.|[\w-]|[^\x00-\x7f])+/;
    const most = (list: string) => Math.max(0, ...selectorsIn(list).map(specificity));
    let total = 0;
    for (let i = 0; i < selector.length;) {
      const rest = selector.slice(i);
      const word = (from: number) => name.exec(rest.slice(from))?.[0] ?? '';
      // Where the brackets that open at a place close, and the text inside them.
      const inside = (open: number): [number, string] => {
        for (let at = open, depth = 0; at < rest.length; at++) {
          if (rest[at] === '\\') at++;
          else if (rest[at] === '(') depth++;
          else if (rest[at] === ')' && --depth === 0) return [at + 1, rest.slice(open + 1, at)];
        }
        return [rest.length, rest.slice(open + 1)];
      };
      let step = 1;
      if (rest[0] === '#' || rest[0] === '.')
        [total, step] = [total + (rest[0] === '#' ? id : kind), 1 + word(1).length];
      else if (rest[0] === '[')
        [total, step] = [total + kind, /^\[(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\\.|[^\]])*\]?/.exec(rest)![0].length];
      else if (rest.startsWith('::')) {
        const after = 2 + word(2).length;
        [total, step] = [total + type, rest[after] === '(' ? inside(after)[0] : after];
      } else if (rest[0] === ':') {
        const pseudo = word(1).toLowerCase();
        step = 1 + pseudo.length;
        if (/^(?:before|after|first-line|first-letter)$/.test(pseudo)) total += type;
        else if (rest[step] !== '(') total += kind;
        else {
          const [end, args] = inside(step);
          if (/^(?:is|not|has|matches|-webkit-any)$/.test(pseudo)) total += most(args);
          else if (pseudo !== 'where') {
            const of = /^nth-(?:last-)?child$/.test(pseudo) ? /\sof\s+([\s\S]*)$/i.exec(args) : null;
            total += kind + (of ? most(of[1]) : 0);
          }
          step = end;
        }
      } else if (name.test(rest)) [total, step] = [total + type, word(0).length];
      i += step;
    }
    return total;
  };
  // Every style rule of every style sheet the page has but the one made here, in order, with its selector in full: in a
  // rule nested in another, & is the rule around it, as :is(...), and a selector without & is inside it.
  type Rule = { written: string; selector: string; style: CSSStyleDeclaration };
  const rulesIn = (list: CSSRuleList, parent?: string): Rule[] =>
    [...list].flatMap((rule) => {
      let selector = parent;
      if (rule instanceof CSSStyleRule)
        selector = selectorsIn(rule.selectorText)
          .map((one) =>
            parent === undefined
              ? one
              : one.includes('&')
                ? one.replaceAll('&', `:is(${parent})`)
                : `:is(${parent}) ${one}`,
          )
          .join(', ');
      // A style rule, or the declarations that follow a nested rule inside one.
      const own =
        'style' in rule && selector !== undefined
          ? [{ written: (rule as CSSStyleRule).selectorText ?? parent, selector, style: (rule as CSSStyleRule).style }]
          : [];
      return [...own, ...('cssRules' in rule ? rulesIn((rule as CSSGroupingRule).cssRules, selector) : [])];
    });
  const rules: Rule[] = [];
  for (const other of [...document.styleSheets, ...document.adoptedStyleSheets.filter((own) => own !== sheet)]) {
    try {
      rules.push(...rulesIn(other.cssRules));
    } catch {
      // A style sheet from another site cannot be read.
    }
  }
  const matching = (selector: string, rule: Rule) => {
    try {
      return [...document.querySelectorAll(selector)];
    } catch (error) {
      throw new Error(
        `the status colour check cannot match the rule "${rule.written}", read as "${selector}": ${(error as Error).message}`,
      );
    }
  };
  // A selector without its pseudo-element, and * in its place where nothing else is left of the last compound.
  const subject = (selector: string, pseudo: RegExp) => {
    const rest = selector.replace(pseudo, '');
    return /(?:^|[\s>+~])$/.test(rest) ? `${rest}*` : rest;
  };
  // The rules that style a part of an element, each with how specifically it matches the element, kept in the order
  // of the cascade: the least specific first and, of two as specific, the one written first.
  type Ruled = { rule: Rule; order: number; specificity: number };
  const ruledBy = (on: Map<Element, Ruled[]>, el: Element, ruled: Ruled) => {
    const list = on.get(el) ?? [];
    const same = list.find((other) => other.order === ruled.order);
    if (same) same.specificity = Math.max(same.specificity, ruled.specificity);
    else list.push(ruled);
    on.set(
      el,
      list.sort((a, b) => a.specificity - b.specificity || a.order - b.order),
    );
  };

  // The pseudo-elements read only where a rule styles them, with the elements each rule puts them on, and the rules
  // for an element hovered, focused, pressed or linked to, read without those states, with every element they can
  // then reach.
  const ruled = /::(?:(?:-webkit-input-|-moz-)?placeholder|selection|first-letter|first-line)(?![\w-])/gi;
  const userAction = /:(?:hover|focus(?:-visible|-within)?|active|target)(?![\w-])/gi;
  const pseudoElement = /::[\w-]+(?:\([^()]*\))?/g;
  const ruledParts = new Map<string, Map<Element, Ruled[]>>();
  const hovered = new Map<Element, Ruled[]>();
  rules.forEach((rule, order) => {
    for (const one of selectorsIn(rule.selector)) {
      const by = { rule, order, specificity: specificity(one) };
      for (const [written] of one.matchAll(ruled)) {
        const pseudo = /placeholder/i.test(written) ? '::placeholder' : written.toLowerCase();
        const on = ruledParts.get(pseudo) ?? new Map<Element, Ruled[]>();
        ruledParts.set(pseudo, on);
        for (const el of matching(subject(one, ruled), rule)) ruledBy(on, el, { ...by });
      }
      if (one.search(userAction) >= 0)
        for (const el of matching(subject(one.replace(userAction, ':is(*)'), pseudoElement), rule))
          ruledBy(hovered, el, { ...by });
    }
  });
  // Each part: an element, each of its pseudo-elements that is drawn, its generated content, its list marker unless
  // none is drawn, those a rule styles, whether or not the element shows them today, and what the rules for it
  // hovered give it. A placeholder and a hovered element are read from their rules, as the browser gives no computed
  // style for either.
  type Part = { el: Element; pseudo: string | null; rules?: Ruled[]; hovered?: boolean };
  const markerDrawn = (el: Element) => {
    const own = getComputedStyle(el);
    if (!own.display.includes('list-item')) return false;
    const content = getComputedStyle(el, '::marker').content;
    return content === 'normal' ? own.listStyleType !== 'none' || own.listStyleImage !== 'none' : content !== 'none';
  };
  const parts: Part[] = [...document.querySelectorAll('html, body, body *')].flatMap((el) => [
    { el, pseudo: null },
    ...['::before', '::after']
      .filter((pseudo) => getComputedStyle(el, pseudo).content !== 'none')
      .map((pseudo) => ({ el, pseudo })),
    ...(markerDrawn(el) ? [{ el, pseudo: '::marker' }] : []),
    ...[...ruledParts].filter(([, on]) => on.has(el)).map(([pseudo, on]) => ({ el, pseudo, rules: on.get(el) })),
    ...(hovered.has(el) ? [{ el, pseudo: null, rules: hovered.get(el), hovered: true }] : []),
  ]);
  // Every computed property but the custom ones, and the longhands of each that is a shorthand.
  const properties = [...getComputedStyle(root)].filter((property) => !property.startsWith('--'));
  const color = properties.indexOf('color');
  const longhands = new Map<string, string[]>();
  const tester = document.createElement('span');
  for (const property of properties) {
    tester.style.cssText = `${property}: inherit`;
    const own = [...tester.style];
    if (own.join() !== property) longhands.set(property, own);
  }
  tester.style.cssText = '';
  // A part read from its rules gets, for each property they set, the value they give it, in the order of the cascade,
  // computed on a probe inside the element, so its tokens are the element's, or beside it, for a field, whose inside has
  // no style. Each property they do not set is left empty.
  const probed = parts.map((part) => part.pseudo === '::placeholder' || part.hovered === true);
  const hosts = parts.map((part, i) => {
    if (!probed[i]) return null;
    part.el.append(tester);
    const inside = getComputedStyle(tester).display !== '';
    tester.remove();
    return inside ? part.el : part.el.parentElement!;
  });
  const set = parts.map((part) => new Set((part.rules ?? []).flatMap(({ rule }) => [...rule.style])));
  const styles = () => {
    const values = parts.map((part, i) => {
      if (probed[i]) return [];
      const style = getComputedStyle(part.el, part.pseudo);
      return properties.map((property) => style.getPropertyValue(property));
    });
    const probes = parts.map((part, i) => {
      if (!probed[i]) return null;
      const probe = document.createElement('span');
      probe.style.cssText = part.rules!.map(({ rule }) => rule.style.cssText).join(' ');
      hosts[i]!.append(probe);
      return probe;
    });
    probes.forEach((probe, i) => {
      if (!probe) return;
      const style = getComputedStyle(probe);
      values[i] = properties.map((property) => (set[i].has(property) ? style.getPropertyValue(property) : ''));
    });
    probes.forEach((probe) => probe?.remove());
    return values;
  };

  // For each part and status token, the properties that show it, and the passes that found each. A property that
  // shows just what color does, as a border, an outline or a text decoration does by default, follows color and is
  // not listed with it.
  const shown = parts.map(() => new Map<string, Map<number, string[]>>());
  const record = (i: number, name: string, which: number[], pass: string, follows: (property: number) => boolean) => {
    const own = which.includes(color) ? which.filter((property) => property === color || !follows(property)) : which;
    const found = shown[i].get(name) ?? new Map<number, string[]>();
    shown[i].set(name, found);
    for (const property of own) found.set(property, [...(found.get(property) ?? []), pass]);
  };
  const indices = properties.map((_, property) => property);
  // A status colour in any property, as a colour or inside a shadow, a gradient or a filter.
  const colourIn = /(?:rgba?|hsla?|hwb|color|oklab|oklch|lab|lch)\((?:[^()]|\([^()]*\))*\)/g;
  const statusIn = (value: string) =>
    value.includes('(') ? (value.match(colourIn) ?? []).map((colour) => status.get(rgb(colour) ?? '')) : [];
  const first = styles();
  first.forEach((values, i) => {
    const named = values.map(statusIn);
    for (const name of Object.keys(statusElements))
      record(
        i,
        name,
        indices.filter((property) => named[property].includes(name)),
        'by its colour',
        (property) => values[property] === values[color],
      );
  });
  // A colour mixed from a status token changes when the token does, so each token is given two other values in turn
  // and every property is compared. A size inside a closed details can read differently once the style has changed,
  // whatever the token, so the two are compared with each other and not with the page as it was.
  const withToken = (name: string, value: string) => {
    sheet.replaceSync(`${noTransitions} :root, * { ${name}: ${value} !important; }`);
    return styles();
  };
  for (const name of Object.keys(statusElements)) {
    const one = withToken(name, 'rgb(1, 2, 3)');
    const other = withToken(name, 'rgb(4, 5, 6)');
    one.forEach((values, i) =>
      record(
        i,
        name,
        indices.filter((property) => values[property] !== other[i][property]),
        'when its token is changed',
        (property) => values[property] === values[color] && other[i][property] === other[i][color],
      ),
    );
  }
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((other) => other !== sheet);

  // Each use is reported once, with the parts that show it alike: the same status colour in the same properties,
  // found the same way and set by the same rule.
  const allowed = (el: Element, name: string) => statusElements[name].some((selector) => el.matches(selector));
  const label = (el: Element) => el.tagName.toLowerCase() + [...el.classList].map((name) => `.${name}`).join('');
  const uses = new Map<string, string[]>();
  shown.forEach((names, i) => {
    const { el, pseudo, rules, hovered } = parts[i];
    for (const [name, found] of names) {
      if (!found.size || allowed(el, name)) continue;
      // The properties grouped by the passes that found them. A shorthand is left out where a longhand of it is
      // listed, and a logical property, such as border-block-start-color, where a physical one with its value is.
      const listed = new Set([...found.keys()].map((property) => properties[property]));
      const logical = /-(?:block|inline)(?:-|$)/;
      const byPasses = new Map<string, string[]>();
      for (const [property, passes] of found) {
        if (longhands.get(properties[property])?.some((longhand) => listed.has(longhand))) continue;
        const value = first[i][property];
        if (
          logical.test(properties[property]) &&
          [...found.keys()].some((other) => !logical.test(properties[other]) && first[i][other] === value)
        )
          continue;
        const how = passes.join(' and ');
        byPasses.set(how, [...(byPasses.get(how) ?? []), properties[property]]);
      }
      const where = [...byPasses].map(([how, names]) => `in ${names.join(', ')}, found ${how}`).join('; ');
      // For a part a rule styles, the rule that sets each property found: the last in the cascade to set it, of
      // those that set it important if any do.
      const winner = (property: string) => {
        const setting = (rules ?? []).filter(({ rule }) => [...rule.style].includes(property));
        const important = setting.filter(({ rule }) => rule.style.getPropertyPriority(property) === 'important');
        return (important.length ? important : setting).at(-1)?.rule.written ?? [];
      };
      const by = [...new Set([...listed].flatMap(winner))];
      const rule = by.length
        ? `, by the rule${by.length > 1 ? 's' : ''} ${by.map((one) => `"${one}"`).join(', ')}`
        : '';
      const use = `${name} ${where}${hovered ? ', once hovered, focused, pressed or linked to' : ''}${rule}`;
      uses.set(use, [...(uses.get(use) ?? []), `${label(el)}${pseudo ?? ''}`]);
    }
  });
  return [...uses].map(([use, parts]) => ({ use, parts }));
}

// Up to three of the parts that show a use, and how many more.
const shownBy = (parts: string[]) =>
  `${parts.slice(0, 3).join(', ')}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''}`;
// The uses found on each page and in each theme, one line for each use, however many pages show it: the parts that
// show it, the use, and the pages, with the theme where it is found in one only. Masked, as the parts and rules are
// named as the page writes them.
function statusReport(found: { path: string; theme: string; uses: StatusUse[] }[]): string[] {
  const all = new Map<string, { parts: Map<string, string[]>; themes: Map<string, string[]> }>();
  for (const { path, theme, uses } of found)
    for (const { use, parts } of uses) {
      const on = all.get(use) ?? { parts: new Map<string, string[]>(), themes: new Map<string, string[]>() };
      all.set(use, on);
      // A page shows the same parts in either theme, so each is counted once.
      if (!on.parts.has(path)) on.parts.set(path, parts);
      on.themes.set(path, [...(on.themes.get(path) ?? []), theme]);
    }
  return [...all].map(([use, { parts, themes }]) => {
    const pages = [...themes].map(([path, on]) => (on.length > 1 ? path : `${path} in ${on[0]}`)).join(', ');
    return masked(`${shownBy([...parts.values()].flat())}: ${use}; on ${pages}`);
  });
}

// Every page the sitemap lists, and the not-found page, so a new page is read too.
async function everyPage(request: APIRequestContext): Promise<string[]> {
  const locations = async (path: string) =>
    [...(await (await request.get(path)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const listed = (await Promise.all((await locations('/sitemap-index.xml')).map(locations))).flat();
  expect(listed.includes('/'), masked(`the home page is among the pages in the sitemap, ${listed.join(', ')}`)).toBe(
    true,
  );
  return [...listed, '/no-such-page/'];
}

test('status colours appear only where they say something', async ({ page, request }) => {
  // Each use found, with the pages and themes it is found in, reported once every page is read. Each page is read in
  // the dark theme, then in the light, set as the theme toggle sets it.
  const found: { path: string; theme: string; uses: StatusUse[] }[] = [];
  await page.addInitScript(() => localStorage.setItem('mdxplora-theme', 'dark'));
  for (const path of await everyPage(request)) {
    await page.goto(path);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      // A rule the check cannot match is named as the page writes it, so it is masked.
      const uses = await page.evaluate(statusColoursShown, statusElements).catch((error: Error) => {
        throw new Error(masked(error.message));
      });
      found.push({ path, theme, uses });
    }
  }
  expect(statusReport(found)).toEqual([]);
});

// The check above, on pages made here: each holds one use of a status colour, and the check reports it once, as on
// a page of the site but without the page.
const statusPage = (css: string, body: string) =>
  `<style>:root { --positive: #1b7a45; --warning: #a65300; --danger: #c0262d; } ${css}</style><main>${body}</main>`;
async function statusColoursOn(page: Page, css: string, body: string): Promise<string[]> {
  await page.setContent(statusPage(css, body));
  const uses = await page.evaluate(statusColoursShown, statusElements);
  return uses.map(({ use, parts }) => masked(`${shownBy(parts)}: ${use}`));
}
const bothPasses = 'found by its colour and when its token is changed';
const hover = (rule: string) => `, once hovered, focused, pressed or linked to, by the rule "${rule}"`;

test('the status colour check names the property that was set, once for both passes', async ({ page }) => {
  // color alone, not the border, outline and decoration colours that follow it.
  expect(await statusColoursOn(page, '.x { color: var(--danger) }', '<p class="x">Text</p>')).toEqual([
    `p.x: --danger in color, ${bothPasses}`,
  ]);
  expect(
    await statusColoursOn(
      page,
      '.x { color: var(--danger); background-color: var(--warning) }',
      '<p class="x">Text</p>',
    ),
  ).toEqual([`p.x: --warning in background-color, ${bothPasses}`, `p.x: --danger in color, ${bothPasses}`]);
  // A colour mixed from a token is found one way only.
  expect(
    await statusColoursOn(
      page,
      '.x { background: color-mix(in srgb, var(--warning) 40%, white) }',
      '<p class="x">Text</p>',
    ),
  ).toEqual(['p.x: --warning in background-color, found when its token is changed']);
  // A longhand is listed without its shorthand, and an element by all its classes.
  expect(
    await statusColoursOn(
      page,
      '.x { text-decoration-color: var(--danger) }',
      '<a class="x button button-primary" href="#">Text</a>',
    ),
  ).toEqual([`a.x.button.button-primary: --danger in text-decoration-color, ${bothPasses}`]);
  // Where a status colour says something, it is not reported.
  expect(await statusColoursOn(page, '.valid { color: var(--positive) }', '<p class="valid">Validated</p>')).toEqual(
    [],
  );
});

test('the status colour check reads the root, the body, and list markers only where they are drawn', async ({
  page,
}) => {
  expect(await statusColoursOn(page, 'body { background-color: var(--danger) }', '<p>Text</p>')).toEqual([
    `body: --danger in background-color, ${bothPasses}`,
  ]);
  expect(await statusColoursOn(page, 'html { border-top: 3px solid var(--warning) }', '<p>Text</p>')).toEqual([
    `html: --warning in border-top-color, ${bothPasses}`,
  ]);
  const list = '<ul class="n"><li>One</li></ul><ul class="m"><li>Two</li></ul>';
  const markers = 'li::marker { color: var(--danger) } ul { list-style: none } .m li::marker { content: "-" }';
  expect(await statusColoursOn(page, markers, list)).toEqual([`li::marker: --danger in color, ${bothPasses}`]);
  expect(
    await statusColoursOn(page, 'li { display: block } li::marker { color: var(--danger) }', '<ul><li>One</li></ul>'),
  ).toEqual([]);
});

test('the status colour check reads selectors with commas in brackets, and nested rules', async ({ page }) => {
  const field = '<form><input placeholder="Name"><textarea placeholder="Message"></textarea></form>';
  // Both fields, or the second only.
  const both = (rule: string, which = [0, 1]) => [
    `${['input::placeholder', 'textarea::placeholder'].filter((_, i) => which.includes(i)).join(', ')}: --danger in ` +
      `color, ${bothPasses}, by the rule "${rule}"`,
  ];
  for (const [css, expected] of [
    [':is(input, textarea)::placeholder { color: var(--danger) }', both(':is(input, textarea)::placeholder')],
    [':where(input, textarea)::placeholder { color: var(--danger) }', both(':where(input, textarea)::placeholder')],
    [
      'form :not(input, select)::placeholder { color: var(--danger) }',
      both('form :not(input, select)::placeholder', [1]),
    ],
    [
      '[title="a, b"], textarea::placeholder { color: var(--danger) }',
      both('[title="a, b"], textarea::placeholder', [1]),
    ],
    ['textarea { &::placeholder { color: var(--danger) } }', both('&::placeholder', [1])],
    ['form { ::placeholder { color: var(--danger) } }', both('& ::placeholder')],
    [
      '@media all { input, textarea { &:not(:disabled)::placeholder { color: var(--danger) } } }',
      both('&:not(:disabled)::placeholder'),
    ],
  ] as const)
    expect(await statusColoursOn(page, css, field), css).toEqual(expected);
  // A placeholder's colour set by a shorthand.
  expect(await statusColoursOn(page, 'input::placeholder { background: var(--danger) }', field)).toEqual([
    `input::placeholder: --danger in background-color, ${bothPasses}, by the rule "input::placeholder"`,
  ]);
  // A selection and a first letter that a rule styles are read too, and a rule that styles every selection is
  // reported once.
  expect(
    await statusColoursOn(
      page,
      '.s::selection { color: var(--danger) } .f::first-letter { background-color: var(--warning) }',
      '<p class="s">One</p><p class="f">Two</p>',
    ),
  ).toEqual([
    `p.s::selection: --danger in color, ${bothPasses}, by the rule ".s::selection"`,
    `p.f::first-letter: --warning in background-color, ${bothPasses}, by the rule ".f::first-letter"`,
  ]);
  const many = await statusColoursOn(page, '::selection { color: var(--danger) }', '<p>One</p>'.repeat(50));
  expect(many).toEqual([
    `html::selection, body::selection, main::selection and 50 more: --danger in color, ${bothPasses}, by the rule "::selection"`,
  ]);
});

test('the status colour check follows the cascade for a placeholder', async ({ page }) => {
  const fields = '<input class="calm" placeholder="Name"><input placeholder="Email">';
  // A rule that is more specific wins wherever it is, and of two as specific, the later one.
  for (const css of [
    'input::placeholder { color: var(--danger) } input.calm::placeholder { color: grey }',
    'input.calm::placeholder { color: grey } input::placeholder { color: var(--danger) }',
    'input::placeholder { color: var(--danger) } :is(.calm)::placeholder { color: grey }',
  ])
    expect(await statusColoursOn(page, css, fields), css).toEqual([
      `input::placeholder: --danger in color, ${bothPasses}, by the rule "input::placeholder"`,
    ]);
  expect(
    await statusColoursOn(
      page,
      'input.calm::placeholder { color: var(--danger) } .calm::placeholder { color: grey } ' +
        'input::placeholder { color: grey }',
      fields,
    ),
  ).toEqual([`input.calm::placeholder: --danger in color, ${bothPasses}, by the rule "input.calm::placeholder"`]);
  // :where() adds nothing, :not() its argument, and an important declaration wins over one that is not.
  for (const [css, rule] of [
    [
      'input:not(#x)::placeholder { color: var(--danger) } input.calm::placeholder { color: grey }',
      'input:not(#x)::placeholder',
    ],
    [
      'input::placeholder { color: var(--danger) } :where(input.calm)::placeholder { color: grey }',
      'input::placeholder',
    ],
    [
      'input::placeholder { color: var(--danger) !important } input.calm::placeholder { color: grey }',
      'input::placeholder',
    ],
  ])
    expect(await statusColoursOn(page, css, fields), css).toEqual([
      `input.calm::placeholder, input::placeholder: --danger in color, ${bothPasses}, by the rule "${rule}"`,
    ]);
});

test('the status colour check reads rules for an element hovered, focused or linked to, and names a rule it cannot match', async ({
  page,
}) => {
  expect(
    await statusColoursOn(
      page,
      '.h:hover { color: var(--danger) } main:focus-within .w::after { outline-color: var(--warning) } ' +
        '[aria-invalid="true"]:focus { border-color: var(--danger) }',
      '<a class="h" href="#">One</a><p class="w">Two</p><input aria-invalid="true">',
    ),
  ).toEqual([
    `a.h: --danger in color, ${bothPasses}${hover('.h:hover')}`,
    `p.w: --warning in outline-color, ${bothPasses}${hover('main:focus-within .w::after')}`,
  ]);
  // A status colour through a token of the page's own, or written out, as hover rules give it.
  expect(
    await statusColoursOn(
      page,
      ':root { --bad: var(--danger) } .h:hover { color: var(--bad) } .k:focus { background: #c0262d }',
      '<a class="h" href="#">One</a><button class="k">Two</button>',
    ),
  ).toEqual([
    `a.h: --danger in color, ${bothPasses}${hover('.h:hover')}`,
    `button.k: --danger in background-color, found by its colour${hover('.k:focus')}`,
  ]);
  // A section linked to, as the page's own links go to its sections, by any element or by one.
  expect(
    await statusColoursOn(
      page,
      ':target { outline: 2px solid var(--danger) }',
      '<section id="faq"><h2>Questions</h2></section>',
    ),
  ).toEqual([`html, body, main and 2 more: --danger in outline-color, ${bothPasses}${hover(':target')}`]);
  expect(
    await statusColoursOn(
      page,
      'section:target { background: color-mix(in srgb, var(--warning) 20%, transparent) }',
      '<section id="faq"><h2>Questions</h2></section><section id="cite"></section>',
    ),
  ).toEqual([`section, section: --warning in background-color, ${bothPasses}${hover('section:target')}`]);
  // Chromium matches every selector it reads, so one it cannot is stood in for here.
  await page.setContent('<style>.odd::placeholder { color: var(--danger) }</style><input class="odd">');
  await page.evaluate(() => {
    const own = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (this: Document, selector: string) {
      if (selector.includes('.odd')) throw new SyntaxError(`'${selector}' is not a valid selector.`);
      return own.call(this, selector);
    } as typeof own;
  });
  await expect(page.evaluate(statusColoursShown, statusElements)).rejects.toThrow(
    'the status colour check cannot match the rule ".odd::placeholder", read as ".odd"',
  );
});

test('the status colour check reports each use once, on every page and in either theme that shows it', async ({
  page,
}) => {
  // A rule for every selection, and one for a link hovered, on two pages whose parts differ.
  const css =
    '::selection { background: var(--warning) } a:hover { background: color-mix(in srgb, var(--warning) 20%, white) }';
  const found: Parameters<typeof statusReport>[0] = [];
  for (const [path, body] of [
    ['/one/', '<a class="skip-link" href="#main">Skip</a><a class="home" href="/">Home</a><p>One</p>'],
    ['/two/', '<nav><a href="/">Home</a></nav><ul><li>Two</li></ul>'],
  ]) {
    await page.setContent(statusPage(css, body));
    for (const theme of ['dark', 'light'])
      found.push({ path, theme, uses: await page.evaluate(statusColoursShown, statusElements) });
  }
  expect(statusReport(found)).toEqual([
    `html::selection, body::selection, main::selection and 10 more: --warning in background-color, ${bothPasses}, ` +
      'by the rule "::selection"; on /one/, /two/',
    `a.skip-link, a.home, a: --warning in background-color, found when its token is changed${hover('a:hover')}; ` +
      'on /one/, /two/',
  ]);
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
    expectText(await textOf(refusal), 'Setup stopped', 'the stopped run');
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
    if (where && where.top < where.under - 1) hidden.push(masked(`${where.name} (top ${Math.round(where.top)})`));
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
    expectExactly(await textOf(current), 'Compute', 'the current page');
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
    expectExactly(await textOf(current), label, `the current page on ${path}`);
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
        return corners.every((corner) => corner === control)
          ? []
          : [`${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}: ${corners.join(' ')}`];
      });
    });
    expect(
      found.map((one) => masked(one)),
      path,
    ).toEqual([]);
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
    expect(
      found.map((one) => masked(one)),
      path,
    ).toEqual([]);
  }
});
