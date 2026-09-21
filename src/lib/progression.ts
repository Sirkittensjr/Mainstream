/**
 * The FayTarra progression system.
 *
 * Points come from participation only — there is no way to buy them. Every
 * award is written to the `activity` table so a creator can always see exactly
 * where their progress came from.
 */

export const POINTS = {
  post: 10,
  like_received: 2,
  comment_received: 3,
  follow_received: 5,
  like_given: 1,
  comment_given: 1,
  follow_given: 1,
  challenge_entry: 25,
  featured: 100,
  daily_active: 5,
} as const;

export type PointReason = keyof typeof POINTS;

export interface Level {
  level: number;
  name: string;
  minPoints: number;
  blurb: string;
}

export const LEVELS: Level[] = [
  { level: 1, name: 'Rookie', minPoints: 0, blurb: 'Day one. Everyone starts here.' },
  { level: 2, name: 'Rising', minPoints: 100, blurb: 'People are starting to notice.' },
  { level: 3, name: 'Breakout', minPoints: 400, blurb: 'Your posts are travelling.' },
  { level: 4, name: 'Creator', minPoints: 1000, blurb: 'You show up and it shows.' },
  { level: 5, name: 'Featured', minPoints: 2500, blurb: 'FayTarra puts you in front of people.' },
  { level: 6, name: 'Elite', minPoints: 6000, blurb: 'Top of your category.' },
  { level: 7, name: 'Icon', minPoints: 15000, blurb: 'Known for something.' },
];

export function levelFor(points: number): Level {
  let current = LEVELS[0];
  for (const level of LEVELS) if (points >= level.minPoints) current = level;
  return current;
}

export function nextLevel(points: number): Level | null {
  return LEVELS.find((level) => level.minPoints > points) ?? null;
}

/** 0–100 progress towards the next level (100 when already at Icon). */
export function levelProgress(points: number): number {
  const current = levelFor(points);
  const next = nextLevel(points);
  if (!next) return 100;
  const span = next.minPoints - current.minPoints;
  return Math.max(0, Math.min(100, Math.round(((points - current.minPoints) / span) * 100)));
}

export function pointsToNextLevel(points: number): number {
  const next = nextLevel(points);
  return next ? next.minPoints - points : 0;
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

/** Follower milestones used by the creator journey. */
export const FOLLOWER_MILESTONES = [0, 10, 100, 1_000, 10_000, 100_000];

export function nextFollowerGoal(followers: number): number {
  return FOLLOWER_MILESTONES.find((m) => m > followers) ?? followers + 100_000;
}
