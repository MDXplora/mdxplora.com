import type { APIRoute } from 'astro';
import { markSvg } from '../lib/icons';

// Shown at 16 and 32 px, so with the small mark's atoms.
export const GET: APIRoute = () =>
  new Response(markSvg({ small: true }), { headers: { 'Content-Type': 'image/svg+xml' } });
