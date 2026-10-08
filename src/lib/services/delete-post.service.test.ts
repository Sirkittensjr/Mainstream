/**
 * Deleting your own post, checked against the real services and a real
 * (throwaway) local store, with real files on disk.
 *
 * The ••• menu only offers Delete on your own posts, but a server action can be
 * called with any post id — so who may delete what is decided here, and these
 * are the rules that have to hold whatever a request sends.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';

// Next's cache tags exist only inside a request; out here, refreshing one is a
// no-op and a cached function is just the function.
mock.module('next/cache', {
  namedExports: {
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: <T,>(fn: T) => fn,
  },
});

// Before anything touches the store: it picks its directory when it loads.
const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-delete-'));
process.env.FAYTARRA_DATA_DIR = dataDir;
const uploads = path.join(dataDir, 'uploads');

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let moderation: typeof import('./moderation');

function person(username: string) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    email: `${username}@example.com`,
    username,
    display_name: username,
    bio: '',
    avatar_url: null as string | null,
    location: null,
    interests: [],
    role: 'user' as const,
    status: 'active' as const,
    status_reason: null,
    trusted: false,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
  };
}

const alice = person('alice');
const bob = person('bob');
const admin = { ...person('admin'), role: 'admin' as const };

/** A real file in the local media folder, and the URL a post would hold for it. */
function file(name: string): string {
  mkdirSync(uploads, { recursive: true });
  writeFileSync(path.join(uploads, name), 'bytes');
  return `/api/media/${name}`;
}
const onDisk = (url: string) => existsSync(path.join(uploads, path.basename(url)));

const KINDS = {
  photo: () => ({ media: [{ kind: 'image' as const, url: file(`${crypto.randomUUID()}.jpg`) }] }),
  video: () => ({
    media: [
      {
        kind: 'video' as const,
        url: file(`${crypto.randomUUID()}.webm`),
        poster: file(`${crypto.randomUUID()}.jpg`),
        duration: 3,
      },
    ],
  }),
  short: () => ({ media: [], textKind: 'short' as const }),
  story: () => ({ media: [], textKind: 'story' as const, textTitle: 'A story' }),
  big: () => ({ media: [], textKind: 'big' as const }),
};

async function postOf(kind: keyof typeof KINDS, authorId = alice.id) {
  return posts.createPost({
    authorId,
    caption: `a ${kind} post`,
    category: 'Life',
    tags: [],
    ...KINDS[kind](),
  });
}

before(async () => {
  posts = await import('./posts');
  moderation = await import('./moderation');
  store = (await import('@/lib/db')).db();
  for (const each of [alice, bob, admin]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('an author can delete every kind of post they made', () => {
  for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
    it(`a ${kind} post`, async () => {
      const post = await postOf(kind);
      const files = post.media.flatMap((m) => [m.url, m.poster].filter(Boolean) as string[]);
      const result = await posts.deletePost(post.id, alice.id);
      assert.equal(result.ok, true);
      assert.equal(await store.get('posts', post.id), null);
      assert.equal(
        (await posts.postsByAuthor(alice.id, alice)).some((p) => p.id === post.id),
        false,
        'gone from the profile',
      );
      for (const url of files) assert.equal(onDisk(url), false, `${url} deleted`);
    });
  }

  it('a video post takes its poster with it, not just the video', async () => {
    const post = await postOf('video');
    const { url, poster } = post.media[0];
    const result = await posts.deletePost(post.id, alice.id);
    assert.ok(result.ok);
    assert.deepEqual(new Set(result.media.removed), new Set([url, poster]));
  });
});

describe('nobody can delete a post that is not theirs', () => {
  it('refuses another account, and touches nothing', async () => {
    const post = await postOf('photo');
    await posts.toggleLike(post.id, bob.id);
    const result = await posts.deletePost(post.id, bob.id);
    assert.deepEqual(result, { ok: false, reason: 'not_yours' });
    assert.ok(await store.get('posts', post.id), 'still there');
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 1);
    assert.equal(onDisk(post.media[0].url), true, 'file untouched');
  });

  it('an admin account is not an author either — moderation has its own tools', async () => {
    const post = await postOf('short');
    assert.deepEqual(await posts.deletePost(post.id, admin.id), { ok: false, reason: 'not_yours' });
    assert.ok(await store.get('posts', post.id));
  });

  it('an id that does not exist, or is not an id at all, deletes nothing', async () => {
    const before = (await store.query('posts')).length;
    for (const id of [crypto.randomUUID(), '', 'x\'; drop table posts; --', '../../etc/passwd']) {
      assert.deepEqual(await posts.deletePost(id, alice.id), { ok: false, reason: 'not_found' });
    }
    assert.equal((await store.query('posts')).length, before);
  });

  it('no signed-in account means no delete', async () => {
    const post = await postOf('short');
    assert.deepEqual(await posts.deletePost(post.id, ''), { ok: false, reason: 'not_found' });
    assert.ok(await store.get('posts', post.id));
  });

  it('a post a moderator removed stays as the record, even for its author', async () => {
    const post = await postOf('photo');
    await moderation.removePost(post.id, 'Spam', admin.id);
    assert.deepEqual(await posts.deletePost(post.id, alice.id), { ok: false, reason: 'moderated' });
    assert.ok(await store.get('posts', post.id));
    assert.equal(onDisk(post.media[0].url), true);
    // And the moderator's own tools still work on it.
    await moderation.restorePost(post.id, admin.id);
    assert.equal((await store.get('posts', post.id))?.removed, false);
  });

  it('the delete itself is conditional on the author, not just the check before it', async () => {
    const post = await postOf('short');
    assert.equal(await store.removeWhere('posts', { id: post.id, author_id: bob.id }), 0);
    assert.ok(await store.get('posts', post.id));
    assert.equal(await store.removeWhere('posts', {}), 0, 'an empty condition deletes nothing');
    assert.ok(await store.get('posts', post.id));
  });
});

describe('what hung off a deleted post', () => {
  it('likes, comments and replies, ratings, notifications and views go with it', async () => {
    const post = await postOf('video');
    const other = await postOf('short');
    const now = new Date().toISOString();
    await posts.toggleLike(post.id, bob.id);
    await posts.toggleLike(other.id, bob.id);
    assert.ok((await posts.addComment(post.id, bob.id, 'nice')).ok);
    const [comment] = await store.query('comments', { where: { post_id: post.id } });
    assert.ok((await posts.addComment(post.id, alice.id, 'thanks', comment.id)).ok);
    assert.equal((await store.query('comments', { where: { post_id: post.id } })).length, 2);
    await store.insert('ratings', {
      id: crypto.randomUUID(),
      rater_id: bob.id,
      target_type: 'post',
      target_id: post.id,
      owner_id: alice.id,
      score: 8,
      reactions: [],
      weight: 1,
      created_at: now,
      updated_at: now,
    });
    await store.insert('video_views', {
      id: crypto.randomUUID(),
      post_id: post.id,
      viewer_id: bob.id,
      identity: bob.id,
      dedupe_key: `${bob.id}:1`,
      created_at: now,
    });
    assert.ok((await store.query('notifications', { where: { post_id: post.id } })).length > 0);

    assert.ok((await posts.deletePost(post.id, alice.id)).ok);

    for (const [table, where] of [
      ['likes', { post_id: post.id }],
      ['comments', { post_id: post.id }],
      ['notifications', { post_id: post.id }],
      ['video_views', { post_id: post.id }],
      ['ratings', { target_id: post.id }],
    ] as const) {
      assert.equal((await store.query(table, { where: where as never })).length, 0, table);
    }
    // Somebody else's post is untouched.
    assert.equal((await store.query('likes', { where: { post_id: other.id } })).length, 1);
    assert.ok(await store.get('posts', other.id));
  });

  it('reports stay as the record, resolved, and the moderation log says what happened', async () => {
    const post = await postOf('photo');
    await moderation.submitReport({
      reporterId: bob.id,
      targetType: 'post',
      targetId: post.id,
      reason: 'Spam',
      details: '',
    });
    assert.ok((await posts.deletePost(post.id, alice.id)).ok);
    const reports = await store.query('reports', { where: { target_id: post.id } });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, 'resolved');
    assert.match(reports[0].resolution ?? '', /author deleted/i);
    const log = await store.query('moderation_events', { where: { target_id: post.id } });
    assert.ok(log.some((row) => row.action === 'author_deleted' && row.actor_id === alice.id));
    // The queue still lists it, with nothing left to act on.
    const queued = (await moderation.listReports('all')).find((r) => r.report.target_id === post.id);
    assert.ok(queued);
    assert.equal(queued.target, null);
  });

  it('an unreported post leaves no moderation trail', async () => {
    const post = await postOf('short');
    assert.ok((await posts.deletePost(post.id, alice.id)).ok);
    assert.equal((await store.query('moderation_events', { where: { target_id: post.id } })).length, 0);
  });
});

describe('a deleted post’s files', () => {
  it('a file another post still uses is kept until that post goes too', async () => {
    const shared = file(`${crypto.randomUUID()}.jpg`);
    const first = await posts.createPost({
      authorId: alice.id,
      caption: 'one',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: shared }],
    });
    const second = await posts.createPost({
      authorId: alice.id,
      caption: 'two',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: shared }],
    });
    const once = await posts.deletePost(first.id, alice.id);
    assert.ok(once.ok);
    assert.deepEqual(once.media.kept, [shared]);
    assert.equal(onDisk(shared), true);
    const twice = await posts.deletePost(second.id, alice.id);
    assert.ok(twice.ok);
    assert.deepEqual(twice.media.removed, [shared]);
    assert.equal(onDisk(shared), false);
  });

  it('a file that is somebody’s profile picture is kept', async () => {
    const picture = file(`${crypto.randomUUID()}.jpg`);
    await store.update('users', bob.id, { avatar_url: picture });
    const post = await posts.createPost({
      authorId: alice.id,
      caption: 'pic',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: picture }],
    });
    assert.ok((await posts.deletePost(post.id, alice.id)).ok);
    assert.equal(onDisk(picture), true);
    await store.update('users', bob.id, { avatar_url: null });
  });

  it('a file a moderator-removed post still holds is kept: it could be restored', async () => {
    const held = file(`${crypto.randomUUID()}.jpg`);
    const removed = await posts.createPost({
      authorId: alice.id,
      caption: 'removed',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: held }],
    });
    await moderation.removePost(removed.id, 'Spam', admin.id);
    const mine = await posts.createPost({
      authorId: alice.id,
      caption: 'same file',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: held }],
    });
    assert.ok((await posts.deletePost(mine.id, alice.id)).ok);
    assert.equal(onDisk(held), true);
  });

  it('pictures FayTarra did not store are never touched', async () => {
    const post = await posts.createPost({
      authorId: alice.id,
      caption: 'seed cover',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: '/api/cover/Life-alice-1' }],
    });
    const result = await posts.deletePost(post.id, alice.id);
    assert.ok(result.ok);
    assert.deepEqual(result.media.removed, []);
  });
});

describe('the rest of the profile', () => {
  it('keeps working, in order, after one of its posts is deleted', async () => {
    const author = person('carol');
    await store.insert('users', author);
    const made = [];
    for (const kind of ['photo', 'short', 'video', 'story', 'big'] as const) {
      made.push(await postOf(kind, author.id));
    }
    assert.ok((await posts.deletePost(made[2].id, author.id)).ok);
    const left = await posts.postsByAuthor(author.id, author);
    assert.deepEqual(
      left.map((p) => p.id),
      [made[4], made[3], made[1], made[0]].map((p) => p.id),
    );
    const views = await posts.hydratePosts(left, author.id);
    assert.equal(views.length, 4);
  });
});
