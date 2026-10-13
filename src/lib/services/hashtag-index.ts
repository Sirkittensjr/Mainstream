import 'server-only';
import { db, isDuplicateRow, isMissingRelation } from '@/lib/db';
import { postHashtags, type Hashtag } from '@/lib/hashtags';
import { newId } from '@/lib/ids';
import type { ID, Post } from '@/lib/types';
import { serially } from './serial';

/**
 * Keeping the hashtag index in step with what posts say.
 *
 * Its own module, apart from the hashtag pages, because publishing and
 * deleting a post (services/posts.ts) write the index, and the pages read
 * posts — one module doing both would import itself in a circle.
 */

/**
 * Whether this database has the hashtag tables.
 *
 * Null until something has tried. A deployment that has not run migration
 * 0015 has neither table, and hashtags should not stop working because an
 * index was never built: pages then read the visible posts directly — slower,
 * and exactly as correct.
 */
export const index: { available: boolean | null; retryAt: number } = {
  available: null,
  retryAt: 0,
};

/** How long to leave the index alone after finding it missing, before looking again. */
const RETRY_MS = 5 * 60_000;

/**
 * Whether to leave the index alone. True for a while after finding it
 * missing; then it is tried again, so applying the migration to a running
 * deployment switches it back on without a restart.
 */
export function indexOff(): boolean {
  if (index.available !== false) return false;
  if (Date.now() < index.retryAt) return true;
  index.available = null;
  return false;
}

export function switchOff(reason: unknown): void {
  index.retryAt = Date.now() + RETRY_MS;
  if (index.available === false) return;
  index.available = false;
  console.error(
    '[faytarra] The hashtag index is switched off: this database has no `hashtags` / ' +
      '`post_hashtags` tables. Run supabase/migrations/0015_hashtags_and_counters.sql ' +
      'against it. Hashtag pages and search still work, by reading every visible post.',
    reason,
  );
}

/** Makes sure a hashtag has its one directory row. */
async function remember(hashtag: Hashtag, at: string): Promise<void> {
  const store = db();
  await serially(`hashtag:${hashtag.tag}`, async () => {
    const known = await store.query('hashtags', { where: { tag: hashtag.tag }, limit: 1 });
    if (known.length > 0) return;
    try {
      await store.insert('hashtags', { id: newId(), tag: hashtag.tag, display: hashtag.display, created_at: at });
    } catch (error) {
      // Somebody else's post brought the same hashtag into being a moment ago.
      if (!isDuplicateRow(error)) throw error;
    }
  });
}

/**
 * Files a post under exactly the hashtags it carries now.
 *
 * Idempotent: it adds the hashtags the post has gained, takes it off the ones
 * it has lost, and leaves the rest alone. Called when a post is published —
 * never while it is a draft — and it is what anything that changes a post's
 * words or tags must call afterwards.
 */
export async function indexPost(
  post: Pick<Post, 'id' | 'caption' | 'text_title' | 'tags' | 'created_at'>,
): Promise<void> {
  if (indexOff()) return;
  const store = db();
  const wanted = postHashtags(post);
  try {
    await serially(`post-hashtags:${post.id}`, async () => {
      const existing = await store.query('post_hashtags', { where: { post_id: post.id } });
      index.available = true;
      const want = new Set(wanted.map((hashtag) => hashtag.tag));
      const have = new Set(existing.map((row) => row.tag));

      // Taken out of the post: off that hashtag's page.
      await Promise.all(
        existing.filter((row) => !want.has(row.tag)).map((row) => store.remove('post_hashtags', row.id)),
      );

      const added = wanted.filter((hashtag) => !have.has(hashtag.tag));
      if (added.length === 0) return;
      for (const hashtag of added) await remember(hashtag, post.created_at);
      try {
        await store.insertMany(
          'post_hashtags',
          added.map((hashtag) => ({
            id: newId(),
            post_id: post.id,
            tag: hashtag.tag,
            post_created_at: post.created_at,
          })),
        );
      } catch (error) {
        // The same post indexed twice at once, by two server processes.
        if (!isDuplicateRow(error)) throw error;
      }
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      switchOff(error);
      return;
    }
    throw error;
  }
}

/** Takes a deleted post off every hashtag page. */
export async function unindexPost(postId: ID): Promise<void> {
  if (indexOff()) return;
  try {
    await db().removeWhere('post_hashtags', { post_id: postId });
  } catch (error) {
    if (isMissingRelation(error)) switchOff(error);
    else throw error;
  }
}

