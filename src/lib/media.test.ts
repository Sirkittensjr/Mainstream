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

/**
 * Text over a video and the sound being off are the only two things a client
 * tells the server about a video that the server cannot re-derive from the file.
 * `sanitiseMedia` rebuilds media from scratch, so these are the fields that had
 * to be opted in — which makes this the place where a client's claim about them
 * stops being a claim.
 */
describe('playback properties on a video', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  });

  const video = (over: Record<string, unknown> = {}) =>
    sanitiseMedia([{ kind: 'video', url: `${BUCKET}media/clip.mp4`, ...over }])[0];

  it('keeps a muted flag, and only when it is really true', () => {
    assert.equal(video({ muted: true })?.muted, true);
    // Not a truthy string, not a 1 — the flag is a boolean or it is absent.
    for (const nonsense of ['true', 1, {}, [], 'yes']) {
      assert.equal(video({ muted: nonsense })?.muted, undefined, JSON.stringify(nonsense));
    }
    assert.equal(video()?.muted, undefined);
  });

  it('keeps a text overlay, normalised', () => {
    const [overlay] = video({
      text: [{ text: '  hello   there  ', at: 'top', size: 'l', tone: 'fay' }],
    })!.text!;
    assert.deepEqual(overlay, { text: 'hello there', at: 'top', size: 'l', tone: 'fay' });
  });

  it('falls back to safe values rather than trusting an unknown one', () => {
    // An arbitrary position or colour is how text ends up off-screen or
    // invisible on its own video.
    const [overlay] = video({
      text: [{ text: 'x', at: 'floating', size: 'enormous', tone: '#000000' }],
    })!.text!;
    assert.deepEqual(overlay, { text: 'x', at: 'bottom', size: 'm', tone: 'light' });
  });

  it('caps the length of one line', () => {
    const long = 'a'.repeat(400);
    const [overlay] = video({ text: [{ text: long }] })!.text!;
    assert.equal(overlay.text.length, 120);
  });

  it('caps how many there can be', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `line ${i}` }));
    assert.equal(video({ text: many })!.text!.length, 4);
  });

  it('drops blank and non-object entries instead of storing empty boxes', () => {
    assert.equal(video({ text: [{ text: '   ' }, { text: '' }, null, 'nope', 7] })?.text, undefined);
    assert.equal(video({ text: [] })?.text, undefined);
    assert.equal(video({ text: 'not an array' })?.text, undefined);
  });

  it('keeps the good entries from a mixed list', () => {
    const overlays = video({ text: [{ text: '' }, { text: 'keep me' }, null] })!.text!;
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].text, 'keep me');
  });

  /**
   * An image has no playback properties. Accepting them there would mean the
   * feed had to decide what muted means for a photograph.
   */
  it('ignores both on an image', () => {
    const [image] = sanitiseMedia([
      { kind: 'image', url: `${BUCKET}media/photo.jpg`, muted: true, text: [{ text: 'hi' }] },
    ]);
    assert.equal(image.muted, undefined);
    assert.equal(image.text, undefined);
  });

  /** The strings are rendered as React text, so they are escaped by the
   *  renderer — but they are kept as DATA here, not interpreted. */
  it('keeps markup as the literal text it is', () => {
    const [overlay] = video({ text: [{ text: '<script>alert(1)</script>' }] })!.text!;
    assert.equal(overlay.text, '<script>alert(1)</script>');
  });
});
