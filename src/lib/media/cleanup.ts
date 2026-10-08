import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';
import { LOCAL_MEDIA_DIR } from '@/lib/db/local';
import { exclusiveMedia } from '@/lib/media';
import type { Media } from '@/lib/types';
import { directUploadsAvailable, removeStoredObjects } from './storage';

/**
 * Every media URL something on FayTarra still points at: each post's media and
 * video posters — removed and under-review posts included, because a moderator
 * can still restore those — and every profile picture and profile background.
 *
 * A scan rather than a lookup, because the URLs live inside each post's media
 * list. Deleting is rare and a scan is cheap next to deleting a file somebody
 * is still using.
 */
export async function mediaStillInUse(): Promise<Set<string>> {
  const store = db();
  const [posts, users] = await Promise.all([store.query('posts'), store.query('users')]);
  const used = new Set<string>();
  for (const post of posts) {
    for (const item of Array.isArray(post.media) ? post.media : []) {
      if (typeof item?.url === 'string') used.add(item.url);
      if (typeof item?.poster === 'string') used.add(item.poster);
    }
  }
  for (const user of users) {
    if (user.avatar_url) used.add(user.avatar_url);
    if (user.profile_cover_url) used.add(user.profile_cover_url);
  }
  return used;
}

export interface MediaRelease {
  /** Files that were deleted. */
  removed: string[];
  /** Files left alone because something else still uses them. */
  kept: string[];
  /** Files that should have gone but storage refused. Left in place, never referenced. */
  failed: string[];
}

/**
 * Deletes the files a just-deleted post owned outright — see `exclusiveMedia`
 * for exactly which those are.
 *
 * Runs AFTER the post row is gone, so the post's own references are no longer
 * counted and a file is never deleted while the post that shows it still
 * exists. If storage refuses, the file is left behind: an orphan nothing
 * points at is untidy, a post pointing at a missing file would be broken, and
 * only the first can happen here. It never throws into the delete — the post is
 * already deleted whatever happens to its files.
 */
export async function releasePostMedia(media: Media[], authorId: string): Promise<MediaRelease> {
  const result: MediaRelease = { removed: [], kept: [], failed: [] };
  const candidates = (Array.isArray(media) ? media : []).flatMap((item) =>
    [item?.url, item?.poster].filter((url): url is string => typeof url === 'string'),
  );
  if (candidates.length === 0) return result;

  try {
    const used = await mediaStillInUse();
    const doomed = exclusiveMedia(media, authorId, used);
    result.kept = [...new Set(candidates)].filter((url) => used.has(url));

    const bucket = doomed.filter((entry) => entry.location.store === 'bucket');
    if (bucket.length > 0) {
      const ok =
        directUploadsAvailable() &&
        (await removeStoredObjects(
          bucket.map((entry) => (entry.location as { path: string }).path),
        ).catch(() => false));
      for (const entry of bucket) (ok ? result.removed : result.failed).push(entry.url);
    }

    for (const entry of doomed) {
      if (entry.location.store !== 'local') continue;
      try {
        await fs.unlink(path.join(LOCAL_MEDIA_DIR, path.basename(entry.location.name)));
        result.removed.push(entry.url);
      } catch (error) {
        // Already gone is the outcome that was wanted.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') result.removed.push(entry.url);
        else result.failed.push(entry.url);
      }
    }
    if (result.failed.length > 0) {
      console.error('[faytarra] could not delete post media', result.failed);
    }
  } catch (error) {
    console.error('[faytarra] post media cleanup failed', error);
  }
  return result;
}
