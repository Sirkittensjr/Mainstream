import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { exclusiveMedia, storedMediaFor } = require('./media') as typeof import('./media');

const BUCKET = 'https://proj.supabase.co/storage/v1/object/public/faytarra-media/';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

describe('where a stored file is', () => {
  it('a checked upload is in its owner’s folder', () => {
    assert.deepEqual(storedMediaFor(`${BUCKET}media/${alice}/clip.mp4`), {
      store: 'bucket',
      path: `media/${alice}/clip.mp4`,
      owner: alice,
    });
  });

  it('an object from before folders has no owner in its path', () => {
    assert.deepEqual(storedMediaFor(`${BUCKET}abc.jpg`), { store: 'bucket', path: 'abc.jpg', owner: null });
  });

  it('a local upload', () => {
    assert.deepEqual(storedMediaFor('/api/media/abc.jpg'), { store: 'local', name: 'abc.jpg' });
  });

  it('nothing it did not store or check: other sites, unchecked uploads, generated covers, traversal', () => {
    for (const url of [
      'https://evil.example/x.jpg',
      `${BUCKET}pending/${alice}/x.mp4`,
      '/api/cover/Life-tommy-1',
      '/api/media/../secrets.json',
      `${BUCKET}media/../x.jpg`,
    ]) {
      assert.equal(storedMediaFor(url), null, url);
    }
  });
});

describe('which of a deleted post’s files may go', () => {
  const video = `${BUCKET}media/${alice}/clip.mp4`;
  const poster = `${BUCKET}media/${alice}/cover.jpg`;

  it('the video and its poster, when nothing else uses them', () => {
    const doomed = exclusiveMedia([{ kind: 'video', url: video, poster }], alice, new Set());
    assert.deepEqual(doomed.map((d) => d.url), [video, poster]);
  });

  it('never one something still uses', () => {
    const doomed = exclusiveMedia([{ kind: 'video', url: video, poster }], alice, new Set([poster]));
    assert.deepEqual(doomed.map((d) => d.url), [video]);
  });

  it('never one in somebody else’s folder, even with nothing using it', () => {
    const theirs = `${BUCKET}media/${bob}/photo.jpg`;
    assert.deepEqual(exclusiveMedia([{ kind: 'image', url: theirs }], alice, new Set()), []);
  });

  it('a file listed twice is deleted once', () => {
    const doomed = exclusiveMedia(
      [
        { kind: 'image', url: poster },
        { kind: 'video', url: video, poster },
      ],
      alice,
      new Set(),
    );
    assert.equal(doomed.length, 2);
  });
});
