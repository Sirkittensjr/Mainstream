import { isMissingColumn } from '@/lib/db/errors';
import { survivesWithout, TEXT_COLUMNS, type TextColumn } from '@/lib/text-posts';
import type { Post } from '@/lib/types';

/**
 * Putting a post in the table when the table may be behind the code.
 *
 * Its own module, not part of posts.ts, so the rule can be tested: posts.ts is
 * server-only and reaches for cookies, and this needs nothing but a function
 * that inserts a row and throws what the driver throws.
 */

/**
 * A text post the database cannot store as it was written.
 *
 * Thrown instead of quietly saving something else. Matched by NAME as well as
 * class for the same reason as `isMissingRelation`: the action that catches it
 * may have been bundled with a different copy of this module.
 */
export class TextPostNotStorableError extends Error {
  readonly column: string;

  constructor(column: string) {
    super(`This database has no \`posts.${column}\` column, so the post cannot keep its shape.`);
    this.name = 'TextPostNotStorableError';
    this.column = column;
  }
}

export function isTextPostNotStorable(error: unknown): error is TextPostNotStorableError {
  return (
    error instanceof TextPostNotStorableError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'TextPostNotStorableError')
  );
}

/** Which migration adds each text column, for the message that names it. */
const TEXT_MIGRATION: Record<TextColumn, string> = {
  text_kind: '0011_text_posts.sql',
  text_title: '0011_text_posts.sql',
  text_style: '0012_text_post_styles.sql',
};

/**
 * True when the database refused `story` as a kind: it has run 0011, which only
 * knew the middle kind as `long`, but not 0012, which renamed it. Any of the
 * three text checks can be the one that says so — Postgres reports whichever it
 * evaluates first, and on a 0011 database that is the BODY check, whose kinds
 * do not include `story` either — and PostgREST passes the name through.
 */
const refusedStory = (error: unknown) =>
  error instanceof Error && /posts_text_(kind|body|title)_check/.test(error.message);

/** What survives between inserts: only the content warning's absence. */
export interface InsertMemo {
  warningsStored: boolean | null;
}

/**
 * Inserts `post`, adapting to a database that is missing a column only where
 * doing so loses nothing, and throwing `TextPostNotStorableError` where it
 * would. Mutates `post` to what was actually stored.
 */
export async function insertPost(
  post: Post,
  insert: (row: Post) => Promise<unknown>,
  memo: InsertMemo,
): Promise<void> {
  if (memo.warningsStored === false) delete post.content_warning;

  /*
   * NO MEMO FOR THE TEXT COLUMNS. `content_warning` remembers its absence for
   * the life of the server, which is fine for a checkbox; for these it was the
   * other half of the bug — after running the migration, a warm server went on
   * stripping kinds until it happened to restart. A text post on a database
   * that is behind costs one failed insert, and one that has caught up works
   * from the next post.
   *
   * Bounded: every pass either removes a field the post was carrying, renames
   * `story` once, or throws.
   */
  let renamedStory = false;
  for (;;) {
    try {
      await insert(post);
      memo.warningsStored ??= true;
      return;
    } catch (error) {
      const column = TEXT_COLUMNS.find((name) => isMissingColumn(error, 'posts', name));
      if (column && column in post) {
        if (!survivesWithout(post, column)) {
          console.error(
            `[faytarra] A ${post.text_kind} message was refused rather than stored without its ` +
              `\`${column}\`: this database has no \`posts.${column}\` column. Run ` +
              `supabase/migrations/${TEXT_MIGRATION[column]} against it.`,
          );
          throw new TextPostNotStorableError(column);
        }
        // Nothing anybody can see depends on it — see `survivesWithout`.
        delete post[column];
        continue;
      }
      if (!renamedStory && post.text_kind === 'story' && refusedStory(error)) {
        // 0011 without 0012. `long` is the same kind under its first name, the
        // constraints of 0011 apply its limits and title rule to it, and it
        // reads back as `story`. Nothing is lost.
        renamedStory = true;
        post.text_kind = 'long';
        continue;
      }
      if (isMissingColumn(error, 'posts', 'content_warning') && 'content_warning' in post) {
        memo.warningsStored = false;
        console.error(
          '[faytarra] Content warnings are switched off: this database has no `content_warning` ' +
            'column on `posts`. Run supabase/migrations/0007_resumable_uploads.sql against it. ' +
            'Posting works as normal; the checkbox does nothing until then.',
        );
        delete post.content_warning;
        continue;
      }
      throw error;
    }
  }
}

