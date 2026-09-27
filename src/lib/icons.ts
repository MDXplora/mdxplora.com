// The site's icons, drawn at build time from the brand mark.

import { Resvg } from '@resvg/resvg-js';
import { markElements } from './brand';

/** The mark as a standalone SVG file. */
export function markSvg(options: Parameters<typeof markElements>[0] = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${markElements(options)}</svg>`;
}

export function markPng(size: number, options: Parameters<typeof markElements>[0] = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new Resvg(markSvg(options), { fitTo: { mode: 'width', value: size } }).render().asPng());
}

/** An .ico holding PNG images, which every browser since Internet Explorer 9 reads. */
export function ico(images: { size: number; png: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const header = 6 + 16 * images.length;
  const out = new Uint8Array(header + images.reduce((sum, image) => sum + image.png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    view.setUint8(entry, size % 256); // 0 means 256
    view.setUint8(entry + 1, size % 256);
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}
