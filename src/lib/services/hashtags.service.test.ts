/**
 * Hashtag pages and hashtag search, against the real services and a throwaway
 * local store.
 *
 *   - a page holds every public VIDEO with the hashtag, whatever case it was
 *     written in, as a tag or in the caption, newest first
 *   - a video with several hashtags is on each of their pages
 *   - deleted, removed, held-for-review and suspended or blocked authors'
 *     videos are not on any page, and leave it the moment that happens
 *   - search finds hashtags with or without the #, and the posts that use them
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-hashtags-'));
process.env.FAYTARRA_DATA_DIR = dataDir;
const uploads = path.join(dataDir, 'uploads');

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let hashtags: typeof import('./hashtags');
let searching: typeof import('./search');
let users: typeof import('./users');
let moderation: typeof import('./moderation');

function person(username: string, extra: Record<string, unknown> = {}) {
  const now = new Date(Date.now() - 30 * 86_400_000).toISOString();
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
    ...extra,
  };
}

const creator = person('creator');
const other = person('other');
const viewer = person('viewer');
const admin = person('boss', { role: 'admin' });

function file(extension: string): string {
  mkdirSync(uploads, { recursive: true });
  const name = `${crypto.randomUUID()}${extension}`;
  writeFileSync(path.join(uploads, name), 'bytes');
  return `/api/media/${name}`;
}

async function video(authorId: string, tags: string[], caption = '') {
  const post = await posts.createPost({
    authorId,
    caption,
    category: 'Gaming',
    tags,
    media: [{ kind: 'video', url: file('.webm'), poster: file('.jpg') }],
  });
  // createdAt order is what the page sorts by; keep each one distinct.
  await new Promise((resolve) => setTimeout(resolve, 5));
  return post;
}

async function photo(authorId: string, tags: string[], caption = '') {
  return posts.createPost({
    authorId,
    caption,
    category: 'Life',
    tags,
    media: [{ kind: 'image', url: file('.jpg') }],
  });
}

const ids = async (key: string, viewerId: string | null = viewer.id) =>
  (await hashtags.hashtagVideos(key, viewerId)).videos.map((view) => view.post.id);

before(async () => {
  posts = await import('./posts');
  hashtags = await import('./hashtags');
  searching = await import('./search');
  users = await import('./users');
  moderation = await import('./moderation');
  store = (await import('@/lib/db')).db();
  for (const each of [creator, other, viewer, admin]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('a hashtag page', () => {
  it('holds every public video with the hashtag, whatever case it was written in, newest first', async () => {
    const upper = await video(creator.id, ['Speedrun']);
    const lower = await video(other.id, ['speedrun']);
    const shouty = await video(creator.id, [], 'new PB!! #SPEEDRUN');
    assert.deepEqual(await ids('speedrun'), [shouty.id, lower.id, upper.id]);
  });

  it('holds videos only — a photo with the hashtag is counted, not played', async () => {
    const clip = await video(creator.id, ['onlyvideos']);
    await photo(creator.id, ['OnlyVideos']);
    await photo(other.id, [], 'a photo #onlyvideos');
    const page = await hashtags.hashtagVideos('onlyvideos', viewer.id);
    assert.deepEqual(page.videos.map((view) => view.post.id), [clip.id]);
    assert.equal(page.otherPosts, 2);
  });

  it('a video with several hashtags is on each of their pages', async () => {
    const clip = await video(creator.id, ['alpha', 'Beta'], 'and #gamma in the caption');
    for (const key of ['alpha', 'beta', 'gamma']) assert.deepEqual(await ids(key), [clip.id], key);
  });

  it('includes the viewer’s own videos, and works signed out', async () => {
    const mine = await video(viewer.id, ['mine']);
    assert.deepEqual(await ids('mine', viewer.id), [mine.id]);
    assert.deepEqual(await ids('mine', null), [mine.id]);
  });

  it('existing posts with tags count, with no change to them', async () => {
    const before = await video(creator.id, ['Legacy']);
    const row = await store.get('posts', before.id);
    assert.deepEqual(row?.tags, ['Legacy'], 'stored as written');
    assert.deepEqual(await ids('legacy'), [before.id]);
  });
});

describe('a hashtag page stays current', () => {
  it('a deleted video leaves it', async () => {
    const clip = await video(creator.id, ['deleteme']);
    assert.deepEqual(await ids('deleteme'), [clip.id]);
    const result = await posts.deletePost(clip.id, creator.id);
    assert.equal(result.ok, true);
    assert.deepEqual(await ids('deleteme'), []);
  });

  it('a video removed from public viewing leaves it, and comes back if restored', async () => {
    const clip = await video(creator.id, ['moderated']);
    assert.equal((await moderation.hideFromPublic(clip.id, admin.id, 'Spam')).ok, true);
    assert.deepEqual(await ids('moderated'), []);
    await moderation.restorePost(clip.id);
    assert.deepEqual(await ids('moderated'), [clip.id]);
  });

  it('a removed video and one held for review are not on it', async () => {
    const removed = await video(creator.id, ['held']);
    const held = await video(creator.id, ['held']);
    await store.update('posts', removed.id, { removed: true, removed_reason: 'Spam' });
    await store.update('posts', held.id, { review_state: 'temporary_review' } as never);
    assert.deepEqual(await ids('held'), []);
  });

  it('a suspended author’s videos are not on it, nor a blocked one’s for whoever blocked them', async () => {
    const benched = person('benched');
    await store.insert('users', benched);
    const suspended = await video(benched.id, ['accounts']);
    const blocked = await video(other.id, ['accounts']);
    assert.deepEqual(await ids('accounts'), [blocked.id, suspended.id]);
    await store.update('users', benched.id, { status: 'suspended' });
    await users.blockUser(viewer.id, other.id);
    assert.deepEqual(await ids('accounts', viewer.id), []);
    assert.deepEqual(await ids('accounts', null), [blocked.id], 'blocking is only for the blocker');
  });
});

describe('searching for hashtags', () => {
  it('finds a hashtag with or without the #, in any case, with what uses it', async () => {
    await video(creator.id, ['Skateboarding']);
    // Not `other`: the viewer blocked them above, and search respects that.
    await video(creator.id, [], 'kickflip #skateboarding');
    await photo(creator.id, ['skateboarding']);
    for (const query of ['#skateboarding', 'Skateboarding', '#SKATE']) {
      const { hashtags: found } = await searching.search(query, viewer.id);
      const hit = found.find((tag) => tag.key === 'skateboarding');
      assert.ok(hit, query);
      assert.deepEqual([hit.videos, hit.posts], [2, 3], query);
    }
  });

  it('an exact match comes before longer hashtags that contain it', async () => {
    await video(creator.id, ['cats']);
    await video(creator.id, ['catsofinstagram']);
    await video(creator.id, ['catsofinstagram']);
    const { hashtags: found } = await searching.search('#cats', viewer.id);
    assert.deepEqual(found.slice(0, 2).map((tag) => tag.key), ['cats', 'catsofinstagram']);
  });

  it('“#tag” finds the posts that use it too, which it did not before', async () => {
    const clip = await video(creator.id, ['puzzlegame']);
    const { posts: found } = await searching.search('#PuzzleGame', viewer.id);
    assert.ok(found.some((view) => view.post.id === clip.id));
  });

  it('a hidden video is not counted in search either', async () => {
    const clip = await video(creator.id, ['vanishing']);
    await store.update('posts', clip.id, { removed: true });
    const { hashtags: found } = await searching.search('#vanishing', viewer.id);
    assert.equal(found.length, 0);
  });
});
