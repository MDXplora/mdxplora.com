// Bring the site in line with the released FastMDXplora.
//
// Everything the site says about the package comes from the release users
// install: the version is read from conda-forge, the docs and the citation from
// the git tag of that version, and the archive DOI from Zenodo. Nothing is
// copied into this repository by hand, so nothing here can fall behind a
// release. A source that cannot be read stops the build rather than leaving an
// older value in place.
//
// Writes (all ignored by git):
//   src/data/release.json          version, tag, commit, DOIs, citation
//   src/data/sidebar.json          the docs navigation, from the package's toctree
//   src/content/docs/docs/*.md     the docs pages
//
// FASTMDXPLORA_SOURCE=/path/to/checkout previews docs from a local checkout
// instead of the release. The pages then say so on every page.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/aai-research-lab/FastMDXplora';
const CONDA_PACKAGE = 'https://api.anaconda.org/package/conda-forge/fastmdxplora';
// Zenodo's concept record groups every archived version of the software.
const ZENODO_CONCEPT = '17510591';
const DOCS_OUT = join(ROOT, 'src/content/docs/docs');
const DATA_OUT = join(ROOT, 'src/data');

function fail(message) {
  console.error(`\nsync-release: ${message}\n`);
  process.exit(1);
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'mdxplora-site-build (+https://mdxplora.com)' },
    });
  } catch (error) {
    fail(`could not reach ${url}: ${error.message}`);
  }
  if (!response.ok) fail(`${url} answered ${response.status}`);
  return response.json();
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function releasedVersion() {
  const pkg = await getJson(CONDA_PACKAGE);
  if (!pkg.latest_version) fail('conda-forge did not report a latest version');
  return pkg.latest_version;
}

function checkoutTag(tag) {
  const dir = join(ROOT, '.cache', `fastmdxplora-${tag}`);
  if (!existsSync(join(dir, '.git'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    const clone = spawnSync('git', ['clone', '--quiet', '--depth', '1', '--branch', tag, `${REPOSITORY}.git`, dir], {
      encoding: 'utf8',
    });
    if (clone.status !== 0) fail(`could not clone ${REPOSITORY} at ${tag}:\n${clone.stderr}`);
  }
  return dir;
}

async function zenodoDoi(tag) {
  const url =
    `https://zenodo.org/api/records?q=conceptrecid:${ZENODO_CONCEPT}` + '&all_versions=true&sort=mostrecent&size=25';
  const found = await getJson(url);
  const hit = found.hits.hits.find((h) => h.metadata.version === tag);
  if (!hit) fail(`Zenodo has no archived record for ${tag} yet`);
  return { doi: hit.doi, conceptDoi: hit.conceptdoi };
}

function citation(source) {
  const cff = parseYaml(readFileSync(join(source, 'CITATION.cff'), 'utf8'));
  // Names only: affiliations are not published on this site.
  const names = (people = []) => people.map((p) => ({ given: p['given-names'], family: p['family-names'] }));
  const paper = cff['preferred-citation'];
  return {
    software: { title: cff.title, authors: names(cff.authors), license: cff.license },
    paper: paper && {
      title: paper.title,
      authors: names(paper.authors),
      journal: paper.journal,
      year: paper.year,
      volume: paper.volume,
      issue: paper.issue,
      doi: paper.doi,
    },
  };
}

// ---------------------------------------------------------------- docs

const FENCE = /^(`{3,})(.*)$/;

function slugOf(name) {
  return name.replace(/\.md$/, '').replaceAll('_', '-');
}

function docHref(target) {
  const [file, anchor] = target.split('#');
  const page = slugOf(file);
  const path = page === 'index' ? '/docs/' : `/docs/${page}/`;
  return anchor ? `${path}#${anchor}` : path;
}

function plainText(markdown) {
  return markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(body) {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(```|>|\||#|-|\*\s|<)/.test(p));
  if (!paragraph) return undefined;
  const text = plainText(paragraph);
  if (text.length <= 180) return text;
  const cut = text.slice(0, 180);
  const stop = cut.lastIndexOf('. ');
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

// Split a page into prose and fenced blocks, so links are rewritten in prose only.
function blocks(text) {
  const lines = text.split('\n');
  const out = [];
  let prose = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    if (prose.length) out.push({ type: 'prose', text: prose.join('\n') });
    prose = [];
    const ticks = open[1];
    const info = open[2].trim();
    const body = [];
    i++;
    while (i < lines.length && !lines[i].startsWith(ticks)) body.push(lines[i++]);
    out.push({ type: 'fence', ticks, info, body: body.join('\n') });
  }
  if (prose.length) out.push({ type: 'prose', text: prose.join('\n') });
  return out;
}

function rewriteLinks(text, tag) {
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    if (/^[\w-]+\.md(#[\w-]*)?$/.test(target)) return `](${docHref(target)})`;
    // Anything else in the repository is linked at the released tag.
    const path = target.replace(/^\.\.\//, '').replace(/^\.\//, 'docs/');
    return `](${REPOSITORY}/blob/${tag}/${path})`;
  });
}

function readToctrees(indexText) {
  const groups = [];
  for (const block of blocks(indexText)) {
    if (block.type !== 'fence' || block.info !== '{toctree}') continue;
    const caption = block.body.match(/^:caption:\s*(.+)$/m);
    const pages = block.body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(':'));
    if (!caption) fail('a toctree in docs/index.md has no :caption:');
    groups.push({ label: caption[1].trim(), pages });
  }
  if (!groups.length) fail('docs/index.md has no toctree to build the navigation from');
  return groups;
}

function renderApi(source, texts) {
  if (!texts.length) return [];
  const result = spawnSync('python3', [join(ROOT, 'scripts/api_reference.py')], {
    input: JSON.stringify({ src: join(source, 'src'), blocks: texts }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `the API reference could not be rendered:\n${result.stderr}\n` +
        'It needs Python 3.10+ with griffe: python3 -m pip install -r scripts/requirements.txt',
    );
  }
  return JSON.parse(result.stdout).blocks;
}

function convertPage(name, text, tag, apiQueue) {
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  if (h1 < 0) fail(`docs/${name} has no top-level heading`);
  const title = plainText(lines[h1].slice(2));
  const body = lines.slice(h1 + 1).join('\n');

  const parts = [];
  for (const block of blocks(body)) {
    if (block.type === 'prose') {
      parts.push(rewriteLinks(block.text, tag));
      continue;
    }
    if (block.info === '{toctree}') continue;
    if (block.info === '{eval-rst}') {
      parts.push(`\u0000API${apiQueue.length}\u0000`);
      apiQueue.push(block.body);
      continue;
    }
    const directive = block.info.match(/^\{([\w-]+)\}\s*(.*)$/);
    if (directive) {
      const asides = {
        note: 'note',
        tip: 'tip',
        warning: 'caution',
        important: 'caution',
        caution: 'caution',
        danger: 'danger',
      };
      const kind = asides[directive[1]];
      if (!kind) fail(`docs/${name} uses the directive {${directive[1]}}, which this site does not know how to show`);
      const label = directive[2] ? `[${directive[2]}]` : '';
      parts.push(`:::${kind}${label}\n${rewriteLinks(block.body, tag)}\n:::`);
      continue;
    }
    parts.push(`${block.ticks}${block.info}\n${block.body}\n${block.ticks}`);
  }
  return { title, body: parts.join('\n'), description: describe(body) };
}

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function importDocs(source, tag, label) {
  const docsDir = join(source, 'docs');
  const index = readFileSync(join(docsDir, 'index.md'), 'utf8');
  const groups = readToctrees(index);
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.md'));

  const listed = new Set(groups.flatMap((g) => g.pages));
  const unlisted = files.map((f) => f.replace(/\.md$/, '')).filter((f) => f !== 'index' && !listed.has(f));
  if (unlisted.length) fail(`pages missing from the docs navigation: ${unlisted.join(', ')}`);

  const apiQueue = [];
  const pages = files.map((file) => {
    const name = file.replace(/\.md$/, '');
    const page = convertPage(file, readFileSync(join(docsDir, file), 'utf8'), tag, apiQueue);
    return { name, file, ...page };
  });
  const api = renderApi(source, apiQueue);

  rmSync(DOCS_OUT, { recursive: true, force: true });
  mkdirSync(DOCS_OUT, { recursive: true });
  const titles = {};
  for (const page of pages) {
    const body = page.body.replace(/\u0000API(\d+)\u0000/g, (_, i) => api[Number(i)]);
    const slug = slugOf(page.name);
    titles[page.name] = page.title;
    const head = frontmatter({
      title: page.name === 'index' ? 'Overview' : page.title,
      description: page.description,
      editUrl: `${REPOSITORY}/edit/main/docs/${page.file}`,
    });
    const banner = label ? `\n:::caution[Preview]\n${label}\n:::\n` : '';
    writeFileSync(join(DOCS_OUT, `${slug}.md`), `${head}${banner}\n${body.trim()}\n`);
  }

  const sidebar = [
    { label: 'Overview', link: '/docs/' },
    ...groups.map((g) => ({
      label: g.label,
      items: g.pages.map((p) => ({
        label: titles[p] ?? fail(`toctree names a missing page: ${p}`),
        link: docHref(`${p}.md`),
      })),
    })),
  ];
  writeFileSync(join(DATA_OUT, 'sidebar.json'), `${JSON.stringify(sidebar, null, 2)}\n`);
  return pages.length;
}

// ---------------------------------------------------------------- main

async function main() {
  mkdirSync(DATA_OUT, { recursive: true });
  const local = process.env.FASTMDXPLORA_SOURCE;
  let release;
  let source;
  let label;

  if (local) {
    source = resolve(local);
    if (!existsSync(join(source, 'docs', 'index.md'))) fail(`${source} is not a FastMDXplora checkout`);
    const described = git(['describe', '--tags', '--always', '--dirty'], source);
    label = `These pages are built from a local checkout at ${described}, not from a release.`;
    release = {
      version: described,
      tag: git(['describe', '--tags', '--abbrev=0'], source),
      commit: git(['rev-parse', 'HEAD'], source),
      preview: true,
      ...citation(source),
    };
    const zenodo = await zenodoDoi(release.tag);
    Object.assign(release, zenodo);
  } else {
    const version = await releasedVersion();
    const tag = `v${version}`;
    source = checkoutTag(tag);
    release = {
      version,
      tag,
      commit: git(['rev-parse', 'HEAD'], source),
      released: git(['log', '-1', '--format=%cs'], source),
      preview: false,
      ...citation(source),
      ...(await zenodoDoi(tag)),
    };
  }
  release.repository = REPOSITORY;

  const count = importDocs(source, release.tag, label);
  writeFileSync(join(DATA_OUT, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  console.log(
    `sync-release: FastMDXplora ${release.version} (${release.tag}), ${count} docs pages, DOI ${release.doi}`,
  );
}

main();
