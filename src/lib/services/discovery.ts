import 'server-only';
import { MIN_VOTES_FOR_POST_RANKING } from '@/lib/ratings';
import { DAY } from '@/lib/time';
import type { Category, ID, Post } from '@/lib/types';
import { engagementFor, hydratePosts, visiblePosts, type PostView } from './posts';
import { recency } from './ranking';
import { ratingsIndex } from './ratings';

export type PostBoard = 'top' | 'trending';

export const POST_BOARDS: { key: PostBoard; label: string; blurb: string }[] = [
  {
    key: 'top',
    label: 'Top rated',
    blurb:
      'The highest rated posts, weighted by how many people have actually rated them — a 9.8 from four votes does not beat an 8.9 from four hundred.',
  },
  {
    key: 'trending',
    label: 'Trending',
    blurb: 'What people are reacting to right now, measured over the last few days.',
  },
];

interface Options {
  board: PostBoard;
  category?: Category | null;
  viewerId: ID | null;
  limit?: number;
}

/**
 * Posts worth finding, for the Discover page.
 *
 * "Top rated" uses the same confidence-adjusted score as the people rankings,
 * so the ordering rule is the one FayTarra explains everywhere else. Trending
 * is deliberately a different question — recent reaction, not quality — so the
 * two tabs do not just return the same list twice.
 */
export async function discoverPosts({
  board,
  category = null,
  viewerId,
  limit = 30,
}: Options): Promise<PostView[]> {
  const all = await visiblePosts(viewerId);
  const pool = category ? all.filter((post) => post.category === category) : all;
  if (pool.length === 0) return [];

  const index = await ratingsIndex();
  let ordered: Post[];

  if (board === 'top') {
    // A vote floor, for the same reason the people rankings have one: a
    // handful of ratings is not yet a community opinion.
    ordered = pool
      .filter((post) => (index.posts.get(post.id)?.votes ?? 0) >= MIN_VOTES_FOR_POST_RANKING)
      .sort((a, b) => (index.posts.get(b.id)?.score ?? 0) - (index.posts.get(a.id)?.score ?? 0));
  } else {
    const recent = pool.filter(
      (post) => Date.now() - new Date(post.created_at).getTime() < 7 * DAY,
    );
    const { likes, comments } = await engagementFor(recent.map((post) => post.id));
    const now = Date.now();
    // Raw reaction, decayed by age. Not divided by audience: trending is
    // literally "what is getting a reaction", which is a different question
    // from the Recommended feed's "what deserves more reach than it is getting".
    const heat = (post: Post) =>
      ((likes.get(post.id) ?? 0) * 3 + (comments.get(post.id) ?? 0) * 6 + post.views * 0.05) *
      recency(post.created_at, now);
    ordered = [...recent].sort((a, b) => heat(b) - heat(a));
  }

  return hydratePosts(ordered.slice(0, limit), viewerId);
}

/** Categories that actually have posts, most active first. */
export async function activeCategories(
  viewerId: ID | null,
): Promise<{ category: Category; posts: number }[]> {
  const posts = await visiblePosts(viewerId);
  const counts = new Map<Category, number>();
  for (const post of posts) counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, posts: count }))
    .sort((a, b) => b.posts - a.posts);
}
