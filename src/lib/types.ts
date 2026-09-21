/**
 * Core FayTarra domain types.
 *
 * These are intentionally plain, serialisable shapes: every storage driver
 * (local JSON in development, Supabase in production) stores exactly these
 * rows, so business logic never has to care which one is active.
 */

export type ID = string;
export type ISODate = string;

export const INTERESTS = [
  'Creator',
  'Musician',
  'Gamer',
  'Athlete',
  'Artist',
  'Entrepreneur',
  'Comedian',
  'Actor',
  'Photographer',
  'Fashion',
  'Food',
  'Fitness',
  'Education',
  'Other',
] as const;
export type Interest = (typeof INTERESTS)[number];

export const CATEGORIES = [
  'Gaming',
  'Music',
  'Comedy',
  'Fitness',
  'Art',
  'Business',
  'Sports',
  'Fashion',
  'Food',
  'Technology',
  'Education',
  'Photography',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const REACTIONS = [
  'Fire',
  'Funny',
  'Creative',
  'Interesting',
  'Love It',
  'Would Collaborate',
] as const;
export type Reaction = (typeof REACTIONS)[number];

export type RatingTarget = 'post' | 'user';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned';

export interface User {
  id: ID;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  bio: string;
  avatar_url: string | null;
  location: string | null;
  interests: Interest[];
  goal: string;
  role: UserRole;
  status: UserStatus;
  status_reason: string | null;
  points: number;
  /**
   * Rating integrity switch. An account a moderator has found to be
   * manipulating ratings keeps its own rating but stops carrying any weight
   * when it rates other people.
   */
  trusted: boolean;
  created_at: ISODate;
  last_active_at: ISODate;
}

/** A user as exposed to the client — never carries the password hash. */
export type PublicUser = Omit<User, 'password_hash' | 'email'> & { email?: string };

export type MediaKind = 'image' | 'video';

export interface Media {
  kind: MediaKind;
  url: string;
  /** Optional poster/thumbnail for video. */
  poster?: string;
}

export interface Post {
  id: ID;
  author_id: ID;
  caption: string;
  media: Media[];
  category: Category;
  tags: string[];
  challenge_id: ID | null;
  /** "GIVE ME A SHOT" — an explicit request to be discovered by the community. */
  shot: boolean;
  /**
   * How far a shot post has travelled through the staged exposure ladder
   * (see `src/lib/shot.ts`). 0 = still in the first 100-impression test.
   */
  shot_stage: number;
  /** Times this post has been put in front of someone by discovery. */
  impressions: number;
  /**
   * Reserved for paid exposure. Boosting can only ever buy impressions — it is
   * excluded from every rating and ranking calculation, and boosted posts are
   * labelled. Nothing sets this yet.
   */
  boosted: boolean;
  views: number;
  featured: boolean;
  featured_at: ISODate | null;
  removed: boolean;
  removed_reason: string | null;
  created_at: ISODate;
}

export interface Like {
  id: ID;
  post_id: ID;
  user_id: ID;
  created_at: ISODate;
}

export interface Comment {
  id: ID;
  post_id: ID;
  user_id: ID;
  body: string;
  removed: boolean;
  created_at: ISODate;
}

export interface Follow {
  id: ID;
  follower_id: ID;
  following_id: ID;
  created_at: ISODate;
}

export interface Block {
  id: ID;
  blocker_id: ID;
  blocked_id: ID;
  created_at: ISODate;
}

export interface Challenge {
  id: ID;
  slug: string;
  title: string;
  description: string;
  category: Category | 'Any';
  starts_at: ISODate;
  ends_at: ISODate;
  featured_post_ids: ID[];
  created_at: ISODate;
}

export type NotificationType =
  | 'follow'
  | 'rating'
  | 'like'
  | 'comment'
  | 'mention'
  | 'featured'
  | 'level_up'
  | 'challenge_ending'
  | 'challenge_entry';

export interface Notification {
  id: ID;
  user_id: ID;
  type: NotificationType;
  actor_id: ID | null;
  post_id: ID | null;
  challenge_id: ID | null;
  body: string;
  read: boolean;
  created_at: ISODate;
}

export type ReportTarget = 'post' | 'user' | 'comment';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface Report {
  id: ID;
  reporter_id: ID;
  target_type: ReportTarget;
  target_id: ID;
  reason: string;
  details: string;
  status: ReportStatus;
  resolution: string | null;
  created_at: ISODate;
}

/**
 * Append-only activity log. Powers FayTarra point history, the creator journey
 * timeline and the DAU/WAU/MAU numbers on the admin dashboard.
 */
export type ActivityType =
  | 'signup'
  | 'post'
  | 'rating_given'
  | 'rating_received'
  | 'like_given'
  | 'like_received'
  | 'comment_given'
  | 'comment_received'
  | 'follow_given'
  | 'follow_received'
  | 'challenge_entry'
  | 'featured'
  | 'daily_active'
  | 'level_up';

export interface Activity {
  id: ID;
  user_id: ID;
  type: ActivityType;
  points: number;
  post_id: ID | null;
  challenge_id: ID | null;
  created_at: ISODate;
}

/**
 * A single rating. One row per (rater, target) — rating again updates the row
 * rather than adding another, which is the first line of manipulation defence.
 */
export interface Rating {
  id: ID;
  rater_id: ID;
  target_type: RatingTarget;
  target_id: ID;
  /** The creator being rated. Denormalised so per-creator scans are one pass. */
  owner_id: ID;
  /** 1–10. */
  score: number;
  reactions: Reaction[];
  /** Integrity weight, 0–1, computed when the rating was cast. */
  weight: number;
  created_at: ISODate;
  updated_at: ISODate;
}

/** Monthly rank capture, so a profile can show its climb over time. */
export interface RankSnapshot {
  id: ID;
  user_id: ID;
  /** Calendar month, e.g. "2026-09". */
  period: string;
  overall_rank: number;
  current_rank: number;
  rising_rank: number;
  overall_rating: number;
  current_rating: number;
  created_at: ISODate;
}

export interface Session {
  user_id: ID;
  issued_at: number;
}
