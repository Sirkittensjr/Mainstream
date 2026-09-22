/**
 * How long a video is, and how big its picture is, read from the file itself.
 *
 * The length limit has to hold against a request that never went near the
 * editor, and the only thing a server can trust about an upload is its bytes.
 * There is no ffmpeg here on purpose: MP4/MOV and WebM both state their own
 * duration in the container header, which is a few hundred lines of parsing
 * rather than a 30MB dependency and a transcode farm.
 *
 * What is measured is also what decides playback length — a player derives the
 * same number from the same fields — so a file that lies here plays short too.
 * There is nothing to gain by tampering.
 */

export interface VideoProbe {
  /** Seconds, or null when the container never says. */
  seconds: number | null;
  /** Display size in pixels, with any rotation already applied. */
  width: number | null;
  height: number | null;
}

const EMPTY: VideoProbe = { seconds: null, width: null, height: null };

export function probeVideo(bytes: Uint8Array): VideoProbe {
  if (bytes.length < 16) return EMPTY;
  // EBML magic. Both WebM and MKV start here; we only ever get WebM.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return probeWebm(bytes);
  }
  return probeIsoBmff(bytes);
}

/* ---------------------------------------------------------------- MP4 / MOV */

interface Box {
  type: string;
  start: number;
  end: number;
}

const u32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/** 64-bit fields, as a Number. Sizes past 2^53 are not a thing we will see. */
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);

const fourcc = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The boxes directly inside [from, to). */
function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = u64(bytes, at + 8);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type: fourcc(bytes, at + 4), start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const findBox = (boxes: Box[], type: string): Box | null =>
  boxes.find((box) => box.type === type) ?? null;

/** Every box of this type at any depth, for the ones scattered across fragments. */
function findAll(bytes: Uint8Array, from: number, to: number, type: string, out: Box[] = []): Box[] {
  for (const box of boxesIn(bytes, from, to)) {
    if (box.type === type) out.push(box);
    // Only containers are worth descending into; a media data box is not one.
    if (CONTAINERS.has(box.type)) findAll(bytes, box.start, box.end, type, out);
  }
  return out;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'mvex', 'edts']);

/** The rotation the matrix in `tkhd` encodes, as degrees. */
function matrixRotation(bytes: Uint8Array, at: number): number {
  // 3x3 of 16.16 fixed point; a and b are enough to tell the quarter turns apart.
  const a = (u32(bytes, at) | 0) / 65536;
  const b = (u32(bytes, at + 4) | 0) / 65536;
  if (Math.abs(a) < 0.01 && b > 0.5) return 90;
  if (Math.abs(a) < 0.01 && b < -0.5) return 270;
  if (a < -0.5) return 180;
  return 0;
}

interface Track {
  id: number;
  timescale: number;
  width: number;
  height: number;
}

function readTrack(bytes: Uint8Array, trak: Box): Track | null {
  const children = boxesIn(bytes, trak.start, trak.end);
  const tkhd = findBox(children, 'tkhd');
  if (!tkhd) return null;

  const version = bytes[tkhd.start];
  const idAt = tkhd.start + (version === 1 ? 4 + 16 : 4 + 8);
  const id = u32(bytes, idAt);
  // track_id, reserved, duration, reserved(8), layer+alternate+volume+reserved(8)
  const afterDuration = idAt + 4 + 4 + (version === 1 ? 8 : 4);
  const matrixAt = afterDuration + 8 + 8;
  const rotation = matrixAt + 36 + 8 <= tkhd.end ? matrixRotation(bytes, matrixAt) : 0;
  let width = matrixAt + 36 + 8 <= tkhd.end ? u32(bytes, matrixAt + 36) / 65536 : 0;
  let height = matrixAt + 36 + 8 <= tkhd.end ? u32(bytes, matrixAt + 40) / 65536 : 0;
  // A phone films sideways and marks it in the matrix. What a player shows —
  // and therefore the aspect the post has to reserve — is the swapped pair.
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const mdia = findBox(children, 'mdia');
  const mdhd = mdia ? findBox(boxesIn(bytes, mdia.start, mdia.end), 'mdhd') : null;
  let timescale = 0;
  if (mdhd) {
    const mdhdVersion = bytes[mdhd.start];
    timescale = u32(bytes, mdhd.start + (mdhdVersion === 1 ? 4 + 16 : 4 + 8));
  }

  return { id, timescale, width: Math.round(width), height: Math.round(height) };
}

/**
 * The `moov` box, even in a buffer that starts mid-file.
 *
 * Verification reads the head and the tail of an uploaded object rather than
 * the whole thing, and plenty of recorders write `moov` last — so the tail is
 * a buffer whose first byte is the middle of some other box. Walking it from
 * offset zero finds nothing; scanning for the box's own name does.
 */
function findMoov(bytes: Uint8Array): Box | null {
  const aligned = findBox(boxesIn(bytes, 0, bytes.length), 'moov');
  if (aligned) return aligned;

  for (let at = 4; at + 8 < bytes.length; at += 1) {
    if (bytes[at] !== 0x6d || bytes[at + 1] !== 0x6f) continue; // "mo"
    if (bytes[at + 2] !== 0x6f || bytes[at + 3] !== 0x76) continue; // "ov"
    const start = at - 4;
    const size = u32(bytes, start);
    if (size < 16 || start + size > bytes.length) continue;
    // A real moov opens with a box of its own; random bytes almost never do.
    const inner = boxesIn(bytes, start + 8, start + size);
    if (inner.length > 0) return { type: 'moov', start: start + 8, end: start + size };
  }
  return null;
}

function probeIsoBmff(bytes: Uint8Array): VideoProbe {
  const moov = findMoov(bytes);
  if (!moov) return EMPTY;
  const moovChildren = boxesIn(bytes, moov.start, moov.end);

  const tracks = moovChildren
    .filter((box) => box.type === 'trak')
    .map((trak) => readTrack(bytes, trak))
    .filter((track): track is Track => track !== null);

  // The video track is the one with a picture. Audio tracks report 0x0.
  const picture = tracks
    .filter((track) => track.width > 0 && track.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  const seconds =
    movieDuration(bytes, moovChildren) ??
    fragmentHeaderDuration(bytes, moovChildren) ??
    fragmentedDuration(bytes, tracks);


  return { seconds, width: picture?.width ?? null, height: picture?.height ?? null };
}

/** The length in `mvhd`. Zero or the unknown marker means it does not say. */
function movieDuration(bytes: Uint8Array, moovChildren: Box[]): number | null {
  const mvhd = findBox(moovChildren, 'mvhd');
  if (!mvhd) return null;
  const version = bytes[mvhd.start];
  const at = mvhd.start + (version === 1 ? 4 + 16 : 4 + 8);
  const timescale = u32(bytes, at);
  const duration = version === 1 ? u64(bytes, at + 4) : u32(bytes, at + 4);
  // 0xFFFFFFFF is the "unknown" marker a fragmented file writes here.
  if (timescale <= 0 || duration <= 0 || duration === 0xffffffff) return null;
  return duration / timescale;
}

/** The total a fragmented file declares up front in `mehd`, when it has one. */
function fragmentHeaderDuration(bytes: Uint8Array, moovChildren: Box[]): number | null {
  const mvhd = findBox(moovChildren, 'mvhd');
  const mvex = findBox(moovChildren, 'mvex');
  const mehd = mvex ? findBox(boxesIn(bytes, mvex.start, mvex.end), 'mehd') : null;
  if (!mehd || !mvhd) return null;
  const timescale = u32(bytes, mvhd.start + (bytes[mvhd.start] === 1 ? 20 : 12));
  if (timescale <= 0) return null;
  const version = bytes[mehd.start];
  const fragmentDuration = version === 1 ? u64(bytes, mehd.start + 4) : u32(bytes, mehd.start + 4);
  return fragmentDuration > 0 ? fragmentDuration / timescale : null;
}

/**
 * Length of a fragmented file, from its fragments.
 *
 * Safari's MediaRecorder writes fragmented MP4 with no duration in `mvhd`, so
 * the only record of how long it runs is the decode time each fragment starts
 * at. The last one plus its own length is the answer; this reads the start and
 * lets the tolerance in limits.ts cover the final fragment.
 */
function fragmentedDuration(bytes: Uint8Array, tracks: Track[]): number | null {
  const timescaleFor = new Map(tracks.map((track) => [track.id, track.timescale]));
  let longest: number | null = null;

  for (const moof of findAll(bytes, 0, bytes.length, 'moof')) {
    for (const traf of boxesIn(bytes, moof.start, moof.end).filter((b) => b.type === 'traf')) {
      const children = boxesIn(bytes, traf.start, traf.end);
      const tfhd = findBox(children, 'tfhd');
      const tfdt = findBox(children, 'tfdt');
      if (!tfhd || !tfdt) continue;
      const timescale = timescaleFor.get(u32(bytes, tfhd.start + 4)) ?? 0;
      if (timescale <= 0) continue;
      const version = bytes[tfdt.start];
      const base = version === 1 ? u64(bytes, tfdt.start + 4) : u32(bytes, tfdt.start + 4);
      const seconds = base / timescale;
      if (longest === null || seconds > longest) longest = seconds;
    }
  }
  return longest;
}

/* -------------------------------------------------------------------- WebM */

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const VIDEO = 0xe0;
const CLUSTER = 0x1f43b675;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const DISPLAY_WIDTH = 0x54b0;
const DISPLAY_HEIGHT = 0x54ba;
const CLUSTER_TIMECODE = 0xe7;

interface Element {
  id: number;
  start: number;
  end: number;
  /** True when the writer did not know the size yet — normal for a live recording. */
  unknownSize: boolean;
}

/** An EBML variable-length integer. `keepMarker` is what tells an ID from a size. */
function vint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length += 1;
  if (length > 8 || at + length > bytes.length) return null;

  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, allOnes };
}

function readElement(bytes: Uint8Array, at: number, limit: number): Element | null {
  const id = vint(bytes, at, true);
  if (!id || at + id.length >= limit) return null;
  const size = vint(bytes, at + id.length, false);
  if (!size) return null;
  const start = at + id.length + size.length;
  if (size.allOnes) return { id: id.value, start, end: limit, unknownSize: true };
  const end = start + size.value;
  if (end > limit) return null;
  return { id: id.value, start, end, unknownSize: false };
}

function* childrenOf(bytes: Uint8Array, from: number, to: number): Generator<Element> {
  let at = from;
  while (at < to) {
    const element = readElement(bytes, at, to);
    if (!element) return;
    yield element;
    // An element of unknown size runs to the end of its parent, so it has no
    // siblings after it. Its own children are still readable inside it.
    if (element.unknownSize) return;
    at = element.end;
  }
}

const uint = (bytes: Uint8Array, from: number, to: number) => {
  let value = 0;
  for (let at = from; at < to; at += 1) value = value * 256 + bytes[at];
  return value;
};

function float(bytes: Uint8Array, from: number, to: number): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset + from, to - from);
  if (to - from === 4) return view.getFloat32(0);
  if (to - from === 8) return view.getFloat64(0);
  return null;
}

/**
 * The length of a video from the head and tail of its file.
 *
 * An upload is verified after it lands in storage, where downloading 250MB to
 * read two numbers out of it would be absurd. Every field that states a
 * duration lives at one end or the other: a movie header at the front, a
 * trailing `moov` or a last cluster at the back. This reads both ends and
 * takes whichever answers.
 */
export function probeVideoParts(head: Uint8Array, tail: Uint8Array | null): VideoProbe {
  const fromHead = probeVideo(head);
  if (!tail || tail.length === 0) return fromHead;

  if (isEbml(head)) {
    // A Duration element is the writer's own answer and settles it. Without
    // one the length is estimated from the last cluster, and the last cluster
    // of a buffer that stops 4MB in is NOT the last cluster of the file — so
    // both ends get scanned and the later one wins. Reading only the head
    // here would under-measure a long recording, which is the one direction a
    // length limit must never be wrong in.
    const declared = declaredWebmDuration(head);
    if (declared !== null) return { ...fromHead, seconds: declared };
    const scale = timecodeScaleOf(head);
    return {
      ...fromHead,
      seconds: longer(lastClusterSeconds(head, scale), lastClusterSeconds(tail, scale)),
    };
  }

  // A movie header states the length outright; anything derived from
  // fragments is a floor, so the tail's fragments are worth reading too.
  const stated = statedIsoDuration(head);
  if (stated !== null) return { ...fromHead, seconds: stated };

  const fromTail = probeIsoBmff(tail);
  const trailingHeader = statedIsoDuration(tail);
  if (trailingHeader !== null) {
    return {
      seconds: trailingHeader,
      width: fromHead.width ?? fromTail.width,
      height: fromHead.height ?? fromTail.height,
    };
  }

  const tracks = tracksIn(head);
  return {
    seconds: longer(fromHead.seconds, fragmentedDuration(tail, tracks.length > 0 ? tracks : tracksIn(tail))),
    width: fromHead.width ?? fromTail.width,
    height: fromHead.height ?? fromTail.height,
  };
}

const longer = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

const isEbml = (bytes: Uint8Array) =>
  bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;

/** The Duration element, when the writer got round to writing one. */
function declaredWebmDuration(bytes: Uint8Array): number | null {
  const segment = segmentOf(bytes);
  if (!segment) return null;
  let scale = 1_000_000;
  let duration: number | null = null;
  for (const child of childrenOf(bytes, segment.start, segment.end)) {
    if (child.id !== INFO) continue;
    for (const field of childrenOf(bytes, child.start, child.end)) {
      if (field.id === TIMECODE_SCALE) scale = uint(bytes, field.start, field.end);
      if (field.id === DURATION) duration = float(bytes, field.start, field.end);
    }
  }
  return duration !== null && duration > 0 ? (duration * scale) / 1_000_000_000 : null;
}

/** The length an MP4 states in its own headers, as opposed to one inferred. */
function statedIsoDuration(bytes: Uint8Array): number | null {
  const moov = findMoov(bytes);
  if (!moov) return null;
  const children = boxesIn(bytes, moov.start, moov.end);
  return movieDuration(bytes, children) ?? fragmentHeaderDuration(bytes, children);
}

function tracksIn(bytes: Uint8Array): Track[] {
  const moov = findMoov(bytes);
  if (!moov) return [];
  return boxesIn(bytes, moov.start, moov.end)
    .filter((box) => box.type === 'trak')
    .map((trak) => readTrack(bytes, trak))
    .filter((track): track is Track => track !== null);
}

/** The timecode scale from a WebM head, for reading a cluster out of the tail. */
function timecodeScaleOf(head: Uint8Array): number {
  const segment = segmentOf(head);
  if (!segment) return 1_000_000;
  for (const child of childrenOf(head, segment.start, segment.end)) {
    if (child.id !== INFO) continue;
    for (const field of childrenOf(head, child.start, child.end)) {
      if (field.id === TIMECODE_SCALE) return uint(head, field.start, field.end);
    }
  }
  return 1_000_000;
}

function segmentOf(bytes: Uint8Array): Element | null {
  for (const element of childrenOf(bytes, 0, bytes.length)) {
    if (element.id === SEGMENT) return element;
  }
  const header = readElement(bytes, 0, bytes.length);
  const second = header ? readElement(bytes, header.end, bytes.length) : null;
  return second?.id === SEGMENT ? second : null;
}

function probeWebm(bytes: Uint8Array): VideoProbe {
  // The EBML header comes first, so the segment is the second top-level
  // element; childrenOf stops at an unknown-size master, hence segmentOf.
  const segment = segmentOf(bytes);
  if (!segment) return EMPTY;

  let timecodeScale = 1_000_000; // nanoseconds, the spec's default
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  for (const child of childrenOf(bytes, segment.start, segment.end)) {
    if (child.id === INFO) {
      for (const field of childrenOf(bytes, child.start, child.end)) {
        if (field.id === TIMECODE_SCALE) timecodeScale = uint(bytes, field.start, field.end);
        if (field.id === DURATION) duration = float(bytes, field.start, field.end);
      }
    }
    if (child.id === TRACKS) {
      for (const entry of childrenOf(bytes, child.start, child.end)) {
        if (entry.id !== TRACK_ENTRY) continue;
        for (const field of childrenOf(bytes, entry.start, entry.end)) {
          if (field.id !== VIDEO) continue;
          for (const dimension of childrenOf(bytes, field.start, field.end)) {
            const value = uint(bytes, dimension.start, dimension.end);
            if (dimension.id === PIXEL_WIDTH && width === null) width = value;
            if (dimension.id === PIXEL_HEIGHT && height === null) height = value;
            if (dimension.id === DISPLAY_WIDTH) width = value;
            if (dimension.id === DISPLAY_HEIGHT) height = value;
          }
        }
      }
    }
  }

  const seconds =
    duration !== null && duration > 0
      ? (duration * timecodeScale) / 1_000_000_000
      : lastClusterSeconds(bytes, timecodeScale);

  return { seconds, width, height };
}

/**
 * Where the last cluster starts, in seconds.
 *
 * MediaRecorder streams WebM and never goes back to write a duration, so a
 * recording made in the editor has no Duration element at all. Every cluster
 * does carry the timestamp it starts at, and the last of those is the length
 * bar one cluster — which is what the tolerance in limits.ts is for.
 *
 * The scan is by signature rather than by walking the tree, because the same
 * files leave cluster sizes unknown as well. A false match has to survive
 * being a valid Timecode element to count, and it can only ever make a video
 * look LONGER, never short enough to slip past the limit.
 */
function lastClusterSeconds(bytes: Uint8Array, timecodeScale: number): number | null {
  let longest: number | null = null;
  for (let at = 0; at + 12 < bytes.length; at += 1) {
    if (bytes[at] !== 0x1f || bytes[at + 1] !== 0x43) continue;
    if (bytes[at + 2] !== 0xb6 || bytes[at + 3] !== 0x75) continue;
    const cluster = readElement(bytes, at, bytes.length);
    if (!cluster || cluster.id !== CLUSTER) continue;
    const first = readElement(bytes, cluster.start, Math.min(cluster.end, bytes.length));
    if (!first || first.id !== CLUSTER_TIMECODE || first.end - first.start > 8) continue;
    const seconds = (uint(bytes, first.start, first.end) * timecodeScale) / 1_000_000_000;
    if (Number.isFinite(seconds) && (longest === null || seconds > longest)) longest = seconds;
  }
  return longest;
}
