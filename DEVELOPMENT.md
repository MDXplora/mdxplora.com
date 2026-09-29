# Working on mdxplora.com

The source of the MDXplora website, built with Astro and served by GitHub Pages. What MDXplora is, for the people it is
for, is in the [README](README.md).

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

The site publishes `/.well-known/security.txt` (RFC 9116), pointing security reports to the contact address. Its
expiry is set just under a year ahead at each build, so a deploy at least once a year keeps it valid.

## Visit counts

With `PUBLIC_CF_ANALYTICS_TOKEN` set, every page loads Cloudflare Web Analytics, which uses no cookies and stores nothing
on the visitor's device. The privacy page describes it only when it is on, and the security policy allows its script
and endpoint only then. It loads on `mdxplora.com` alone, so local previews, the browser tests and Lighthouse are never
counted. To turn it off, delete the variable and rerun the workflow.

## Sign in

With `PUBLIC_APP_URL` set to the hosted service's address (`https://app.mdxplora.com`), the header, the phone menu
and the footer link to it as **Sign in**. Unset, the site shows no sign-in, so it never points at a service that is not
running. The address must be https and a name only; a build with anything else fails.

Set it once the service answers at that address (`/_mdx/health` returns `ok`), and once the service has its own privacy
notice and terms: signing in gives the service an email address, which this site's privacy page does not cover. Then
`gh variable set PUBLIC_APP_URL --repo MDXplora/mdxplora.com --body https://app.mdxplora.com` and rerun the workflow.

## Uptime

Every 15 minutes, `.github/workflows/uptime.yml` checks from outside that this site answers over https and, with
`PUBLIC_APP_URL` set, that the service's `/_mdx/health` answers `ok`. The service says `ok` only while its database
answers and its regular check has got through in the last five minutes. Each address is tried three times, 20 seconds
apart, so a restart is not an outage, and each certificate must have more than 14 days left.

A failed run is emailed to whoever last changed the workflow's schedule, as long as their GitHub notification settings
(Settings, Notifications, Actions) send failed workflows by email. The run's log is public, like the repository: it
says which address failed and curl's reason, such as an HTTP status, and nothing else. To check at once: Actions,
Uptime, Run workflow.

GitHub turns scheduled workflows off after 60 days without activity in a public repository, and emails before it does;
Actions, Uptime, Enable workflow turns it back on.

## Dependencies

Dependabot proposes updates every Monday (`.github/dependabot.yml`): minor and patch updates together in one pull
request each for npm and for GitHub Actions, major updates one at a time, each release at least a week old. Merge once
CI passes. The workflows pin each action to a commit, with its version beside it, and Dependabot moves both. Lighthouse
CI runs through `npx` at the version pinned in `package.json`, outside the lockfile, and is updated by hand; it runs after
the site is packed for Pages and without the banned-terms list, so it cannot change what is published or read the list.

## Configuration

| Where                        | Name                        | What                                                                     |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Repository variable          | `PUBLIC_FORMSPREE_ID`       | The Formspree form ID. A build without it, or with a placeholder, fails. |
| Repository variable          | `PUBLIC_CF_ANALYTICS_TOKEN` | Optional. Cloudflare Web Analytics token; unset, nothing is counted.     |
| Repository variable          | `PUBLIC_APP_URL`            | Optional. The hosted service's address; unset, no sign-in is shown.      |
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
