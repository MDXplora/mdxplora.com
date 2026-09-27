// The brand mark, drawn once here and used by the header logo, the icons and
// the link preview images.

export const colours = {
  teal: '#22c3b5',
  blue: '#4c7dff',
  violet: '#8b6cff',
  ink: '#070b16',
} as const;

/** Three atoms and two bonds, on a 32 x 32 grid. */
export const mark = {
  bonds: 'M9 21.5 16 11l7 8',
  atoms: [
    { cx: 9, cy: 21.5, r: 3.1 },
    { cx: 16, cy: 11, r: 3.6 },
    { cx: 23, cy: 19, r: 2.7 },
  ],
} as const;

/**
 * The mark as SVG elements on a 32 x 32 grid.
 *
 * `radius` rounds the tile's corners (0 for icons the platform rounds itself),
 * and `scale` shrinks the atoms towards the centre, for icons whose edges may be cropped.
 */
export function markElements({ id = 'mark', radius = 8, scale = 1 } = {}): string {
  const inner = `<path d="${mark.bonds}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>${mark.atoms
    .map((a) => `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="#fff"/>`)
    .join('')}`;
  const shrink =
    scale === 1 ? inner : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${inner}</g>`;
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${colours.teal}"/><stop offset="0.55" stop-color="${colours.blue}"/>` +
    `<stop offset="1" stop-color="${colours.violet}"/></linearGradient></defs>` +
    `<rect width="32" height="32" rx="${radius}" fill="url(#${id})"/>${shrink}`
  );
}
