// Link preview images (1200 x 630), drawn at build time.
//
// Plain, as the pages are: the dark theme's ground, the droplet in blue beside
// the name, and the page's title and summary in the theme's greys. Text is laid
// out by satori, which turns it into paths, and the whole image is rendered to
// PNG by resvg. Nothing here runs in the browser.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { Card } from '../data/cards';
import { site } from '../data/site';
import { colours, markElements } from './brand';

export const WIDTH = 1200;
export const HEIGHT = 630;

const PAD_X = 80;
const PAD_Y = 72;
const LOGO = 44;

const require = createRequire(import.meta.url);
const font = (weight: number) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`));
const fonts = [400, 600].map((weight) => ({
  name: 'Inter',
  data: font(weight),
  weight: weight as 400 | 600,
  style: 'normal' as const,
}));

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  // satori lays out every element as a flex box.
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

function layout(card: Card): Node {
  const size = card.title.length > 44 ? 60 : card.title.length > 30 ? 66 : 72;
  return h(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: `${PAD_Y}px ${PAD_X}px`,
      fontFamily: 'Inter',
      color: colours.text,
      backgroundColor: colours.ground,
    },
    // The droplet is drawn under this space; the name sits beside it.
    h(
      'div',
      { alignItems: 'center', height: LOGO },
      h('div', { width: LOGO, height: LOGO, marginRight: 16 }),
      h('div', { fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }, site.name),
    ),
    h(
      'div',
      { flexDirection: 'column', maxWidth: 940 },
      h('div', { fontSize: size, fontWeight: 600, letterSpacing: -0.025 * size, lineHeight: 1.1 }, card.title),
      h('div', { marginTop: 28, fontSize: 28, lineHeight: 1.45, color: colours.textMuted, maxWidth: 880 }, card.text),
    ),
    h(
      'div',
      { paddingTop: 22, borderTop: '1px solid rgba(255, 255, 255, 0.12)', fontSize: 24, color: colours.textSubtle },
      site.domain,
    ),
  );
}

// A font satori cannot read gives every letter the same placeholder box, and the image keeps its size, so nothing
// else notices. The build stops instead: "I" and "O" must have outlines of their own at every weight.
let fontsRead: Promise<void> | undefined;

async function outline(text: string, weight: 400 | 600): Promise<string> {
  const node = h('div', { display: 'flex', fontSize: 40, fontWeight: weight }, text);
  const svg = await satori(node as never, { width: 200, height: 80, fonts });
  return [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
}

function checkFontsRead(): Promise<void> {
  fontsRead ??= (async () => {
    for (const { weight } of fonts) {
      const [i, o] = await Promise.all([outline('I', weight), outline('O', weight)]);
      if (!i || i === o) {
        throw new Error(
          `The link preview images cannot read the Inter ${weight} font: every letter would be a placeholder ` +
            'box. Check what satori decompresses the font with (see DEVELOPMENT.md).',
        );
      }
    }
  })();
  return fontsRead;
}

export async function renderCard(card: Card): Promise<Uint8Array<ArrayBuffer>> {
  await checkFontsRead();
  const page = await satori(layout(card) as never, { width: WIDTH, height: HEIGHT, fonts });
  const droplet = markElements({ tile: false, fill: colours.blueOnDark });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    page +
    `<svg x="${PAD_X}" y="${PAD_Y}" width="${LOGO}" height="${LOGO}" viewBox="0 0 32 32">${droplet}</svg>` +
    `</svg>`;
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}
