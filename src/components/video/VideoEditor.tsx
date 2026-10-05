'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronIcon,
  CropIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateIcon,
  TextIcon,
  TrashIcon,
  TrimIcon,
  UndoIcon,
  VolumeIcon,
} from '@/components/Icons';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';
import { CoverPicker } from './CoverPicker';
import { VideoText } from './VideoText';
import { cropForRatio } from './ClipEditor';
import { useClipFrames } from './useClipFrames';
import { projectFrames } from '@/lib/video/thumbnails';
import {
  clampOverlay,
  newOverlay,
  trimOverlay,
  windowOf,
} from '@/lib/video/overlays';
import { clipDuration, outputFrame, type Clip, type Rotation } from '@/lib/video/clips';
import { timeline, timelineDuration } from '@/lib/video/playlist';
import { formatPreciseSeconds, formatSeconds } from '@/lib/video/limits';
import { MAX_TEXT_OVERLAYS, MAX_TEXT_OVERLAY_LENGTH, type TextOverlay } from '@/lib/types';

/**
 * The editing stage: the video, with the editing arranged AROUND it.
 *
 * FIVE BANDS, top to bottom, and the order is the whole design:
 *
 *   1  back, "Edit", Next
 *   2  the open clip as a filmstrip of its own frames — scrub it, trim it
 *   3  the video, large and with nothing on top of it
 *   4  Trim, Sound, Text, Cover, Crop, and whichever one is open
 *   5  the clips in the project as thumbnails, and a + to film another
 *
 * WHAT THIS REPLACED put the video full-bleed behind everything and floated the
 * controls over its lower third. That kept the picture as large as a phone can
 * make it, but it meant the thing being edited was permanently half-covered by
 * the thing doing the editing. Laying the bands out instead costs the video
 * width — a 9:16 box in the ~420px left over is about 240px wide on a 390px
 * screen — and buys a picture that is never obscured. That is the trade this
 * was asked for, and the gutters either side of the video are where the cost
 * shows up.
 *
 * THE PREVIEW IS THE OUTPUT FRAME. The video sits in a 9:16 box and is met with
 * `cover`, which is exactly what `renderClips` does into 1080x1920 — so a
 * landscape recording is centre-cropped here the same way it will be in the
 * finished file. A preview with a different fit from the export is not a
 * preview.
 *
 * THE FILMSTRIP IS THE SELECTED CLIP, all of its source, as its own frames.
 * Dragging it scrubs that clip; with Trim open it also carries a grip at each
 * end, with the trimmed-off parts dimmed. Trimming is therefore dragging the
 * ends of the thing you are looking at, and nothing has to open over the video
 * to do it. The slim bar under it is the whole PROJECT, which is the other
 * question — where am I in the finished video — and the one the filmstrip
 * cannot answer while it is showing a single clip.
 *
 * Nothing about captions, categories, tags or content warnings is here. Those
 * belong to posting, and this is editing.
 *
 * WHAT IT EDITS, and what each one costs:
 *
 *   Trim   — two numbers on ONE clip, applied by the render pass at the end.
 *            A multi-clip project is not one blob: each clip keeps its own
 *            boundaries and its own grips, and the preview re-cuts itself as
 *            soon as either moves.
 *   Sound  — a playback property on the finished post. Silencing an audio track
 *            for real means re-encoding, and a two-minute video would cost two
 *            minutes to mute.
 *   Text   — also a playback property, drawn over the video by the player, so a
 *            video carrying words costs no render it did not already need. The
 *            words are tappable: picking a line on the video opens it.
 *   Cover  — the existing picker, shared with the posting screen.
 *   Crop   — the clip's crop rectangle and rotation, which `drawFrame` has
 *            always honoured. The same ratios the desktop editor offers.
 *
 * There is no Filters tool. FayTarra's render has no colour pipeline — `drawFrame`
 * scales, crops and rotates and that is all — so a filter rail would be a row of
 * buttons that change nothing.
 *
 * It owns nothing except which clip is selected and which tool is open. Every
 * change goes up to the composer that holds the clips and does the uploading.
 */

export type EditorTool = 'trim' | 'sound' | 'text' | 'cover' | 'crop';
type Tool = EditorTool;

const TOOLS: { key: Tool; label: string; Icon: typeof TrimIcon }[] = [
  { key: 'trim', label: 'Trim', Icon: TrimIcon },
  { key: 'sound', label: 'Sound', Icon: VolumeIcon },
  { key: 'text', label: 'Text', Icon: TextIcon },
  { key: 'cover', label: 'Cover', Icon: ImageIcon },
  { key: 'crop', label: 'Crop', Icon: CropIcon },
];

/** The shapes on offer, matching the desktop editor's. */
const SHAPES: { label: string; ratio: number | null }[] = [
  { label: 'Original', ratio: null },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '1:1', ratio: 1 },
  { label: '16:9', ratio: 16 / 9 },
];

export interface EditorCover {
  preview: string | null;
  custom: File | null;
  isCustom: boolean;
  at: number;
  error: string | null;
  onAt: (seconds: number) => void;
  onFile: (file: File | undefined) => void;
  onClear: () => void;
}

export function VideoEditor({
  clips,
  muted,
  overlays,
  cover,
  tool,
  onTool,
  onTrimClip,
  onPatchClip,
  onMuted,
  onOverlays,
  onAddClip,
  onDeleteClip,
  onRetake,
  onNext,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: {
  /** The whole project, in order. One clip is a project of one. */
  clips: Clip[];
  muted: boolean;
  overlays: TextOverlay[];
  cover: EditorCover;
  /** Which tool is open. Controlled, so arriving here to pick a cover can say so. */
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Trims ONE clip, named by id rather than by position. */
  onTrimClip: (id: string, patch: { trimStart: number; trimEnd: number }) => void;
  /** The clip's shape — crop rectangle and rotation. */
  onPatchClip?: (id: string, patch: Partial<Clip>) => void;
  onMuted: (muted: boolean) => void;
  onOverlays: (overlays: TextOverlay[]) => void;
  /** Filming another clip, where the budget allows it. */
  onAddClip?: () => void;
  /** Dropping one clip out of the project. */
  onDeleteClip?: (id: string) => void;
  /** Back to the camera, dropping the take being edited. */
  onRetake: () => void;
  onNext: () => void;
  /** One step back through the editing, and forward again. */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const player = useRef<ClipPlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  /** Project time, driven by the player. */
  const [at, setAt] = useState(0);
  /** Which clip the filmstrip and the tools are about. */
  const [selected, setSelected] = useState(0);
  /** Which line of text is being edited, if any. */
  const [pickedText, setPickedText] = useState<number | null>(null);
  /** The clip Delete is asking about. Null when it is not asking. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /** The same fit the finished video is rendered with. See the note above. */
  const fit = outputFrame(clips).fit;

  const segments = useMemo(() => timeline(clips), [clips]);
  const total = timelineDuration(segments);
  const many = clips.length > 1;

  // A clip can be dropped from under the selection — Retake and Delete both do it.
  const index = Math.min(selected, Math.max(0, clips.length - 1));
  const clip = clips[index];
  const frames = useClipFrames(clips, clip?.id ?? null);

  /** Keeps the selection following the playhead while it plays. */
  useEffect(() => {
    if (!playing) return;
    const here = segments.find((segment) => at >= segment.startsAt && at < segment.endsAt);
    if (here && here.index !== index) setSelected(here.index);
  }, [at, index, playing, segments]);

  /* -------------------------------------------------------------- the text */

  function addOverlay() {
    if (overlays.length >= MAX_TEXT_OVERLAYS) return;
    // The middle of the frame, and selected, so the next thing somebody does is
    // type into it and drag it where they meant.
    onOverlays([...overlays, newOverlay()]);
    setPickedText(overlays.length);
  }

  /** Dragged on the video. The index is into `overlays`, not into what is drawn. */
  function moveOverlay(position: number, x: number, y: number) {
    onOverlays(
      overlays.map((entry, i) => (i === position ? clampOverlay(entry, x, y) : entry)),
    );
  }

  function patchOverlay(position: number, patch: Partial<TextOverlay>) {
    onOverlays(overlays.map((entry, i) => (i === position ? { ...entry, ...patch } : entry)));
  }

  function removeOverlay(position: number) {
    onOverlays(overlays.filter((_, i) => i !== position));
    setPickedText(null);
  }

  /* --------------------------------------------------------- the filmstrip */

  const strip = useRef<HTMLDivElement>(null);

  /** How far along the strip a pointer is, 0 to 1. */
  function acrossStrip(clientX: number): number {
    const rail = strip.current;
    if (!rail) return 0;
    const box = rail.getBoundingClientRect();
    return Math.min(Math.max((clientX - box.left) / Math.max(1, box.width), 0), 1);
  }

  /** Where a clientX falls in the selected clip's own source, in seconds. */
  function sourceAt(clientX: number): number {
    return acrossStrip(clientX) * clip.sourceDuration;
  }

  /**
   * Puts the preview where the finger is.
   *
   * The strip means one of two things and the scrub follows it: the open clip's
   * own source normally, and the whole project while a line of text is being
   * timed — because the question then is "when in the finished video", which a
   * single clip's strip cannot answer.
   */
  function scrubTo(clientX: number) {
    if (timing) {
      player.current?.seek(acrossStrip(clientX) * total);
      return;
    }
    const segment = segments[index];
    if (!segment) return;
    const source = Math.min(Math.max(sourceAt(clientX), clip.trimStart), clip.trimEnd);
    player.current?.seek(segment.startsAt + (source - clip.trimStart));
  }

  /** Dragging anywhere on the filmstrip scrubs the clip it is showing. */
  function scrubFrom(event: React.PointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
    const move = (moveEvent: PointerEvent) => scrubTo(moveEvent.clientX);
    const release = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  /**
   * Dragging a trim grip.
   *
   * The filmstrip is the clip's WHOLE source, which is what makes dragging
   * stable: if it were the kept part, every drag would resize the thing being
   * dragged and the grip would run away from the thumb. Pointer capture so a
   * finger that slides off the strip keeps hold of the grip.
   */
  /** Dragging one end of the open line's window, along the project strip. */
  function dragTextHandle(edge: 'from' | 'to', event: React.PointerEvent<HTMLElement>) {
    if (pickedText === null || total <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    const position = pickedText;

    const move = (moveEvent: PointerEvent) => {
      const seconds = acrossStrip(moveEvent.clientX) * total;
      onOverlays(
        overlays.map((entry, i) =>
          i === position ? trimOverlay(entry, edge, seconds, total) : entry,
        ),
      );
    };
    const release = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      // Park the playhead inside the window that was just set, so the line being
      // timed is the line on screen.
      const entry = overlays[position];
      if (entry) {
        const span = windowOf(entry, total);
        player.current?.seek(edge === 'from' ? span.from : Math.max(span.from, span.to - 0.1));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  function dragHandle(edge: 'start' | 'end', event: React.PointerEvent<HTMLElement>) {
    if (clip.sourceDuration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    const move = (moveEvent: PointerEvent) => {
      const seconds = sourceAt(moveEvent.clientX);
      if (edge === 'start') {
        const next = Math.max(0, Math.min(seconds, clip.trimEnd - 0.3));
        onTrimClip(clip.id, { trimStart: next, trimEnd: clip.trimEnd });
      } else {
        const next = Math.min(clip.sourceDuration, Math.max(seconds, clip.trimStart + 0.3));
        onTrimClip(clip.id, { trimStart: clip.trimStart, trimEnd: next });
      }
    };

    const release = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      // Show the cut that was just made.
      const segment = segments[index];
      if (!segment) return;
      player.current?.seek(
        edge === 'start' ? segment.startsAt : Math.max(0, segment.endsAt - 0.15),
      );
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  /** Jumps the preview to a clip's first kept frame and selects it. */
  function pick(segmentIndex: number) {
    const segment = segments[segmentIndex];
    if (!segment) return;
    setSelected(segmentIndex);
    player.current?.seek(segment.startsAt);
  }

  if (!clip) return null;

  const kept = clipDuration(clip);
  /** The kept window as fractions of the selected clip's own source length. */
  const window0 = clip.sourceDuration > 0 ? clip.trimStart / clip.sourceDuration : 0;
  const window1 = clip.sourceDuration > 0 ? clip.trimEnd / clip.sourceDuration : 1;
  /** Where the playhead sits along the filmstrip, in the same fractions. */
  const segment = segments[index];
  const head =
    segment && clip.sourceDuration > 0
      ? Math.min(Math.max(clip.trimStart + (at - segment.startsAt), 0), clip.sourceDuration) /
        clip.sourceDuration
      : 0;
  const onStrip = Boolean(segment && at >= segment.startsAt && at <= segment.endsAt);
  const trimming = tool === 'trim';

  /** The line being timed, if the Text tool has one open. */
  const timedText = tool === 'text' && pickedText !== null ? overlays[pickedText] : undefined;
  const timing = Boolean(timedText);
  const textWindow = timedText ? windowOf(timedText, total) : null;

  /**
   * What the strip is showing. One clip's own frames, or the whole project's —
   * assembled from the per-clip strips already in hand rather than grabbed again.
   */
  const stripFrames = timing
    ? projectFrames(segments, frames.strips, 10)
    : (frames.strips[clip.id] ?? []);
  /** The playhead's place along whichever of those the strip is showing. */
  const headAt = timing ? (total > 0 ? Math.min(Math.max(at / total, 0), 1) : 0) : head;
  const headShown = timing || onStrip;

  return (
    // Five bands, and the video is one of them rather than the floor they sit
    // on. See the note above for what that costs and what it buys.
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink-950"
      data-editor-fullscreen
    >
      {/* ===================== 1. the top bar ===================== */}
      <div
        data-editor-topbar
        className="safe-top safe-x flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-2"
      >
        <button
          type="button"
          onClick={onRetake}
          data-editor-retake
          aria-label="Back to the camera"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white transition active:scale-95 active:bg-white/10"
        >
          <ChevronIcon direction="left" width={22} height={22} />
        </button>
        {/* Undo and redo sit with the title rather than in the tool rail: they
            are not a tool, they apply to whatever was last done, and a thumb
            looking for them looks at the top of the screen. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            data-editor-undo
            aria-label="Undo"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition active:bg-white/10 disabled:opacity-25"
          >
            <UndoIcon width={18} height={18} />
          </button>
          <p className="text-[15px] font-semibold tracking-wide text-white">Edit</p>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            data-editor-redo
            aria-label="Redo"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition active:bg-white/10 disabled:opacity-25"
          >
            <UndoIcon width={18} height={18} className="-scale-x-100" />
          </button>
        </div>
        <button
          type="button"
          onClick={onNext}
          data-editor-next
          className="btn-primary h-10 px-5 py-0 text-[14px]"
        >
          Next
        </button>
      </div>

      {/* ============ 2. the open clip, as its own frames ============ */}
      {/* Scrub it to move the preview; with Trim open it carries a grip at each
          end and dims what is being cut away. Nothing opens over the video to
          trim, because the thing being trimmed is already on screen. */}
      <div className="safe-x shrink-0 px-3" data-editor-scrub>
        <div
          ref={strip}
          onPointerDown={scrubFrom}
          data-editor-track
          className="relative h-14 w-full touch-none select-none overflow-hidden rounded-xl bg-ink-800"
        >
          <span className="absolute inset-0 flex">
            {(stripFrames.length > 0 ? stripFrames : ['']).map((frame, slot) => (
              <span
                key={slot}
                className="h-full flex-1 bg-ink-700 bg-cover bg-center"
                style={frame ? { backgroundImage: `url(${frame})` } : undefined}
              />
            ))}
          </span>

          {timing && textWindow && (
            <>
              {/* When the line is NOT on screen. */}
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-ink-950/75"
                style={{ width: `${(textWindow.from / Math.max(0.01, total)) * 100}%` }}
              />
              <span
                className="pointer-events-none absolute inset-y-0 right-0 bg-ink-950/75"
                style={{ width: `${(1 - textWindow.to / Math.max(0.01, total)) * 100}%` }}
              />
              {/* When it is. */}
              <span
                className="pointer-events-none absolute inset-y-0 flex items-center justify-center border-y-2 border-aura bg-aura/20"
                style={{
                  left: `${(textWindow.from / Math.max(0.01, total)) * 100}%`,
                  right: `${(1 - textWindow.to / Math.max(0.01, total)) * 100}%`,
                }}
              >
                <span className="truncate px-2 text-[9px] font-bold uppercase tracking-wide text-white/90">
                  Text
                </span>
              </span>
              {(['from', 'to'] as const).map((edge) => (
                <span
                  key={edge}
                  role="slider"
                  tabIndex={-1}
                  aria-label={edge === 'from' ? 'Text starts' : 'Text ends'}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0.1, total)}
                  aria-valuenow={edge === 'from' ? textWindow.from : textWindow.to}
                  aria-valuetext={formatPreciseSeconds(
                    edge === 'from' ? textWindow.from : textWindow.to,
                  )}
                  data-editor-text-handle={edge}
                  onPointerDown={(event) => dragTextHandle(edge, event)}
                  className="absolute inset-y-0 flex w-9 cursor-ew-resize touch-none items-center justify-center"
                  style={
                    edge === 'from'
                      ? {
                          left: `${(textWindow.from / Math.max(0.01, total)) * 100}%`,
                          marginLeft: '-4px',
                        }
                      : {
                          left: `${(textWindow.to / Math.max(0.01, total)) * 100}%`,
                          marginLeft: '-32px',
                        }
                  }
                >
                  <span className="h-10 w-1.5 rounded-full bg-aura shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]" />
                </span>
              ))}
            </>
          )}

          {trimming && !timing && (
            <>
              {/* What is being cut away. */}
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-ink-950/75"
                style={{ width: `${window0 * 100}%` }}
              />
              <span
                className="pointer-events-none absolute inset-y-0 right-0 bg-ink-950/75"
                style={{ width: `${(1 - window1) * 100}%` }}
              />
              {/* What is being kept. */}
              <span
                className="pointer-events-none absolute inset-y-0 border-y-2 border-fay"
                style={{ left: `${window0 * 100}%`, right: `${(1 - window1) * 100}%` }}
              />
              {(['start', 'end'] as const).map((edge) => (
                <span
                  key={edge}
                  role="slider"
                  tabIndex={-1}
                  aria-label={`Trim ${edge}`}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0.1, clip.sourceDuration)}
                  aria-valuenow={edge === 'start' ? clip.trimStart : clip.trimEnd}
                  aria-valuetext={formatPreciseSeconds(
                    edge === 'start' ? clip.trimStart : clip.trimEnd,
                  )}
                  data-editor-handle={edge}
                  onPointerDown={(event) => dragHandle(edge, event)}
                  // A thumb's worth of target, drawn as a bar. Kept inside the
                  // strip at the extremes rather than half off its edge, which
                  // is where a centred grip at 0s ends up.
                  className="absolute inset-y-0 flex w-9 cursor-ew-resize touch-none items-center justify-center"
                  style={
                    edge === 'start'
                      ? { left: `${window0 * 100}%`, marginLeft: '-4px' }
                      : { left: `${window1 * 100}%`, marginLeft: '-32px' }
                  }
                >
                  <span className="h-10 w-1.5 rounded-full bg-fay shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]" />
                </span>
              ))}
            </>
          )}

          {/* The playhead. */}
          {headShown && (
            <span
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]"
              style={{ left: `${headAt * 100}%` }}
            />
          )}
        </div>

        {/* The whole project, which the filmstrip above cannot show while it is
            showing one clip. Thin on purpose; the strip is the thumb target. */}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => player.current?.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}
            data-editor-playpause
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95"
          >
            {playing ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, total)}
            step={0.05}
            value={Math.min(Math.max(at, 0), total)}
            aria-label="Position in the video"
            data-editor-timeline
            onChange={(event) => player.current?.seek(Number(event.target.value))}
            style={
              {
                '--scrub-track': `linear-gradient(to right, #FF3D9A ${
                  total > 0 ? Math.min(100, Math.max(0, (at / total) * 100)) : 0
                }%, rgba(255,255,255,0.22) ${
                  total > 0 ? Math.min(100, Math.max(0, (at / total) * 100)) : 0
                }%)`,
              } as React.CSSProperties
            }
            className="scrub scrub-sm flex-1"
          />
          <span
            data-editor-time
            className="shrink-0 text-[11px] font-semibold tabular-nums text-white/60"
          >
            {formatPreciseSeconds(at)} / {formatSeconds(total)}
          </span>
        </div>
      </div>

      {/* ===================== 3. the video ===================== */}
      {/* A 9:16 box, which IS the output frame, met with the same fit the render
          uses. Nothing is drawn on top of it but the words being edited. */}
      <div
        data-editor-stage
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-2"
      >
        <div className="relative h-full max-w-full overflow-hidden rounded-2xl bg-black [aspect-ratio:9/16]">
          <ClipPlayer
            ref={player}
            clips={clips}
            muted={muted}
            fit={fit}
            onTime={setAt}
            onPlayingChange={setPlaying}
            className="absolute inset-0"
          />
          <button
            type="button"
            onClick={() => player.current?.toggle()}
            aria-hidden="true"
            tabIndex={-1}
            data-editor-tap
            className="absolute inset-0 flex items-center justify-center"
          >
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-opacity ${
                playing ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
            </span>
          </button>
          {/* The words sit in the frame they will be posted in, so positioning
              them here is positioning them there. */}
          <VideoText
            // `now` is what makes the preview honest about timing: a line is on
            // screen here exactly when it will be on screen in the post.
            media={{ text: overlays, duration: total }}
            now={at}
            onPick={tool === 'text' ? (position) => setPickedText(position) : undefined}
            onMove={tool === 'text' ? moveOverlay : undefined}
            selected={tool === 'text' ? pickedText : null}
          />
        </div>
      </div>

      {/* ============ 4. the tools, and whichever one is open ============ */}
      <div data-editor-controls className="safe-x shrink-0 px-3">
        <div className="flex items-stretch gap-1">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTool(key)}
              aria-pressed={tool === key}
              data-editor-tool={key}
              className={`flex min-h-[48px] flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-semibold transition ${
                tool === key ? 'bg-white/[0.14] text-white' : 'text-white/60 active:bg-white/[0.07]'
              }`}
            >
              <Icon width={18} height={18} />
              {label}
            </button>
          ))}
        </div>

        {/* Compact and capped. A tool's controls belong under the video, never
            over it — and Trim needs almost nothing here, because its grips are
            on the filmstrip at the top. */}
        <div className="max-h-[24vh] overflow-y-auto" data-editor-panel={tool}>
          {tool === 'trim' && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/80">
                {many ? `Clip ${index + 1} of ${clips.length} · Keeping ` : 'Keeping '}
                <span className="tabular-nums text-white/55">{formatPreciseSeconds(kept)}</span>
              </p>
              {/* The grips on the filmstrip are the way to trim; these are the
                  same two numbers for a keyboard, and what the suite drives. */}
              <label className="sr-only" htmlFor="editor-trim-start">
                Start
              </label>
              <input
                id="editor-trim-start"
                type="range"
                min={0}
                max={Math.max(0.1, clip.sourceDuration)}
                step={0.05}
                value={clip.trimStart}
                data-editor-trim="start"
                onChange={(event) => {
                  const next = Math.max(0, Math.min(Number(event.target.value), clip.trimEnd - 0.3));
                  onTrimClip(clip.id, { trimStart: next, trimEnd: clip.trimEnd });
                  player.current?.seek(segments[index]?.startsAt ?? 0);
                }}
                className="scrub scrub-sm w-14 shrink-0"
              />
              <label className="sr-only" htmlFor="editor-trim-end">
                End
              </label>
              <input
                id="editor-trim-end"
                type="range"
                min={0}
                max={Math.max(0.1, clip.sourceDuration)}
                step={0.05}
                value={clip.trimEnd}
                data-editor-trim="end"
                onChange={(event) => {
                  const next = Math.min(
                    clip.sourceDuration,
                    Math.max(Number(event.target.value), clip.trimStart + 0.3),
                  );
                  onTrimClip(clip.id, { trimStart: clip.trimStart, trimEnd: next });
                  const here = segments[index];
                  if (here) {
                    player.current?.seek(here.startsAt + Math.max(0, next - clip.trimStart - 0.15));
                  }
                }}
                className="scrub scrub-sm w-14 shrink-0"
              />
              <button
                type="button"
                onClick={() => onTrimClip(clip.id, { trimStart: 0, trimEnd: clip.sourceDuration })}
                disabled={clip.trimStart === 0 && clip.trimEnd === clip.sourceDuration}
                data-editor-trim-reset
                className="btn-quiet shrink-0 px-2 py-1 text-[11px] disabled:opacity-30"
              >
                Reset
              </button>
            </div>
          )}

          {tool === 'sound' && (
            // PER CLIP, and it says so. `Clip.volume` has always existed and the
            // render has always honoured it — `renderClips` routes each clip
            // through its own gain node — but the only control was one switch
            // over the finished post, so three clips could be loud or silent
            // together and nothing in between. This edits the open clip and
            // nothing else, and names it so that is not in doubt.
            <div className="space-y-2 pt-1" data-editor-sound-panel={clip.id}>
              <div className="flex items-baseline justify-between">
                <p className="text-[12px] font-semibold text-white/80">
                  Volume ·{' '}
                  <span className="text-white/55">
                    {many ? `Clip ${index + 1} of ${clips.length}` : 'this clip'}
                  </span>
                </p>
                <span
                  data-editor-clip-volume-value
                  className="text-[13px] font-bold tabular-nums text-white"
                >
                  {Math.round(clip.volume * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="sr-only" htmlFor="editor-clip-volume">
                  Volume for this clip
                </label>
                <input
                  id="editor-clip-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={clip.volume}
                  data-editor-clip-volume
                  onChange={(event) =>
                    onPatchClip?.(clip.id, { volume: Number(event.target.value) })
                  }
                  className="scrub flex-1"
                />
                <button
                  type="button"
                  onClick={() => onPatchClip?.(clip.id, { volume: clip.volume > 0 ? 0 : 1 })}
                  aria-pressed={clip.volume === 0}
                  data-editor-clip-mute
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition ${
                    clip.volume === 0
                      ? 'border-fay bg-fay/15 text-white'
                      : 'border-white/10 bg-white/[0.04] text-white/70'
                  }`}
                >
                  <VolumeIcon muted={clip.volume === 0} width={15} height={15} />
                  {clip.volume === 0 ? 'Muted' : 'Mute'}
                </button>
              </div>

              <p className="text-[11px] text-white/45">
                Only this clip. The others keep their own levels, in the preview and in
                the posted video.
              </p>

              {/* The whole post, which is a different question from how loud any
                  one clip is: it is whether this video is watched silent. */}
              <div className="flex gap-2 pt-0.5">
                {[
                  { on: true, label: 'Sound on', hint: 'The post plays audio' },
                  { on: false, label: 'Sound off', hint: 'The post is silent' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => onMuted(!option.on)}
                    aria-pressed={muted === !option.on}
                    data-editor-sound={option.on ? 'on' : 'off'}
                    className={`min-h-[44px] flex-1 rounded-xl border px-3 py-1.5 text-left transition ${
                      muted === !option.on
                        ? 'border-fay bg-fay/15'
                        : 'border-white/10 bg-white/[0.04] active:bg-white/[0.09]'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[12px] font-semibold text-white">
                      <VolumeIcon muted={!option.on} width={14} height={14} />
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-white/45">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tool === 'text' && (
            <div className="space-y-2 pt-1">
              {overlays.length === 0 && (
                <p className="text-[12px] text-white/50">
                  Put a line over the video, then drag it where you want it.
                </p>
              )}
              {overlays.map((overlay, position) => (
                <div
                  key={position}
                  data-editor-overlay={position}
                  data-editor-overlay-picked={pickedText === position}
                  className={`rounded-xl border p-2 transition ${
                    pickedText === position
                      ? 'border-fay bg-fay/10'
                      : 'border-white/10 bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      value={overlay.text}
                      maxLength={MAX_TEXT_OVERLAY_LENGTH}
                      aria-label={`Text ${position + 1}`}
                      data-editor-text-input
                      placeholder="Say something"
                      onFocus={() => setPickedText(position)}
                      onChange={(event) => patchOverlay(position, { text: event.target.value })}
                      className="min-h-[44px] w-full text-base"
                    />
                    <button
                      type="button"
                      onClick={() => removeOverlay(position)}
                      aria-label={`Remove text ${position + 1}`}
                      data-editor-text-remove
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-white/60 transition active:scale-95"
                    >
                      <TrashIcon width={16} height={16} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {(['m', 'l'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => patchOverlay(position, { size })}
                        aria-pressed={overlay.size === size}
                        className={`chip px-2.5 py-1 text-[11px] ${overlay.size === size ? 'chip-active' : ''}`}
                      >
                        {size === 'm' ? 'Small' : 'Big'}
                      </button>
                    ))}
                    <span className="w-1" />
                    {(['light', 'dark', 'fay'] as const).map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => patchOverlay(position, { tone })}
                        aria-pressed={overlay.tone === tone}
                        aria-label={`${tone} background`}
                        className={`h-7 w-7 rounded-full border-2 transition ${
                          overlay.tone === tone ? 'border-white' : 'border-white/20'
                        } ${tone === 'light' ? 'bg-black/70' : tone === 'dark' ? 'bg-white' : 'bg-fay'}`}
                      />
                    ))}
                  </div>
                  {/* Where and when, both said plainly, because both are set by
                      dragging something rather than by a control in this row. */}
                  <p
                    data-editor-text-window={position}
                    className="mt-1.5 text-[11px] text-white/45"
                  >
                    {pickedText === position
                      ? 'Drag it on the video to move it. '
                      : 'Tap it on the video to move it. '}
                    <span className="tabular-nums text-white/65">
                      {formatPreciseSeconds(windowOf(overlay, total).from)}–
                      {formatPreciseSeconds(windowOf(overlay, total).to)}
                    </span>
                    {pickedText === position ? ' — drag the purple handles above' : ''}
                  </p>
                </div>
              ))}
              {overlays.length < MAX_TEXT_OVERLAYS && (
                <button
                  type="button"
                  onClick={addOverlay}
                  data-editor-add-text
                  className="btn-ghost min-h-[44px] w-full py-2 text-[13px]"
                >
                  <PlusIcon width={15} height={15} /> Add text
                </button>
              )}
            </div>
          )}

          {tool === 'cover' && (
            <div className="pt-1">
              <CoverPicker
                preview={cover.preview}
                custom={cover.custom}
                isCustom={cover.isCustom}
                at={cover.at}
                max={total}
                error={cover.error}
                onAt={cover.onAt}
                onFile={cover.onFile}
                onClear={cover.onClear}
              />
            </div>
          )}

          {tool === 'crop' && (
            <div className="space-y-2 pt-1">
              <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto">
                {SHAPES.map((shape) => {
                  const target = cropForRatio(clip, shape.ratio);
                  const active =
                    Math.abs(target.width - clip.crop.width) < 0.005 &&
                    Math.abs(target.height - clip.crop.height) < 0.005;
                  return (
                    <button
                      key={shape.label}
                      type="button"
                      onClick={() => onPatchClip?.(clip.id, { crop: target })}
                      aria-pressed={active}
                      data-editor-shape={shape.label}
                      className={`chip shrink-0 px-3 py-1.5 text-[11px] ${active ? 'chip-active' : ''}`}
                    >
                      {shape.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onPatchClip?.(clip.id, { rotation: ((clip.rotation + 90) % 360) as Rotation })
                  }
                  data-editor-rotate
                  className="btn-quiet min-h-[40px] shrink-0 px-3 py-1.5 text-[11px]"
                >
                  <RotateIcon width={14} height={14} /> Turn
                </button>
                <p className="text-[11px] text-white/45">
                  Crops from the middle of the frame. Nothing outside it is posted.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============ 5. the clips, and one more ============ */}
      {/* Their own frames, because a clip is chosen by recognising it. */}
      <div
        data-editor-strip
        className="safe-bottom safe-x hide-scrollbar flex shrink-0 items-stretch gap-2 overflow-x-auto px-3 pt-2"
      >
        {segments.map((each, position) => {
          const chosen = position === index;
          const poster = frames.poster(each.clip.id);
          return (
            <button
              key={each.clip.id}
              type="button"
              onClick={() => pick(position)}
              aria-pressed={chosen}
              aria-label={`Clip ${position + 1} of ${clips.length}`}
              data-editor-clip={position}
              className={`relative h-14 w-12 shrink-0 overflow-hidden rounded-lg border-2 bg-ink-800 transition ${
                confirmDelete === each.clip.id
                  ? 'border-red-400 ring-2 ring-red-400/60'
                  : chosen
                    ? 'border-fay'
                    : 'border-transparent opacity-70 active:opacity-100'
              }`}
            >
              <span
                className="absolute inset-0 bg-cover bg-center"
                style={poster ? { backgroundImage: `url(${poster})` } : undefined}
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent pb-0.5 pt-2 text-center text-[9px] font-bold tabular-nums text-white">
                {formatSeconds(each.length)}
              </span>
              <span className="absolute left-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded bg-black/65 px-1 text-[9px] font-bold text-white">
                {position + 1}
              </span>
            </button>
          );
        })}

        {onDeleteClip && (
          <button
            type="button"
            onClick={() => setConfirmDelete(clip.id)}
            data-editor-delete
            aria-label={many ? `Delete clip ${index + 1}` : 'Delete this clip'}
            className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-white/55 transition active:bg-white/10"
          >
            <TrashIcon width={16} height={16} />
          </button>
        )}

        {onAddClip && (
          <button
            type="button"
            onClick={onAddClip}
            data-editor-add-clip
            aria-label="Film another clip"
            className="flex h-14 w-12 shrink-0 items-center justify-center rounded-lg bg-fay text-white shadow-lg shadow-fay/25 transition active:scale-95"
          >
            <PlusIcon width={20} height={20} />
          </button>
        )}
      </div>

      {/* ============ asking before deleting ============ */}
      {/* Deleting used to happen on the tap. A clip is a take somebody cannot
          film again — the moment has gone — so this asks, and says which one it
          means: the clip in question is already the selected one, lit in the row
          above, and named here. Small and low, so the video stays visible behind
          it and the answer is next to the thumb that asked the question. */}
      {confirmDelete && (
        <div
          data-editor-confirm-delete
          role="dialog"
          aria-modal="true"
          aria-label="Delete clip?"
          className="absolute inset-0 z-20 flex items-end justify-center"
        >
          {/* Dismisses on a tap outside, which is the same answer as No. */}
          <button
            type="button"
            aria-label="Keep the clip"
            data-editor-confirm-scrim
            onClick={() => setConfirmDelete(null)}
            className="absolute inset-0 bg-black/45"
          />
          <div className="safe-bottom relative mb-2 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-white/10 bg-ink-900/95 p-3 shadow-2xl backdrop-blur-xl">
            <p className="text-center text-[14px] font-semibold text-white">
              {many ? `Delete clip ${index + 1} of ${clips.length}?` : 'Delete this clip?'}
            </p>
            <p className="mt-0.5 text-center text-[11px] text-white/50">
              {many
                ? 'The other clips are not touched.'
                : 'It is the only clip, so this goes back to the camera.'}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                data-editor-confirm-no
                className="btn-quiet min-h-[44px] flex-1 py-2 text-[14px]"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  const going = confirmDelete;
                  setConfirmDelete(null);
                  // Only the clip that was asked about, by id — not by position,
                  // which could have moved under the question.
                  onDeleteClip?.(going);
                }}
                data-editor-confirm-yes
                className="btn-primary min-h-[44px] flex-1 py-2 text-[14px]"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
