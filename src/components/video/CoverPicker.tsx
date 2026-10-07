import { formatMegabytes, formatPreciseSeconds, formatSeconds, COVER_ACCEPT } from '@/lib/video/limits';

/**
 * Choosing what people see before they press play.
 *
 * Lifted out of VideoStudio so the editing stage and the posting stage are the
 * same picker rather than two that have to be kept in step — there is one frame
 * scrubber, one custom-image path and one set of rules about what an image may
 * weigh, wherever a cover gets chosen.
 *
 * It owns no state. The video, the chosen frame and the supplied image all live
 * with the composer that will upload them, which is what keeps "nothing is
 * uploaded until Post" true: a cover picked here is a File in this tab, and
 * replacing it or changing your mind costs nothing and orphans nothing.
 */
export function CoverPicker({
  preview,
  custom,
  isCustom,
  at,
  max,
  error,
  onAt,
  onFile,
  onClear,
  compact = false,
}: {
  /** The image currently winning: the supplied one, or the scrubbed frame. */
  preview: string | null;
  custom: File | null;
  isCustom: boolean;
  /** Seconds into the video that the frame is taken from. */
  at: number;
  /** The video's length, so the scrubber knows where it ends. */
  max: number;
  error: string | null;
  onAt: (seconds: number) => void;
  onFile: (file: File | undefined) => void;
  onClear: () => void;
  /**
   * The editor's version: no heading or explanation, and a small 9:16 thumbnail,
   * because it shares a short panel under the video and the video is where the
   * chosen frame is shown large. The posting screen keeps the full one.
   */
  compact?: boolean;
}) {
  return (
    <>
      {!compact && (
        <>
          <h2 id="cover-heading" className="text-sm font-semibold text-white/70">
            Choose cover
          </h2>
          <p className="mt-1 text-xs text-white/40">
            What people see before they press play. The start of the video unless you pick
            something else.
          </p>
        </>
      )}

      <div className={`flex items-start ${compact ? 'gap-2.5' : 'mt-3 gap-3'}`}>
        {/* One preview, whichever kind of cover is winning. */}
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={isCustom ? 'The image chosen as this cover' : 'The frame chosen as this cover'}
            data-cover-preview={isCustom ? 'custom' : 'frame'}
            className={`shrink-0 bg-black ${
              compact ? 'h-[52px] w-[30px] rounded-md object-cover' : 'h-20 w-20 rounded-xl object-contain'
            }`}
          />
        ) : (
          <div
            className={`shrink-0 bg-white/[0.04] ${
              compact ? 'h-[52px] w-[30px] rounded-md' : 'h-20 w-20 rounded-xl'
            }`}
          />
        )}

        <div className="min-w-0 flex-1">
          {custom ? (
            <>
              <p className="truncate text-xs text-white/60">
                Using your own image — {formatMegabytes(custom.size)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label
                  htmlFor="cover-file"
                  className="btn-quiet cursor-pointer px-3 py-2 text-xs"
                >
                  Replace
                </label>
                <button type="button" onClick={onClear} className="btn-quiet px-3 py-2 text-xs">
                  Use a frame instead
                </button>
              </div>
            </>
          ) : (
            <>
              <label
                htmlFor="thumbnail"
                className={compact ? 'flex h-3.5 items-center text-[12px] font-semibold leading-none text-white/80' : 'text-xs text-white/40'}
              >
                {compact ? 'Cover · drag to pick a frame' : 'Drag to pick a frame'}
              </label>
              {/* Full width and 44px tall so a thumb can work it. */}
              <div className={compact ? 'mt-1 flex h-9 items-center gap-2' : ''}>
                <input
                  id="thumbnail"
                  type="range"
                  min={0}
                  max={Math.max(0.1, max - 0.1)}
                  step={0.1}
                  value={at}
                  aria-label="Cover frame position"
                  aria-valuetext={`${formatPreciseSeconds(at)} of ${formatSeconds(max)}`}
                  onChange={(event) => onAt(Number(event.target.value))}
                  className={`accent-fay ${compact ? 'h-9 min-w-0 flex-1' : 'mt-1 h-11 w-full'}`}
                />
                <label
                  htmlFor="cover-file"
                  className={`btn-quiet inline-flex cursor-pointer items-center text-xs ${
                    compact ? 'h-9 shrink-0 px-3 py-0' : 'px-3 py-2'
                  }`}
                >
                  {compact ? 'Upload' : 'Upload thumbnail'}
                </label>
              </div>
            </>
          )}

          {/* Nothing is uploaded on pick — see the note on `custom`. */}
          <input
            id="cover-file"
            type="file"
            accept={COVER_ACCEPT}
            className="hidden"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              // Cleared so picking the SAME file again still fires.
              event.target.value = '';
            }}
          />

          {error && (
            <p role="alert" className="mt-2 text-xs text-fay-soft">
              {error}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
