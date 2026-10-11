import 'server-only';
import { db } from '@/lib/db';
import { isMissingReviewColumn, REVIEW_STATES, underReview } from '@/lib/auto-review-rules';
import { storedMediaFor } from '@/lib/media';
import type { ID, Media } from '@/lib/types';
import { autoReviewAvailable } from './auto-review';

/**
 * Whether a file may be put somewhere new: on a post, as a profile picture, or
 * behind a profile.
 *
 * `sanitiseMedia` already holds every address to files FayTarra itself stored
 * and checked. That says where a file is, not whose it is or what became of
 * it, and both matter once moderation exists: a post hidden for review, or
 * removed, would be back on screen the moment its author — or anybody who
 * copied the address — attached the same file to a new post or made it their
 * profile picture. Hiding the post would hide nothing.
 *
 * So two more rules, checked on the server whatever the request sends:
 *
 *   - an upload in somebody's own folder (`media/<user id>/…`, which is where
 *     every checked upload goes) may only be used by that person;
 *   - a file on a post that is under review or was removed may not be used
 *     again at all, by anybody, until a moderator restores that post.
 *
 * Reusing your own file on a post that is fine — posting the same photo twice
 * — stays allowed; that is not a way around anything.
 */
export type MediaReuse = 'not_yours' | 'moderated';

export const MEDIA_REUSE_ERROR: Record<MediaReuse, string> = {
  not_yours: 'That file was uploaded by somebody else, so it cannot be posted from your account.',
  moderated:
    'That file is on a post that is being reviewed or was removed by FayTarra moderation, so it cannot be used again.',
};

/** Every file a list of media points at: the media itself and any video poster. */
export function mediaFiles(media: Media[]): string[] {
  const out: string[] = [];
  for (const item of media) {
    if (typeof item?.url === 'string') out.push(item.url);
    if (typeof item?.poster === 'string') out.push(item.poster);
  }
  return out;
}

/** An upload sitting in another person's folder. Older uploads have no folder and no owner. */
export function uploadedBySomeoneElse(url: string, userId: ID): boolean {
  const stored = storedMediaFor(url);
  return stored?.store === 'bucket' && stored.owner !== null && stored.owner !== userId;
}

/** Why these files may not be used by this person, or null when they may. */
export async function mediaReuseProblem(files: string[], userId: ID): Promise<MediaReuse | null> {
  const wanted = files.filter((url) => typeof url === 'string' && url.length > 0);
  if (wanted.length === 0) return null;
  if (wanted.some((url) => uploadedBySomeoneElse(url, userId))) return 'not_yours';
  const held = await moderatedFiles();
  return wanted.some((url) => held.has(url)) ? 'moderated' : null;
}

/**
 * Files on posts a moderator removed or that are hidden for review.
 *
 * Two narrow queries rather than a scan of every post: removed posts and the
 * review queue are both small next to the table, and `posts_review_idx` is a
 * partial index over exactly the second set.
 */
async function moderatedFiles(): Promise<Set<string>> {
  const store = db();
  const removed = await store.query('posts', { where: { removed: true } });
  let reviewed: typeof removed = [];
  if (await autoReviewAvailable()) {
    try {
      reviewed = (await store.query('posts', { in: { review_state: REVIEW_STATES } })).filter(
        (post) => underReview(post),
      );
    } catch (error) {
      if (!isMissingReviewColumn(error)) throw error;
    }
  }
  const held = new Set<string>();
  for (const post of [...removed, ...reviewed]) {
    for (const url of mediaFiles(Array.isArray(post.media) ? post.media : [])) held.add(url);
  }
  return held;
}
