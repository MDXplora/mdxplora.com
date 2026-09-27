export const site = {
  name: 'MDXplora',
  tagline: 'From question to publishable molecular dynamics',
  support: 'Every study is reproducible, traceable and checked before it runs.',
  domain: 'mdxplora.com',
  email: 'info@mdxplora.com',
  // Set as a repository variable for the deploy (see README). A production
  // build without it fails, so a form that cannot send is never published.
  formspreeId: import.meta.env.PUBLIC_FORMSPREE_ID as string | undefined,
} as const;

// The software MDXplora computes with, named only where a user must cite it.
export const engine = {
  name: 'FastMDXplora',
  // Permanent identifiers: the paper, and the archive record that lists every release.
  paperDoi: '10.1002/jcc.70350',
  archiveDoi: '10.5281/zenodo.17510591',
} as const;

export const nav = [
  { label: 'How it works', href: '/#how' },
  { label: 'Compute', href: '/compute/' },
  { label: 'Services', href: '/services/' },
  { label: 'Contact', href: '/contact/' },
] as const;

export const footer = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '/#how' },
      { label: 'Compute', href: '/compute/' },
      { label: 'Questions', href: '/#faq' },
      { label: 'Early access', href: '/contact/?topic=early-access' },
    ],
  },
  {
    title: 'Services',
    links: [
      { label: 'Studies run for you', href: '/services/' },
      { label: 'Training', href: '/contact/?topic=training' },
      { label: 'Support', href: '/contact/?topic=support' },
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
