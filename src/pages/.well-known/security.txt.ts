// How to report a security problem with this site (RFC 9116). The expiry is set
// at build time, just under a year ahead as the RFC recommends, so each deploy
// renews it.

import type { APIRoute } from 'astro';
import { site } from '../../data/site';

const DAY = 24 * 60 * 60 * 1000;

export const GET: APIRoute = ({ site: origin }) => {
  const expires = new Date(Date.now() + 364 * DAY);
  expires.setUTCHours(0, 0, 0, 0);
  const body = [
    `Contact: mailto:${site.email}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${new URL('/.well-known/security.txt', origin)}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
