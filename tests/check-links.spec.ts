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

test('structured data: other properties schema.org gives an address are read too', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://mdxplora.com/' },
              { '@type': 'ListItem', position: 2, name: '/Missing', item: 'https://mdxplora.com/missing-crumb/' },
            ],
          },
          {
            '@type': 'WebSite',
            url: '/',
            potentialAction: [
              {
                '@type': 'SearchAction',
                target: { '@type': 'EntryPoint', urlTemplate: 'https://mdxplora.com/missing-search/?q={q}' },
                'query-input': 'required name=q',
              },
              { '@type': 'ViewAction', target: '/missing-target/' },
            ],
          },
          {
            '@type': 'WebPage',
            url: '/about/',
            screenshot: '/missing-screenshot.png',
            thumbnail: '/missing-thumbnail.png',
            relatedLink: ['/about/', '/missing-related/'],
            significantLink: '/missing-significant/',
            isBasedOn: '/missing-basis/',
            archivedAt: '/missing-archive/',
            citation: ['/missing-citation/', { '@type': 'CreativeWork', name: '/not-a-link', url: '/missing-cited/' }],
          },
          { '@type': 'Place', name: '#2 on the map', hasMap: '/missing-map/' },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    [
      'https://mdxplora.com/missing-crumb/',
      'https://mdxplora.com/missing-search/?q={q}',
      '/missing-target/',
      '/missing-screenshot.png',
      '/missing-thumbnail.png',
      '/missing-related/',
      '/missing-significant/',
      '/missing-basis/',
      '/missing-archive/',
      '/missing-citation/',
      '/missing-cited/',
      '/missing-map/',
    ].sort(),
  );
});

test('srcset and imagesrcset: each candidate is read as the HTML standard reads it', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        '<img src="/ok.png" srcset="/ok.png 1x, /missing-2x.png 2x" alt="">' +
        '<img src="/ok.png" srcset="/ok.png 480w, /missing-wide.png 960w" sizes="100vw" alt="">' +
        '<img src="/ok.png" srcset="data:text/plain;charset=utf-8,one,/two,three 1x, /missing-after-data.png 2x" alt="">' +
        '<img src="/ok.png" srcset="/ok.png 1x ((x), /missing-after-parens.png 2x" alt="">',
      '<link rel="preload" as="image" imagesrcset="/ok.png 1x, /missing-preload.png 2x">',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    [
      '/missing-2x.png',
      '/missing-wide.png',
      '/missing-after-data.png',
      '/missing-after-parens.png',
      '/missing-preload.png',
    ].sort(),
  );
});

test('srcset: only ASCII whitespace ends an address, as the HTML standard reads it', () => {
  // A no-break space (U+00A0) is part of the address, not a separator, and is not skipped before an address.
  const nbsp = '\u00a0';
  const run = checkLinks({
    [`no${nbsp}break.png`]: 'png',
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        `<img src="/ok.png" srcset="/no${nbsp}break.png 1x, /missing${nbsp}2x.png 2x" alt="">` +
        `<img src="/ok.png" srcset="/ok.png 1x,${nbsp}/not-from-the-root.png 2x" alt="">`,
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual([`/missing${nbsp}2x.png`]);
});

test('structured data: an address given as a node reference {"@id": ...} is read', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: { '@id': 'https://mdxplora.com/' } },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Gone',
                item: { '@id': 'https://mdxplora.com/missing-crumb/' },
              },
            ],
          },
          {
            '@type': 'WebSite',
            '@id': 'https://mdxplora.com/#website',
            url: '/',
            potentialAction: { '@type': 'ViewAction', target: { '@id': '/missing-target/' } },
          },
          {
            '@type': 'WebPage',
            '@id': 'https://mdxplora.com/about/#webpage',
            url: '/about/',
            mainEntityOfPage: { '@id': '/about/#team' },
            isPartOf: { '@id': 'https://mdxplora.com/#website' },
            image: { '@type': 'ImageObject', '@id': 'https://mdxplora.com/#logo', url: '/ok.png' },
          },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-target/', 'https://mdxplora.com/missing-crumb/'].sort());
});

test('structured data: a node reference names a node, so only the page of its @id is checked', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': 'https://mdxplora.com/#organization',
            logo: { '@id': 'https://mdxplora.com/#logo' },
            image: { '@id': '#primaryimage' },
          },
          {
            '@type': 'Article',
            mainEntityOfPage: { '@id': 'https://mdxplora.com/about/#webpage' },
            isBasedOn: { '@id': 'https://mdxplora.com/gone/#webpage' },
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                item: { '@type': 'WebPage', '@id': 'https://mdxplora.com/nope/', name: 'Nope' },
              },
            ],
          },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['https://mdxplora.com/gone/#webpage', 'https://mdxplora.com/nope/'].sort());
});

test('structured data: a target written as a template is read as one', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: '/',
        potentialAction: [
          { '@type': 'SearchAction', target: 'https://mdxplora.com/about/{?q}' },
          { '@type': 'SearchAction', target: 'https://mdxplora.com/docs/{slug}' },
          { '@type': 'SearchAction', target: '/missing-search/?q={q}' },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-search/?q={q}']);
});

test('structured data: the @id of a node that gives its own address is only its name', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        url: '/',
        image: { '@type': 'ImageObject', '@id': 'https://mdxplora.com/images/logo#img', contentUrl: '/ok.png' },
        isBasedOn: { '@type': 'WebPage', '@id': 'https://mdxplora.com/gone/', url: 'https://mdxplora.com/about/' },
        relatedLink: { '@type': 'WebPage', '@id': '/missing-id/', url: null },
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-id/']);
});

test('structured data: only a url, contentUrl or embedUrl is the own address of a node', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', item: { '@id': 'https://mdxplora.com/gone-image/', image: '/ok.png' } },
          { '@type': 'ListItem', item: { '@id': '/gone-logo/', logo: '/ok.png', license: '/about/' } },
          { '@type': 'ListItem', item: { '@id': '/gone-same/', sameAs: 'https://example.org/x' } },
          { '@type': 'ListItem', item: { '@id': '/gone-same-list/', sameAs: ['https://example.org/x'] } },
          { '@type': 'ListItem', item: { '@id': '/gone-thumb/', thumbnailUrl: '/ok.png' } },
          { '@type': 'ListItem', item: { '@id': '/gone-content/', contentUrl: '/ok.png' } },
          { '@type': 'ListItem', item: { '@id': '/gone-embed/', embedUrl: '/about/' } },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    ['https://mdxplora.com/gone-image/', '/gone-logo/', '/gone-same/', '/gone-same-list/', '/gone-thumb/'].sort(),
  );
});

test('structured data: an empty or blank url is no address, so the @id is checked', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        url: '/',
        isBasedOn: { '@id': '/missing-empty/', url: '' },
        relatedLink: { '@id': '/missing-blank/', url: '   ' },
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-blank/', '/missing-empty/']);
});

test('structured data: a placeholder left in an address is still reported, and the @context is not read', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': [
          'https://schema.org',
          { image: { '@id': '/vocab/image' }, url: { '@id': 'https://mdxplora.com/ns#url', '@type': '@id' } },
        ],
        '@type': 'WebSite',
        url: 'https://mdxplora.com/docs/{slug}',
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: '/missing{#s}' } },
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    ['/missing{#s}', 'https://mdxplora.com/docs/{slug} (a placeholder left in the address)'].sort(),
  );
});

test('a placeholder left in an address, even in its query, is reported outside a template', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><a href="/about/?tab={tab}">Tab</a><a href="/about/#{section}">Section</a>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: 'https://mdxplora.com/about/?q={q}',
        sameAs: ['https://example.org/?q={q}', '/about/?ref={ref}'],
        isBasedOn: { '@id': '/about/?v={v}' },
        mainEntityOfPage: { '@id': '/about/#{node}' },
        potentialAction: [
          { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: '/about/?q={q}' } },
          { '@type': 'SearchAction', target: 'https://mdxplora.com/about/?q={q}' },
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  const reason = ' (a placeholder left in the address)';
  expect(run.reported).toEqual(
    [
      '/about/?tab={tab}',
      '/about/#{section}',
      'https://mdxplora.com/about/?q={q}',
      '/about/?ref={ref}',
      '/about/?v={v}',
    ]
      .map((link) => link + reason)
      .sort(),
  );
});

test('structured data: a urlTemplate is checked up to its first placeholder, unless that is in the path', () => {
  const entry = (urlTemplate: string) => ({ '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate } });
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: '/',
        potentialAction: [
          entry('https://mdxplora.com/about/?q={q}'),
          entry('https://mdxplora.com/about/{?q}'),
          entry('/about/#{section}'),
          entry('https://mdxplora.com/docs/{slug}'),
          entry('/docs/{slug}/index.html'),
          entry('https://mdxplora.com/missing-search/?q={q}'),
          entry('/missing-expanded{?q}'),
        ],
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-expanded{?q}', 'https://mdxplora.com/missing-search/?q={q}'].sort());
});

test('a link to /page#name without the trailing slash is checked against that page', () => {
  const run = checkLinks({
    'index.html': html('<h1 id="top">Home</h1><a href="/about#team">Team</a><a href="/about#nowhere">Nowhere</a>'),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/about#nowhere (no element with id "nowhere")']);
});
