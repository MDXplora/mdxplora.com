// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The content security policy, sent as a <meta> tag because GitHub Pages cannot
// set response headers. Astro adds script-src and style-src, with a hash for
// every script and style it bundles; Base.astro adds the hashes of the inline
// scripts in src/lib/inline-scripts.ts. Nothing else, such as injected code,
// can run. A <meta> policy cannot carry frame-ancestors or report-uri.
const policy = /** @type {const} */ ([
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // The contact form posts to Formspree, in the page or, without JavaScript, as a plain form.
  'form-action https://formspree.io',
  "connect-src 'self' https://formspree.io",
  // One small font subset is inlined into the stylesheet as a data: URL.
  "font-src 'self' data:",
  "img-src 'self'",
  'upgrade-insecure-requests',
]);

export default defineConfig({
  site: 'https://mdxplora.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  // No page has code blocks, and the highlighter's inline styles would need the policy relaxed.
  markdown: { syntaxHighlight: false },
  security: {
    csp: { directives: [...policy] },
  },
});
