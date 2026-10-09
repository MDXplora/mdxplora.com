import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';

// scripts/check-links.mjs run with node on small built sites, each a few files in a temporary folder.

type Site = Record<string, string>;

function html(body: string, head = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

// Every site has a home page with the id "top", a page at /about/ with the id "team", and an image at /ok.png.
function checkLinks(files: Site): { status: number | null; reported: string[]; output: string } {
  const dist = mkdtempSync(join(tmpdir(), 'check-links-'));
  try {
    const site: Site = {
      'index.html': html('<h1 id="top">Home</h1>'),
      'about/index.html': html('<h1 id="team">About</h1>'),
      'ok.png': 'png',
      ...files,
    };
    for (const [path, content] of Object.entries(site)) {
      mkdirSync(dirname(join(dist, path)), { recursive: true });
      writeFileSync(join(dist, path), content);
    }
    const run = spawnSync(process.execPath, ['scripts/check-links.mjs', dist], { encoding: 'utf8' });
    // Each broken link is reported on its own line as "page → link", with the reason after the link when there is one.
    const reported = run.stderr
      .split('\n')
      .filter((line) => line.startsWith('  '))
      .map((line) => line.trim().replace(/^[^→]*→ /, ''))
      .sort();
    return { status: run.status, reported, output: run.stdout + run.stderr };
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
}

test('a site whose links all resolve passes', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><a href="/about/">About</a><a href="/about#team">Team</a>' +
        '<img src="/ok.png" srcset="/ok.png 1x, /ok.png 2x" alt="">',
      jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', url: 'https://mdxplora.com/', logo: '/ok.png' }),
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('all resolve');
});

test('structured data: a broken address on this site is reported, wherever it sits', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            url: 'https://mdxplora.com/missing-page/',
            logo: 'https://mdxplora.com/missing-logo.png',
            sameAs: ['https://example.org/elsewhere', '/missing-same/'],
          },
          {
            '@type': 'WebPage',
            url: '/about/',
            image: { '@type': 'ImageObject', url: '/missing-image.png' },
            mainEntityOfPage: 'https://mdxplora.com/#nowhere',
          },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    [
      'https://mdxplora.com/missing-page/',
      'https://mdxplora.com/missing-logo.png',
      '/missing-same/',
      '/missing-image.png',
      'https://mdxplora.com/#nowhere (no element with id "nowhere")',
    ].sort(),
  );
});

test('structured data: names, descriptions and @id names are not links', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': 'https://mdxplora.com/#organization',
        name: '#1 for molecular dynamics',
        alternateName: '/slash/ in a name',
        description: '/ not a path, and #not-an-id',
        url: '/',
        founder: { '@id': '/no-such-node/', name: '/also/not/a/path' },
      }),
    ),
  });
  expect(run.reported).toEqual([]);
  expect(run.status, run.output).toBe(0);
});

test('srcset and imagesrcset: each candidate is read as the HTML standard reads it', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        '<img src="/ok.png" srcset="/ok.png 1x, /missing-2x.png 2x" alt="">' +
        '<img src="/ok.png" srcset="/ok.png 480w, /missing-wide.png 960w" sizes="100vw" alt="">' +
        '<img src="/ok.png" srcset="data:text/plain;charset=utf-8,one,/two,three 1x, /missing-after-data.png 2x" alt="">',
      '<link rel="preload" as="image" imagesrcset="/ok.png 1x, /missing-preload.png 2x">',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    ['/missing-2x.png', '/missing-wide.png', '/missing-after-data.png', '/missing-preload.png'].sort(),
  );
});

test('a link to /page#name without the trailing slash is checked against that page', () => {
  const run = checkLinks({
    'index.html': html('<h1 id="top">Home</h1><a href="/about#team">Team</a><a href="/about#nowhere">Nowhere</a>'),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/about#nowhere (no element with id "nowhere")']);
});
