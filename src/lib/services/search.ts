import 'server-only';
import { db } from '@/lib/db';
import { levelFor } from '@/lib/progression';
import { CATEGORIES, type Category, type ID, type PublicUser } from '@/lib/types';
import { hydratePosts, visiblePosts, type PostView } from './posts';
import { followerCounts, hiddenUserIds, toPublicUser } from './users';

export interface SearchResults {
  people: { user: PublicUser; followers: number; level: number; levelName: string }[];
  posts: PostView[];
  categories: Category[];
  challenges: { slug: string; title: string; description: string }[];
}

export async function search(query: string, viewerId: ID | null): Promise<SearchResults> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { people: [], posts: [], categories: [], challenges: [] };
  const store = db();
  const [users, challenges, hidden, posts] = await Promise.all([
    store.query('users', { where: { status: 'active' } }),
    store.query('challenges'),
    hiddenUserIds(viewerId),
    visiblePosts(viewerId),
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
        post.tags.some((tag) => tag.toLowerCase().includes(needle)),
    )
    .slice(0, 24);

  return {
    people: people.map((user) => {
      const level = levelFor(user.points);
      return {
        user: toPublicUser(user),
        followers: followers.get(user.id) ?? 0,
        level: level.level,
        levelName: level.name,
      };
    }),
    posts: await hydratePosts(matchedPosts, viewerId),
    categories: CATEGORIES.filter((category) => category.toLowerCase().includes(needle)),
    challenges: challenges
      .filter(
        (challenge) =>
          challenge.title.toLowerCase().includes(needle) ||
          challenge.description.toLowerCase().includes(needle),
      )
      .map(({ slug, title, description }) => ({ slug, title, description })),
  };
}
