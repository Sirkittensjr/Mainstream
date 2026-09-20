import 'server-only';
import { db } from '@/lib/db';
import type { Challenge, ID, User } from '@/lib/types';
import { hydratePosts, visiblePosts, type PostView } from './posts';
import { engagementFor } from './posts';
import { trendingScore } from './ranking';

export interface ChallengeView {
  challenge: Challenge;
  entries: number;
  creators: number;
  state: 'live' | 'upcoming' | 'ended';
  entered: boolean;
}

function stateOf(challenge: Challenge, now: number): ChallengeView['state'] {
  if (new Date(challenge.starts_at).getTime() > now) return 'upcoming';
  if (new Date(challenge.ends_at).getTime() < now) return 'ended';
  return 'live';
}

export async function listChallenges(viewerId: ID | null): Promise<ChallengeView[]> {
  const store = db();
  const now = Date.now();
  const [challenges, posts] = await Promise.all([
    store.query('challenges', { orderBy: 'ends_at' }),
    store.query('posts', { where: { removed: false } }),
  ]);
  const order = { live: 0, upcoming: 1, ended: 2 };
  return challenges
    .map((challenge) => {
      const entries = posts.filter((post) => post.challenge_id === challenge.id);
      return {
        challenge,
        entries: entries.length,
        creators: new Set(entries.map((entry) => entry.author_id)).size,
        state: stateOf(challenge, now),
        entered: Boolean(viewerId && entries.some((entry) => entry.author_id === viewerId)),
      } satisfies ChallengeView;
    })
    .sort((a, b) => {
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
      return a.challenge.ends_at.localeCompare(b.challenge.ends_at);
    });
}

export async function getChallengeBySlug(slug: string): Promise<Challenge | null> {
  const rows = await db().query('challenges', { where: { slug } });
  return rows[0] ?? null;
}

export interface ChallengeDetail extends ChallengeView {
  featured: PostView[];
  entriesList: PostView[];
}

export async function getChallengeDetail(
  slug: string,
  viewer: User | null,
): Promise<ChallengeDetail | null> {
  const challenge = await getChallengeBySlug(slug);
  if (!challenge) return null;
  const viewerId = viewer?.id ?? null;
  const posts = await visiblePosts(viewerId);
  const entries = posts.filter((post) => post.challenge_id === challenge.id);
  const { likes, comments } = await engagementFor(entries.map((entry) => entry.id));
  const now = Date.now();

  const ranked = [...entries].sort(
    (a, b) =>
      trendingScore(b, { likes: likes.get(b.id) ?? 0, comments: comments.get(b.id) ?? 0, views: b.views }, now) -
      trendingScore(a, { likes: likes.get(a.id) ?? 0, comments: comments.get(a.id) ?? 0, views: a.views }, now),
  );
  const featuredIds = new Set(challenge.featured_post_ids);
  const featured = ranked.filter((entry) => featuredIds.has(entry.id));

  const [featuredViews, entryViews] = await Promise.all([
    hydratePosts(featured.length > 0 ? featured : ranked.slice(0, 3), viewerId),
    hydratePosts(ranked, viewerId),
  ]);

  return {
    challenge,
    entries: entries.length,
    creators: new Set(entries.map((entry) => entry.author_id)).size,
    state: stateOf(challenge, now),
    entered: Boolean(viewerId && entries.some((entry) => entry.author_id === viewerId)),
    featured: featuredViews.map((view) => ({ ...view, reason: 'Featured entry' })),
    entriesList: entryViews,
  };
}

/** The challenge shown at the top of the Challenges page and in Create. */
export async function activeChallenges(): Promise<Challenge[]> {
  const nowIso = new Date().toISOString();
  const challenges = await db().query('challenges', { orderBy: 'ends_at' });
  return challenges.filter((c) => c.starts_at <= nowIso && c.ends_at >= nowIso);
}
