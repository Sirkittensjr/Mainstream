import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FULL_FRAME, needsRender, type Clip } from './clips';
import { recordedContainer, recordedExtension, recordedFile } from './recording';
import { UPLOADABLE } from './limits';

describe('recordedContainer', () => {
  /**
   * The upload routes accept a bare type from a fixed list, so the codec suffix
   * MediaRecorder reports has to come off before anything is signed. Sending
   * `video/webm;codecs=vp9,opus` gets a 415 and the person never finds out why.
   */
  it('strips the codec list browsers append', () => {
    assert.equal(recordedContainer('video/webm;codecs=vp9,opus'), 'video/webm');
    assert.equal(recordedContainer('video/webm;codecs=vp8,opus'), 'video/webm');
    assert.equal(recordedContainer('video/mp4;codecs=avc1.4d002a,mp4a.40.2'), 'video/mp4');
    assert.equal(recordedContainer('video/mp4;codecs=avc1,mp4a'), 'video/mp4');
  });

  it('leaves a bare type alone', () => {
    assert.equal(recordedContainer('video/mp4'), 'video/mp4');
    assert.equal(recordedContainer('video/webm'), 'video/webm');
    assert.equal(recordedContainer('video/quicktime'), 'video/quicktime');
  });

  it('is case and whitespace insensitive, because the string comes from a browser', () => {
    assert.equal(recordedContainer('VIDEO/WEBM; codecs="vp9"'), 'video/webm');
    assert.equal(recordedContainer('  video/mp4  '), 'video/mp4');
  });

  it('falls back to WebM rather than to something certainly refused', () => {
    // Every browser that can record produces MP4 or WebM, so a type nobody
    // recognises is far more likely a spelling than a real third container.
    for (const odd of ['', 'video/x-matroska;codecs=avc1', 'application/octet-stream', 'nonsense']) {
      assert.equal(recordedContainer(odd), 'video/webm', odd);
    }
  });

  /** The contract that matters: whatever comes out, the server will take it. */
  it('always returns a type the upload routes accept', () => {
    const inputs = [
      'video/webm;codecs=vp9,opus',
      'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
      'video/quicktime',
      'video/x-matroska',
      '',
    ];
    for (const input of inputs) {
      assert.ok(
        (UPLOADABLE as string[]).includes(recordedContainer(input)),
        `${input} -> ${recordedContainer(input)} is not uploadable`,
      );
    }
  });
});

describe('recordedExtension', () => {
  it('matches the container', () => {
    assert.equal(recordedExtension('video/mp4;codecs=avc1'), 'mp4');
    assert.equal(recordedExtension('video/webm;codecs=vp9,opus'), 'webm');
    assert.equal(recordedExtension('video/quicktime'), 'mov');
    assert.equal(recordedExtension('who knows'), 'webm');
  });
});

describe('recordedFile', () => {
  const blob = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/webm;codecs=vp9' });

  it('keeps the recorded bytes exactly as they are', async () => {
    const source = blob();
    const file = recordedFile(source, 'video/webm;codecs=vp9,opus', 1);
    assert.equal(file.size, source.size);
    assert.deepEqual(
      [...new Uint8Array(await file.arrayBuffer())],
      [1, 2, 3, 4],
      'a recording must not be re-encoded on its way into a clip',
    );
  });

  it('labels it with a bare type and a matching extension', () => {
    const file = recordedFile(blob(), 'video/webm;codecs=vp9,opus', 2);
    assert.equal(file.type, 'video/webm');
    assert.equal(file.name, 'recording-2.webm');

    const mp4 = recordedFile(blob(), 'video/mp4;codecs=avc1,mp4a', 1);
    assert.equal(mp4.type, 'video/mp4');
    assert.equal(mp4.name, 'recording-1.mp4');
  });
});

/**
 * The reason this module exists.
 *
 * `needsRender` reads `clip.file` as "we still have the original bytes". A
 * recording handed over as a bare Blob has none, so it was re-encoded in real
 * time — two more minutes of waiting on a two-minute video, to arrive back at
 * bytes the upload routes already accepted. These are the regression guards.
 */
describe('an untouched recording is not re-encoded', () => {
  const clipFrom = (file: File | undefined, over: Partial<Clip> = {}): Clip => ({
    id: 'c1',
    src: 'blob:x',
    label: 'Recording 1',
    sourceDuration: 8,
    sourceWidth: 1280,
    sourceHeight: 720,
    trimStart: 0,
    trimEnd: 8,
    crop: FULL_FRAME,
    rotation: 0,
    volume: 1,
    file,
    ...over,
  });

  it('a recording carried as a File skips the render pass', () => {
    const file = recordedFile(new Blob(['x']), 'video/webm;codecs=vp9,opus', 1);
    assert.equal(needsRender([clipFrom(file)]), false);
  });

  it('a recording carried as a bare Blob does not — which is the old bug', () => {
    assert.equal(needsRender([clipFrom(undefined)]), true);
  });

  it('but an EDITED recording still renders, because the bytes have to change', () => {
    const file = recordedFile(new Blob(['x']), 'video/webm;codecs=vp9,opus', 1);
    assert.equal(needsRender([clipFrom(file, { rotation: 90 })]), true);
    assert.equal(needsRender([clipFrom(file, { trimStart: 1 })]), true);
    assert.equal(needsRender([clipFrom(file, { trimEnd: 4 })]), true);
    assert.equal(needsRender([clipFrom(file, { volume: 0 })]), true);
    assert.equal(
      needsRender([clipFrom(file, { crop: { x: 0.1, y: 0, width: 0.8, height: 1 } })]),
      true,
    );
  });

  it('and two recordings still render, because they have to be joined', () => {
    const file = recordedFile(new Blob(['x']), 'video/webm;codecs=vp9,opus', 1);
    assert.equal(needsRender([clipFrom(file), clipFrom(file, { id: 'c2' })]), true);
  });
});
