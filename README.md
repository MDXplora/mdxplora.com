# mdxplora.com

The MDXplora website and the FastMDXplora documentation, built with Astro and Starlight and served by GitHub Pages.

## Where the content comes from

Nothing about the package is written here by hand. On every build, `scripts/sync-release.mjs`:

- reads the released version from conda-forge,
- clones FastMDXplora at that version's tag and converts its `docs/` into the pages under `/docs/`, with the navigation
  taken from the package's own toctree,
- renders the API reference from the package's docstrings (`scripts/api_reference.py`, which reads the source without
  importing it),
- reads the citation from `CITATION.cff` at the tag and the release DOI from Zenodo.

A source that cannot be read stops the build. The daily scheduled build publishes a new release without a commit here.

To preview docs from a local FastMDXplora checkout instead of the release:

```bash
FASTMDXPLORA_SOURCE=~/path/to/FastMDXplora npm run dev
```

Every page then carries a notice that it is a preview.

## Working on the site

Needs Node 22 and Python 3.10 or later.

```bash
npm ci
python3 -m pip install -r scripts/requirements.txt
npm run dev          # http://localhost:4321
```

Before pushing:

```bash
npm run format
PUBLIC_FORMSPREE_ID=<form id> npm run build
npm run check        # types, internal links, banned terms
npm test             # browser tests against the build
```

## Banned terms

`scripts/check-terms.mjs` fails the build if any listed term appears in the source or the built pages. The list is not
kept in this repository. Locally it is read from `~/.config/mdxplora/banned-terms.txt` (one term per line, `#` for
comments); in CI from the `BANNED_TERMS` secret. Matching ignores case and accents.

## Configuration

| Where                        | Name                  | What                                                 |
| ---------------------------- | --------------------- | ---------------------------------------------------- |
| Repository variable          | `PUBLIC_FORMSPREE_ID` | The Formspree form ID. A build without it fails.     |
| Repository secret            | `BANNED_TERMS`        | The banned-terms list, one term per line.            |
| Settings, Pages              | Source                | GitHub Actions                                       |
| Settings, Pages              | Custom domain         | `mdxplora.com`, with Enforce HTTPS                   |
| Organization settings, Pages | Verified domains      | `mdxplora.com`, so no other account can claim it     |
| Formspree, form settings     | reCAPTCHA             | Off; the form submits in the page and has a honeypot |
| Formspree, form settings     | Restrict to domain    | `mdxplora.com`                                       |

DNS for GitHub Pages, with the records set to DNS only (not proxied) so GitHub can issue the certificate:

| Type  | Name  | Value                                                                                      |
| ----- | ----- | ------------------------------------------------------------------------------------------ |
| A     | `@`   | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`                 |
| AAAA  | `@`   | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |
| CNAME | `www` | `mdxplora.github.io`                                                                       |
