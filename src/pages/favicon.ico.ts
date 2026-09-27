import type { APIRoute } from 'astro';
import { ico, markPng } from '../lib/icons';

// For browsers and tools that ask for /favicon.ico and cannot read the SVG.
export const GET: APIRoute = () =>
  new Response(ico([16, 32, 48].map((size) => ({ size, png: markPng(size) }))), {
    headers: { 'Content-Type': 'image/x-icon' },
  });
