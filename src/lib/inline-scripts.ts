// Scripts that run inline rather than as bundled files, kept here as text so
// the layout can both print them and add their hashes to the content security
// policy. Astro hashes the scripts it bundles, not inline ones, and without its
// hash an inline script is refused by the browser.

import { createHash } from 'node:crypto';

/** The policy source that allows exactly this script, and nothing else, to run inline. */
export const hashOf = (source: string) => `sha256-${createHash('sha256').update(source).digest('base64')}` as const;

/**
 * Applies the stored or preferred theme before the first paint, so a page never
 * flashes the wrong one, and makes the browser's own chrome (address bar,
 * status bar) follow it.
 */
export const themeScript = `(() => {
  let stored = '';
  try {
    stored = localStorage.getItem('mdxplora-theme') || '';
  } catch {}
  const theme =
    stored === 'light' || stored === 'dark'
      ? stored
      : matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#fafbfe' : '#070b16');
})();`;

/**
 * Loads Cloudflare's visit counter, on the live site only, so local previews,
 * the browser tests and Lighthouse runs are never counted. The token and the
 * live host are read from the script element's own data attributes.
 */
export const counterScript = `(() => {
  const own = document.currentScript;
  if (!own || location.hostname !== own.dataset.host) return;
  const beacon = document.createElement('script');
  beacon.defer = true;
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: own.dataset.token });
  document.body.append(beacon);
})();`;
