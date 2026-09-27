// Link preview images (1200 x 630), drawn at build time.
//
// The background is a snapshot of the same Lennard-Jones fluid that runs
// behind the home page hero, from a fixed seed so every build draws the same
// one. Text is laid out by satori, which turns it into paths, and the whole
// image is rendered to PNG by resvg. Nothing here runs in the browser.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { Card } from '../data/cards';
import { site } from '../data/site';
import { colours, markElements } from './brand';
import { BOND, DENSITY, DROPLET, LJFluid, seeded } from './lj-fluid';

export const WIDTH = 1200;
export const HEIGHT = 630;

const SIGMA_PX = 15;
const PAD_X = 80;
const PAD_Y = 72;
const LOGO = 52;

const text = {
  strong: '#eef1f8',
  muted: '#a5aec8',
  subtle: '#8b95b3',
};

const require = createRequire(import.meta.url);
const font = (weight: number) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`));
const fonts = [400, 500, 700].map((weight) => ({
  name: 'Inter',
  data: font(weight),
  weight: weight as 400 | 500 | 700,
  style: 'normal' as const,
}));

// The fluid is the same for every card, so it is simulated once.
let background: string | undefined;

function fluidBackground(): string {
  if (background) return background;
  const lx = WIDTH / SIGMA_PX;
  const ly = HEIGHT / SIGMA_PX;
  const fluid = new LJFluid(lx, ly, Math.round(lx * ly * DENSITY), seeded(20260926));
  // Long enough for the starting lattice to melt and clusters to form.
  fluid.step(4000);
  const { x, y, n } = fluid;
  const px = (v: number) => (v * SIGMA_PX).toFixed(1);
  const bond2 = BOND * BOND;
  const bonds: string[] = [];
  const sizes = fluid.bonds((i, j, r2) => {
    const a = (Math.min(1, (bond2 - r2) / 0.5) * 0.5).toFixed(2);
    bonds.push(`<line x1="${px(x[i])}" y1="${px(y[i])}" x2="${px(x[j])}" y2="${px(y[j])}" stroke-opacity="${a}"/>`);
  });
  const vapour: string[] = [];
  const droplets: string[] = [];
  for (let i = 0; i < n; i++) {
    (sizes[i] >= DROPLET ? droplets : vapour).push(`<circle cx="${px(x[i])}" cy="${px(y[i])}" r="2.1"/>`);
  }

  background =
    `<defs>` +
    `<radialGradient id="glow-blue" cx="0.12" cy="-0.1" r="0.7"><stop offset="0" stop-color="${colours.blue}" stop-opacity="0.22"/><stop offset="1" stop-color="${colours.blue}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="glow-teal" cx="0.95" cy="0.05" r="0.55"><stop offset="0" stop-color="${colours.teal}" stop-opacity="0.12"/><stop offset="1" stop-color="${colours.teal}" stop-opacity="0"/></radialGradient>` +
    // The fluid shows on the right and fades out behind the text.
    `<radialGradient id="fade" cx="0.78" cy="0.42" r="0.62" gradientTransform="translate(0.78 0.42) scale(1 1.25) translate(-0.78 -0.42)"><stop offset="0.2" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<mask id="fluid-mask"><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/></mask>` +
    `<linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${colours.teal}"/><stop offset="0.55" stop-color="${colours.blue}"/><stop offset="1" stop-color="${colours.violet}"/></linearGradient>` +
    `</defs>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${colours.ink}"/>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow-blue)"/>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow-teal)"/>` +
    `<g mask="url(#fluid-mask)" opacity="0.9">` +
    `<g stroke="rgb(34,195,181)" stroke-width="1.2">${bonds.join('')}</g>` +
    `<g fill="rgb(143,176,255)" fill-opacity="0.75">${vapour.join('')}</g>` +
    `<g fill="rgb(34,195,181)" fill-opacity="0.9">${droplets.join('')}</g>` +
    `</g>` +
    `<rect y="${HEIGHT - 6}" width="${WIDTH}" height="6" fill="url(#bar)"/>`;
  return background;
}

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  // satori lays out every element as a flex box.
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

// The title as words, so it wraps, with the accent (if any) as one run in the brand gradient.
function title(card: Card): Node[] {
  const accent = card.accent && card.title.endsWith(card.accent) ? card.accent : '';
  const plain = card.title.slice(0, card.title.length - accent.length).trim();
  const words: Node[] = plain ? plain.split(' ').map((word) => h('span', { marginRight: '0.24em' }, word)) : [];
  if (accent) {
    words.push(
      h(
        'span',
        {
          backgroundImage: `linear-gradient(120deg, ${colours.teal}, ${colours.blue} 55%, ${colours.violet})`,
          backgroundClip: 'text',
          color: 'transparent',
        },
        accent,
      ),
    );
  }
  return words;
}

function layout(card: Card): Node {
  const size = card.title.length > 44 ? 60 : card.title.length > 30 ? 66 : 76;
  return h(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: `${PAD_Y}px ${PAD_X}px`,
      fontFamily: 'Inter',
      color: text.strong,
    },
    // The logo tile is drawn under this space; the wordmark sits beside it.
    h(
      'div',
      { display: 'flex', alignItems: 'center', height: LOGO },
      h('div', { width: LOGO, height: LOGO, marginRight: 18 }),
      h('div', { fontSize: 36, fontWeight: 700, letterSpacing: -0.7 }, 'MDX'),
      h('div', { fontSize: 36, fontWeight: 500, letterSpacing: -0.7 }, 'plora'),
    ),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', maxWidth: 900 },
      h(
        'div',
        { fontSize: 22, fontWeight: 500, letterSpacing: 1.8, textTransform: 'uppercase', color: text.subtle },
        card.eyebrow,
      ),
      h(
        'div',
        {
          marginTop: 18,
          flexWrap: 'wrap',
          fontSize: size,
          fontWeight: 700,
          letterSpacing: -0.03 * size,
          lineHeight: 1.08,
        },
        ...title(card),
      ),
      h('div', { marginTop: 26, fontSize: 28, lineHeight: 1.4, color: text.muted, maxWidth: 880 }, card.text),
    ),
    h('div', { fontSize: 24, color: text.subtle }, site.domain),
  );
}

export async function renderCard(card: Card): Promise<Uint8Array<ArrayBuffer>> {
  const foreground = await satori(layout(card) as never, { width: WIDTH, height: HEIGHT, fonts });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    fluidBackground() +
    `<svg x="${PAD_X}" y="${PAD_Y}" width="${LOGO}" height="${LOGO}" viewBox="0 0 32 32">${markElements({ id: 'card-mark' })}</svg>` +
    foreground +
    `</svg>`;
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}
