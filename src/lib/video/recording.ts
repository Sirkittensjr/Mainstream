/**
 * What comes off the camera, in the shape the rest of the pipeline expects.
 *
 * A recording arrives from MediaRecorder as a Blob with a MIME type like
 * `video/webm;codecs=vp9,opus`. Two things elsewhere need it to be more than
 * that, and neither is cosmetic:
 *
 *   - `needsRender` in clips.ts treats a clip with no `file` as something it
 *     has to build, so a recording handed over as a bare Blob was re-encoded in
 *     real time before it could be uploaded — two more minutes of waiting on a
 *     two-minute video, to arrive back at bytes the pipeline already accepted.
 *     Giving it a File means an untouched recording takes the same path a
 *     phone's camera-roll upload does: straight to storage.
 *
 *   - The upload routes accept a bare type from a fixed list. A codec suffix is
 *     not on that list, so it has to come off before anything is signed.
 *
 * No re-encoding happens here. The recorded bytes are handed on untouched; this
 * only labels them.
 */

/** Containers MediaRecorder produces that FayTarra's upload routes accept. */
const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/**
 * The container, without the codec list.
 *
 * `video/webm;codecs=vp9,opus` is what the browser reports; `video/webm` is
 * what /api/upload/sign will accept. Anything unrecognised falls back to WebM,
 * because every browser that can record at all records one of these two and a
 * guess is better than sending a type that is certainly refused.
 */
export function recordedContainer(mimeType: string): string {
  const bare = (mimeType || '').split(';')[0].trim().toLowerCase();
  return bare in EXTENSIONS ? bare : 'video/webm';
}

/** The extension to name a recording with, matching its container. */
export function recordedExtension(mimeType: string): string {
  return EXTENSIONS[recordedContainer(mimeType)];
}

/**
 * Wraps a recording as a File so it travels as an ordinary uploaded video.
 *
 * The name is only ever shown in the clip strip and used for the extension —
 * nothing is written to disk under it.
 */
export function recordedFile(blob: Blob, mimeType: string, index: number): File {
  const container = recordedContainer(mimeType);
  return new File([blob], `recording-${index}.${recordedExtension(mimeType)}`, {
    type: container,
  });
}
