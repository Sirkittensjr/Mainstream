import 'server-only';
import { db, isMissingColumn, isMissingRelation } from '@/lib/db';
import { newId } from '@/lib/ids';
import { refreshCommunity } from './community-cache';
import { notify } from './notifications';
import type { ID, ModerationEvent, Report, ReportTarget } from '@/lib/types';
import {
  AUTO_REVIEW_THRESHOLD,
  REVIEW_WINDOW_HOURS,
  REVIEW_STATES,
  REVIEW_WINDOW_MS,
  clampWindow,
  countUniqueReporters,
  describeWindow,
  isMissingReviewColumn,
  reachedThreshold,
  reviewExpiry,
  reviewHasExpired,
  underReview,
  type ModerationAction,
  type ReviewState,
} from '@/lib/auto-review-rules';

// The rules themselves live in lib/auto-review-rules.ts, which has no database
// and no `server-only`, so they can be tested and so the admin screens can
// explain the threshold without importing a service. Re-exported here so
// callers have one place to import from.
export {
  AUTO_REVIEW_THRESHOLD,
  REVIEW_WINDOW_HOURS,
  underReview,
  type ModerationAction,
  type ReviewState,
};

/**
 * How long an automatic hide lasts here.
 *
 * 24 hours unless a deployment shortens it, and it can only ever be shortened:
 * `clampWindow` caps it at the documented maximum. This exists so the expiry
 * can be watched happening in a test in a couple of minutes instead of a day —
 * the same reason AUTH_EMAIL_COOLDOWN_SECONDS and ADMIN_CODE_COOLDOWN_SECONDS
 * exist — and not as a knob anybody is expected to turn in production.
 */
export function reviewWindowMs(): number {
  const raw = Number(process.env.FAY_REVIEW_WINDOW_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return REVIEW_WINDOW_MS;
  return clampWindow(raw * 60_000);
}

/** The window in words, so nothing hard-codes "24 hours" next to a shorter one. */
export function reviewWindowLabel(): string {
  return describeWindow(reviewWindowMs());
}

/**
 * Automatic temporary review.
 *
 * One moderator cannot read every report the moment it arrives. When enough
 * DIFFERENT accounts report the same post, it is hidden while somebody looks
 * at it — and that is all it is. Not a verdict, not a ban, not a deletion:
 * a pause, with a clock on it.
 *
 * Four rules hold this together, and they are the ones worth not getting
 * wrong:
 *
 *   - It counts PEOPLE, not reports. One account reporting the same post ten
 *     times is one report, enforced by a unique index rather than by this
 *     code, so it holds even for a caller that never comes through here.
 *   - It is temporary. 24 hours, then the post comes back on its own, and the
 *     expiry is recorded as an expiry rather than as a decision.
 *   - An admin outranks the clock in both directions: they can restore early,
 *     or hold something past 24 hours while they look into it.
 *   - Nothing is deleted. Clearing the threshold clears what COUNTS, never
 *     what happened.
 */

/**
 * Whether this database has migration 0009.
 *
 * Null until something has told us. A deployment without it must keep working
 * — reporting, moderation and every post on the site are not about this
 * feature — so automatic review switches itself off rather than taking the
 * site down with it.
 */
let installed: boolean | null = null;
let warned = false;

function noteMissing(): void {
  installed = false;
  if (warned) return;
  warned = true;
  console.warn(
    '[faytarra] Automatic report review is off: this database has not had ' +
      'migration 0009 run against it. Reporting and manual moderation are ' +
      'unaffected.',
  );
}

/** True when the schema is there. Cheap after the first answer. */
export async function autoReviewAvailable(): Promise<boolean> {
  if (installed !== null) return installed;
  try {
    await db().query('moderation_events', { limit: 1 });
    installed = true;
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    noteMissing();
  }
  return installed ?? false;
}

/**
 * Writes review columns onto a post, and survives a database that has no such
 * columns.
 *
 * Without this, a deployment that has not run migration 0009 would break
 * something that works today: restoring or removing a post also clears its
 * review state, and sending a column Postgres does not have fails the whole
 * update. That would take an existing admin action down over a feature that is
 * supposed to switch itself off quietly. So the fields are dropped and the rest
 * of the update goes through.
 *
 * Returns whether the review fields were actually stored.
 */
export async function patchReview(
  postId: ID,
  review: Record<string, unknown>,
  alsoSet: Record<string, unknown> = {},
): Promise<boolean> {
  const store = db();
  const rest = async () => {
    if (Object.keys(alsoSet).length > 0) await store.update('posts', postId, alsoSet);
  };

  if (installed === false) {
    await rest();
    return false;
  }
  try {
    await store.update('posts', postId, { ...alsoSet, ...review });
    // Deliberately NOT `installed = true`. Writing these columns proves the
    // columns exist; it says nothing about `moderation_events`, and claiming
    // the whole feature is installed on that evidence would send the next
    // history read at a table that may not be there. `autoReviewAvailable()`
    // answers that by asking the table itself.
    return true;
  } catch (error) {
    if (!isMissingReviewColumn(error)) throw error;
    noteMissing();
    await rest();
    return false;
  }
}


/** Writes one line of history. Never throws into a caller's path. */
export async function record(input: {
  targetType: ReportTarget;
  targetId: ID;
  action: ModerationAction;
  actorId?: ID | null;
  uniqueReports?: number;
  detail?: string;
}): Promise<void> {
  try {
    await db().insert('moderation_events', {
      id: newId(),
      target_type: input.targetType,
      target_id: input.targetId,
      action: input.action,
      actor_id: input.actorId ?? null,
      unique_reports: input.uniqueReports ?? 0,
      detail: (input.detail ?? '').slice(0, 500),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      noteMissing();
      return;
    }
    throw error;
  }
}

/**
 * The reports that currently COUNT for this content.
 *
 * Cleared reports are left out — that is the whole point of clearing: the same
 * ten reports must not re-trigger a hide the moment an admin restores the
 * post. They are still in the table, still readable, still attributable.
 */
export async function activeReports(
  targetType: ReportTarget,
  targetId: ID,
): Promise<Report[]> {
  const rows = await db().query('reports', {
    where: { target_type: targetType, target_id: targetId },
  });
  return rows.filter((row) => !(row as Report & { cleared_at?: string }).cleared_at);
}

/** How many DISTINCT accounts have an active report against this. */
export async function uniqueReporterCount(
  targetType: ReportTarget,
  targetId: ID,
): Promise<number> {
  const rows = await activeReports(targetType, targetId);
  return countUniqueReporters(rows);
}

/**
 * Called after a report lands. Hides the post if enough people have now
 * reported it, and tells the author why.
 *
 * Only posts — a video IS a post here, which is why videos need nothing of
 * their own. Comments and profiles are reported and reviewed by hand; hiding
 * a whole profile on a report count is a much larger decision than this
 * feature is allowed to make on its own.
 */
export async function maybeAutoReview(targetType: ReportTarget, targetId: ID): Promise<boolean> {
  if (targetType !== 'post') return false;
  if (!(await autoReviewAvailable())) return false;

  const store = db();
  const post = await store.get('posts', targetId);
  if (!post) return false;

  // Already hidden, already removed, or already being looked at: nothing to do.
  const state = (post as { review_state?: string | null }).review_state ?? null;
  if (post.removed || state) return false;

  const unique = await uniqueReporterCount(targetType, targetId);
  if (!reachedThreshold(unique)) return false;

  const now = new Date();
  const expires = reviewExpiry(now, reviewWindowMs());

  const stored = await patchReview(targetId, {
    review_state: 'temporary_review',
    review_started_at: now.toISOString(),
    review_expires_at: expires.toISOString(),
    review_reports: unique,
  });
  if (!stored) return false;

  refreshCommunity();

  await record({
    targetType: 'post',
    targetId,
    action: 'auto_review_started',
    actorId: null,
    uniqueReports: unique,
    detail: `Reached ${unique} unique reports. Hidden until ${expires.toISOString()}.`,
  });

  await tellAuthor(post.author_id, targetId, isVideoPost(post));
  return true;
}

/** Does this post lead with a video? Only changes the word in the message. */
function isVideoPost(post: { media?: unknown }): boolean {
  const media = Array.isArray(post.media) ? post.media : [];
  return media.some((item) => (item as { kind?: string })?.kind === 'video');
}

/**
 * The message the author gets.
 *
 * A NOTIFICATION, not a direct message. Direct messages on FayTarra require
 * the two people to follow each other, enforced by a trigger on the table as
 * well as in the service — and that rule is not being bent so that FayTarra
 * can talk to somebody. A notification reaches anybody, is one-way by
 * construction, and cannot be replied to as though it were a conversation.
 * Nothing about user-to-user messaging changes.
 */
async function tellAuthor(authorId: ID, postId: ID, video: boolean): Promise<void> {
  const noun = video ? 'video' : 'content';
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body:
      `Your ${noun} is currently being reviewed. It has been temporarily hidden ` +
      'because it received multiple reports. The review can take up to ' +
      `${reviewWindowLabel()}.`,
  });
}

/** The message after an admin decides to remove something. */
export async function tellAuthorRemoved(
  authorId: ID,
  postId: ID,
  video: boolean,
): Promise<void> {
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body:
      `Your ${video ? 'video' : 'post'} was removed by FayTarra moderation ` +
      'because it violated our community guidelines.',
  });
}

/**
 * Puts expired reviews back, and records that the clock ran out rather than
 * that anybody decided anything.
 *
 * Lazy: called when somebody looks, because FayTarra has no scheduler and a
 * feature that needs one to be correct would be wrong here. `underReview`
 * already treats an expired review as over, so this is bookkeeping catching
 * up with a decision that has already taken effect — not the thing that makes
 * the post visible.
 */
export async function sweepExpiredReviews(): Promise<number> {
  if (!(await autoReviewAvailable())) return 0;

  const store = db();
  let candidates;
  try {
    candidates = await store.query('posts', { where: { review_state: 'temporary_review' } });
  } catch (error) {
    if (!isMissingReviewColumn(error)) throw error;
    noteMissing();
    return 0;
  }

  const now = Date.now();
  const expired = candidates.filter((post) => reviewHasExpired(post, now));
  if (expired.length === 0) return 0;

  for (const post of expired) {
    await patchReview(post.id, { review_state: null, review_expires_at: null });
    await record({
      targetType: 'post',
      targetId: post.id,
      action: 'auto_review_expired',
      actorId: null,
      uniqueReports: (post as { review_reports?: number }).review_reports ?? 0,
      detail:
        `Nobody reviewed it within ${reviewWindowLabel()}, so it was restored ` +
        'automatically.',
    });
  }

  // NO refreshCommunity() here, for two reasons that happen to agree.
  //
  // It is not needed: the community cache holds post ROWS, and `underReview`
  // evaluates the expiry against the clock every time it is asked, so a cached
  // row whose window has passed already reads as visible. This loop is writing
  // down a decision the clock already made, not the thing that makes the post
  // reappear.
  //
  // And it is not allowed: `refreshCommunity` is `revalidateTag`, which Next.js
  // refuses during a render — and this is called from the admin page's render,
  // because that is where somebody is looking. Calling it there turned
  // /admin?tab=reports into a 500 the first time a review had lapsed, which is
  // precisely when a moderator most needs the page.
  return expired.length;
}

/** One piece of content waiting for a human, with everything needed to judge it. */
export interface ReviewItem {
  postId: ID;
  authorId: ID;
  authorUsername: string;
  caption: string;
  video: boolean;
  state: ReviewState;
  startedAt: string | null;
  expiresAt: string | null;
  /** Distinct accounts whose report still counts. */
  uniqueReports: number;
  /** Why they said they reported it, most common first. Never who. */
  reasons: { reason: string; count: number }[];
  /** What reporters typed, with no name attached to any of it. */
  notes: string[];
  history: ModerationEvent[];
}

/**
 * The review queue: everything currently hidden by the automatic threshold or
 * held by an admin.
 *
 * Reporter identities do not come out of here. An admin sees how many
 * different people reported something, what reasons they picked and what they
 * wrote — not which accounts they were. Ten names next to a post is a list of
 * people to be annoyed at, and moderation that leaks that is moderation people
 * stop trusting enough to use.
 */
export async function reviewQueue(): Promise<ReviewItem[]> {
  if (!(await autoReviewAvailable())) return [];

  const store = db();
  let candidates;
  try {
    // Asking for the two review states rather than reading every post and
    // filtering in memory. This is what `posts_review_idx` is for — a partial
    // index over exactly these rows — and the gap widens as the site grows: the
    // queue is a handful of posts on a table that is not.
    candidates = await store.query('posts', { in: { review_state: REVIEW_STATES } });
  } catch (error) {
    if (!isMissingReviewColumn(error)) throw error;
    noteMissing();
    return [];
  }

  // Still filtered through `underReview`. The query returns rows the DATABASE
  // has marked; `underReview` decides whether they still count as of now, and a
  // row whose window ran out an hour ago is in the first answer but not this one.
  const pending = candidates.filter((post) => underReview(post));
  if (pending.length === 0) return [];

  // Three queries for the whole queue rather than two per item: the per-item
  // version was an N+1 on the page a moderator reloads most.
  const postIds = pending.map((post) => post.id);
  const [users, allReports, allEvents] = await Promise.all([
    store.query('users', { in: { id: [...new Set(pending.map((p) => p.author_id))] } }),
    store.query('reports', { where: { target_type: 'post' }, in: { target_id: postIds } }),
    store.query('moderation_events', {
      where: { target_type: 'post' },
      in: { target_id: postIds },
      orderBy: 'created_at',
      desc: true,
    }),
  ]);
  const username = new Map(users.map((user) => [user.id, user.username]));
  const reportsByPost = groupByTarget(allReports.filter((row) => !row.cleared_at));
  const eventsByPost = groupByTarget(allEvents);

  const items = pending.map((post) => {
    const reports = reportsByPost.get(post.id) ?? [];
    const byReason = new Map<string, number>();
    const byReporter = new Set<ID>();
    const notes: string[] = [];
    for (const report of reports) {
      byReporter.add(report.reporter_id);
      byReason.set(report.reason, (byReason.get(report.reason) ?? 0) + 1);
      const note = (report.details ?? '').trim();
      if (note) notes.push(note);
    }
    const state = ((post as { review_state?: string | null }).review_state ??
      'temporary_review') as ReviewState;
    return {
      postId: post.id,
      authorId: post.author_id,
      authorUsername: username.get(post.author_id) ?? 'unknown',
      caption: post.caption,
      video: isVideoPost(post),
      state,
      startedAt: (post as { review_started_at?: string | null }).review_started_at ?? null,
      expiresAt: (post as { review_expires_at?: string | null }).review_expires_at ?? null,
      uniqueReports: byReporter.size,
      reasons: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      notes: notes.slice(0, 10),
      history: eventsByPost.get(post.id) ?? [],
    } satisfies ReviewItem;
  });

  // Whatever is closest to expiring needs a human first.
  return items.sort((a, b) => {
    const at = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const bt = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    return at - bt;
  });
}

/** Takes a post out of review. Used by every admin decision below. */
async function endReview(postId: ID): Promise<void> {
  await patchReview(postId, { review_state: null, review_expires_at: null });
  refreshCommunity();
}

/**
 * An admin looked and it is fine. The post comes back now rather than in
 * however many hours were left.
 */
export async function restoreReviewed(postId: ID, adminId: ID): Promise<void> {
  const post = await db().get('posts', postId);
  if (!post) return;
  await endReview(postId);
  await record({
    targetType: 'post',
    targetId: postId,
    action: 'admin_restored',
    actorId: adminId,
    uniqueReports: (post as { review_reports?: number }).review_reports ?? 0,
    detail: 'Reviewed and restored by an administrator.',
  });
}

/**
 * An admin needs longer than the window allows.
 *
 * This is the one state with no clock on it. It exists so that "nobody got to
 * it in time" and "somebody is dealing with it" cannot be confused, and so
 * that a genuinely serious case does not reappear mid-investigation because 24
 * hours passed.
 */
export async function holdReviewed(postId: ID, adminId: ID): Promise<void> {
  const post = await db().get('posts', postId);
  if (!post) return;
  const stored = await patchReview(postId, {
    review_state: 'admin_hold',
    review_expires_at: null,
  });
  if (!stored) return;
  refreshCommunity();
  await record({
    targetType: 'post',
    targetId: postId,
    action: 'admin_held',
    actorId: adminId,
    uniqueReports: (post as { review_reports?: number }).review_reports ?? 0,
    detail: 'Held for further review by an administrator. No automatic expiry.',
  });
}

/**
 * Clears the reports that COUNT, so the same ones cannot hide the post again
 * the moment it is restored.
 *
 * It does not delete anything. Every report stays in the table with its
 * reason, its note and its reporter; `cleared_at` records that an admin looked
 * at that batch and decided it did not warrant hiding. A new report after this
 * counts again, from one.
 */
export async function clearReportThreshold(
  targetType: ReportTarget,
  targetId: ID,
  adminId: ID,
): Promise<number> {
  const reports = await activeReports(targetType, targetId);
  const now = new Date().toISOString();
  const unique = countUniqueReporters(reports);

  for (const report of reports) {
    try {
      await db().update('reports', report.id, { cleared_at: now });
    } catch (error) {
      if (isMissingColumn(error, 'reports', 'cleared_at') || isMissingRelation(error)) {
        noteMissing();
        return 0;
      }
      throw error;
    }
  }

  await record({
    targetType,
    targetId,
    action: 'admin_cleared_reports',
    actorId: adminId,
    uniqueReports: unique,
    detail:
      `Cleared ${reports.length} report${reports.length === 1 ? '' : 's'} from ` +
      `${unique} account${unique === 1 ? '' : 's'} toward the automatic threshold. ` +
      'The reports themselves are kept on the record.',
  });
  return reports.length;
}

/** Buckets rows by `target_id`, so one query can serve a page of items. */
function groupByTarget<T extends { target_id: ID }>(rows: T[]): Map<ID, T[]> {
  const out = new Map<ID, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.target_id);
    if (bucket) bucket.push(row);
    else out.set(row.target_id, [row]);
  }
  return out;
}
