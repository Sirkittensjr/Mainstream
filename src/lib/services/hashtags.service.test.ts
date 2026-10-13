/**
 * Hashtag pages and hashtag search, checked against the real services and a
 * real (throwaway) local store: publishing, moderating, blocking and deleting
 * through the same functions the app calls, and reading back what a person
 * opening `/tag/…` or searching would be shown.
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
const dataDir = mkdtempSync(path.join(tmpdir(), 'fay-hashtags-'));
process.env.FAYTARRA_DATA_DIR = dataDir;

let store: ReturnType<typeof import('@/lib/db').db>;
let posts: typeof import('./posts');
let hashtags: typeof import('./hashtags');
let index: typeof import('./hashtag-index');
let moderation: typeof import('./moderation');
let users: typeof import('./users');
let search: typeof import('./search');

function person(username: string, role: 'user' | 'admin' = 'user') {
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
    role,
    status: 'active' as const,
    status_reason: null,
    trusted: false,
    username_changed_at: null,
    created_at: now,
    last_active_at: now,
  };
}

const ana = person('tagana');
const ben = person('tagben');
const cal = person('tagcal');
const viewer = person('tagviewer');
const admin = person('tagadmin', 'admin');

type Kind = 'text' | 'photo' | 'video';
const MEDIA = {
  text: () => ({ media: [], textKind: 'short' as const }),
  photo: () => ({ media: [{ kind: 'image' as const, url: `/api/media/${crypto.randomUUID()}.jpg` }] }),
  video: () => ({
    media: [{ kind: 'video' as const, url: `/api/media/${crypto.randomUUID()}.webm`, duration: 5 }],
  }),
};

function publish(kind: Kind, caption: string, author = ana, tags: string[] = []) {
  return posts.createPost({ authorId: author.id, caption, category: 'Gaming', tags, ...MEDIA[kind]() });
}

/** Post ids on a hashtag's page, as `who` would be shown them. */
async function onPage(tag: string, who: { id: string } | null = viewer, limit?: number) {
  const page = await hashtags.hashtagPage(tag, who?.id ?? null, limit);
  return page ? page.posts.map((view) => view.post.id) : null;
}

before(async () => {
  posts = await import('./posts');
  hashtags = await import('./hashtags');
  index = await import('./hashtag-index');
  moderation = await import('./moderation');
  users = await import('./users');
  search = await import('./search');
  store = (await import('@/lib/db')).db();
  for (const each of [ana, ben, cal, viewer, admin]) await store.insert('users', each);
});

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe('publishing makes a hashtag', () => {
  it('files text, photo and video posts under every hashtag they carry', async () => {
    const text = await publish('text', 'gg #Clutchmoment #Esports');
    const photo = await publish('photo', 'new desk #CLUTCHMOMENT');
    // The video posting screen collects hashtags as tags, not in the caption.
    const video = await publish('video', 'one take', ana, ['clutchmoment', 'Highlights']);

    const filed = await store.query('post_hashtags', { where: { tag: 'clutchmoment' } });
    assert.deepEqual(
      new Set(filed.map((row) => row.post_id)),
      new Set([text.id, photo.id, video.id]),
    );
    assert.deepEqual(
      (await store.query('post_hashtags', { where: { post_id: text.id } })).map((row) => row.tag).sort(),
      ['clutchmoment', 'esports'],
    );
    assert.deepEqual(await onPage('clutchmoment'), [video.id, photo.id, text.id], 'newest first');
    assert.deepEqual(await onPage('highlights'), [video.id]);
  });

  it('keeps #Gaming, #gaming and #GAMING as one hashtag and one page', async () => {
    const one = await publish('text', 'first #Samewordtag', ana);
    const two = await publish('photo', 'second #sameWORDtag', ben);
    const three = await publish('video', 'third #SAMEWORDTAG', cal);

    const rows = await store.query('hashtags', { where: { tag: 'samewordtag' } });
    assert.equal(rows.length, 1, 'one hashtag record');
    assert.equal(rows[0].display, 'Samewordtag', 'titled the way it was first written');
    for (const spelling of ['Samewordtag', 'samewordtag', 'SAMEWORDTAG', '#SameWordTag']) {
      assert.deepEqual(await onPage(spelling), [three.id, two.id, one.id], spelling);
    }
    const page = await hashtags.hashtagPage('SAMEWORDTAG', null);
    assert.equal(page?.tag, 'samewordtag');
    assert.equal(page?.display, 'Samewordtag');
  });

  it('shows posts from everybody who used it, not just whoever used it first', async () => {
    const mine = await publish('text', '#Everyonestag mine', ana);
    const theirs = await publish('text', '#everyonestag theirs', ben);
    assert.deepEqual(new Set(await onPage('everyonestag')), new Set([mine.id, theirs.id]));
  });

  it('files nothing that is not a hashtag', async () => {
    const post = await publish('text', 'open mic #31, C# and example.com/page#anchor');
    assert.deepEqual(await store.query('post_hashtags', { where: { post_id: post.id } }), []);
  });

  it('is not a page for something that is not a hashtag at all', async () => {
    assert.equal(await hashtags.hashtagPage('#', null), null);
    assert.equal(await hashtags.hashtagPage('31', null), null);
    assert.equal(await hashtags.hashtagPage('two words', null), null);
  });

  it('is still a page, an empty one, for a hashtag nothing carries', async () => {
    const page = await hashtags.hashtagPage('nothinghasthisyet', null);
    assert.deepEqual(page && { tag: page.tag, posts: page.posts, hasMore: page.hasMore }, {
      tag: 'nothinghasthisyet',
      posts: [],
      hasMore: false,
    });
  });
});

describe('what a hashtag page never shows', () => {
  it('a deleted post', async () => {
    const post = await publish('photo', 'gone soon #Deletedcase');
    assert.ok((await posts.deletePost(post.id, ana.id)).ok);
    assert.deepEqual(await onPage('deletedcase'), []);
    assert.deepEqual(await store.query('post_hashtags', { where: { post_id: post.id } }), [], 'unfiled');
  });

  it('a post removed by a moderator, or removed from public viewing', async () => {
    const removed = await publish('video', '#Moderatedcase one');
    const hidden = await publish('text', '#Moderatedcase two');
    const kept = await publish('text', '#Moderatedcase three');
    assert.ok((await moderation.removePostPermanently(removed.id, admin.id, 'rule 1')).ok);
    assert.ok((await moderation.hideFromPublic(hidden.id, admin.id, 'rule 2')).ok);
    assert.deepEqual(await onPage('moderatedcase'), [kept.id]);
    // Not even for the moderator who did it, on a public page.
    assert.deepEqual(await onPage('moderatedcase', admin), [kept.id]);
  });

  it('a post hidden while reports are reviewed', async () => {
    const held = await publish('photo', '#Reviewcase held');
    const kept = await publish('photo', '#Reviewcase kept');
    await store.update('posts', held.id, {
      review_state: 'temporary_review',
      review_started_at: new Date().toISOString(),
      review_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.deepEqual(await onPage('reviewcase'), [kept.id]);
  });

  it('posts by a suspended account', async () => {
    const suspended = person('tagsuspended');
    await store.insert('users', suspended);
    await publish('text', '#Suspendedcase theirs', suspended);
    const kept = await publish('text', '#Suspendedcase mine', ana);
    assert.ok((await moderation.setUserStatus(suspended.id, 'suspended', 'spam', admin.id)).ok);
    assert.deepEqual(await onPage('suspendedcase'), [kept.id]);
  });

  it('posts by somebody the viewer blocked, or who blocked the viewer', async () => {
    const blocked = await publish('text', '#Blockcase from ben', ben);
    const blocker = await publish('text', '#Blockcase from cal', cal);
    const kept = await publish('text', '#Blockcase from ana', ana);
    await users.blockUser(viewer.id, ben.id);
    await users.blockUser(cal.id, viewer.id);
    assert.deepEqual(await onPage('blockcase', viewer), [kept.id]);
    // Somebody else still sees all three: blocks are personal.
    assert.deepEqual(new Set(await onPage('blockcase', null)), new Set([blocked.id, blocker.id, kept.id]));
  });
});

describe('changing what a post says', () => {
  it('moves it between hashtag pages', async () => {
    const post = await publish('text', 'before #Editbefore');
    assert.deepEqual(await onPage('editbefore'), [post.id]);

    // What an edit does: the post's words change, then it is re-filed.
    await store.update('posts', post.id, { caption: 'after #Editafter', tags: ['Edittag'] });
    await index.indexPost({ ...post, caption: 'after #Editafter', tags: ['Edittag'] });

    assert.deepEqual(await onPage('editbefore'), [], 'off the hashtag it lost');
    assert.deepEqual(await onPage('editafter'), [post.id], 'on the hashtag it gained');
    assert.deepEqual(await onPage('edittag'), [post.id], 'and on a tag it gained');
    assert.deepEqual(
      (await store.query('post_hashtags', { where: { post_id: post.id } })).map((row) => row.tag).sort(),
      ['editafter', 'edittag'],
    );
  });

  it('never shows a post under a hashtag it no longer carries, even before it is re-filed', async () => {
    const post = await publish('text', 'before #Stalecase');
    await store.update('posts', post.id, { caption: 'the hashtag is gone' });
    assert.deepEqual(await onPage('stalecase'), []);
  });

  it('re-filing is harmless to repeat', async () => {
    const post = await publish('text', 'twice #Repeatcase');
    await index.indexPost(post);
    await index.indexPost(post);
    assert.equal((await store.query('post_hashtags', { where: { post_id: post.id } })).length, 1);
  });
});

describe('a busy hashtag', () => {
  it('opens with a page and grows with Show more', async () => {
    const made = [];
    for (let i = 0; i < 25; i += 1) {
      made.push(await publish(i % 2 ? 'photo' : 'text', `number ${i} #Busycase`, i % 3 ? ana : ben));
    }
    // Signed out, so the blocks set up above are nobody's here.
    const first = await hashtags.hashtagPage('busycase', null, 20);
    assert.equal(first?.posts.length, 20);
    assert.equal(first?.hasMore, true);
    const all = await hashtags.hashtagPage('busycase', null, 40);
    assert.equal(all?.posts.length, 25);
    assert.equal(all?.hasMore, false);
    assert.deepEqual(
      all?.posts.map((view) => view.post.id),
      [...made].reverse().map((post) => post.id),
      'newest first, every one',
    );
  });

  it('fills a page even when much of the index is hidden from this viewer', async () => {
    const older = [];
    for (let i = 0; i < 5; i += 1) older.push(await publish('text', `#Mostlyblocked ok ${i}`, ana));
    // `viewer` blocked ben above, so the eighty newest are not theirs to see,
    // and the first read of the index finds nothing visible in them.
    for (let i = 0; i < 80; i += 1) await publish('text', `#Mostlyblocked ${i}`, ben);
    const page = await hashtags.hashtagPage('mostlyblocked', viewer.id, 3);
    assert.deepEqual(
      page?.posts.map((view) => view.post.id),
      [older[4].id, older[3].id, older[2].id],
    );
    assert.equal(page?.hasMore, true);
  });
});

describe('without the index', () => {
  it('reads the visible posts directly and shows the same page', async () => {
    const a = await publish('text', '#Fallbackcase a');
    const b = await publish('photo', '#FALLBACKCASE b', ben);
    const withIndex = await onPage('fallbackcase', null);
    // A database that has not run migration 0015.
    index.index.available = false;
    index.index.retryAt = Date.now() + 60_000;
    try {
      assert.deepEqual(await onPage('fallbackcase', null), withIndex);
      assert.deepEqual(new Set(withIndex), new Set([a.id, b.id]));
    } finally {
      index.index.available = null;
      index.index.retryAt = 0;
    }
  });
});

describe('searching for a hashtag', () => {
  it('finds the hashtag page for Gaming and #Gaming alike', async () => {
    const dee = person('tagdee');
    await store.insert('users', dee);
    await publish('video', 'go #Searchable', ana);
    await publish('photo', 'go #SEARCHABLE', dee);
    for (const query of ['Searchable', '#Searchable', 'searchable', '#SEARCHABLE']) {
      const results = await search.search(query, viewer.id);
      const hit = results.hashtags.find((result) => result.tag === 'searchable');
      assert.ok(hit, query);
      assert.equal(hit.posts, 2);
      assert.equal(hit.display, 'Searchable');
    }
  });

  it('keeps hashtags apart from the people and posts that match', async () => {
    const results = await search.search('#Searchable', viewer.id);
    assert.ok(results.hashtags.length > 0);
    assert.ok(results.posts.length > 0, 'the posts are still found, as posts');
  });

  it('suggests hashtags that start with what was typed', async () => {
    await publish('text', '#Prefixcaseone and #Prefixcasetwo');
    const tags = (await search.search('prefixcase', viewer.id)).hashtags.map((result) => result.tag);
    assert.deepEqual(tags.sort(), ['prefixcaseone', 'prefixcasetwo']);
  });

  it('never counts, or suggests, a hashtag only hidden posts carry', async () => {
    const post = await publish('text', '#Hiddenonlycase secret');
    await publish('text', '#Hiddenonlycasevisible fine');
    assert.ok((await moderation.removePostPermanently(post.id, admin.id, 'rule 3')).ok);
    const results = await search.search('hiddenonlycase', viewer.id);
    // The exact hashtag that was typed is offered, with nothing on it — its
    // page says so. Nothing hidden is counted or shown.
    assert.deepEqual(
      results.hashtags.map((result) => [result.tag, result.posts]),
      [
        ['hiddenonlycase', 0],
        ['hiddenonlycasevisible', 1],
      ],
    );
    assert.ok(!results.posts.some((view) => view.post.id === post.id));
    const hiddenOnly = (await search.search('hiddenonly', viewer.id)).hashtags.map((r) => r.tag);
    assert.deepEqual(hiddenOnly, ['hiddenonlycasevisible'], 'not suggested from a prefix');
  });

  it('finds no hashtag for a phrase', async () => {
    assert.deepEqual((await search.search('searchable things', viewer.id)).hashtags, []);
  });
});
