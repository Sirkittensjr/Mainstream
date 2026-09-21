/**
 * "Give me a shot" — staged exposure.
 *
 * A shot post is not promised virality. It is promised a *test*: a small slice
 * of the Discover audience. If the community responds well it graduates to a
 * bigger slice, and if it does not, it rests. Nobody can buy a stage.
 */

export const SHOT_STAGES = [100, 1_000, 10_000, 100_000] as const;

/** A post needs at least this rating to earn the next slice of audience. */
export const ADVANCE_RATING = 7.4;
/** Unrated posts can still advance on raw engagement rate. */
export const ADVANCE_ENGAGEMENT = 0.05;

export type ShotStatus = 'testing' | 'expanding' | 'resting' | 'complete';

export interface ShotProgress {
  stage: number;
  /** Impressions that unlock the next stage. */
  cap: number;
  impressions: number;
  /** 0–100 through the current stage. */
  progress: number;
  status: ShotStatus;
  label: string;
}

export function shotProgress(
  post: { shot: boolean; shot_stage: number; impressions: number },
  rating: number | null,
  engagementRate: number,
): ShotProgress | null {
  if (!post.shot) return null;
  const stage = Math.min(post.shot_stage, SHOT_STAGES.length - 1);
  const cap = SHOT_STAGES[stage];
  const reached = post.impressions >= cap;
  const qualifies = rating != null ? rating >= ADVANCE_RATING : engagementRate >= ADVANCE_ENGAGEMENT;

  let status: ShotStatus = 'testing';
  if (post.shot_stage >= SHOT_STAGES.length - 1 && reached) status = 'complete';
  else if (reached && !qualifies) status = 'resting';
  else if (post.shot_stage > 0) status = 'expanding';

  return {
    stage,
    cap,
    impressions: post.impressions,
    progress: Math.min(100, Math.round((post.impressions / cap) * 100)),
    status,
    label: `${formatCap(cap)} impressions`,
  };
}

/**
 * Decides whether a post has earned the next slice. Called as impressions are
 * recorded, so graduation happens in the same place exposure is handed out.
 */
export function shouldAdvance(
  post: { shot_stage: number; impressions: number },
  rating: number | null,
  engagementRate: number,
): boolean {
  if (post.shot_stage >= SHOT_STAGES.length - 1) return false;
  if (post.impressions < SHOT_STAGES[post.shot_stage]) return false;
  return rating != null ? rating >= ADVANCE_RATING : engagementRate >= ADVANCE_ENGAGEMENT;
}

/** A post that failed its test stops taking rotation slots from other people. */
export function isResting(
  post: { shot_stage: number; impressions: number },
  rating: number | null,
  engagementRate: number,
): boolean {
  const cap = SHOT_STAGES[Math.min(post.shot_stage, SHOT_STAGES.length - 1)];
  if (post.impressions < cap) return false;
  return !shouldAdvance(post, rating, engagementRate);
}

export function formatCap(cap: number): string {
  if (cap >= 1_000_000) return `${cap / 1_000_000}M`;
  if (cap >= 1_000) return `${cap / 1_000}k`;
  return String(cap);
}
