import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  pickShowcase,
  PREVIEW_POSTS,
  previewsNeeded,
  showcaseThumb,
  slideOffset,
  withPreviews,
  SHOWCASE_MIN,
  type ShowcaseCandidate,
  type ShowcasePostCard,
} from './landing';
import type { Category, Media } from './types';

const photo = (url = '/api/media/a.jpg'): Media => ({ kind: 'image', url });

let made = 0;
function post(overrides: Partial<ShowcaseCandidate> = {}): ShowcaseCandidate {
  made += 1;
  return {
    id: `p${made}`,
    authorId: `u${made}`,
    category: 'Photography',
    media: [photo()],
    contentWarning: false,
    score: 5,
    createdAt: new Date(Date.UTC(2026, 0, made)).toISOString(),
    ...overrides,
  };
}

const card = (id: string): ShowcasePostCard => ({
  type: 'post',
  id,
  thumb: { url: '/api/media/a.jpg', kind: 'image' },
  caption: '',
  category: 'Art',
  author: { username: 'someone', displayName: 'Someone', avatarUrl: null },
  rating: null,
  votes: 0,
  likes: 0,
});

describe('the picture a carousel card shows', () => {
  it('is the photo itself for a photo post', () => {
    assert.deepEqual(showcaseThumb([photo('/api/media/x.jpg')]), {
      url: '/api/media/x.jpg',
      kind: 'image',
    });
  });

  it('is the poster for a video — never the video', () => {
    assert.deepEqual(
      showcaseThumb([{ kind: 'video', url: '/api/media/v.mp4', poster: '/api/media/v.jpg' }]),
      { url: '/api/media/v.jpg', kind: 'video' },
    );
  });

  it('is nothing for a video without a poster, a text post, or generated cover art', () => {
    assert.equal(showcaseThumb([{ kind: 'video', url: '/api/media/v.mp4' }]), null);
    assert.equal(showcaseThumb([]), null);
    assert.equal(showcaseThumb([photo('/api/cover/music-1')]), null);
    assert.equal(showcaseThumb([photo('https://example.com/a.svg')]), null);
  });
});

describe('which real posts the carousel shows', () => {
  it('leaves out covered posts and posts with nothing to show', () => {
    const shown = post();
    const picked = pickShowcase([
      post({ contentWarning: true }),
      post({ media: [] }),
      post({ media: [{ kind: 'video', url: '/api/media/v.mp4' }] }),
      shown,
    ]);
    assert.deepEqual(
      picked.map((entry) => entry.id),
      [shown.id],
    );
  });

  it('puts the best rated first, then the newest', () => {
    const older = post({ score: 3 });
    const newer = post({ score: 3 });
    const best = post({ score: 8 });
    const categories: Category[] = ['Art', 'Art', 'Art'];
    [older, newer, best].forEach((entry, i) => (entry.category = categories[i]));
    assert.deepEqual(
      pickShowcase([older, newer, best]).map((entry) => entry.id),
      [best.id, newer.id, older.id],
    );
  });

  it('shows the range of categories before a second post from any one of them', () => {
    const photos = [post({ score: 9 }), post({ score: 8 }), post({ score: 7 })];
    const art = post({ category: 'Art', score: 2 });
    const gaming = post({ category: 'Gaming', score: 1 });
    const picked = pickShowcase([...photos, art, gaming]).map((entry) => entry.category);
    assert.deepEqual(picked.slice(0, 3), ['Photography', 'Art', 'Gaming']);
    assert.equal(picked.length, 5);
  });

  it('takes at most two posts from one person', () => {
    const one = Array.from({ length: 5 }, (_, i) => post({ authorId: 'same', score: 9 - i }));
    const picked = pickShowcase(one);
    assert.equal(picked.length, 2);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 20 }, () => post());
    assert.equal(pickShowcase(many, 8).length, 8);
  });
});

describe('preview cards', () => {
  it('fill the carousel up to its minimum and no further', () => {
    assert.equal(previewsNeeded(0), SHOWCASE_MIN);
    assert.equal(previewsNeeded(2), SHOWCASE_MIN - 2);
    assert.equal(previewsNeeded(SHOWCASE_MIN), 0);
    assert.equal(previewsNeeded(12), 0);
  });

  it('come after the real posts, and are marked as previews', () => {
    const cards = withPreviews([card('a'), card('b')]);
    assert.deepEqual(
      cards.map((entry) => entry.type),
      ['post', 'post', 'preview', 'preview', 'preview'],
    );
  });

  it('are not needed at all once there are enough real posts', () => {
    const real = Array.from({ length: SHOWCASE_MIN }, (_, i) => card(`r${i}`));
    assert.ok(withPreviews(real).every((entry) => entry.type === 'post'));
  });

  it('cover photography, cats, art, gaming and hobbies, and carry no username', () => {
    assert.deepEqual(
      PREVIEW_POSTS.map((preview) => preview.art),
      ['nature', 'cat', 'art', 'gaming', 'car', 'music'],
    );
    for (const preview of PREVIEW_POSTS) {
      assert.ok(!('username' in preview));
      assert.ok(preview.exampleRating >= 1 && preview.exampleRating <= 10);
    }
  });
});

describe('where each card sits around the active one', () => {
  it('puts neighbours either side, wrapping round the ends', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((index) => slideOffset(index, 0, 5)),
      [0, 1, 2, -2, -1],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((index) => slideOffset(index, 4, 5)),
      [1, 2, -2, -1, 0],
    );
  });

  it('never puts two cards in the same place', () => {
    for (const total of [2, 3, 4, 5, 6, 7, 8]) {
      for (let active = 0; active < total; active += 1) {
        const offsets = Array.from({ length: total }, (_, index) =>
          slideOffset(index, active, total),
        );
        assert.equal(new Set(offsets).size, total, `${total} cards, active ${active}`);
      }
    }
  });

  it('is zero for a single card', () => {
    assert.equal(slideOffset(0, 0, 1), 0);
  });
});
