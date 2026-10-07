import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIO_BITS_PER_SECOND, OUTPUT_FPS, VIDEO_BITS_PER_SECOND } from './render';
import { FULL_FRAME, type Clip, outputFrame } from './clips';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from './limits';

const camera = (width: number, height: number): Clip => ({
  id: 'c',
  src: 'blob:x',
  label: 'Recording 1',
  sourceDuration: 5,
  sourceWidth: width,
  sourceHeight: height,
  trimStart: 0,
  trimEnd: 5,
  crop: FULL_FRAME,
  rotation: 0,
  volume: 1,
  fromCamera: true,
});

describe('render output settings', () => {
  it('encodes video at 10 Mb/s — 6 Mb/s was measured starving 1080x1920 of detail', () => {
    assert.equal(VIDEO_BITS_PER_SECOND, 10_000_000);
  });

  it('states the audio bitrate instead of leaving it to each browser', () => {
    assert.equal(AUDIO_BITS_PER_SECOND, 128_000);
  });

  it('keeps 30 frames a second', () => {
    assert.equal(OUTPUT_FPS, 30);
  });

  it('fits the longest video under the upload limit, with room for an encoder that overshoots', () => {
    const bytes = ((VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) * MAX_VIDEO_SECONDS) / 8;
    // Hardware encoders treat the bitrate as a target; 25% over is well past
    // what was measured, and must still upload.
    assert.ok(bytes * 1.25 <= MAX_VIDEO_BYTES, `${Math.round(bytes / 1e6)}MB at target`);
  });

  it('renders camera clips to exactly 1080x1920, whatever the sensor handed back', () => {
    for (const [width, height] of [
      [1080, 1920],
      [1920, 1080],
      [1216, 2160],
      [720, 1280],
    ]) {
      const frame = outputFrame([camera(width, height)]);
      assert.deepEqual([frame.width, frame.height, frame.fit], [1080, 1920, 'cover']);
    }
  });

  it('prefers H.264 MP4, the format every iPhone plays', async () => {
    const calls: string[] = [];
    const original = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
      isTypeSupported: (type: string) => {
        calls.push(type);
        return true;
      },
    };
    try {
      const { pickMimeType } = await import('./render');
      assert.equal(pickMimeType(), 'video/mp4;codecs=avc1.4d002a,mp4a.40.2');
      assert.equal(calls[0], 'video/mp4;codecs=avc1.4d002a,mp4a.40.2');
    } finally {
      (globalThis as { MediaRecorder?: unknown }).MediaRecorder = original;
    }
  });
});
