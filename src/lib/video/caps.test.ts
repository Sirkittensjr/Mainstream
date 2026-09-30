import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_VIDEO_SECONDS, RECORD_CAPS, capLabel } from './limits';

describe('the caps the camera offers', () => {
  it('offers a short, a medium and the full length', () => {
    assert.deepEqual([...RECORD_CAPS], [15, 60, 120]);
  });

  /**
   * The cap is a decision about the video, never a way past the limit. If a cap
   * could exceed MAX_VIDEO_SECONDS the camera would let somebody film something
   * the server then refuses — a trap rather than a control.
   */
  it('never offers more than the platform allows', () => {
    for (const cap of RECORD_CAPS) {
      assert.ok(cap <= MAX_VIDEO_SECONDS, `${cap} is over the ${MAX_VIDEO_SECONDS}s limit`);
      assert.ok(cap > 0, `${cap} is not a length`);
    }
  });

  it('includes the full length, so the longest video is still reachable', () => {
    assert.ok((RECORD_CAPS as readonly number[]).includes(MAX_VIDEO_SECONDS));
  });

  it('labels them the way a camera does', () => {
    assert.equal(capLabel(15), '15s');
    assert.equal(capLabel(60), '60s');
    assert.equal(capLabel(120), '2m');
    assert.equal(capLabel(180), '3m');
    // Not a round number of minutes: seconds is clearer than "1.5m".
    assert.equal(capLabel(90), '90s');
  });
});
