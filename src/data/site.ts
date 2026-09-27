import release from './release.json';

export const site = {
  name: 'MDXplora',
  tagline: 'From a PDB code to publishable molecular dynamics',
  support: 'Every study ships its methods, provenance and uncertainty.',
  email: 'hello@mdxplora.com',
  // Set as a repository variable for the deploy (see README). A production
  // build without it fails, so a form that cannot send is never published.
  formspreeId: import.meta.env.PUBLIC_FORMSPREE_ID as string | undefined,
  github: release.repository,
} as const;

export const nav = [
  { label: 'Docs', href: '/docs/' },
  { label: 'Hosted', href: '/hosted/' },
  { label: 'Services', href: '/services/' },
  { label: 'Cite', href: '/cite/' },
] as const;

export const footer = [
  {
    title: 'Product',
    links: [
      { label: 'Install', href: '/docs/installation/' },
      { label: 'Your first study', href: '/docs/first-study/' },
      { label: 'Hosted MDXplora', href: '/hosted/' },
      { label: 'Services', href: '/services/' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs/' },
      { label: 'Python API', href: '/docs/api/' },
      { label: 'Cite', href: '/cite/' },
      { label: 'Source code', href: release.repository },
      { label: 'Changelog', href: `${release.repository}/blob/${release.tag}/CHANGELOG.md` },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', href: '/contact/' },
      { label: 'Privacy', href: '/privacy/' },
    ],
  },
] as const;

export { release };
