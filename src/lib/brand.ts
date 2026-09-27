// The brand mark, drawn once here and used by the header logo, the icons and
// the link preview images.

export const colours = {
  teal: '#22c3b5',
  blue: '#4c7dff',
  violet: '#8b6cff',
  ink: '#070b16',
} as const;

/**
 * A droplet: seven atoms in the close-packed arrangement a Lennard-Jones
 * liquid forms, one at the centre and six around it, on a 32 x 32 grid. The
 * same droplets form in the fluid behind the home page.
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
 * The mark as SVG elements on a 32 x 32 grid.
 *
 * `radius` rounds the tile's corners (0 for icons the platform rounds itself),
 * and `scale` shrinks the atoms towards the centre, for icons whose edges may be cropped.
 */
export function markElements({ id = 'mark', radius = 8, scale = 1 } = {}): string {
  const inner = mark.atoms.map((a) => `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}" fill="#fff"/>`).join('');
  const shrink =
    scale === 1 ? inner : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${inner}</g>`;
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${colours.teal}"/><stop offset="0.55" stop-color="${colours.blue}"/>` +
    `<stop offset="1" stop-color="${colours.violet}"/></linearGradient></defs>` +
    `<rect width="32" height="32" rx="${radius}" fill="url(#${id})"/>${shrink}`
  );
}
