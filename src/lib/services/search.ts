import 'server-only';
import { db } from '@/lib/db';
import { CATEGORIES, type Category, type ID, type PublicUser } from '@/lib/types';
import { hydratePosts, visiblePosts, type PostView } from './posts';
import { ratingsIndex } from './ratings';
import { followerCounts, hiddenUserIds, toPublicUser } from './users';

export interface SearchResults {
  people: { user: PublicUser; followers: number; rating: number | null; votes: number }[];
  posts: PostView[];
  categories: Category[];
}

export async function search(query: string, viewerId: ID | null): Promise<SearchResults> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { people: [], posts: [], categories: [] };
  const store = db();
  const [users, hidden, posts, index] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    hiddenUserIds(viewerId),
    visiblePosts(viewerId),
    ratingsIndex(),
  ]);

  const people = users
    .filter(
      (user) =>
        !hidden.has(user.id) &&
        (user.username.includes(needle) ||
          user.display_name.toLowerCase().includes(needle) ||
          user.bio.toLowerCase().includes(needle) ||
          user.interests.some((i) => i.toLowerCase().includes(needle))),
    )
    .slice(0, 20);
  const followers = await followerCounts(people.map((u) => u.id));

  const matchedPosts = posts
    .filter(
      (post) =>
        post.caption.toLowerCase().includes(needle) ||
        post.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        post.category.toLowerCase() === needle,
    )
    .slice(0, 24);

  return {
    people: people.map((user) => {
      const summary = index.users.get(user.id);
      return {
        user: toPublicUser(user),
        followers: followers.get(user.id) ?? 0,
        rating: summary && summary.overallVotes > 0 ? summary.overall : null,
        votes: summary?.overallVotes ?? 0,
      };
    }),
    posts: await hydratePosts(matchedPosts, viewerId),
    categories: CATEGORIES.filter((category) => category.toLowerCase().includes(needle)),
  };
}
