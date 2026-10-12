import 'server-only';
import { postHashtags, postHasTag, tagKey } from '@/lib/hashtags';
import { firstVideo } from '@/lib/media';
import type { ID, Post } from '@/lib/types';
import { hydratePosts, visiblePosts, type PostView } from './posts';

/**
 * Hashtag pages and hashtag search.
 *
 * Both read `visiblePosts` — the same list every feed, Discover and search
 * read — so a video that is deleted, removed, held for review, or by an
 * account that is suspended, banned or blocked is never on a hashtag page,
 * and stops being on one the moment that happens. Nothing is indexed or
 * copied anywhere that could fall behind.
 */

/**
 * The most videos one hashtag page holds. Generous: the feed only ever plays
 * the video on screen and mounts its neighbours, so a long page costs little
 * more than a short one.
 */
export const HASHTAG_PAGE = 200;

export interface HashtagPage {
  /** Its videos, newest first. */
  videos: PostView[];
  /** Photo and text posts that use it too, which the video page does not show. */
  otherPosts: number;
}

export async function hashtagVideos(
  key: string,
  viewerId: ID | null,
  limit = HASHTAG_PAGE,
): Promise<HashtagPage> {
  const tagged = (await visiblePosts(viewerId)).filter((post) => postHasTag(post, key));
  // visiblePosts is newest first already.
  const videos = tagged.filter((post) => firstVideo(post.media) !== null);
  return {
    videos: await hydratePosts(videos.slice(0, limit), viewerId),
    otherPosts: tagged.length - videos.length,
  };
}

export interface HashtagSummary {
  key: string;
  /** How most posts that use it spell it, for showing. */
  label: string;
  videos: number;
  posts: number;
}

/**
 * Hashtags that match what somebody searched for, with how much uses them.
 *
 * A leading # is optional, case does not matter, and part of a hashtag finds
 * it — "gam" finds #gaming. An exact match comes first, then hashtags that
 * start with the search, then the rest, busiest first.
 */
export function matchHashtags(posts: Post[], query: string, limit = 12): HashtagSummary[] {
  const needle = tagKey(query);
  if (!needle) return [];
  const found = new Map<string, { spellings: Map<string, number>; videos: number; posts: number }>();
  for (const post of posts) {
    const isVideo = firstVideo(post.media) !== null;
    for (const tag of postHashtags(post)) {
      if (!tag.key || !tag.key.includes(needle)) continue;
      const entry = found.get(tag.key) ?? { spellings: new Map(), videos: 0, posts: 0 };
      entry.posts += 1;
      if (isVideo) entry.videos += 1;
      entry.spellings.set(tag.label, (entry.spellings.get(tag.label) ?? 0) + 1);
      found.set(tag.key, entry);
    }
  }
  const rank = (key: string) => (key === needle ? 0 : key.startsWith(needle) ? 1 : 2);
  return [...found.entries()]
    .map(([key, entry]) => ({
      key,
      label: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      videos: entry.videos,
      posts: entry.posts,
    }))
    .sort(
      (a, b) =>
        rank(a.key) - rank(b.key) ||
        b.videos - a.videos ||
        b.posts - a.posts ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit);
}
