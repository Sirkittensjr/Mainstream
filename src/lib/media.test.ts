import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isOwnMediaUrl, mediaKindForUrl, sanitiseAvatarUrl, sanitiseMedia } from './media';

const PROJECT = 'https://abcdefgh.supabase.co';
const BUCKET = `${PROJECT}/storage/v1/object/public/faytarra-media/`;

describe('which media URLs are allowed on a post', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  });

  it('accepts an upload this deployment published', () => {
    assert.equal(isOwnMediaUrl(`${BUCKET}media/user-1/abc.mp4`), true);
    assert.equal(isOwnMediaUrl('/api/media/abc.mp4'), true);
  });

  it('refuses an upload that has not been checked yet', () => {
    // This is the whole reason an upload lands in `pending/` first: skipping
    // the size and duration checks has to leave you with nothing to post.
    assert.equal(isOwnMediaUrl(`${BUCKET}pending/user-1/abc.mp4`), false);
    assert.deepEqual(sanitiseMedia([{ kind: 'video', url: `${BUCKET}pending/user-1/abc.mp4` }]), []);
  });

  it('refuses somebody else\'s server entirely', () => {
    for (const url of [
      'https://evil.example/tracker.gif',
      'https://abcdefgh.supabase.co.evil.example/storage/v1/object/public/faytarra-media/media/a.mp4',
      'javascript:alert(1)',
      `${BUCKET}media/../../pending/user-1/abc.mp4`,
    ]) {
      assert.equal(isOwnMediaUrl(url), false, url);
    }
  });

  it('decides video or image from the name the server gave the file', () => {
    // The client saying `kind: 'image'` about an .mp4 does not make it one.
    const [item] = sanitiseMedia([{ kind: 'image', url: `${BUCKET}media/u/abc.mp4` }]);
    assert.equal(item.kind, 'video');
    assert.equal(mediaKindForUrl('/api/media/x.webm'), 'video');
    assert.equal(mediaKindForUrl('/api/media/x.png'), 'image');
  });

  it('holds a poster to the same rule as the video', () => {
    const [kept] = sanitiseMedia([
      { kind: 'video', url: `${BUCKET}media/u/a.mp4`, poster: `${BUCKET}media/u/a.jpg` },
    ]);
    assert.equal(kept.poster, `${BUCKET}media/u/a.jpg`);

    const [stripped] = sanitiseMedia([
      { kind: 'video', url: `${BUCKET}media/u/a.mp4`, poster: 'https://evil.example/pixel.gif' },
    ]);
    assert.equal(stripped.poster, undefined);
  });

  it('keeps a plausible size and duration, and drops nonsense', () => {
    const [good] = sanitiseMedia([
      { url: `${BUCKET}media/u/a.mp4`, width: 1080, height: 1920, duration: 42.5 },
    ]);
    assert.deepEqual([good.width, good.height, good.duration], [1080, 1920, 42.5]);

    const [bad] = sanitiseMedia([
      { url: `${BUCKET}media/u/a.mp4`, width: -5, height: 99999, duration: Number.NaN },
    ]);
    assert.equal(bad.width, undefined);
    assert.equal(bad.height, undefined);
    assert.equal(bad.duration, undefined);
  });

  it('never carries a duration on an image', () => {
    const [item] = sanitiseMedia([{ url: `${BUCKET}media/u/a.png`, duration: 90 }]);
    assert.equal(item.duration, undefined);
  });

  it('stops at the limit it was given', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `${BUCKET}media/u/${i}.png` }));
    assert.equal(sanitiseMedia(many, 6).length, 6);
    assert.equal(sanitiseMedia(many, 1).length, 1);
  });

  it('treats an avatar exactly the same way', () => {
    assert.equal(sanitiseAvatarUrl(`${BUCKET}media/u/a.png`), `${BUCKET}media/u/a.png`);
    assert.equal(sanitiseAvatarUrl(`${BUCKET}pending/u/a.png`), null);
    assert.equal(sanitiseAvatarUrl('https://evil.example/a.png'), null);
  });
});
