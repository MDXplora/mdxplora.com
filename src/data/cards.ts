import { site } from './site';

// The link preview image for each page, as shown when a link is shared. The
// title must match the page's headline; a browser test checks that it does.
// Pages without a card of their own (the 404 page) use the first.
export const cards = [
  {
    slug: 'home',
    title: site.tagline,
    text: site.support,
  },
  {
    slug: 'compute',
    title: 'Where studies will run',
    text: 'Studies will run on GPUs we provide, and on your own workstation or cluster once the connector is ready.',
  },
  {
    slug: 'services',
    title: 'Molecular dynamics services',
    text: 'Studies run for you, training for your group, and support.',
  },
  {
    slug: 'early-access',
    title: 'How early access works',
    text: 'Who it is for first, what you get, what it costs and what you agree to.',
  },
  {
    slug: 'contact',
    title: 'Contact us',
    text: 'Early access, a study run for you, training or support.',
  },
  {
    slug: 'privacy',
    title: 'What this site collects',
    text: 'Very little, and nothing to track you.',
  },
] as const satisfies readonly Card[];

export type Card = { slug: string; title: string; text: string };

/** The card for a page, found from its path: '/' is 'home', '/compute/' is 'compute'. */
export function cardFor(pathname: string): Card {
  const slug = pathname.replace(/^\/+|\/+$/g, '') || 'home';
  return cards.find((card) => card.slug === slug) ?? cards[0];
}
