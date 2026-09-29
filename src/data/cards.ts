import { site } from './site';

// The link preview image for each page, as shown when a link is shared. The
// title must match the page's headline; a browser test checks that it does.
// `accent`, where given, is the end of the title drawn in the brand gradient,
// as on the page. Pages without a card of their own (the 404 page) use the first.
export const cards = [
  {
    slug: 'home',
    eyebrow: 'Early access is open',
    title: site.tagline,
    accent: 'publishable molecular dynamics',
    text: site.support,
  },
  {
    slug: 'compute',
    eyebrow: 'Compute',
    title: 'Our GPUs, or yours.',
    text: 'Run each study on GPUs we provide, or on your own workstation or cluster.',
  },
  {
    slug: 'services',
    eyebrow: 'Services',
    title: 'Molecular dynamics, done with you or for you.',
    text: 'Studies run for you, training for your group, and support.',
  },
  {
    slug: 'early-access',
    eyebrow: 'Early access',
    title: 'How early access works.',
    text: 'Who it is for first, what you get, what it costs and what you agree to.',
  },
  {
    slug: 'contact',
    eyebrow: 'Contact',
    title: 'Talk to us.',
    text: 'Early access, a study run for you, training or support.',
  },
  {
    slug: 'privacy',
    eyebrow: 'Privacy',
    title: 'What this site collects',
    text: 'Very little, and nothing to track you.',
  },
] as const satisfies readonly Card[];

export type Card = { slug: string; eyebrow: string; title: string; accent?: string; text: string };

/** The card for a page, found from its path: '/' is 'home', '/compute/' is 'compute'. */
export function cardFor(pathname: string): Card {
  const slug = pathname.replace(/^\/+|\/+$/g, '') || 'home';
  return cards.find((card) => card.slug === slug) ?? cards[0];
}
