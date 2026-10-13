import type {
  Block,
  Comment,
  Follow,
  HashtagRecord,
  Like,
  Message,
  ModerationEvent,
  Notification,
  Post,
  PostHashtag,
  Rating,
  Report,
  User,
  VideoView,
} from '@/lib/types';

/** Every collection FayTarra persists. Table names match the Supabase schema. */
export interface Schema {
  users: User;
  posts: Post;
  likes: Like;
  comments: Comment;
  follows: Follow;
  blocks: Block;
  ratings: Rating;
  notifications: Notification;
  reports: Report;
  messages: Message;
  moderation_events: ModerationEvent;
  video_views: VideoView;
  hashtags: HashtagRecord;
  post_hashtags: PostHashtag;
}

export type TableName = keyof Schema;
export type Row<T extends TableName> = Schema[T];

export interface QueryOptions<T> {
  /** Equality filters, ANDed together. */
  where?: Partial<T>;
  /** Rows whose column value is any of the listed values. */
  in?: { [K in keyof T]?: readonly T[K][] };
  /** Rows whose (text) column value starts with the given text. */
  startsWith?: { [K in keyof T]?: string };
  orderBy?: keyof T;
  desc?: boolean;
  limit?: number;
}

/** The columns of a row that hold a number, and so can be counted up. */
export type CounterColumn<R> = {
  [K in keyof R]-?: NonNullable<R[K]> extends number ? K : never;
}[keyof R] &
  string;

/**
 * The entire storage contract. Deliberately tiny: ranking, feed mixing and the
 * rating maths all live in plain TypeScript on top of these primitives so that
 * swapping drivers can never change product behaviour.
 */
export interface Driver {
  readonly name: 'local' | 'supabase';
  query<T extends TableName>(table: T, options?: QueryOptions<Row<T>>): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>;
  insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>>;
  insertMany<T extends TableName>(table: T, rows: Row<T>[]): Promise<Row<T>[]>;
  update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<Row<T>>,
  ): Promise<Row<T> | null>;
  remove<T extends TableName>(table: T, id: string): Promise<void>;
  /**
   * Deletes the rows matching every one of `where`'s columns, as ONE statement,
   * and returns how many went.
   *
   * For a delete whose condition is the point — "this post, and only if it is
   * this person's" — so the check and the delete cannot be pulled apart: there
   * is no window between reading a row and removing it in which the row could
   * be anybody else's. An empty `where` deletes nothing.
   */
  removeWhere<T extends TableName>(table: T, where: Partial<Row<T>>): Promise<number>;
  /**
   * Updates the rows matching every one of `where`'s columns, as ONE
   * statement, and returns how many changed.
   *
   * The update for a state change whose condition is the point — "hide this
   * post only if nothing has hidden it yet", "lift the hold only if it is still
   * the report hold" — so two requests racing each other cannot both make the
   * same change, or undo one another's. A `null` in `where` matches a column
   * that is null (or absent). An empty `where` changes nothing.
   */
  updateWhere<T extends TableName>(
    table: T,
    where: Partial<Row<T>>,
    patch: Partial<Row<T>>,
  ): Promise<number>;
  /**
   * Adds `by` to one number on one row, as ONE statement, and returns what it
   * now holds — or null when there is no such row.
   *
   * For a counter two requests can move at the same moment. Reading the row,
   * adding one and writing it back loses one of two simultaneous views; this
   * cannot, because the database does the adding.
   */
  increment<T extends TableName>(
    table: T,
    id: string,
    column: CounterColumn<Row<T>>,
    by?: number,
  ): Promise<number | null>;
  /**
   * Stores one counted video view AND adds it to its post's total, as one
   * operation: both happen, or neither does.
   *
   * The two used to be separate writes, and the gap between them lost views:
   * when the total failed to move after the row was stored, the player's retry
   * found the row, was told "already counted", and that view was never added
   * to the number anybody sees. Now a failure leaves nothing behind, so the
   * same report can always be sent again.
   *
   * `counted` is false when a view with this `dedupe_key` is already stored —
   * an earlier copy of the same report got there first — and `total` is then
   * the stored total. `total` is null when there is no such post.
   */
  recordView(view: VideoView): Promise<{ counted: boolean; total: number | null }>;
  /** Wipe every table. Used by the seed script. */
  clear(): Promise<void>;
  /** Persist an uploaded file, returning a URL the app can render. */
  putMedia(fileName: string, contentType: string, data: Uint8Array): Promise<string>;
}
