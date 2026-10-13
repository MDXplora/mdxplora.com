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

test('structured data: a urlTemplate is checked without the query and fragment its first placeholder is in', () => {
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
          entry('/about/?x=%7Bstale%7D&q={q}'),
          entry('/about/#%7Bstale%7D-{n}'),
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

test('only the attributes of real tags are read, not the text of a script, a style or a comment', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        '<script>const id = 1; const link = `<a href="/about/${id}/">`; const ghost = \'<b id="ghost">\';</script>' +
        '<script src="/missing.js"></script>' +
        '<style>/* <img src="/missing-style.png"> */</style>' +
        '<!-- <a href="/missing-comment/"> -->' +
        '<textarea><a href="/missing-textarea/"></textarea>' +
        '<script>const end = "</script\u00a0>", link = \'<a href="/missing-script-end/">\';</script>' +
        '<a href="#ghost">Ghost</a><a href="/missing-after/">After</a>',
      '<title><a href="/missing-title/"></title>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['#ghost (no element with id "ghost")', '/missing-after/', '/missing.js'].sort());
});

test('character references in an attribute are decoded before the address is resolved', () => {
  const run = checkLinks({
    'a&b/index.html': html('<h1 id="t&c">A and B</h1>'),
    'index.html': html(
      '<h1 id="top">Home</h1><h2 id="q&amp;a">Questions</h2>' +
        '<a href="/a&amp;b/">1</a><a href="/a&#38;b/">2</a><a href="/a&#x26;b/#t&AMP;c">3</a>' +
        '<a href="&sol;about&sol;&num;team">4</a><a href="/about/#t&#101;am">5</a><a href="#q&amp;a">6</a>' +
        "<a href='/a&amp;b/'>7</a><a href=/a&amp;b/>8</a>" +
        '<img src="/ok.png" srcset="/ok.png 1x, /a&amp;b/ 2x" alt="">' +
        '<a href="/missing&amp;page/">9</a><a href="/a&bogus;b/">10</a><a href="/a&ampb/">11</a>',
      '<meta property="og:url" content="https://mdxplora.com/a&amp;b/">',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/a&ampb/', '/a&bogus;b/', '/missing&page/'].sort());
});

test('a placeholder left in an address is reported when it is encoded too', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><a href="/about/?q=%7Bq%7D">1</a><a href="/about/%7bslug%7d/">2</a>' +
        '<a href="/about/?q=&#123;q&#125;">3</a>',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: 'https://mdxplora.com/about/?q=%7Bq%7D',
        mainEntityOfPage: { '@id': '/about/#%7Bnode%7D' },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: '/about/%7Bx%7D/?q={q}' },
        },
      }),
    ),
  });
  expect(run.status, run.output).toBe(1);
  const reason = ' (a placeholder left in the address)';
  expect(run.reported).toEqual(
    [
      '/about/?q=%7Bq%7D',
      '/about/%7bslug%7d/',
      '/about/?q={q}',
      'https://mdxplora.com/about/?q=%7Bq%7D',
      '/about/%7Bx%7D/?q={q}',
    ]
      .map((link) => link + reason)
      .sort(),
  );
});

test('inside svg, a style holds markup, and HTML returns inside a foreignObject', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        '<svg><style><a href="/missing-in-svg-style/"></a></style></svg>' +
        '<svg><foreignObject><style><a href="/not-a-link/"></style></foreignObject></svg>' +
        '<a href="/missing-after/">x</a>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-after/', '/missing-in-svg-style/']);
});

test('of two href attributes on one tag, the second is ignored, as browsers ignore it', () => {
  const run = checkLinks({ 'index.html': html('<h1 id="top">Home</h1><a href="/about/" href="/gone/">x</a>') });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 1 internal links, all resolve');
});

test('an ld+json script inside svg is not structured data, so it is not read', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><svg><script type="application/ld+json">{"url": "/gone/"}</script></svg>',
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 0 internal links, all resolve');
});

// The next two show where parse5 and Chromium differ, as the header lists. If one fails after a parse5 update, check
// that list again.
test('parse5 differs: a style after a desc that closes its svg is read as text', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><svg><desc><b></desc></svg></b></desc><style><a href="/gone/"></a></style>',
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 0 internal links, all resolve');
});

test('parse5 differs: a form start tag in a table in a template is dropped, so its id is lost', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><template><a href="#f">x</a><table><form id="f"></form></table></template>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['#f (no element with id "f")']);
});

test('an attribute or an id is read in single quotes, without quotes and in any case', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><h2 id=\'sq\'>1</h2><h2 id=uq>2</h2><H2 ID="UP">3</H2>' +
        '<a href=\'/missing-sq/\'>4</a><a href=/missing-uq/>5</a><A HREF="/missing-up/">6</A>' +
        '<a href="#sq">7</a><a href="#uq">8</a><a href="#UP">9</a><a href="#nowhere">10</a>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(
    ['/missing-sq/', '/missing-uq/', '/missing-up/', '#nowhere (no element with id "nowhere")'].sort(),
  );
});

test('a structured data script is known by the essence of its type, the part before any ";"', () => {
  const ld = (type: string, link: string) => `<script type='${type}'>{"url": "${link}"}</script>`;
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      ld('application/ld+json; profile="http://www.w3.org/ns/json-ld#compacted"', '/missing-profile/') +
        ld('APPLICATION/LD+JSON ;charset=utf-8', '/missing-charset/') +
        ld('\tapplication/ld+json\n;x=y', '/missing-spaced/') +
        ld('application/ld+json\u00a0', '/not-read-1/') +
        ld('application/ld+json\u00a0; charset=utf-8', '/not-read-2/') +
        ld('application/ld+json+x; charset=utf-8', '/not-read-3/') +
        ld('text/plain; application/ld+json', '/not-read-4/'),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-profile/', '/missing-charset/', '/missing-spaced/'].sort());
});

test('the links in a noscript are read, as a browser with JavaScript off reads them', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><noscript><a href="/missing-in-noscript/">1</a><img src="/ok.png" alt=""></noscript>' +
        '<noscript><p id="no-js">Text</p><a href="/#no-js">2</a></noscript><a href="#no-js">3</a>',
      '<noscript><link rel="stylesheet" href="/missing-noscript.css"></noscript>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-in-noscript/', '/missing-noscript.css'].sort());
});

test('the content of a template is read', () => {
  const run = checkLinks({
    'index.html': html('<h1 id="top">Home</h1><template><a href="/missing-in-template/">1</a></template>'),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-in-template/']);
});

test('a page whose parse ends inside a comment, a tag or the text of an element is reported', () => {
  const page = (rest: string) => `<!doctype html><html><head><title>x</title></head><body><h1>x</h1>${rest}`;
  const run = checkLinks({
    'comment/index.html': page('<!-- <a href="/about/">'),
    'tag/index.html': page('<a href="/about/>x</a>'),
    'cdata/index.html': page('<svg><![CDATA[ <a href="/about/">'),
    'style/index.html': page('<style> a { color: red } <a href="/about/">'),
    'title/index.html': page('<svg></svg><title>x <a href="/about/">'),
    'script/index.html': page('<script><!-- var a = \'<script>\'; </script><a href="/about/">'),
    'textarea/index.html': page('<textarea>x <a href="/about/">'),
    'xmp/index.html': page('<xmp>x <a href="/about/">'),
    'iframe/index.html': page('<iframe>x <a href="/about/">'),
    'noembed/index.html': page('<noembed>x <a href="/about/">'),
    'noframes/index.html': page('<noframes>x <a href="/about/">'),
    'plaintext/index.html': page('<plaintext><a href="/about/">'),
  });
  expect(run.status, run.output).toBe(1);
  const reported = (what: string) => `the page ends inside ${what}, so what follows is not read`;
  const onlyText = reported('the text of an element that holds only text, such as a script or a style');
  expect(run.reported).toEqual(
    [
      reported('a comment'),
      reported('a tag'),
      reported('a CDATA section'),
      ...Array(8).fill(onlyText),
      reported('a plaintext element'),
    ].sort(),
  );
  for (const name of ['comment', 'tag', 'cdata', 'plaintext'])
    expect(run.output).toContain(`${name}/index.html \u2192 the page ends inside`);
  for (const name of ['style', 'title', 'script', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes'])
    expect(run.output).toContain(`${name}/index.html \u2192 ${onlyText}`);
});

test('a noscript in the head that holds content of the body is reported', () => {
  const run = checkLinks({
    'index.html':
      '<!doctype html><html><head><title>x</title><noscript><p id="js-off">Turn on JavaScript</p></noscript></head>' +
      '<body><h1 id="top">Home</h1><a href="#js-off">x</a></body></html>',
    'about/index.html': html(
      '<h1 id="team">About</h1>',
      '<noscript><link rel="stylesheet" href="/ok.png"><style>p {}</style><meta name="x" content="y"></noscript>',
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual([
    'a noscript in the head holds content that belongs in the body, which browsers read differently with ' +
      'JavaScript on and off, so change the markup',
  ]);
  expect(run.output).toContain('index.html \u2192 a noscript in the head');
});

test('the address of this site with no path is read, and resolves to the home page', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      '<meta property="og:url" content="https://mdxplora.com"><meta content="https://mdxplora.com.example.org/x">',
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 1 internal links, all resolve');
});

test('a content attribute is read only when it is a full address on this site', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>',
      '<meta name="x" content="/nope/"><meta name="y" content="#nowhere">' +
        '<meta property="og:url" content="https://mdxplora.com/about/">',
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 1 internal links, all resolve');
});

test('xlink:href, which svg once used for links, is not read', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><svg><a xlink:href="/missing-xlink/">x</a><use xlink:href="#nowhere"/></svg>',
    ),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain('check-links: 0 internal links, all resolve');
});

test('a select that holds a tag other than an option is reported, so its markup is changed', () => {
  const run = checkLinks({
    'img/index.html': html('<select><option>x</option><img src="/missing.png"></select>'),
    // The link is reported while parse5 drops the span. If a later parse5 keeps it, this fails: the guard is stale.
    'span/index.html': html('<select><option>a</option><span id="opt-x">o</span></select><a href="#opt-x">x</a>'),
    // A select with no end tag runs to the end of the page.
    'open/index.html': '<!doctype html><html><head><title>x</title></head><body><select><option>a<a href="/nope/">',
    'tags/index.html': html('<div><select><option><b>a</b></option></div><div id="d">d</div></select>'),
    // This errs towards reporting.
    'attribute/index.html': html('<select><option title="<b>">a</option></select>'),
    // None of these.
    'index.html': html(
      '<h1 id="top">Home</h1>' +
        '<select><option>a &lt;b&gt;</option><optgroup label="g"><option>b<hr></optgroup><!-- <div> -->' +
        '<script>"<div>"</script><template><div><a href="/about/">x</a></div></template></select>' +
        '<select><option>c</option></select><select><OPTION>d</OPTION><OptGroup label=g><Hr></OptGroup></select>' +
        '<svg><select><a href="/about/">x</a></select></svg>' +
        '<select><option>a<input id="in"><a href="#in">x</a>',
    ),
    // The select ends at its end tag.
    'end/index.html': html('<select><option>a</option></select><form><form><input></form>'),
  });
  expect(run.status, run.output).toBe(1);
  const holds = (tags: string) => `a select holds ${tags}, which is not supported here, so change the markup`;
  expect(run.reported).toEqual(
    [
      holds('<img>'),
      holds('<span>'),
      '#opt-x (no element with id "opt-x")',
      holds('<a>'),
      holds('<b>, <div>'),
      holds('<b>'),
    ].sort(),
  );
  for (const name of ['img', 'span', 'open', 'tags', 'attribute'])
    expect(run.output).toContain(`${name}/index.html \u2192 a select holds`);
});

test('a select inside a template is checked too', () => {
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1><template><select><a href="/nope/">x</a><option>o</option></select></template>',
    ),
    'img/index.html': html('<template><select><img src="/nope.png"><option>o</option></select></template>'),
  });
  expect(run.status, run.output).toBe(1);
  const holds = (tag: string) => `a select holds ${tag}, which is not supported here, so change the markup`;
  expect(run.reported).toEqual([holds('<a>'), holds('<img>')].sort());
  expect(run.output).toContain('img/index.html \u2192 a select holds <img>');
});

test('a page nested many thousands of elements deep is read in full', () => {
  const depth = 10000;
  const run = checkLinks({
    'index.html': html(
      '<h1 id="top">Home</h1>' + '<div>'.repeat(depth) + '<a href="/missing-deep/">x</a>' + '</div>'.repeat(depth),
    ),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing-deep/']);
});

test('structured data nested too deep to read is reported, and the other pages are still checked', () => {
  const depth = 10000;
  const data = '{"url": "/about/", "part": '.repeat(depth) + '1' + '}'.repeat(depth);
  const run = checkLinks({
    'deep/index.html': html('<h1>Deep</h1>', `<script type="application/ld+json">${data}</script>`),
    'index.html': html('<h1 id="top">Home</h1><a href="/missing/">x</a>'),
  });
  expect(run.status, run.output).toBe(1);
  expect(run.reported).toEqual(['/missing/', 'structured data nested too deep to read']);
  expect(run.output).toContain('deep/index.html \u2192 structured data nested too deep to read');
});

test('structured data with a long flat list of addresses is read in full', () => {
  const count = 200000;
  const data = JSON.stringify({ sameAs: Array(count).fill('/about/') });
  const run = checkLinks({
    'index.html': html('<h1 id="top">Home</h1>', `<script type="application/ld+json">${data}</script>`),
  });
  expect(run.status, run.output).toBe(0);
  expect(run.output).toContain(`check-links: ${count} internal links, all resolve`);
});
