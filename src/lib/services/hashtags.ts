import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import { hasHashtag, hashtagQuery, normaliseHashtag, postHashtags } from '@/lib/hashtags';
import type { ID, Post } from '@/lib/types';
import { index, indexOff, switchOff } from './hashtag-index';
import { hydratePosts, visibleAmong, visiblePosts, type PostView } from './posts';

/**
 * Hashtags as places: the index behind every `/tag/…` page, and the hashtags
 * search can find.
 *
 * Two tables (migration 0015). `hashtags` holds each hashtag once, under its
 * normalised form, so differently-capitalised spellings can never become two.
 * `post_hashtags` files each post under each of its hashtags, which is what a
 * hashtag page reads instead of every post on FayTarra.
 *
 * The index says which posts CARRY a hashtag; it never decides who may SEE
 * one. A hashtag page reads the post ids from it and then puts every one
 * through the same visibility rule as the feeds (`visibleAmong`), on the
 * server, per request — so a removed post, one hidden for review, one by a
 * suspended account or by somebody the viewer has blocked never appears,
 * whatever the index holds. It also re-checks each post still carries the
 * hashtag, so a stale row can only ever cost a page a post, never show one
 * that does not belong.
 */

/** How many posts a hashtag page opens with, and how far "Show more" goes. */
export const HASHTAG_PAGE = 20;
export const HASHTAG_MAX = 200;

/** The most index rows one page will read while looking for enough visible posts. */
const INDEX_READ_CEILING = 4_000;

/**
 * The visible posts carrying a hashtag, newest first — at least `wanted` of
 * them when there are that many.
 *
 * Read from the index a page at a time, growing until enough of what it names
 * turns out to be visible to this viewer.
 */
async function taggedPosts(tag: string, viewerId: ID | null, wanted: number): Promise<Post[]> {
  if (!indexOff()) {
    try {
      let reading = Math.max(wanted * 2, 50);
      for (;;) {
        const rows = await db().query('post_hashtags', {
          where: { tag },
          orderBy: 'post_created_at',
          desc: true,
          limit: reading,
        });
        index.available = true;
        const posts = (await visibleAmong(rows.map((row) => row.post_id), viewerId)).filter((post) =>
          hasHashtag(post, tag),
        );
        if (posts.length >= wanted || rows.length < reading || reading >= INDEX_READ_CEILING) {
          return posts;
        }
        reading = Math.min(reading * 4, INDEX_READ_CEILING);
      }
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
      switchOff(error);
    }
  }
  return (await visiblePosts(viewerId)).filter((post) => hasHashtag(post, tag));
}

/** A hashtag's directory row, if it has one. */
async function directoryEntry(tag: string) {
  if (indexOff()) return null;
  try {
    const [row] = await db().query('hashtags', { where: { tag }, limit: 1 });
    return row ?? null;
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    switchOff(error);
    return null;
  }
}

export interface HashtagPage {
  /** The normalised hashtag: the page's address. */
  tag: string;
  /** How to title it, as somebody wrote it. */
  display: string;
  posts: PostView[];
  hasMore: boolean;
}

/**
 * One hashtag's page, as `viewerId` may see it.
 *
 * Null for something that is not a hashtag at all. A hashtag nothing visible
 * carries is still a page — an empty one — so a link to it never breaks.
 */
export async function hashtagPage(
  raw: string,
  viewerId: ID | null,
  limit = HASHTAG_PAGE,
): Promise<HashtagPage | null> {
  const tag = normaliseHashtag(raw);
  if (!tag) return null;
  const [found, entry] = await Promise.all([
    taggedPosts(tag, viewerId, limit + 1),
    directoryEntry(tag),
  ]);
  const page = found.slice(0, limit);
  const display =
    entry?.display ??
    page.flatMap((post) => postHashtags(post)).find((hashtag) => hashtag.tag === tag)?.display ??
    tag;
  return {
    tag,
    display,
    posts: await hydratePosts(page, viewerId),
    hasMore: found.length > limit,
  };
}

export interface HashtagResult {
  tag: string;
  display: string;
  /** Visible posts carrying it — what a person opening the page would find. */
  posts: number;
}

/** How many hashtag results a search shows. */
const SEARCH_LIMIT = 8;

/**
 * Hashtags matching what somebody searched for: the exact hashtag, then ones
 * that start with it.
 *
 * `visible` is the posts this viewer may see, which search has already read;
 * every count comes from those, so neither a count nor a hashtag that only
 * hidden or removed posts carry can leak through. The one exception is the
 * exact hashtag searched for, which is offered even with nothing visible on it
 * — its name is what the person typed, and its page says it is empty.
 */
export async function searchHashtags(query: string, visible: readonly Post[]): Promise<HashtagResult[]> {
  const needle = hashtagQuery(query);
  if (!needle) return [];

  const counts = new Map<string, number>();
  const displays = new Map<string, string>();
  for (const post of visible) {
    for (const hashtag of postHashtags(post)) {
      if (!hashtag.tag.startsWith(needle)) continue;
      counts.set(hashtag.tag, (counts.get(hashtag.tag) ?? 0) + 1);
      if (!displays.has(hashtag.tag)) displays.set(hashtag.tag, hashtag.display);
    }
  }

  // The directory, for the casing a hashtag was first written in and for the
  // exact hashtag when nothing visible carries it right now.
  let directory: { tag: string; display: string }[] = [];
  if (!indexOff()) {
    try {
      directory = await db().query('hashtags', {
        startsWith: { tag: needle },
        orderBy: 'tag',
        limit: 200,
      });
      index.available = true;
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
      switchOff(error);
    }
  }
  for (const entry of directory) displays.set(entry.tag, entry.display);

  const results: HashtagResult[] = [...counts.entries()].map(([tag, posts]) => ({
    tag,
    display: displays.get(tag) ?? tag,
    posts,
  }));
  if (!counts.has(needle) && directory.some((entry) => entry.tag === needle)) {
    results.push({ tag: needle, display: displays.get(needle) ?? needle, posts: 0 });
  }

  return results
    .sort(
      (a, b) =>
        Number(b.tag === needle) - Number(a.tag === needle) ||
        b.posts - a.posts ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, SEARCH_LIMIT);
}
