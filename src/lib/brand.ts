// The brand mark, drawn once here and used by the header logo, the icons and
// the link preview images.

export const colours = {
  /** MDXplora blue, as on a light ground and behind the icons' white mark. */
  blue: '#155ad1',
  /** The same blue, lighter, as on a dark ground. */
  blueOnDark: '#4c9aff',
  /** The dark theme's ground. */
  ground: '#1c1c1d',
  /** The dark theme's text, strong and muted. */
  text: '#ececee',
  textMuted: '#b4b6ba',
  textSubtle: '#9a9ca1',
} as const;

/**
 * A droplet: seven atoms in the close-packed arrangement a Lennard-Jones
 * liquid forms, one at the centre and six around it, on a 32 x 32 grid.
 */
export const mark = {
  atoms: [
    { cx: 16, cy: 16, r: 3.2 },
    ...Array.from({ length: 6 }, (_, k) => {
      const angle = (k * Math.PI) / 3 + Math.PI / 6;
      return { cx: +(16 + 7.4 * Math.cos(angle)).toFixed(2), cy: +(16 + 7.4 * Math.sin(angle)).toFixed(2), r: 3.2 };
    }),
  ],
} as const;

/**
 * The mark as SVG elements on a 32 x 32 grid, in one colour.
 *
 * With `tile` (the icons), the atoms are white on a solid blue square whose
 * corners `radius` rounds (0 for icons the platform rounds itself), and
 * `scale` shrinks the atoms towards the centre, for icons whose edges may be
 * cropped. Without it (beside the word mark), the atoms alone, in `fill`,
 * on nothing.
 */
export function markElements({
  tile = true,
  fill = colours.blue as string,
  radius = 6,
  scale = 1,
}: { tile?: boolean; fill?: string; radius?: number; scale?: number } = {}): string {
  const inner = mark.atoms
    .map((a) => `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="${tile ? '#fff' : fill}"/>`)
    .join('');
  const shrink =
    scale === 1 ? inner : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${inner}</g>`;
  return tile ? `<rect width="32" height="32" rx="${radius}" fill="${colours.blue}"/>${shrink}` : shrink;
}
