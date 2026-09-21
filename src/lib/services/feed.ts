import 'server-only';
import type { ID, Post, User } from '@/lib/types';
import { engagementFor, hydratePosts, visiblePosts, type PostView } from './posts';
import { interleave, recommendScore } from './ranking';
import { ratingsIndex } from './ratings';
import { followerCounts, followingIds } from './users';

export type FeedTab = 'following' | 'recommended';

/**
 * Posts from the people you follow, newest first. No ranking, no mixing —
 * following should be predictable.
 */
export async function followingFeed(viewer: User, limit = 40): Promise<PostView[]> {
  const [posts, following] = await Promise.all([
    visiblePosts(viewer.id),
    followingIds(viewer.id),
  ]);
  const mine = posts.filter(
    (post) => following.has(post.author_id) || post.author_id === viewer.id,
  );
  return hydratePosts(mine.slice(0, limit), viewer.id);
}

/**
 * Recommended: good posts you would not otherwise see.
 *
 * Ranked on engagement relative to the author's existing audience, community
 * rating, freshness and whether it matches what you are into. Follower count
 * only ever appears as a denominator, so a big account gets no free ride.
 */
export async function recommendedFeed(
  viewer: User | null,
  limit = 40,
): Promise<PostView[]> {
  const now = Date.now();
  const viewerId = viewer?.id ?? null;
  const posts = await visiblePosts(viewerId);
  if (posts.length === 0) return [];

  const following = viewerId ? await followingIds(viewerId) : new Set<ID>();
  const { likes, comments } = await engagementFor(posts.map((p) => p.id));
  const followers = await followerCounts([...new Set(posts.map((p) => p.author_id))]);
  const index = await ratingsIndex();
  const interests = new Set(viewer?.interests ?? []);

  const score = (post: Post) =>
    recommendScore(
      post,
      {
        likes: likes.get(post.id) ?? 0,
        comments: comments.get(post.id) ?? 0,
        views: post.views,
      },
      followers.get(post.author_id) ?? 0,
      now,
      index.posts.get(post.id)?.rating ?? null,
      interests.has(post.category),
    );

  const pool = posts.filter((post) => post.author_id !== viewerId);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  // A slice of genuinely new posts is reserved so people who just joined are
  // seen by somebody on their first day.
  const fresh = [...pool]
    .filter((post) => !following.has(post.author_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  const ordered = interleave([ranked.slice(0, limit), fresh], (post) => post.id).slice(0, limit);
  const views = await hydratePosts(ordered, viewerId);
  const freshIds = new Set(fresh.slice(0, 4).map((post) => post.id));

  return views.map((view) => ({
    ...view,
    reason: view.following
      ? undefined
      : freshIds.has(view.post.id)
        ? 'Just posted'
        : interests.has(view.post.category)
          ? `Popular in ${view.post.category}`
          : 'Recommended',
  }));
}
