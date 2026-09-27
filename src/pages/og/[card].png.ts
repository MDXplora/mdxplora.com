import type { APIRoute, GetStaticPaths } from 'astro';
import { cards, type Card } from '../../data/cards';
import { renderCard } from '../../lib/card-image';

export const getStaticPaths = (() =>
  cards.map((card) => ({ params: { card: card.slug }, props: { card } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(await renderCard((props as { card: Card }).card), { headers: { 'Content-Type': 'image/png' } });
