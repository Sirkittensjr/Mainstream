import 'server-only';
import { db, isMissingRelation } from '@/lib/db';
import { newId } from '@/lib/ids';
import { notify } from './notifications';
import type { ID, Report, ReportTarget } from '@/lib/types';
import {
  REVIEW_WINDOW_HOURS,
  REVIEW_WINDOW_MS,
  clampWindow,
  describeWindow,
  isMissingReviewColumn,
  underReview,
  type ModerationAction,
  type ReviewState,
} from '@/lib/auto-review-rules';

// The rules themselves live in lib/auto-review-rules.ts, which has no database
// and no `server-only`, so they can be tested and so the admin screens can
// explain the threshold without importing a service. Re-exported here so
// callers have one place to import from.
export { REVIEW_WINDOW_HOURS, underReview, type ModerationAction, type ReviewState };

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

/**
 * The message the author gets when a report hides their post.
 *
 * A NOTIFICATION, not a direct message. Direct messages on FayTarra require
 * the two people to follow each other, enforced by a trigger on the table as
 * well as in the service — and that rule is not being bent so that FayTarra
 * can talk to somebody. A notification reaches anybody, is one-way by
 * construction, and cannot be replied to as though it were a conversation.
 * It never says who reported it, or what they wrote.
 */
export async function tellAuthorHidden(authorId: ID, postId: ID, video: boolean): Promise<void> {
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body:
      `Your ${video ? 'video' : 'post'} is temporarily hidden pending review by FayTarra ` +
      'moderation, after several reports. Nothing has been decided yet, and nothing has been deleted.',
  });
}

/** An administrator took it out of public view, pending review, and says why. */
export async function tellAuthorHiddenByAdmin(
  authorId: ID,
  postId: ID,
  video: boolean,
  reason: string,
): Promise<void> {
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body:
      `Your ${video ? 'video' : 'post'} was removed from public viewing by FayTarra moderation ` +
      `pending review. Reason: ${reason}`,
  });
}

/** The message when a moderator looked and the post is back. */
export async function tellAuthorRestored(authorId: ID, postId: ID, video: boolean): Promise<void> {
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body: `Your ${video ? 'video' : 'post'} was reviewed by FayTarra moderation and is visible again.`,
  });
}

/** Does this post lead with a video? Only changes the word in a message. */
export function isVideoPost(post: { media?: unknown }): boolean {
  const media = Array.isArray(post.media) ? post.media : [];
  return media.some((item) => (item as { kind?: string })?.kind === 'video');
}

/** The message after an admin decides it stays off FayTarra — kept removed, or deleted. */
export async function tellAuthorRemoved(
  authorId: ID,
  postId: ID,
  video: boolean,
  reason?: string,
): Promise<void> {
  await notify({
    userId: authorId,
    type: 'system',
    postId,
    body:
      `Your ${video ? 'video' : 'post'} was removed by FayTarra moderation ` +
      'because it violated our community guidelines.' +
      (reason ? ` Reason: ${reason}` : ''),
  });
}
