/**
 * Video views, checked against the real services and a real (throwaway) local
 * store: what a player's report does to the number the database holds.
 *
 * The player half — when a report is sent at all — is covered by the tracker
 * tests in lib/video/views.test.ts. These are the server half: that a report
 * actually moves the stored total, that the total is still there when it is
 * read back, and that the duplicates a real browser sends do not inflate it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-views-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let views: typeof import('./video-views');
let rules: typeof import('@/lib/video/views');

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

const author = person('viewsauthor');
const watcher = person('viewswatcher');

async function video(caption = 'a clip') {
  return posts.createPost({
    authorId: author.id,
    caption,
    category: 'Life',
    tags: [],
    media: [{ kind: 'video', url: '/api/media/clip.webm', duration: 8 }],
  });
}

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);

/** The number the database holds for a post, read fresh. */
async function stored(postId: string) {
  return (await store.get('posts', postId))?.video_views ?? 0;
}

/** The number in the file on disk — what a restart or a refresh would read. */
async function onDisk(postId: string): Promise<number> {
  // The local store coalesces writes onto the next tick.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'faytarra.json'), 'utf8')) as {
    posts: { id: string; video_views?: number }[];
  };
  return saved.posts.find((post) => post.id === postId)?.video_views ?? 0;
}

before(async () => {
  posts = await import('./posts');
  views = await import('./video-views');
  rules = await import('@/lib/video/views');
  store = (await import('@/lib/db')).db();
  for (const each of [author, watcher]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('a view is stored', () => {
  it('moves the count by one, in the database, and it is still there afterwards', async () => {
    const post = await video();
    const result = await views.recordVideoView({
      postId: post.id,
      viewerId: watcher.id,
      browserId: null,
      sessionKey: 'session-aaaaaaaa',
      now: T0,
    });
    assert.deepEqual(result, { count: 1, counted: true });
    assert.equal(await stored(post.id), 1);
    assert.equal(await onDisk(post.id), 1, 'written to the store file, so a refresh reads it');
    assert.equal(
      (await store.query('video_views', { where: { post_id: post.id } })).length,
      1,
      'one view row',
    );
  });

  it('counts a visitor who is not signed in, by their browser', async () => {
    const post = await video();
    const result = await views.recordVideoView({
      postId: post.id,
      viewerId: null,
      browserId: 'browser-1',
      sessionKey: 'session-bbbbbbbb',
      now: T0,
    });
    assert.equal(result.counted, true);
    assert.equal(await stored(post.id), 1);
  });

  it('shows the stored count wherever the post is drawn, even from a stale copy', async () => {
    const post = await video();
    const stale = { ...post };
    await views.recordVideoView({
      postId: post.id,
      viewerId: watcher.id,
      browserId: null,
      sessionKey: 'session-cccccccc',
      now: T0,
    });
    // The feeds hand hydratePosts rows from the shared community cache, which
    // can be from before the view. The card still has to show the new number.
    const [view] = await posts.hydratePosts([stale], null);
    assert.equal(view.post.video_views, 1);
  });
});

describe('one playback session is one view', () => {
  it('counts the same session once however many times it is reported at once', async () => {
    const post = await video();
    const report = () =>
      views.recordVideoView({
        postId: post.id,
        viewerId: watcher.id,
        browserId: null,
        sessionKey: 'session-dddddddd',
        now: T0,
      });
    // A handler that fired twice, a retry that crossed the first response, a
    // remount: all the same playback session, all arriving together.
    const results = await Promise.all([report(), report(), report(), report(), report()]);
    assert.equal(results.filter((result) => result.counted).length, 1);
    assert.equal(await stored(post.id), 1);
  });

  it('counts the same session once when it is reported again later', async () => {
    const post = await video();
    const first = await views.recordVideoView({
      postId: post.id,
      viewerId: watcher.id,
      browserId: null,
      sessionKey: 'session-eeeeeeee',
      now: T0,
    });
    const again = await views.recordVideoView({
      postId: post.id,
      viewerId: watcher.id,
      browserId: null,
      sessionKey: 'session-eeeeeeee',
      now: T0 + 10 * 60_000,
    });
    assert.equal(first.counted, true);
    assert.deepEqual(again, { count: 1, counted: false });
    assert.equal(await stored(post.id), 1);
  });
});

describe('watching again is another view', () => {
  it('counts a replay or a scroll back, which is a new playback session', async () => {
    const post = await video();
    for (const [i, key] of ['session-ffffffff', 'session-gggggggg', 'session-hhhhhhhh'].entries()) {
      const result = await views.recordVideoView({
        postId: post.id,
        viewerId: watcher.id,
        browserId: null,
        sessionKey: key,
        now: T0 + i * (rules.VIEW_COOLDOWN_MS + 1_000),
      });
      assert.equal(result.counted, true, `viewing ${i + 1}`);
    }
    assert.equal(await stored(post.id), 3);
  });

  it('does not count a burst of invented session keys inside the cooldown', async () => {
    const post = await video();
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(
        await views.recordVideoView({
          postId: post.id,
          viewerId: watcher.id,
          browserId: null,
          sessionKey: `burst-key-${i}-xxxxxx`,
          now: T0 + i * 100,
        }),
      );
    }
    assert.equal(results.filter((result) => result.counted).length, 1);
    assert.equal(await stored(post.id), 1);
  });

  it('loses nobody when many people watch at the same moment', async () => {
    const post = await video();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        views.recordVideoView({
          postId: post.id,
          viewerId: null,
          browserId: `crowd-${i}`,
          sessionKey: `crowd-session-${i}`,
          now: T0,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.counted).length, 12);
    assert.equal(await stored(post.id), 12, 'every one of them, not a lost update');
  });
});

describe('what is never a view', () => {
  it('the author watching their own video', async () => {
    const post = await video();
    const result = await views.recordVideoView({
      postId: post.id,
      viewerId: author.id,
      browserId: null,
      sessionKey: 'session-iiiiiiii',
      now: T0,
    });
    assert.equal(result.counted, false);
    assert.equal(await stored(post.id), 0);
  });

  it('a photo post', async () => {
    const post = await posts.createPost({
      authorId: author.id,
      caption: 'a photo',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: '/api/media/photo.jpg' }],
    });
    const result = await views.recordVideoView({
      postId: post.id,
      viewerId: watcher.id,
      browserId: null,
      sessionKey: 'session-jjjjjjjj',
      now: T0,
    });
    assert.deepEqual(result, { count: 0, counted: false });
  });

  it('a removed post, or one hidden while it is reviewed', async () => {
    const removed = await video();
    await store.update('posts', removed.id, { removed: true, removed_reason: 'test' });
    const reviewed = await video();
    await store.update('posts', reviewed.id, {
      review_state: 'admin_hold',
      review_started_at: new Date(T0).toISOString(),
    });
    for (const post of [removed, reviewed]) {
      const result = await views.recordVideoView({
        postId: post.id,
        viewerId: watcher.id,
        browserId: null,
        sessionKey: 'session-kkkkkkkk',
        now: T0,
      });
      assert.equal(result.counted, false);
      assert.equal(await stored(post.id), 0);
    }
  });
});
