import type {
  Block,
  Comment,
  Follow,
  Like,
  Message,
  Notification,
  Post,
  Rating,
  Report,
  User,
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
}

export type TableName = keyof Schema;
export type Row<T extends TableName> = Schema[T];

export interface QueryOptions<T> {
  /** Equality filters, ANDed together. */
  where?: Partial<T>;
  /** Rows whose column value is any of the listed values. */
  in?: { [K in keyof T]?: readonly T[K][] };
  orderBy?: keyof T;
  desc?: boolean;
  limit?: number;
}

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
  /** Wipe every table. Used by the seed script. */
  clear(): Promise<void>;
  /** Persist an uploaded file, returning a URL the app can render. */
  putMedia(fileName: string, contentType: string, data: Uint8Array): Promise<string>;
}
