import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  profileTabFrom,
  shelfHref,
  shelfLimit,
  shelfPages,
  shelfPosts,
} from './profile-shelves';

const video = { kind: 'video' as const, url: 'v.mp4' };
const image = { kind: 'image' as const, url: 'p.jpg' };

// Newest first, the way `postsByAuthor` returns them: one of every kind.
const profile = [
  { id: 'big', media: [] },
  { id: 'clip', media: [video] },
  { id: 'story', media: [] },
  { id: 'photo', media: [image] },
  { id: 'short', media: [] },
  { id: 'both', media: [image, video] },
];
const ids = (posts: { id: string }[]) => posts.map((post) => post.id);

describe('what each profile shelf holds', () => {
  it('Posts is everything — photos, videos and writing — in the order given', () => {
    assert.deepEqual(ids(shelfPosts(profile, 'posts')), ids(profile));
  });

  it('Videos is only the posts with a video', () => {
    assert.deepEqual(ids(shelfPosts(profile, 'videos')), ['clip', 'both']);
  });

  it('Text is only the written posts — Short, Story and Big alike', () => {
    assert.deepEqual(ids(shelfPosts(profile, 'text')), ['big', 'story', 'short']);
  });
});

describe('the first page of every shelf', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({
    id: `p${i}`,
    media: i % 3 === 0 ? [video] : i % 3 === 1 ? [image] : [],
  }));

  it('every shelf gets its first page, and the open one as far as asked', () => {
    const { shelves } = shelfPages(many, 'videos', 40);
    assert.equal(shelves.videos.page.length, 24); // all 24 videos fit in 40
    assert.equal(shelves.posts.page.length, 20);
    assert.equal(shelves.text.page.length, 20);
    assert.equal(shelves.posts.all.length, 70);
  });

  it('hydrates each post once, in order, and nothing past the pages', () => {
    const { shelves, wanted } = shelfPages(many, 'posts', 20);
    const shown = new Set(
      [shelves.posts, shelves.videos, shelves.text].flatMap((s) => ids(s.page)),
    );
    assert.deepEqual(ids(wanted), ids(many.filter((post) => shown.has(post.id))));
    assert.equal(new Set(ids(wanted)).size, wanted.length);
    assert.ok(wanted.length < many.length);
  });

  it('About opens with every shelf at its first page', () => {
    const { shelves } = shelfPages(many, 'about', 200);
    for (const shelf of [shelves.posts, shelves.videos, shelves.text]) {
      assert.equal(shelf.limit, 20);
    }
  });
});

describe('profile tab addresses', () => {
  it('keeps ?tab= as it was, with Posts as the profile itself', () => {
    assert.equal(shelfHref('ana', 'posts'), '/u/ana');
    assert.equal(shelfHref('ana', 'videos'), '/u/ana?tab=videos');
    assert.equal(shelfHref('ana', 'about'), '/u/ana?tab=about');
  });

  it('says how far a shelf has been opened only once it is past a first page', () => {
    assert.equal(shelfHref('ana', 'text', 20), '/u/ana?tab=text');
    assert.equal(shelfHref('ana', 'text', 40), '/u/ana?tab=text&show=40');
    assert.equal(shelfHref('ana', 'posts', 60), '/u/ana?show=60');
  });

  it('anything unknown opens Posts', () => {
    assert.equal(profileTabFrom(undefined), 'posts');
    assert.equal(profileTabFrom('photos'), 'posts');
    assert.equal(profileTabFrom('text'), 'text');
  });

  it('?show= is held between one page and the most a page shows', () => {
    assert.equal(shelfLimit(undefined), 20);
    assert.equal(shelfLimit('5'), 20);
    assert.equal(shelfLimit('60'), 60);
    assert.equal(shelfLimit('9999'), 200);
    assert.equal(shelfLimit('junk'), 20);
  });
});
