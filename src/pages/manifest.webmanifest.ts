import type { APIRoute } from 'astro';
import { colours } from '../lib/brand';
import { site } from '../data/site';
import { iconVersion } from '../lib/icons';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: site.name,
        short_name: site.name,
        description: site.support,
        start_url: '/',
        display: 'browser',
        background_color: colours.ink,
        theme_color: colours.ink,
        icons: [
          { src: `/icon-192.png?v=${iconVersion}`, sizes: '192x192', type: 'image/png' },
          { src: `/icon-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png' },
          { src: `/icon-maskable-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
