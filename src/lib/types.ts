/**
 * Core RISE domain types.
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
  rise_points: number;
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
 * Append-only activity log. Powers RISE point history, the creator journey
 * timeline and the DAU/WAU/MAU numbers on the admin dashboard.
 */
export type ActivityType =
  | 'signup'
  | 'post'
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

export interface Session {
  user_id: ID;
  issued_at: number;
}
