/**
 * Who may delete a comment, checked against the real services and a
 * throwaway local store.
 *
 *   - its author, on any kind of post
 *   - the owner of the post it is on — text, photo or video — whoever wrote it
 *   - nobody else, however visible the post is to them, and whatever post id a
 *     request claims: the post is read from the comment, never from the request
 *   - replies go with their comment, and nothing is left pointing at nothing
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

const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-comments-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

let store: ReturnType<typeof import('@/lib/db').db>;
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

const owner = person('owner');
const commenter = person('commenter');
const stranger = person('stranger');

const KINDS = {
  text: [] as never[],
  photo: [{ kind: 'image' as const, url: '/api/media/p.jpg' }],
  video: [{ kind: 'video' as const, url: '/api/media/v.webm' }],
};

async function postOf(kind: keyof typeof KINDS, authorId = owner.id) {
  return posts.createPost({ authorId, caption: `a ${kind} post`, category: 'Life', tags: [], media: KINDS[kind] });
}

async function comment(postId: string, userId: string, body = 'hello', parentId: string | null = null) {
  const added = await posts.addComment(postId, userId, body, parentId);
  assert.equal(added.ok, true, 'comment added');
  return (added as { id: string }).id;
}

const exists = async (id: string) => Boolean(await store.get('comments', id));

before(async () => {
  posts = await import('./posts');
  store = (await import('@/lib/db')).db();
  for (const each of [owner, commenter, stranger]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
  describe(`on a ${kind} post`, () => {
    it('its author deletes their own comment', async () => {
      const post = await postOf(kind);
      const id = await comment(post.id, commenter.id);
      assert.deepEqual(await posts.deleteComment(id, commenter.id), { ok: true, postId: post.id, removed: 1 });
      assert.equal(await exists(id), false);
    });

    it('the post’s owner deletes somebody else’s comment', async () => {
      const post = await postOf(kind);
      const id = await comment(post.id, commenter.id);
      assert.equal((await posts.deleteComment(id, owner.id)).ok, true);
      assert.equal(await exists(id), false);
    });

    it('anybody else is refused, and the comment stays', async () => {
      const post = await postOf(kind);
      const id = await comment(post.id, commenter.id);
      assert.deepEqual(await posts.deleteComment(id, stranger.id), { ok: false, reason: 'not_allowed' });
      assert.equal(await exists(id), true);
    });
  });
}

describe('nobody gets around it', () => {
  it('a commenter cannot delete other people’s comments on a post that is not theirs', async () => {
    const post = await postOf('photo');
    const mine = await comment(post.id, commenter.id);
    const theirs = await comment(post.id, stranger.id);
    assert.equal((await posts.deleteComment(theirs, commenter.id)).ok, false);
    assert.equal(await exists(theirs), true);
    assert.equal(await exists(mine), true);
  });

  it('owning a post gives no say over comments on somebody else’s', async () => {
    await postOf('video', stranger.id); // stranger owns a post…
    const elsewhere = await postOf('video', owner.id);
    const id = await comment(elsewhere.id, commenter.id);
    // …but this comment is on owner's post, whatever a request says.
    assert.equal((await posts.deleteComment(id, stranger.id)).ok, false);
    assert.equal(await exists(id), true);
  });

  it('a made-up or empty id is not found, not an error', async () => {
    assert.deepEqual(await posts.deleteComment(crypto.randomUUID(), owner.id), { ok: false, reason: 'not_found' });
    assert.deepEqual(await posts.deleteComment('', owner.id), { ok: false, reason: 'not_found' });
    assert.deepEqual(await posts.deleteComment(42 as never, owner.id), { ok: false, reason: 'not_found' });
  });

  it('nobody signed in can delete anything', async () => {
    const post = await postOf('text');
    const id = await comment(post.id, commenter.id);
    assert.equal((await posts.deleteComment(id, '')).ok, false);
    assert.equal(await exists(id), true);
  });

  it('a comment a moderator removed stays on record', async () => {
    const post = await postOf('photo');
    const id = await comment(post.id, commenter.id);
    await store.update('comments', id, { removed: true });
    assert.deepEqual(await posts.deleteComment(id, commenter.id), { ok: false, reason: 'moderated' });
    assert.equal(await exists(id), true);
  });
});

describe('replies', () => {
  it('a reply’s author deletes their reply; the comment it answered stays', async () => {
    const post = await postOf('video');
    const parent = await comment(post.id, owner.id, 'first');
    const reply = await comment(post.id, commenter.id, 'a reply', parent);
    assert.equal((await posts.deleteComment(reply, commenter.id)).ok, true);
    assert.equal(await exists(reply), false);
    assert.equal(await exists(parent), true);
  });

  it('the post’s owner deletes a reply somebody else wrote', async () => {
    const post = await postOf('text');
    const parent = await comment(post.id, commenter.id, 'first');
    const reply = await comment(post.id, stranger.id, 'a reply', parent);
    assert.equal((await posts.deleteComment(reply, owner.id)).ok, true);
    assert.equal(await exists(reply), false);
  });

  it('a commenter cannot delete somebody else’s reply to them', async () => {
    const post = await postOf('photo');
    const parent = await comment(post.id, commenter.id, 'first');
    const reply = await comment(post.id, stranger.id, 'a reply', parent);
    assert.equal((await posts.deleteComment(reply, commenter.id)).ok, false);
    assert.equal(await exists(reply), true);
  });

  it('deleting a comment takes its replies with it — nothing is left replying to nothing', async () => {
    const post = await postOf('video');
    const parent = await comment(post.id, commenter.id, 'first');
    const replies = [
      await comment(post.id, stranger.id, 'one', parent),
      await comment(post.id, owner.id, 'two', parent),
    ];
    const result = await posts.deleteComment(parent, commenter.id);
    assert.deepEqual(result, { ok: true, postId: post.id, removed: 3 });
    for (const id of [parent, ...replies]) assert.equal(await exists(id), false);
    assert.deepEqual(await posts.listComments(post.id, owner.id), []);
    const [view] = await posts.hydratePosts([(await store.get('posts', post.id))!], owner.id);
    assert.equal(view.comments, 0, 'the count goes with them');
  });
});

describe('who is offered Delete', () => {
  it('the author on their own comments, the post’s owner on all of them, nobody else on any', async () => {
    const post = await postOf('photo');
    const a = await comment(post.id, commenter.id, 'a');
    await comment(post.id, stranger.id, 'b', a);
    const flags = async (viewer: string | null) => {
      const [root] = await posts.listComments(post.id, viewer);
      return [root.canDelete, root.replies[0].canDelete];
    };
    assert.deepEqual(await flags(commenter.id), [true, false]);
    assert.deepEqual(await flags(stranger.id), [false, true]);
    assert.deepEqual(await flags(owner.id), [true, true]);
    assert.deepEqual(await flags(null), [false, false]);
  });

  it('canDeleteComment is the same rule', () => {
    const c = { user_id: 'u1' };
    assert.equal(posts.canDeleteComment(c, { author_id: 'u2' }, 'u1'), true);
    assert.equal(posts.canDeleteComment(c, { author_id: 'u2' }, 'u2'), true);
    assert.equal(posts.canDeleteComment(c, { author_id: 'u2' }, 'u3'), false);
    assert.equal(posts.canDeleteComment(c, null, 'u3'), false);
    assert.equal(posts.canDeleteComment(c, { author_id: 'u2' }, null), false);
  });
});
