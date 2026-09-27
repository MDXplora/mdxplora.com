// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Written by scripts/sync-release.mjs from the released package's own toctree.
const sidebar = JSON.parse(readFileSync(new URL('./src/data/sidebar.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: 'https://mdxplora.com',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'MDXplora',
      description: 'From a PDB code to publishable molecular dynamics.',
      favicon: '/favicon.svg',
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/tokens.css',
        './src/styles/docs.css',
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/aai-research-lab/FastMDXplora' }],
      sidebar,
      components: {
        Header: './src/components/starlight/Header.astro',
        SiteTitle: './src/components/starlight/SiteTitle.astro',
        MobileMenuFooter: './src/components/starlight/MobileMenuFooter.astro',
      },
      head: [{ tag: 'meta', attrs: { name: 'theme-color', content: '#0b1122' } }],
      plugins: [starlightLinksValidator()],
    }),
  ],
});
