/**
 * Counting video views against the real service and a throwaway local store.
 *
 *   - a playback counts once, however many times — or how concurrently — its
 *     session is reported
 *   - a new session (scrolled back, replayed, refreshed) counts again
 *   - concurrent views from different people are all counted, none lost
 *   - the total only ever comes from the database, and a photo never gets one
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';

mock.module('next/cache', {
  namedExports: {
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: <T,>(fn: T) => fn,
  },
});

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-views-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

let store: ReturnType<typeof import('@/lib/db').db>;
let views: typeof import('./video-views');
let posts: typeof import('./posts');

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
    trusted: true,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
  };
}

const creator = person('creator');
const watcher = person('watcher');

async function video() {
  return posts.createPost({
    authorId: creator.id,
    caption: 'a clip',
    category: 'Gaming',
    tags: [],
    media: [{ kind: 'video', url: `/api/media/${crypto.randomUUID()}.webm` }],
  });
}

let clock = Date.parse('2026-10-12T12:00:00Z');
/** Time moves on by more than the burst gap between separate viewings. */
const later = () => (clock += 5_000);
const session = () => crypto.randomUUID();

const view = (postId: string, viewerId: string | null, sessionKey: string | null, browserId: string | null = null, now = clock) =>
  views.recordVideoView({ postId, viewerId, browserId, sessionKey, now });

const total = async (postId: string) => (await store.get('posts', postId))?.video_views ?? 0;

before(async () => {
  views = await import('./video-views');
  posts = await import('./posts');
  store = (await import('@/lib/db')).db();
  for (const each of [creator, watcher]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('one playback session is one view', () => {
  it('reported once: counted, and the stored total is returned', async () => {
    const clip = await video();
    const result = await view(clip.id, watcher.id, session(), null, later());
    assert.deepEqual([result.counted, result.count, result.verdict], [true, 1, 'count']);
    assert.equal(await total(clip.id), 1);
  });

  it('reported again — a retry, a re-render, a duplicate callback — still one', async () => {
    const clip = await video();
    const key = session();
    await view(clip.id, watcher.id, key, null, later());
    for (const _ of [1, 2, 3]) {
      const again = await view(clip.id, watcher.id, key, null, later());
      assert.deepEqual([again.counted, again.verdict, again.count], [false, 'duplicate-session', 1]);
    }
    assert.equal(await total(clip.id), 1);
  });

  it('the same session reported five times at once: one view', async () => {
    const clip = await video();
    const key = session();
    const now = later();
    const results = await Promise.all(Array.from({ length: 5 }, () => view(clip.id, watcher.id, key, null, now)));
    assert.equal(results.filter((r) => r.counted).length, 1);
    assert.equal(await total(clip.id), 1);
    assert.equal((await store.query('video_views', { where: { post_id: clip.id } })).length, 1);
  });
});

describe('every new viewing counts', () => {
  it('scrolling back, replaying or refreshing is a new session, and another view', async () => {
    const clip = await video();
    for (let i = 1; i <= 4; i += 1) {
      const result = await view(clip.id, watcher.id, session(), null, later());
      assert.equal(result.count, i);
    }
    assert.equal(await total(clip.id), 4);
  });

  it('a second session a moment after the first is a burst, not a re-watch', async () => {
    const clip = await video();
    const now = later();
    await view(clip.id, watcher.id, session(), null, now);
    const burst = await view(clip.id, watcher.id, session(), null, now + 200);
    assert.deepEqual([burst.counted, burst.verdict], [false, 'too-soon']);
    assert.equal(await total(clip.id), 1);
  });

  it('the author watching their own video counts too', async () => {
    const clip = await video();
    assert.equal((await view(clip.id, creator.id, session(), null, later())).counted, true);
  });

  it('a visitor who is not signed in counts, by their browser', async () => {
    const clip = await video();
    assert.equal((await view(clip.id, null, session(), 'browser-1', later())).counted, true);
    assert.equal((await view(clip.id, null, session(), null, later())).verdict, 'unknown-viewer');
  });
});

describe('the total is reliable under load', () => {
  it('thirty people at the same moment: thirty views, none lost', async () => {
    const clip = await video();
    const now = later();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => view(clip.id, null, session(), `browser-${i}`, now)),
    );
    assert.equal(results.filter((r) => r.counted).length, 30);
    assert.equal(await total(clip.id), 30);
    assert.equal(Math.max(...results.map((r) => r.count)), 30);
  });

  it('a total from before this change is kept and added to', async () => {
    const clip = await video();
    await store.update('posts', clip.id, { video_views: 1200 });
    const result = await view(clip.id, watcher.id, session(), null, later());
    assert.equal(result.count, 1201);
  });

  it('a post from before the column existed starts from zero', async () => {
    const clip = await video();
    const row = await store.get('posts', clip.id);
    if (row) delete (row as { video_views?: number }).video_views;
    await store.update('posts', clip.id, { video_views: undefined } as never);
    assert.equal((await view(clip.id, watcher.id, session(), null, later())).count, 1);
  });
});

describe('what never gets a view', () => {
  it('a photo, a removed video, a missing post', async () => {
    const photo = await posts.createPost({
      authorId: creator.id,
      caption: 'a photo',
      category: 'Life',
      tags: [],
      media: [{ kind: 'image', url: `/api/media/${crypto.randomUUID()}.jpg` }],
    });
    assert.equal((await view(photo.id, watcher.id, session(), null, later())).verdict, 'not-a-video');
    const clip = await video();
    await store.update('posts', clip.id, { removed: true });
    assert.equal((await view(clip.id, watcher.id, session(), null, later())).verdict, 'no-post');
    assert.equal((await view(crypto.randomUUID(), watcher.id, session(), null, later())).verdict, 'no-post');
  });
});
