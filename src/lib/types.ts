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
  /**
   * The three accounts this person picked as their favourites, in their order.
   * Empty or absent means the default: the first three accounts they followed.
   * Optional for the same reason as the colours — migration 0006 may not have
   * been run yet.
   */
  top_creators?: string[] | null;
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
  /**
   * Whether viewers hear this video.
   *
   * A playback property, not a change to the file. Re-encoding a two-minute
   * video to silence its audio track costs a two-minute pass in the browser —
   * the same real-time render the trim needs — and "the viewer hears nothing" is
   * what somebody turning the sound off actually means. The audio is still in
   * the file; nothing plays it.
   */
  muted?: boolean;
  /**
   * Words over the video, drawn by the player.
   *
   * Also deliberately not burnt in. `needsRender` returns false for an untouched
   * recording, which is the only reason a two-minute take does not cost a
   * two-minute re-encode before it can be uploaded; burning text in would flip
   * that for every video that has any. Drawn at playback instead: free, and
   * still editable afterwards.
   *
   * The trade-off, stated because it is real: the text is not in the file, so a
   * downloaded copy does not carry it.
   */
  text?: TextOverlay[];
}

/** One line of text over a video: where it sits, when it shows, how it looks. */
export interface TextOverlay {
  text: string;
  /**
   * The centre of the line, as fractions of the frame — 0.5, 0.5 is the middle.
   *
   * Free placement, dragged on the video itself. This used to be three stops
   * (top, middle, bottom) on the reasoning that a thumb is not a precise
   * instrument; in practice the three stops were the imprecise part, because the
   * one place somebody wants a line is beside the thing they are pointing at.
   * Kept away from the very edges when dragged, so a line cannot be lost off the
   * frame — see `clampOverlay`.
   */
  x: number;
  y: number;
  size: 'm' | 'l';
  /** From FayTarra's palette. Not a colour picker — an unbounded colour is how
   *  text ends up invisible on its own video. */
  tone: 'light' | 'dark' | 'fay';
  /**
   * When it appears and disappears, in seconds of the finished video.
   *
   * Both absent means the whole video, which is what every overlay made before
   * this existed means too. Drawn by the player rather than burnt into the file,
   * so a line that shows for three seconds still costs no render.
   */
  from?: number;
  to?: number;
  /**
   * The old three-stop position.
   *
   * Still read, never written: posts made before free placement carry it and no
   * `x`/`y`, and they have to keep looking the way their author left them. The
   * sanitiser turns it into coordinates on the way in, so there is one way to
   * draw an overlay rather than two.
   */
  at?: 'top' | 'middle' | 'bottom';
}

/** Where the three old stops sit, as coordinates. */
export const LEGACY_TEXT_SPOTS: Record<'top' | 'middle' | 'bottom', number> = {
  top: 0.16,
  middle: 0.5,
  bottom: 0.84,
};

/** The most overlays one video may carry. */
export const MAX_TEXT_OVERLAYS = 4;

/** The longest one line may be. */
export const MAX_TEXT_OVERLAY_LENGTH = 120;

export interface Post {
  id: ID;
  author_id: ID;
  caption: string;
  media: Media[];
  category: Category;
  tags: string[];
  views: number;
  /**
   * How many times the video on this post has actually been watched.
   *
   * Separate from `views` above, which counts the post page being opened and
   * has done since the beginning. This one counts PLAYBACK — somebody watching
   * the video past a threshold — and only video posts ever have it, because a
   * photo has nothing to play. The number is the database's: it is written by
   * one server-side path and never from a count a client sent.
   *
   * Optional because a database that has not had migration 0010 run against it
   * does not return the column, and a post from before it has never had one.
   */
  video_views?: number;
  /**
   * The author asked for this to stay covered until somebody chooses to see
   * it. Optional because a database without migration 0007 does not return
   * the column, and a post from before it has never had one.
   */
  content_warning?: boolean;
  /**
   * Which of the three shapes a text post is: short, long or big.
   *
   * Null for every post that is not one — a photo or a video — and also for a
   * text post written before kinds existed, which is drawn as `short`. See
   * lib/text-posts.ts. Optional because a database that has not run migration
   * 0011 does not return the column.
   */
  text_kind?: 'short' | 'story' | 'big' | 'long' | null;
  /** A story's title. Only ever set when `text_kind` is 'story'. */
  text_title?: string | null;
  /**
   * How a BIG message is coloured: glow, night, violet or dusk.
   *
   * Null for every other kind, and for a big message written before the colours
   * existed — which reads as `glow`, the quietest of the four. Optional because
   * a database that has not run migration 0012 does not return the column.
   */
  text_style?: string | null;
  removed: boolean;
  removed_reason: string | null;
  /**
   * Automatic temporary review. Null normally; 'temporary_review' while the
   * 24-hour clock runs; 'admin_hold' while an admin is looking, which no clock
   * undoes. Deliberately separate from `removed`: that is a decision, this is
   * a pause.
   */
  review_state?: 'temporary_review' | 'admin_hold' | null;
  review_started_at?: ISODate | null;
  review_expires_at?: ISODate | null;
  /** How many distinct accounts had reported it when the review started. */
  review_reports?: number;
  created_at: ISODate;
}

/**
 * One counted watch of one video.
 *
 * A row per view rather than a bare counter, because the counter alone cannot
 * answer "has this person already been counted for this playback session?" —
 * and without that answer a scroll back up a feed is a dozen more views. The
 * row is the dedupe record; `posts.video_views` is the total it keeps.
 *
 * `identity` is who watched, as far as this can be known: the account id when
 * somebody is signed in, and an opaque per-browser id when they are not.
 * Nothing here is shown to anybody.
 */
export interface VideoView {
  id: ID;
  post_id: ID;
  /** The signed-in account, or null for a visitor. */
  viewer_id: ID | null;
  /** Account id, or `anon:<opaque browser id>`. Dedupe and cooldown key on this. */
  identity: string;
  /** Identity plus the browser's playback-session key. Unique per counted view. */
  dedupe_key: string;
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
  /** From FayTarra itself — moderation decisions. No actor, never a reply. */
  | 'system'
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

/**
 * One line of the moderation record.
 *
 * Written, never updated: what happened, who did it, and when. `actor_id` is
 * null when FayTarra itself acted — the automatic hide, and the expiry.
 */
export interface ModerationEvent {
  id: ID;
  target_type: ReportTarget;
  target_id: ID;
  action: string;
  actor_id: ID | null;
  unique_reports: number;
  detail: string;
  created_at: ISODate;
}

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
  /**
   * When an admin cleared the active threshold this report counted toward.
   * Null means it still counts; set means it is history.
   */
  cleared_at?: ISODate | null;
}
