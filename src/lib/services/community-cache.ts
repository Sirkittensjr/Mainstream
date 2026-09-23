import 'server-only';
import { revalidateTag, unstable_cache } from 'next/cache';

/**
 * Cross-request caching for the aggregates that are the same for everybody.
 *
 * FayTarra computes several things by reading a whole table and folding it in
 * JavaScript: the rating of every post, the ranking of every person, the set
 * of posts that are visible at all. Measured on a database of 200 people and
 * 600 posts, that came to roughly 7,000 rows read to render one page — very
 * nearly the entire database, on every request, for every visitor.
 *
 * The saving grace is that none of it is personal. The average rating of a
 * post is the same number whoever is looking, so it can be computed once and
 * shared, rather than recomputed per request per viewer.
 *
 * What may go in here: aggregates derived only from public rows, with no
 * viewer id anywhere in the inputs. What may NOT: anything that depends on
 * who is asking — their follows, their blocks, their unread counts, their
 * own ratings. Those stay per-request. The Data Cache is shared between
 * users, so caching something personal here would show it to somebody else.
 *
 * Staleness is bounded twice: every mutation that could change these numbers
 * calls `refreshCommunity()`, and `revalidate` is the backstop if one is ever
 * missed. Rating a post therefore updates the page immediately rather than a
 * minute later.
 */

const TAG = 'faytarra:community';

/** The backstop, in seconds, if an invalidation is ever missed. */
const MAX_AGE = 60;

export function communityCache<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  return unstable_cache(load, ['faytarra', key], { revalidate: MAX_AGE, tags: [TAG] });
}

/**
 * Called by every mutation that changes what those aggregates say: a rating,
 * a post appearing or going away, a follow, a block, a profile edit, a
 * moderation action. Cheap — it marks the tag, it does not recompute.
 */
export function refreshCommunity(): void {
  revalidateTag(TAG);
}
