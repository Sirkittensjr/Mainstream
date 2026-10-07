/**
 * The rules a request can reach without the UI, checked against the real
 * services and a real (throwaway) local store.
 *
 * The UI hides the comment box from somebody who is blocked and offers no way
 * to set an account to a status that does not exist — but a server action can
 * be called with any arguments, so these are the rules that have to hold on
 * the server. Every case here was found open in the pre-launch audit.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-integrity-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

// Loaded in `before`, after the directory above is set: the store picks its
// directory when it loads, and this project compiles tests as CommonJS, which
// has no top-level await.
let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let users: typeof import('./users');
let moderation: typeof import('./moderation');

function person(username: string) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    email: `${username}@example.com`,
    username,
    display_name: username,
    bio: '',
    avatar_url: null,
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

const author = person('author');
const blocked = person('blocked');
const reader = person('reader');
const admin = { ...person('admin'), role: 'admin' as const };

async function newPost() {
  return posts.createPost({
    authorId: author.id,
    caption: 'hello',
    media: [],
    category: 'Life',
    tags: [],
  });
}

const notificationsFor = async (userId: string, type: string) =>
  (await store.query('notifications', { where: { user_id: userId } })).filter(
    (row) => row.type === type,
  );

before(async () => {
  posts = await import('./posts');
  users = await import('./users');
  moderation = await import('./moderation');
  store = (await import('@/lib/db')).db();
  for (const each of [author, blocked, reader, admin]) await store.insert('users', each);
  // The author blocks one account; the block counts in both directions.
  await users.blockUser(author.id, blocked.id);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('a block holds on the server, not only in the UI', () => {
  it('refuses a like from somebody the author has blocked', async () => {
    const post = await newPost();
    assert.deepEqual(await posts.toggleLike(post.id, blocked.id), { liked: false });
    assert.equal((await store.query('likes', { where: { post_id: post.id } })).length, 0);
  });

  it('refuses a comment from them, and says why', async () => {
    const post = await newPost();
    const result = await posts.addComment(post.id, blocked.id, 'let me in');
    assert.equal(result.ok, false);
    assert.equal((await store.query('comments', { where: { post_id: post.id } })).length, 0);
  });

  it('holds the other way round too: the author cannot comment on the blocked account', async () => {
    const theirs = await posts.createPost({
      authorId: blocked.id,
      caption: 'mine',
      media: [],
      category: 'Life',
      tags: [],
    });
    assert.equal((await posts.addComment(theirs.id, author.id, 'hi')).ok, false);
  });

  it('refuses a reply to a comment by somebody who blocked you', async () => {
    const theirs = await posts.createPost({
      authorId: reader.id,
      caption: 'open thread',
      media: [],
      category: 'Life',
      tags: [],
    });
    assert.equal((await posts.addComment(theirs.id, author.id, 'first')).ok, true);
    const [comment] = await store.query('comments', { where: { post_id: theirs.id } });
    const reply = await posts.addComment(theirs.id, blocked.id, 'reply', comment.id);
    assert.equal(reply.ok, false);
  });

  it('still lets everyone else like and comment', async () => {
    const post = await newPost();
    assert.deepEqual(await posts.toggleLike(post.id, reader.id), { liked: true });
    assert.equal((await posts.addComment(post.id, reader.id, 'nice')).ok, true);
  });

  it('refuses a like or comment on a removed post', async () => {
    const post = await newPost();
    await moderation.removePost(post.id, 'test', admin.id);
    assert.deepEqual(await posts.toggleLike(post.id, reader.id), { liked: false });
    assert.equal((await posts.addComment(post.id, reader.id, 'late')).ok, false);
  });
});

describe('toggling does not flood somebody with notifications', () => {
  it('like, unlike, like is one notification', async () => {
    const post = await newPost();
    const before = (await notificationsFor(author.id, 'like')).length;
    await posts.toggleLike(post.id, reader.id);
    await posts.toggleLike(post.id, reader.id);
    await posts.toggleLike(post.id, reader.id);
    assert.equal((await notificationsFor(author.id, 'like')).length, before + 1);
  });

  it('a like on a different post is still its own notification', async () => {
    const before = (await notificationsFor(author.id, 'like')).length;
    await posts.toggleLike((await newPost()).id, reader.id);
    assert.equal((await notificationsFor(author.id, 'like')).length, before + 1);
  });

  it('follow, unfollow, follow is one notification', async () => {
    const before = (await notificationsFor(author.id, 'follow')).length;
    await users.follow(reader.id, author.id);
    await users.unfollow(reader.id, author.id);
    await users.follow(reader.id, author.id);
    assert.equal((await notificationsFor(author.id, 'follow')).length, before + 1);
  });
});

describe('the unread badge agrees with the list', () => {
  it('stops counting notifications from somebody once they are blocked', async () => {
    const { unreadCount } = await import('./notifications');
    const fan = person('fan');
    await store.insert('users', fan);
    const post = await newPost();
    const before = await unreadCount(author.id);
    await posts.toggleLike(post.id, fan.id);
    assert.equal(await unreadCount(author.id), before + 1);
    await users.blockUser(author.id, fan.id);
    assert.equal(await unreadCount(author.id), before);
  });
});

describe('moderation takes only what it means', () => {
  it('suspends an account and writes it to the moderation log', async () => {
    await moderation.setUserStatus(reader.id, 'suspended', 'spam', admin.id);
    assert.equal((await store.get('users', reader.id))?.status, 'suspended');
    const log = await store.query('moderation_events', { where: { target_id: reader.id } });
    assert.ok(log.some((row) => row.action === 'admin_suspended' && row.actor_id === admin.id));
  });

  it('logs reinstating it too', async () => {
    await moderation.setUserStatus(reader.id, 'active', '', admin.id);
    const log = await store.query('moderation_events', { where: { target_id: reader.id } });
    assert.ok(log.some((row) => row.action === 'admin_reinstated'));
  });

  it('ignores a status that does not exist rather than storing it', async () => {
    await moderation.setUserStatus(reader.id, 'admin' as never, 'promote me', admin.id);
    assert.equal((await store.get('users', reader.id))?.status, 'active');
  });

  it('ignores a report resolution that does not exist', async () => {
    await moderation.submitReport({
      reporterId: reader.id,
      targetType: 'user',
      targetId: author.id,
      reason: 'Spam',
    });
    const [report] = await store.query('reports', { where: { reporter_id: reader.id } });
    await moderation.resolveReport(report.id, 'deleted' as never, 'x', admin.id);
    assert.equal((await store.get('reports', report.id))?.status, 'open');
  });
});
