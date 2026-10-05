import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MissingRelationError } from '@/lib/db/errors';
import { bigStyleOf, drawnAs } from '@/lib/text-posts';
import type { Post } from '@/lib/types';
import { insertPost, isTextPostNotStorable, TextPostNotStorableError, type InsertMemo } from './insert-post';

/**
 * A `posts` table at some point in its migrations, answering the way PostgREST
 * does: a column it does not have is PGRST204 naming that column, and a kind
 * its check constraint does not allow names the constraint.
 *
 * `names` decides WHICH missing column it complains about when there are
 * several, because PostgREST picks one and the code must not depend on which.
 */
function table({
  columns,
  kinds = ['short', 'story', 'long', 'big'],
  names = 'first',
}: {
  columns: string[];
  kinds?: string[];
  names?: 'first' | 'last';
}) {
  const stored: Post[] = [];
  const insert = async (row: Post) => {
    const unknown = Object.keys(row).filter((key) => !columns.includes(key));
    if (unknown.length > 0) {
      const column = names === 'first' ? unknown[0] : unknown[unknown.length - 1];
      throw new MissingRelationError(
        'posts',
        column,
        `[supabase:posts] Could not find the '${column}' column of 'posts' in the schema cache`,
      );
    }
    if (row.text_kind && !kinds.includes(row.text_kind)) {
      // The BODY check, not the kind check: on a 0011 database Postgres reaches
      // posts_text_body_check first, and its kinds do not include `story`
      // either. Measured against Postgres 16 with 0011 applied.
      throw new Error(
        '[supabase:posts] new row for relation "posts" violates check constraint "posts_text_body_check"',
      );
    }
    stored.push(structuredClone(row));
  };
  return { stored, insert };
}

const BASE = [
  'id', 'author_id', 'caption', 'media', 'category', 'tags', 'views',
  'content_warning', 'removed', 'removed_reason', 'created_at',
];
const WITH_0011 = [...BASE, 'text_kind', 'text_title'];
const WITH_0012 = [...WITH_0011, 'text_style'];

function post(text: Partial<Pick<Post, 'text_kind' | 'text_title' | 'text_style'>> & { caption?: string }): Post {
  const row: Post = {
    id: 'p1',
    author_id: 'u1',
    caption: text.caption ?? 'BIG TEST',
    media: [],
    category: 'Life',
    tags: [],
    views: 0,
    content_warning: false,
    removed: false,
    removed_reason: null,
    created_at: '2026-10-05T00:00:00.000Z',
  };
  // As createPost builds it: only the fields a text post actually has.
  if (text.text_kind) row.text_kind = text.text_kind;
  if (text.text_title) row.text_title = text.text_title;
  if (text.text_style) row.text_style = text.text_style;
  return row;
}

const memo = (): InsertMemo => ({ warningsStored: null });

/** Swallows the console.error a refusal writes, so the test output stays readable. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
}

describe('a migrated database keeps every text post exactly as written', () => {
  it('stores a big message with its kind and its colour', async () => {
    const db = table({ columns: WITH_0012 });
    await insertPost(post({ text_kind: 'big', text_style: 'violet' }), db.insert, memo());
    assert.equal(db.stored.length, 1);
    assert.equal(db.stored[0].text_kind, 'big');
    assert.equal(db.stored[0].text_style, 'violet');
  });

  it('stores every one of the four colours as itself', async () => {
    for (const style of ['glow', 'night', 'violet', 'dusk']) {
      const db = table({ columns: WITH_0012 });
      await insertPost(post({ text_kind: 'big', text_style: style }), db.insert, memo());
      assert.equal(bigStyleOf(db.stored[0].text_style), style);
    }
  });

  it('stores a story as a story, title and all', async () => {
    const db = table({ columns: WITH_0012 });
    await insertPost(
      post({ text_kind: 'story', text_title: 'A Tuesday', caption: 'It started…' }),
      db.insert,
      memo(),
    );
    assert.equal(db.stored[0].text_kind, 'story');
    assert.equal(db.stored[0].text_title, 'A Tuesday');
  });

  it('stores a short message as short', async () => {
    const db = table({ columns: WITH_0012 });
    await insertPost(post({ text_kind: 'short', caption: 'hi' }), db.insert, memo());
    assert.equal(db.stored[0].text_kind, 'short');
  });
});

describe('a database without 0011 never turns a big message into a short one', () => {
  for (const names of ['first', 'last'] as const) {
    it(`refuses a big message rather than store it kind-less (PostgREST names the ${names} missing column)`, async () => {
      const db = table({ columns: BASE, names });
      await quietly(() =>
        assert.rejects(
          insertPost(post({ text_kind: 'big', text_style: 'violet' }), db.insert, memo()),
          (error: unknown) => isTextPostNotStorable(error),
        ),
      );
      assert.equal(db.stored.length, 0, 'nothing was stored');
    });

    it(`refuses a big message in glow too, because without its kind it is a white bubble (${names})`, async () => {
      const db = table({ columns: BASE, names });
      await quietly(() =>
        assert.rejects(
          insertPost(post({ text_kind: 'big', text_style: 'glow' }), db.insert, memo()),
          TextPostNotStorableError,
        ),
      );
      assert.equal(db.stored.length, 0);
    });

    it(`refuses a story, which would lose its title for good (${names})`, async () => {
      const db = table({ columns: BASE, names });
      await quietly(() =>
        assert.rejects(
          insertPost(post({ text_kind: 'story', text_title: 'A Tuesday' }), db.insert, memo()),
          TextPostNotStorableError,
        ),
      );
      assert.equal(db.stored.length, 0);
    });
  }

  it('still posts a short message, which reads back drawn exactly the same', async () => {
    const db = table({ columns: BASE });
    await insertPost(post({ text_kind: 'short', caption: 'hello' }), db.insert, memo());
    assert.equal(db.stored.length, 1);
    assert.equal('text_kind' in db.stored[0], false);
    assert.equal(drawnAs(db.stored[0]), 'short');
  });

  it('leaves a photo or video post alone: it never sends a text column', async () => {
    const db = table({ columns: BASE });
    const media = post({ caption: 'look' });
    media.media = [{ kind: 'image', url: 'https://x/y.jpg' }];
    await insertPost(media, db.insert, memo());
    assert.equal(db.stored.length, 1);
  });
});

describe('a database that ran the earlier 0011, which knew a story only as long', () => {
  const only0011 = () => table({ columns: WITH_0011, kinds: ['short', 'long', 'big'] });

  it('stores a story under its first name, and it reads back as a story', async () => {
    const db = only0011();
    await insertPost(
      post({ text_kind: 'story', text_title: 'A Tuesday', caption: 'It started…' }),
      db.insert,
      memo(),
    );
    assert.equal(db.stored[0].text_kind, 'long');
    assert.equal(db.stored[0].text_title, 'A Tuesday');
    assert.equal(drawnAs(db.stored[0]), 'story');
  });

  it('stores a big message in glow, which is what no colour means', async () => {
    const db = only0011();
    await insertPost(post({ text_kind: 'big', text_style: 'glow' }), db.insert, memo());
    assert.equal(db.stored[0].text_kind, 'big');
    assert.equal(bigStyleOf(db.stored[0].text_style), 'glow');
  });

  it('refuses a big message in any other colour rather than reset it to glow', async () => {
    for (const style of ['night', 'violet', 'dusk']) {
      const db = only0011();
      await quietly(() =>
        assert.rejects(
          insertPost(post({ text_kind: 'big', text_style: style }), db.insert, memo()),
          (error: unknown) =>
            isTextPostNotStorable(error) && (error as TextPostNotStorableError).column === 'text_style',
        ),
      );
      assert.equal(db.stored.length, 0, style);
    }
  });
});

describe('running the migration takes effect on the next post', () => {
  it('does not remember a missing text column the way it remembers content warnings', async () => {
    const shared = memo();
    const before = table({ columns: BASE });
    await quietly(() =>
      assert.rejects(
        insertPost(post({ text_kind: 'big', text_style: 'violet' }), before.insert, shared),
        TextPostNotStorableError,
      ),
    );
    // Same server, same memo — the migration has just been run.
    const after = table({ columns: WITH_0012 });
    await insertPost(post({ text_kind: 'big', text_style: 'violet' }), after.insert, shared);
    assert.equal(after.stored[0].text_kind, 'big');
    assert.equal(after.stored[0].text_style, 'violet');
  });
});

describe('everything else is as it was', () => {
  it('still drops a missing content warning column and remembers it', async () => {
    const shared = memo();
    const db = table({ columns: BASE.filter((column) => column !== 'content_warning') });
    await quietly(() => insertPost(post({ caption: 'x' }), db.insert, shared));
    assert.equal(db.stored.length, 1);
    assert.equal(shared.warningsStored, false);
  });

  it('rethrows a failure that is not about a missing column', async () => {
    const boom = new Error('[supabase:posts] connection reset');
    await assert.rejects(
      insertPost(post({ text_kind: 'short' }), async () => {
        throw boom;
      }, memo()),
      boom,
    );
  });

  it('recognises its refusal by name, whichever copy of the module threw it', () => {
    const copy = Object.assign(new Error('x'), { name: 'TextPostNotStorableError', column: 'text_kind' });
    assert.equal(isTextPostNotStorable(copy), true);
    assert.equal(isTextPostNotStorable(new Error('x')), false);
    assert.equal(isTextPostNotStorable(null), false);
  });
});
