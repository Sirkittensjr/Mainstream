import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeVideo, probeVideoParts } from './probe';

/* ------------------------------------------------------------ MP4 builders */

const bytes = (...values: number[]) => Uint8Array.from(values);

const be32 = (value: number) =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

const be64 = (value: number) =>
  concat(be32(Math.floor(value / 2 ** 32)), be32(value >>> 0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

/** `[size][type][payload]`, the shape every MP4 box has. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(be32(body.length + 8), ascii(type), body);
}

/** The 3x3 display matrix, as a quarter-turn. */
function matrix(rotation: 0 | 90 | 180 | 270): Uint8Array {
  const one = 0x00010000;
  const minusOne = -0x00010000 >>> 0;
  const cells =
    rotation === 90
      ? [0, one, 0, minusOne, 0, 0]
      : rotation === 270
        ? [0, minusOne, 0, one, 0, 0]
        : rotation === 180
          ? [minusOne, 0, 0, 0, minusOne, 0]
          : [one, 0, 0, 0, one, 0];
  return concat(...cells.map(be32), be32(0), be32(0), be32(0x40000000));
}

function mvhd({ timescale, duration }: { timescale: number; duration: number }) {
  return box('mvhd', be32(0), be32(0), be32(0), be32(timescale), be32(duration), new Uint8Array(80));
}

function tkhd({
  id,
  width,
  height,
  rotation = 0,
}: {
  id: number;
  width: number;
  height: number;
  rotation?: 0 | 90 | 180 | 270;
}) {
  return box(
    'tkhd',
    be32(0), // version 0 + flags
    be32(0), // creation
    be32(0), // modification
    be32(id),
    be32(0), // reserved
    be32(0), // duration
    new Uint8Array(8), // reserved
    new Uint8Array(8), // layer, alternate group, volume, reserved
    matrix(rotation),
    be32(width * 65536),
    be32(height * 65536),
  );
}

const mdhd = (timescale: number) =>
  box('mdhd', be32(0), be32(0), be32(0), be32(timescale), be32(0), be32(0));

const trak = (track: Parameters<typeof tkhd>[0] & { timescale?: number }) =>
  box('trak', tkhd(track), box('mdia', mdhd(track.timescale ?? 600)));

const mp4 = (...moovChildren: Uint8Array[]) =>
  concat(box('ftyp', ascii('isom'), be32(512), ascii('isomiso2')), box('moov', ...moovChildren));

/* ----------------------------------------------------------- WebM builders */

/** An EBML id, which is already a vint and is written as-is. */
const id = (value: number) => {
  const out: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    out.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return bytes(...out);
};

/** A size as a 4-byte vint, which is plenty for a test fixture. */
const size = (value: number) =>
  bytes(0x10 | ((value >>> 24) & 0x0f), (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

function element(elementId: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(id(elementId), size(body.length), body);
}

/** An element whose length the writer did not know — what MediaRecorder emits. */
const unknownSize = (elementId: number, ...payload: Uint8Array[]) =>
  concat(id(elementId), bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), ...payload);

const uint = (value: number) => {
  const out: number[] = [];
  let remaining = Math.round(value);
  do {
    out.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return bytes(...out);
};

const float64 = (value: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
};

const EBML_HEADER = element(0x1a45dfa3, element(0x4286, uint(1)));

const videoTrack = (width: number, height: number) =>
  element(0x1654ae6b, element(0xae, element(0xe0, element(0xb0, uint(width)), element(0xba, uint(height)))));

const cluster = (timecodeMs: number) =>
  element(0x1f43b675, element(0xe7, uint(timecodeMs)), element(0xa3, bytes(0x81, 0, 0, 0x80, 1, 2, 3)));

/* --------------------------------------------------------------- the tests */

describe('probeVideo — MP4 and MOV', () => {
  it('reads the length from the movie header', () => {
    const file = mp4(mvhd({ timescale: 600, duration: 600 * 42 }), trak({ id: 1, width: 1920, height: 1080 }));
    const probe = probeVideo(file);
    assert.equal(probe.seconds, 42);
    assert.equal(probe.width, 1920);
    assert.equal(probe.height, 1080);
  });

  it('sees a video longer than the limit for what it is', () => {
    const file = mp4(mvhd({ timescale: 1000, duration: 1000 * 600 }), trak({ id: 1, width: 720, height: 1280 }));
    assert.equal(probeVideo(file).seconds, 600);
  });

  it('swaps the dimensions a phone filmed sideways', () => {
    const upright = mp4(
      mvhd({ timescale: 600, duration: 600 }),
      trak({ id: 1, width: 1920, height: 1080, rotation: 90 }),
    );
    const probe = probeVideo(upright);
    assert.equal(probe.width, 1080);
    assert.equal(probe.height, 1920);
  });

  it('ignores the audio track when deciding the picture size', () => {
    const file = mp4(
      mvhd({ timescale: 600, duration: 1200 }),
      trak({ id: 1, width: 0, height: 0 }),
      trak({ id: 2, width: 640, height: 640 }),
    );
    const probe = probeVideo(file);
    assert.equal(probe.width, 640);
    assert.equal(probe.height, 640);
  });

  it('falls back to the fragment header when the movie header says nothing', () => {
    const file = concat(
      mp4(
        mvhd({ timescale: 1000, duration: 0 }),
        trak({ id: 1, width: 720, height: 1280 }),
        box('mvex', box('mehd', be32(0), be32(1000 * 95))),
      ),
    );
    assert.equal(probeVideo(file).seconds, 95);
  });

  it('measures a fragmented recording by its last fragment', () => {
    // Safari's MediaRecorder: mvhd duration 0, no mehd, length only in tfdt.
    const head = mp4(mvhd({ timescale: 1000, duration: 0 }), trak({ id: 1, width: 720, height: 1280, timescale: 90000 }));
    const fragment = (decodeTime: number) =>
      box('moof', box('traf', box('tfhd', be32(0), be32(1)), box('tfdt', be32(0x01000000), be64(decodeTime))));
    const file = concat(head, fragment(0), fragment(90000 * 60), fragment(90000 * 121));
    const seconds = probeVideo(file).seconds;
    assert.ok(seconds !== null && Math.abs(seconds - 121) < 0.01, `got ${seconds}`);
  });

  it('says nothing rather than guessing at a file it cannot read', () => {
    assert.deepEqual(probeVideo(ascii('not a video at all, not even close')), {
      seconds: null,
      width: null,
      height: null,
    });
  });
});

describe('probeVideo — WebM', () => {
  it('reads the duration the writer recorded', () => {
    const file = concat(
      EBML_HEADER,
      element(
        0x18538067,
        element(0x1549a966, element(0x2ad7b1, uint(1_000_000)), element(0x4489, float64(64_500))),
        videoTrack(1280, 720),
      ),
    );
    const probe = probeVideo(file);
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 64.5) < 0.001);
    assert.equal(probe.width, 1280);
    assert.equal(probe.height, 720);
  });

  it('measures a live recording by its last cluster', () => {
    // What MediaRecorder actually writes: unknown-size segment, no Duration.
    const file = concat(
      EBML_HEADER,
      unknownSize(
        0x18538067,
        element(0x1549a966, element(0x2ad7b1, uint(1_000_000))),
        videoTrack(720, 1280),
        cluster(0),
        cluster(30_000),
        cluster(170_000),
      ),
    );
    const probe = probeVideo(file);
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 170) < 0.01, `got ${probe.seconds}`);
    assert.equal(probe.width, 720);
    assert.equal(probe.height, 1280);
  });

  it('catches an over-length live recording that carries no duration', () => {
    const file = concat(
      EBML_HEADER,
      unknownSize(0x18538067, videoTrack(640, 480), cluster(0), cluster(240_000)),
    );
    const probe = probeVideo(file);
    assert.ok(probe.seconds !== null && probe.seconds > 180, `got ${probe.seconds}`);
  });

  it('honours a non-default timecode scale', () => {
    const file = concat(
      EBML_HEADER,
      element(
        0x18538067,
        element(0x1549a966, element(0x2ad7b1, uint(1_000_000_000)), element(0x4489, float64(12))),
        videoTrack(100, 100),
      ),
    );
    assert.equal(probeVideo(file).seconds, 12);
  });
});

describe('probeVideoParts — verifying an upload from both ends of the file', () => {
  const head = (length: number) => new Uint8Array(length).fill(0x41);

  it('reads a trailing moov out of the tail', () => {
    // A recorder that writes the header last: the head is media data only.
    const trailer = mp4(mvhd({ timescale: 600, duration: 600 * 150 }), trak({ id: 1, width: 1920, height: 1080 }));
    const tail = concat(bytes(0, 0, 0x40, 0x00), ascii('mdat'), head(64), trailer);
    const probe = probeVideoParts(concat(box('ftyp', ascii('isom'), be32(512)), head(4096)), tail);
    assert.equal(probe.seconds, 150);
  });

  it('catches an over-length video whose header is at the end', () => {
    const trailer = mp4(mvhd({ timescale: 1000, duration: 1000 * 420 }), trak({ id: 1, width: 720, height: 1280 }));
    const probe = probeVideoParts(head(4096), concat(head(128), trailer));
    assert.ok(probe.seconds !== null && probe.seconds > 180, `got ${probe.seconds}`);
  });

  it('times a fragmented file by the fragments in its tail', () => {
    const moovHead = mp4(
      mvhd({ timescale: 1000, duration: 0 }),
      trak({ id: 1, width: 720, height: 1280, timescale: 90000 }),
    );
    const fragment = (decodeTime: number) =>
      box('moof', box('traf', box('tfhd', be32(0), be32(1)), box('tfdt', be32(0x01000000), be64(decodeTime))));
    const probe = probeVideoParts(moovHead, concat(fragment(90000 * 200), fragment(90000 * 260)));
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 260) < 0.01, `got ${probe.seconds}`);
  });

  it('reads the last cluster of a live WebM recording out of the tail', () => {
    const webmHead = concat(
      EBML_HEADER,
      unknownSize(0x18538067, element(0x1549a966, element(0x2ad7b1, uint(1_000_000))), videoTrack(720, 1280)),
    );
    const probe = probeVideoParts(webmHead, concat(cluster(150_000), cluster(220_000)));
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 220) < 0.01, `got ${probe.seconds}`);
    assert.equal(probe.width, 720);
  });

  it('prefers what the head already said', () => {
    const file = mp4(mvhd({ timescale: 600, duration: 600 * 12 }), trak({ id: 1, width: 640, height: 480 }));
    assert.equal(probeVideoParts(file, concat(cluster(999_000))).seconds, 12);
  });

  it('does not stop at the last cluster it can see in the head', () => {
    // The bug this guards: a long live recording whose head holds plenty of
    // clusters answers from the head and never looks at the tail, so a
    // six-minute video reports four and slips past the length limit.
    const webmHead = concat(
      EBML_HEADER,
      unknownSize(
        0x18538067,
        element(0x1549a966, element(0x2ad7b1, uint(1_000_000))),
        videoTrack(320, 240),
        cluster(0),
        cluster(60_000),
        cluster(128_000),
      ),
    );
    const probe = probeVideoParts(webmHead, concat(cluster(300_000), cluster(360_000)));
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 360) < 0.01, `got ${probe.seconds}`);
  });

  it('does not stop at the fragments in the head either', () => {
    const moovHead = mp4(
      mvhd({ timescale: 1000, duration: 0 }),
      trak({ id: 1, width: 320, height: 240, timescale: 1000 }),
    );
    const fragment = (decodeTime: number) =>
      box('moof', box('traf', box('tfhd', be32(0), be32(1)), box('tfdt', be32(0), be32(decodeTime))));
    const head = concat(moovHead, fragment(0), fragment(100_000));
    const probe = probeVideoParts(head, concat(fragment(340_000), fragment(400_000)));
    assert.ok(probe.seconds !== null && Math.abs(probe.seconds - 400) < 0.01, `got ${probe.seconds}`);
  });

  it('gives up rather than guessing when neither end says anything', () => {
    assert.equal(probeVideoParts(head(2048), head(2048)).seconds, null);
  });
});
