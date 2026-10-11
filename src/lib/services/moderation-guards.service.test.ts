/**
 * The ways around moderation that a request — rather than the UI — could take,
 * checked against the real services and a throwaway local store.
 *
 *   - reporting: only an account in good standing, only something that exists,
 *     never your own
 *   - a post hidden for review takes no likes, comments or ratings meanwhile
 *   - the file of a post that is hidden or removed cannot be posted again, or
 *     worn as a profile picture, and nobody can post another person's upload
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

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-guards-'));
process.env.FAYTARRA_DATA_DIR = dataDir;
const uploads = path.join(dataDir, 'uploads');

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let moderation: typeof import('./moderation');
let ratings: typeof import('./ratings');
let reuse: typeof import('./media-reuse');

function person(username: string, status: 'active' | 'suspended' = 'active') {
  const now = new Date(Date.now() - 90 * 86_400_000).toISOString();
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
    status,
    status_reason: null,
    trusted: true,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
  };
}

const author = person('author');
const reader = person('reader');
const benched = person('benched', 'suspended');

function file(name = `${crypto.randomUUID()}.jpg`): string {
  mkdirSync(uploads, { recursive: true });
  writeFileSync(path.join(uploads, name), 'bytes');
  return `/api/media/${name}`;
}

async function photoPost(url = file()) {
  return posts.createPost({
    authorId: author.id,
    caption: 'a photo',
    category: 'Life',
    tags: [],
    media: [{ kind: 'image', url }],
  });
}

/** Hides a post the way an administrator's hold does. */
async function hold(postId: string) {
  await store.update('posts', postId, { review_state: 'admin_hold' } as never);
}

before(async () => {
  posts = await import('./posts');
  moderation = await import('./moderation');
  ratings = await import('./ratings');
  reuse = await import('./media-reuse');
  store = (await import('@/lib/db')).db();
  for (const each of [author, reader, benched]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('who may report what', () => {
  const report = (reporterId: string, targetType: 'post' | 'user' | 'comment', targetId: string) =>
    moderation.submitReport({ reporterId, targetType, targetId, reason: 'Spam' });

  it('somebody else’s post: yes', async () => {
    const post = await photoPost();
    assert.deepEqual(await report(reader.id, 'post', post.id), { ok: true });
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1);
  });

  it('your own post, comment or account: no, and nothing is filed', async () => {
    const post = await photoPost();
    const own = await report(author.id, 'post', post.id);
    assert.equal(own.ok, false);
    await posts.addComment(post.id, reader.id, 'hello');
    const [comment] = await store.query('comments', { where: { post_id: post.id } });
    assert.equal((await report(reader.id, 'comment', comment.id)).ok, false);
    assert.equal((await report(reader.id, 'user', reader.id)).ok, false);
    assert.equal((await store.query('reports', { where: { reporter_id: author.id } })).length, 0);
  });

  it('something that does not exist: no', async () => {
    assert.equal((await report(reader.id, 'post', crypto.randomUUID())).ok, false);
    assert.equal((await report(reader.id, 'user', crypto.randomUUID())).ok, false);
  });

  it('a suspended account: no', async () => {
    const post = await photoPost();
    assert.equal((await report(benched.id, 'post', post.id)).ok, false);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 0);
  });

  it('reporting twice is still one report', async () => {
    const post = await photoPost();
    await report(reader.id, 'post', post.id);
    await report(reader.id, 'post', post.id);
    assert.equal((await store.query('reports', { where: { target_id: post.id } })).length, 1);
  });
});

describe('a post hidden for review takes nothing new', () => {
  it('no like, no comment, no rating — and the author cannot add any either', async () => {
    const post = await photoPost();
    await hold(post.id);
    assert.deepEqual(await posts.toggleLike(post.id, reader.id), { liked: false });
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 0);
    assert.equal((await posts.addComment(post.id, reader.id, 'still here?')).ok, false);
    assert.equal((await posts.addComment(post.id, author.id, 'mine')).ok, false);
    const rated = await ratings.submitRating({
      raterId: reader.id,
      targetType: 'post',
      targetId: post.id,
      score: 10,
      reactions: [],
    });
    assert.equal(rated.ok, false);
    assert.equal((await store.query('ratings', { where: { target_id: post.id } })).length, 0);
  });

  it('a like given before the hold can still be taken back', async () => {
    const post = await photoPost();
    await posts.toggleLike(post.id, reader.id);
    await hold(post.id);
    assert.deepEqual(await posts.toggleLike(post.id, reader.id), { liked: false });
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 0);
  });

  it('once restored, it takes them again', async () => {
    const post = await photoPost();
    await hold(post.id);
    await moderation.restorePost(post.id);
    assert.deepEqual(await posts.toggleLike(post.id, reader.id), { liked: true });
    assert.equal((await posts.addComment(post.id, reader.id, 'welcome back')).ok, true);
  });
});

describe('the file of a hidden or removed post stays hidden', () => {
  it('a file on a post under review cannot go on a new one, by anybody', async () => {
    const url = file();
    const post = await photoPost(url);
    assert.equal(await reuse.mediaReuseProblem([url], author.id), null, 'fine while the post is');
    await hold(post.id);
    assert.equal(await reuse.mediaReuseProblem([url], author.id), 'moderated');
    assert.equal(await reuse.mediaReuseProblem([url], reader.id), 'moderated');
  });

  it('nor a file on a removed post — a video’s poster included', async () => {
    const video = file(`${crypto.randomUUID()}.webm`);
    const poster = file();
    const post = await posts.createPost({
      authorId: author.id,
      caption: 'a video',
      category: 'Life',
      tags: [],
      media: [{ kind: 'video', url: video, poster }],
    });
    await moderation.removePost(post.id, 'Spam');
    assert.equal(await reuse.mediaReuseProblem([video], author.id), 'moderated');
    assert.equal(await reuse.mediaReuseProblem([poster], author.id), 'moderated');
  });

  it('restoring the post lets the file be used again', async () => {
    const url = file();
    const post = await photoPost(url);
    await hold(post.id);
    await moderation.restorePost(post.id);
    assert.equal(await reuse.mediaReuseProblem([url], author.id), null);
  });

  it('posting your own photo twice is not a way around anything, and stays allowed', async () => {
    const url = file();
    await photoPost(url);
    assert.equal(await reuse.mediaReuseProblem([url], author.id), null);
  });

  it('every file a post carries is checked: media and poster', () => {
    assert.deepEqual(
      reuse.mediaFiles([
        { kind: 'image', url: '/api/media/a.jpg' },
        { kind: 'video', url: '/api/media/b.webm', poster: '/api/media/b.jpg' },
      ]),
      ['/api/media/a.jpg', '/api/media/b.webm', '/api/media/b.jpg'],
    );
  });

  it('an upload in somebody else’s folder is theirs alone', () => {
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    try {
      const base = 'https://project.supabase.co/storage/v1/object/public/faytarra-media/';
      const theirs = `${base}media/${author.id}/photo.jpg`;
      assert.equal(reuse.uploadedBySomeoneElse(theirs, author.id), false);
      assert.equal(reuse.uploadedBySomeoneElse(theirs, reader.id), true);
      // Older objects have no folder, so no owner to compare against.
      assert.equal(reuse.uploadedBySomeoneElse(`${base}legacy.jpg`, reader.id), false);
      assert.equal(reuse.uploadedBySomeoneElse('/api/media/local.jpg', reader.id), false);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  });
});
