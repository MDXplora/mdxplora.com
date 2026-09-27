# mdxplora.com

The MDXplora website, built with Astro and served by GitHub Pages.

## Working on the site

Needs Node 22.

```bash
npm ci
npm run dev          # http://localhost:4321
```

Before pushing:

```bash
npm run format
PUBLIC_FORMSPREE_ID=<form id> npm run build
npm run check        # types, internal links, banned terms
npm test             # browser and accessibility tests against the build
npm run lighthouse   # speed, accessibility, best practice and SEO scores
```

The accessibility tests check every page in both themes against WCAG 2.2 AA with axe. Lighthouse runs each page three
times on a simulated phone and fails below the scores in `lighthouserc.json`: 90 for speed, 100 for the rest. CI keeps
its reports as a build artifact named `lighthouse`.

## Link preview images

Each page's preview image (`/og/<page>.png`, 1200 x 630) is drawn at build time by `src/lib/card-image.ts`: text from
`src/data/cards.ts` over a snapshot of the hero's Lennard-Jones fluid, simulated from a fixed seed so every build draws
the same image. A page's card title must match its headline; a browser test checks it. To preview one, build and open
`dist/og/home.png`.

`npm audit` reports a moderate advisory in `fflate`, which the image renderer uses only to decompress the bundled fonts
at build time. The advisory concerns ZIP archives, which it never reads, and nothing from it reaches the browser.

## Banned terms

`scripts/check-terms.mjs` fails the build if any listed term appears in the source or the built pages. The list is not
kept in this repository. Locally it is read from `~/.config/mdxplora/banned-terms.txt` (one term per line, `#` for
comments); in CI from the `BANNED_TERMS` secret. Matching ignores case and accents.

## Security policy

Every page carries a content security policy (`astro.config.mjs`) as a `<meta>` tag, since GitHub Pages cannot set
response headers. Scripts and styles run only from this site or by the hash Astro computes for each inline one, so
injected code does not run; the form may send only to Formspree. A browser test fails if the policy is missing, allows
inline code wholesale, or blocks anything the site itself uses. When adding a third-party script, image or form
endpoint, add its host to the policy in the same change.

## Visit counts

With `PUBLIC_CF_ANALYTICS_TOKEN` set, every page loads Cloudflare Web Analytics, which uses no cookies and stores nothing
on the visitor's device. The privacy page describes it only when it is on, and the security policy allows its script
and endpoint only then. It loads on `mdxplora.com` alone, so local previews, the browser tests and Lighthouse are never
counted. To turn it off, delete the variable and rerun the workflow.

## Dependencies

Dependabot proposes updates every Monday (`.github/dependabot.yml`): minor and patch updates together in one pull
request each for npm and for GitHub Actions, major updates one at a time, each release at least a week old. Merge once
CI passes. Lighthouse CI runs through `npx` at the version pinned in `package.json`, outside the lockfile, and is updated
by hand.

## Configuration

| Where                        | Name                        | What                                                                     |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Repository variable          | `PUBLIC_FORMSPREE_ID`       | The Formspree form ID. A build without it, or with a placeholder, fails. |
| Repository variable          | `PUBLIC_CF_ANALYTICS_TOKEN` | Optional. Cloudflare Web Analytics token; unset, nothing is counted.     |
| Repository secret            | `BANNED_TERMS`              | The banned-terms list, one term per line.                                |
| Dependabot secret            | `BANNED_TERMS`              | The same list, so Dependabot's pull requests are checked too.            |
| Settings, Pages              | Source                      | GitHub Actions                                                           |
| Settings, Pages              | Custom domain               | `mdxplora.com`, with Enforce HTTPS                                       |
| Organization settings, Pages | Verified domains            | `mdxplora.com`, so no other account can claim it                         |
| Formspree, form settings     | reCAPTCHA                   | Off; the form submits in the page and has a honeypot                     |
| Formspree, form settings     | Restrict to domain          | `mdxplora.com`                                                           |

DNS for GitHub Pages, with the records set to DNS only (not proxied) so GitHub can issue the certificate:

| Type  | Name  | Value                                                                                      |
| ----- | ----- | ------------------------------------------------------------------------------------------ |
| A     | `@`   | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`                 |
| AAAA  | `@`   | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |
| CNAME | `www` | `mdxplora.github.io`                                                                       |
