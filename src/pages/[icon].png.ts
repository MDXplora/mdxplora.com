import type { APIRoute, GetStaticPaths } from 'astro';
import { markPng } from '../lib/icons';

// Platforms that round icons themselves get square corners. The maskable icon
// keeps the atoms inside the central circle that every mask shape leaves visible.
const icons = {
  'apple-touch-icon': { size: 180, radius: 0, scale: 1 },
  'icon-192': { size: 192, radius: 8, scale: 1 },
  'icon-512': { size: 512, radius: 8, scale: 1 },
  'icon-maskable-512': { size: 512, radius: 0, scale: 0.8 },
};

export const getStaticPaths = (() =>
  Object.entries(icons).map(([icon, props]) => ({ params: { icon }, props }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const { size, radius, scale } = props as (typeof icons)[keyof typeof icons];
  return new Response(markPng(size, { id: 'icon', radius, scale }), { headers: { 'Content-Type': 'image/png' } });
};
