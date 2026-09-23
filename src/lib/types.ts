/**
 * Core FayTarra domain types.
 *
 * Plain, serialisable shapes: every storage driver (local JSON in development,
 * Supabase in production) stores exactly these rows, so business logic never
 * has to care which one is active.
 */

export type ID = string;
export type ISODate = string;

/**
 * The categories a person can be into and be ranked within. One list, used for
 * profile interests, post categories and the category rankings — so "people
 * who post great music" and "the Music ranking" are the same idea.
 */
export const CATEGORIES = [
  'Gaming',
  'Music',
  'Art',
  'Comedy',
  'Sports',
  'Fitness',
  'Food',
  'Photography',
  'Fashion',
  'Business',
  'Technology',
  'Education',
  'Life',
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
  /** Same id as the Supabase Auth user. This row is the profile. */
  id: ID;
  /** Mirrored from auth.users so moderators can search by address. */
  email: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  location: string | null;
  /** What this person is into. Drives recommendations and category rankings. */
  interests: Category[];
  role: UserRole;
  status: UserStatus;
  status_reason: string | null;
  /**
   * Rating integrity switch. An account a moderator has found to be
   * manipulating ratings keeps its own rating but stops carrying any weight
   * when it rates other people.
   */
  trusted: boolean;
  /** When the @username last changed. Null means it never has. */
  username_changed_at: ISODate | null;
  /**
   * What this person painted their profile in: a key from
   * src/lib/profile-theme.ts, or null for the way FayTarra looks everywhere
   * else. Optional because a database that has not had migration 0005 run
   * against it simply does not return these columns.
   */
  profile_bg?: string | null;
  profile_box?: string | null;
  created_at: ISODate;
  last_active_at: ISODate;
}

/** A user as exposed to the client — never carries the email address. */
export type PublicUser = Omit<User, 'email'> & { email?: string };

export type MediaKind = 'image' | 'video';

export interface Media {
  kind: MediaKind;
  url: string;
  /** Optional poster/thumbnail for video. */
  poster?: string;
  /**
   * The picture's size, when it is known.
   *
   * Stored so a post can reserve the right shape of space before the file has
   * loaded. Without it every video is a guess, and the feed either jumps as
   * each one arrives or crops them all to one house aspect ratio — which is
   * not what a general social network should do to somebody's landscape video.
   */
  width?: number;
  height?: number;
  /** Seconds, for video. */
  duration?: number;
}

export interface Post {
  id: ID;
  author_id: ID;
  caption: string;
  media: Media[];
  category: Category;
  tags: string[];
  views: number;
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
  /**
   * The comment this is a reply to, if any. Threads are one level deep: a
   * reply to a reply attaches to the same parent, so a conversation stays
   * readable on a phone and stays moderatable.
   */
  parent_id: ID | null;
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

/**
 * A single rating, 1–10, of a post or a profile.
 *
 * One row per (rater, target): rating again updates the row rather than adding
 * another, which is the first line of manipulation defence.
 */
export interface Rating {
  id: ID;
  rater_id: ID;
  target_type: RatingTarget;
  target_id: ID;
  /** The person being rated. Denormalised so per-person scans are one pass. */
  owner_id: ID;
  score: number;
  reactions: Reaction[];
  /** Integrity weight, 0–1, computed when the rating was cast. */
  weight: number;
  created_at: ISODate;
  updated_at: ISODate;
}

export type NotificationType =
  | 'follow'
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'rating';

export interface Notification {
  id: ID;
  user_id: ID;
  type: NotificationType;
  actor_id: ID | null;
  post_id: ID | null;
  body: string;
  read: boolean;
  created_at: ISODate;
}

/**
 * A private message.
 *
 * Only ever exchanged between two people who follow each other. That rule is
 * enforced by a trigger on this table as well as in the service layer, so no
 * request can write a row that breaks it.
 */
export interface Message {
  id: ID;
  sender_id: ID;
  recipient_id: ID;
  body: string;
  read_at: ISODate | null;
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
