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
import { ConfirmSheet } from './ConfirmSheet';
import { projectFrames } from '@/lib/video/thumbnails';
import {
  clampOverlay,
  newOverlay,
  trimOverlay,
  windowOf,
} from '@/lib/video/overlays';
import {
  clipDuration,
  outputFrame,
  toggledVolume,
  type Clip,
  type Rotation,
} from '@/lib/video/clips';
import { timeline, timelineDuration } from '@/lib/video/playlist';
import { formatPreciseSeconds, formatSeconds } from '@/lib/video/limits';
import { MAX_TEXT_OVERLAYS, MAX_TEXT_OVERLAY_LENGTH, type TextOverlay } from '@/lib/types';

/**
 * The editing stage: the video, with the editing arranged AROUND it.
 *
 * FIVE BANDS, top to bottom, and the order is the whole design:
 *
 *   1  back · undo · "Edit" · redo · Next
 *   2  the PROJECT as a strip of its own frames, the selected clip outlined, a
 *      playhead; under it play, a scrubber and the time
 *   3  the video, as large as the rest allows, with nothing on top of it
 *   4  Trim, Sound, Text, Cover, Crop, and ONE compact row for whichever is open
 *   5  the clips as thumbnails, Delete, and a + to film another
 *
 * THE VIDEO DOES NOT MOVE. Every tool's panel is the same short height — a label
 * and one row of controls — so switching from Trim to Sound no longer shrinks
 * the picture. It used to: the Sound panel carried a sentence and two large
 * "Sound on / Sound off" cards, and on a 390x664 phone the video dropped from
 * 358px tall to 227px the moment it opened. A slider and a Mute button are all
 * per-clip sound needs.
 *
 * THE STRIP IS THE WHOLE VIDEO, with the selected clip outlined in it, because
 * "where am I in the finished video" is the question it answers. Scrubbing it
 * moves through the project and selects whichever clip the playhead lands in.
 * With Trim open it zooms into the selected clip — all of its source, with a
 * grip at each end and the trimmed-off parts dimmed — because a grip on a strip
 * that resizes as you drag it runs away from your thumb.
 *
 * THE PREVIEW IS THE OUTPUT FRAME. A 9:16 box, the same fit `renderClips` uses
 * into 1080x1920, each clip shown with its own crop, turn and volume — see
 * ClipPlayer. A preview that differs from the export is not a preview.
 *
 * WHAT IT EDITS, all of it values on the project the studio holds:
 *
 *   Trim   — `trimStart`/`trimEnd` on ONE clip. Never leaves the editor.
 *   Sound  — `volume` on ONE clip; Mute is a volume of 0, and unmute brings the
 *            old level back. The render gives each clip its own gain node.
 *   Text   — overlays with a free position and their own start and end, drawn
 *            over the video by the player rather than burned in.
 *   Cover  — the existing picker, compact; picking a frame shows it large.
 *   Crop   — `crop` and `rotation` on ONE clip, which `drawFrame` honours.
 *
 * There is no Filters tool. FayTarra's render has no colour pipeline, so a
 * filter rail would be a row of buttons that change nothing.
 *
 * Next is the only way forward. The studio renders the project with every edit
 * in it, showing progress here, and only then moves to posting.
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

/** How many frames the project strip shows across the screen. */
const PROJECT_CELLS = 10;

/** The text backgrounds, in the order the swatch cycles through them. */
const TONES: TextOverlay['tone'][] = ['light', 'dark', 'fay'];

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
  onOverlays,
  onAddClip,
  onDeleteClip,
  onRetake,
  onNext,
  preparing = null,
  onCancelPreparing,
  problem = null,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: {
  /** The whole project, in order. One clip is a project of one. */
  clips: Clip[];
  /** Whether the finished post plays silent. Applied to the preview. */
  muted: boolean;
  overlays: TextOverlay[];
  cover: EditorCover;
  /** Which tool is open. Controlled, so arriving here to pick a cover can say so. */
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Trims ONE clip, named by id rather than by position. */
  onTrimClip: (id: string, patch: { trimStart: number; trimEnd: number }) => void;
  /** One clip's volume, crop or rotation. */
  onPatchClip?: (id: string, patch: Partial<Clip>) => void;
  onOverlays: (overlays: TextOverlay[]) => void;
  /** Filming another clip, where the budget allows it. */
  onAddClip?: () => void;
  /** Dropping one clip out of the project. */
  onDeleteClip?: (id: string) => void;
  /** Back to the camera, dropping the take being edited. */
  onRetake: () => void;
  onNext: () => void;
  /** The render Next started, while it runs. Null otherwise. */
  preparing?: { label: string; ratio: number } | null;
  onCancelPreparing?: () => void;
  /** Why the last Next did not get to posting, if it did not. */
  problem?: string | null;
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
  /** Which clip the tools are about. */
  const [selected, setSelected] = useState(0);
  /** Which line of text is being edited, if any. */
  const [pickedText, setPickedText] = useState<number | null>(null);
  /** The clip Delete is asking about. Null when it is not asking. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /**
   * Whether Back is asking. Back goes to the camera to retake, and dropping the
   * last take is what that means — so it asks first, exactly as Delete does,
   * rather than losing a clip to a tap meant as "go back".
   */
  const [confirmBack, setConfirmBack] = useState(false);
  /**
   * The level each clip had before it was muted, by id, so unmuting brings it
   * back. Held here rather than on the clip: it is a convenience of this
   * screen, not part of the video, and the render has no use for it.
   */
  const beforeMute = useRef<Record<string, number>>({});

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

  /* -------------------------------------------------------------- the sound */

  function setVolume(volume: number) {
    if (!clip) return;
    if (volume > 0) beforeMute.current[clip.id] = volume;
    onPatchClip?.(clip.id, { volume });
  }

  function toggleMute() {
    if (!clip) return;
    if (clip.volume > 0) beforeMute.current[clip.id] = clip.volume;
    onPatchClip?.(clip.id, { volume: toggledVolume(clip.volume, beforeMute.current[clip.id]) });
  }

  /* ------------------------------------------------------------- the strip */

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
   * The strip is the whole project, so this is project time — and the clip the
   * playhead lands in becomes the selected one, which is what "this clip" means
   * to the tools below. Zoomed into one clip for trimming, it is that clip's own
   * source instead, held inside what is kept.
   */
  function scrubTo(clientX: number) {
    if (zoomed) {
      const segment = segments[index];
      if (!segment) return;
      const source = Math.min(Math.max(sourceAt(clientX), clip.trimStart), clip.trimEnd);
      player.current?.seek(segment.startsAt + (source - clip.trimStart));
      return;
    }
    const seconds = acrossStrip(clientX) * total;
    player.current?.seek(seconds);
    // A line being timed is about the whole video, not about a clip.
    if (timing) return;
    const landed = segments.find((each) => seconds < each.endsAt) ?? segments[segments.length - 1];
    if (landed && landed.index !== index) setSelected(landed.index);
  }

  /** Dragging anywhere on the strip scrubs it. */
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

  /**
   * Dragging a trim grip.
   *
   * The zoomed strip is the clip's WHOLE source, which is what makes dragging
   * stable: if it were the kept part, every drag would resize the thing being
   * dragged and the grip would run away from the thumb. Pointer capture so a
   * finger that slides off the strip keeps hold of the grip.
   */
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
  const segment = segments[index];
  const clipName = many ? `Clip ${index + 1} of ${clips.length}` : 'This clip';

  /** The line being timed, if the Text tool has one open. */
  const timedText = tool === 'text' && pickedText !== null ? overlays[pickedText] : undefined;
  const timing = Boolean(timedText);
  const textWindow = timedText ? windowOf(timedText, total) : null;
  /** Trim open: the strip shows the selected clip's own source, with grips. */
  const zoomed = tool === 'trim' && !timing;

  /** The kept window as fractions of the selected clip's own source length. */
  const window0 = clip.sourceDuration > 0 ? clip.trimStart / clip.sourceDuration : 0;
  const window1 = clip.sourceDuration > 0 ? clip.trimEnd / clip.sourceDuration : 1;
  /** Where the selected clip sits in the project, as fractions of it. */
  const span0 = segment && total > 0 ? segment.startsAt / total : 0;
  const span1 = segment && total > 0 ? segment.endsAt / total : 1;

  const stripFrames = zoomed
    ? (frames.strips[clip.id] ?? [])
    : projectFrames(segments, frames.strips, PROJECT_CELLS);
  /** The playhead's place along whichever of those the strip is showing. */
  const headAt = zoomed
    ? segment && clip.sourceDuration > 0
      ? Math.min(Math.max(clip.trimStart + (at - segment.startsAt), 0), clip.sourceDuration) /
        clip.sourceDuration
      : 0
    : total > 0
      ? Math.min(Math.max(at / total, 0), 1)
      : 0;
  const headShown = !zoomed || Boolean(segment && at >= segment.startsAt && at <= segment.endsAt);
  const progress = total > 0 ? Math.min(100, Math.max(0, (at / total) * 100)) : 0;
  const picked = pickedText !== null ? overlays[pickedText] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink-950"
      data-editor-fullscreen
    >
      {/* ===================== 1. the top bar ===================== */}
      <div
        data-editor-topbar
        className="safe-top safe-x grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 px-2"
      >
        <button
          type="button"
          onClick={() => setConfirmBack(true)}
          data-editor-retake
          aria-label="Back to the camera"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white transition active:scale-95 active:bg-white/10"
        >
          <ChevronIcon direction="left" width={22} height={22} />
        </button>
        {/* Undo and redo sit with the title: they are not a tool, they apply to
            whatever was last done, and a thumb looks for them up here. */}
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            data-editor-undo
            aria-label="Undo"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white transition active:bg-white/10 disabled:opacity-25"
          >
            <UndoIcon width={19} height={19} />
          </button>
          <p className="px-1 text-[16px] font-semibold tracking-wide text-white">Edit</p>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            data-editor-redo
            aria-label="Redo"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white transition active:bg-white/10 disabled:opacity-25"
          >
            <UndoIcon width={19} height={19} className="-scale-x-100" />
          </button>
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={Boolean(preparing)}
          data-editor-next
          className="btn-primary h-10 px-5 py-0 text-[15px] disabled:opacity-60"
        >
          Next
        </button>
      </div>

      {/* =========== 2. the project, as its own frames, and the clock =========== */}
      <div className="safe-x shrink-0 px-3 pt-1" data-editor-scrub>
        <div
          ref={strip}
          onPointerDown={scrubFrom}
          data-editor-track
          data-editor-track-mode={zoomed ? 'clip' : 'project'}
          className="relative h-11 w-full touch-none select-none overflow-hidden rounded-xl bg-ink-800"
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

          {/* The joins between clips, and the selected clip outlined. */}
          {!zoomed && (
            <>
              {segments.slice(1).map((each) => (
                <span
                  key={each.clip.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-ink-950"
                  style={{ left: `${total > 0 ? (each.startsAt / total) * 100 : 0}%` }}
                />
              ))}
              {many && !timing && (
                <span
                  aria-hidden="true"
                  data-editor-track-selected={index}
                  className="pointer-events-none absolute inset-y-0 rounded-lg border-2 border-fay shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                  style={{ left: `${span0 * 100}%`, right: `${(1 - span1) * 100}%` }}
                />
              )}
            </>
          )}

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
                  <span className="h-9 w-1.5 rounded-full bg-aura shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]" />
                </span>
              ))}
            </>
          )}

          {zoomed && (
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
                className="pointer-events-none absolute inset-y-0 rounded-md border-2 border-fay"
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
                  // A thumb's worth of target, drawn as a bar, and kept inside the
                  // strip at the extremes rather than half off its edge.
                  className="absolute inset-y-0 flex w-9 cursor-ew-resize touch-none items-center justify-center"
                  style={
                    edge === 'start'
                      ? { left: `${window0 * 100}%`, marginLeft: '-4px' }
                      : { left: `${window1 * 100}%`, marginLeft: '-32px' }
                  }
                >
                  <span className="h-9 w-1.5 rounded-full bg-fay shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]" />
                </span>
              ))}
            </>
          )}

          {/* The playhead. */}
          {headShown && (
            <span
              className="pointer-events-none absolute -inset-y-px w-[2px] -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]"
              style={{ left: `${headAt * 100}%` }}
            />
          )}
        </div>

        {/* Play, where we are, and how long it is — always the whole video. */}
        <div className="mt-1 flex h-7 items-center gap-2.5">
          <button
            type="button"
            onClick={() => player.current?.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}
            data-editor-playpause
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95"
          >
            {playing ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
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
                '--scrub-track': `linear-gradient(to right, #FF3D9A ${progress}%, rgba(255,255,255,0.22) ${progress}%)`,
              } as React.CSSProperties
            }
            className="scrub scrub-sm min-w-0 flex-1"
          />
          <span
            data-editor-time
            className="shrink-0 text-[12px] font-semibold tabular-nums text-white/70"
          >
            {formatPreciseSeconds(at)} / {formatSeconds(total)}
          </span>
        </div>
      </div>

      {/* ===================== 3. the video ===================== */}
      {/* A 9:16 box, which IS the output frame, as tall as the bands around it
          allow. Nothing is drawn on top of it but the words being edited. */}
      <div
        data-editor-stage
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-0.5"
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
              them here is positioning them there, and `now` shows each one
              exactly when it will show in the post. */}
          <VideoText
            media={{ text: overlays, duration: total }}
            now={at}
            onPick={tool === 'text' ? (position) => setPickedText(position) : undefined}
            onMove={tool === 'text' ? moveOverlay : undefined}
            selected={tool === 'text' ? pickedText : null}
          />
        </div>
      </div>

      {/* ============ 4. the tools, and one row for whichever is open ============ */}
      <div data-editor-controls className="safe-x shrink-0 px-3 pt-0.5">
        <div className="grid grid-cols-5 gap-1.5">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTool(key)}
              aria-pressed={tool === key}
              data-editor-tool={key}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[11px] font-semibold transition ${
                tool === key
                  ? 'border-fay bg-fay/[0.16] text-white'
                  : 'border-white/[0.07] bg-white/[0.04] text-white/70 active:bg-white/[0.09]'
              }`}
            >
              <Icon width={19} height={19} />
              {label}
            </button>
          ))}
        </div>

        {/* THE SAME HEIGHT FOR EVERY TOOL: a label and one row. That is what
            keeps the video from jumping when the tool changes. */}
        <div className="h-[60px] pt-1.5" data-editor-panel={tool}>
          {tool === 'trim' && (
            <>
              <PanelLabel
                left={`Trim · ${clipName}`}
                right={
                  <>
                    Keeping{' '}
                    <span className="tabular-nums text-white">{formatPreciseSeconds(kept)}</span>
                  </>
                }
              />
              <div className="mt-1 flex h-9 items-center gap-2">
                {/* The grips on the strip are the way to trim; these are the same
                    two numbers for fine adjustment and for a keyboard. */}
                <label
                  className="shrink-0 text-[11px] font-semibold text-white/50"
                  htmlFor="editor-trim-start"
                >
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
                  className="scrub scrub-sm min-w-0 flex-1"
                />
                <label
                  className="shrink-0 text-[11px] font-semibold text-white/50"
                  htmlFor="editor-trim-end"
                >
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
                  className="scrub scrub-sm min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={() => onTrimClip(clip.id, { trimStart: 0, trimEnd: clip.sourceDuration })}
                  disabled={clip.trimStart === 0 && clip.trimEnd === clip.sourceDuration}
                  data-editor-trim-reset
                  className="h-9 shrink-0 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[12px] font-semibold text-white/80 transition active:bg-white/10 disabled:opacity-30"
                >
                  Reset
                </button>
              </div>
            </>
          )}

          {tool === 'sound' && (
            // PER CLIP, and it says which. Every clip keeps its own level; this
            // edits the selected one and nothing else.
            <div data-editor-sound-panel={clip.id}>
              <PanelLabel left={`Volume · ${clipName}`} />
              <div className="mt-1 flex h-9 items-center gap-2.5">
                <div className="flex h-9 min-w-0 flex-1 items-center">
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
                    onChange={(event) => setVolume(Number(event.target.value))}
                    style={
                      {
                        '--scrub-track': `linear-gradient(to right, #FF3D9A ${clip.volume * 100}%, rgba(255,255,255,0.22) ${clip.volume * 100}%)`,
                      } as React.CSSProperties
                    }
                    className="scrub scrub-sm w-full"
                  />
                </div>
                <span
                  data-editor-clip-volume-value
                  className="w-11 shrink-0 text-right text-[14px] font-bold tabular-nums text-white"
                >
                  {Math.round(clip.volume * 100)}%
                </span>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={clip.volume === 0}
                  data-editor-clip-mute
                  className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition ${
                    clip.volume === 0
                      ? 'border-fay bg-fay/15 text-white'
                      : 'border-white/10 bg-white/[0.05] text-white/80'
                  }`}
                >
                  <VolumeIcon muted width={15} height={15} />
                  {clip.volume === 0 ? 'Unmute' : 'Mute'}
                </button>
              </div>
            </div>
          )}

          {tool === 'text' && (
            <>
              <PanelLabel
                left={
                  picked && textWindow ? (
                    <span data-editor-text-window={pickedText}>
                      Text {(pickedText ?? 0) + 1} ·{' '}
                      <span className="tabular-nums">
                        {formatPreciseSeconds(textWindow.from)}–{formatPreciseSeconds(textWindow.to)}
                      </span>
                      <span className="text-white/40"> · drag on video, time above</span>
                    </span>
                  ) : overlays.length > 0 ? (
                    'Text · tap one to edit'
                  ) : (
                    'Text · starts in the middle, drag it anywhere'
                  )
                }
                right={
                  <span className="flex items-center gap-1">
                    {overlays.map((overlay, position) => (
                      <button
                        key={position}
                        type="button"
                        onClick={() => setPickedText(position)}
                        aria-pressed={pickedText === position}
                        aria-label={`Text ${position + 1}`}
                        data-editor-overlay={position}
                        data-editor-overlay-picked={pickedText === position}
                        className={`h-5 min-w-[20px] rounded-md px-1 text-[10px] font-bold transition ${
                          pickedText === position ? 'bg-fay text-white' : 'bg-white/10 text-white/70'
                        }`}
                      >
                        {position + 1}
                      </button>
                    ))}
                  </span>
                }
              />
              <div className="mt-1 flex h-9 items-center gap-1.5">
                {picked && pickedText !== null ? (
                  <>
                    <input
                      value={picked.text}
                      maxLength={MAX_TEXT_OVERLAY_LENGTH}
                      aria-label={`Text ${pickedText + 1}`}
                      data-editor-text-input
                      placeholder="Say something"
                      onChange={(event) => patchOverlay(pickedText, { text: event.target.value })}
                      className="h-9 min-w-0 flex-1 rounded-xl px-3 py-0 text-base"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patchOverlay(pickedText, { size: picked.size === 'l' ? 'm' : 'l' })
                      }
                      aria-label={picked.size === 'l' ? 'Make the text smaller' : 'Make the text bigger'}
                      data-editor-text-size={picked.size}
                      className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-white/[0.05] text-[13px] font-bold text-white"
                    >
                      {picked.size === 'l' ? 'Aa' : 'aa'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchOverlay(pickedText, {
                          tone: TONES[(TONES.indexOf(picked.tone) + 1) % TONES.length],
                        })
                      }
                      aria-label="Change the text background"
                      data-editor-text-tone={picked.tone}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]"
                    >
                      <span
                        className={`h-5 w-5 rounded-full border-2 border-white/70 ${
                          picked.tone === 'light' ? 'bg-black/70' : picked.tone === 'dark' ? 'bg-white' : 'bg-fay'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOverlay(pickedText)}
                      aria-label={`Remove text ${pickedText + 1}`}
                      data-editor-text-remove
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70"
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </>
                ) : null}
                {overlays.length < MAX_TEXT_OVERLAYS && (
                  <button
                    type="button"
                    onClick={addOverlay}
                    data-editor-add-text
                    aria-label="Add text"
                    className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] text-[13px] font-semibold text-white ${
                      picked ? 'w-9' : 'flex-1'
                    }`}
                  >
                    <PlusIcon width={15} height={15} />
                    {!picked && 'Add text'}
                  </button>
                )}
              </div>
            </>
          )}

          {tool === 'cover' && (
            <CoverPicker
              compact
              preview={cover.preview}
              custom={cover.custom}
              isCustom={cover.isCustom}
              at={cover.at}
              max={total}
              error={cover.error}
              onAt={(seconds) => {
                cover.onAt(seconds);
                // Shown large, in the video, rather than only in the thumbnail.
                player.current?.seek(seconds);
              }}
              onFile={cover.onFile}
              onClear={cover.onClear}
            />
          )}

          {tool === 'crop' && (
            <>
              <PanelLabel left={`Crop · ${clipName}`} right="Only this clip" />
              <div className="mt-1 flex h-9 items-center gap-1.5">
                <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
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
                        className={`h-9 shrink-0 rounded-xl border px-3 text-[12px] font-semibold transition ${
                          active
                            ? 'border-fay bg-fay/15 text-white'
                            : 'border-white/10 bg-white/[0.05] text-white/75'
                        }`}
                      >
                        {shape.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onPatchClip?.(clip.id, { rotation: ((clip.rotation + 90) % 360) as Rotation })
                  }
                  data-editor-rotate
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[12px] font-semibold text-white/80"
                >
                  <RotateIcon width={14} height={14} /> Turn
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ============ 5. the clips, and one more ============ */}
      {/* Their own frames, because a clip is chosen by recognising it. */}
      <div
        data-editor-strip
        className="safe-bottom safe-x hide-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto px-3 pb-1 pt-1"
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
              data-editor-clip-volume-level={each.clip.volume}
              className={`relative h-[54px] w-[48px] shrink-0 overflow-hidden rounded-xl border-2 bg-ink-800 transition ${
                confirmDelete === each.clip.id ||
                (confirmBack && position === clips.length - 1)
                  ? 'border-red-400 ring-2 ring-red-400/60'
                  : chosen
                    ? 'border-fay shadow-lg shadow-fay/30'
                    : 'border-white/[0.06] opacity-75 active:opacity-100'
              }`}
            >
              <span
                className="absolute inset-0 bg-cover bg-center"
                style={poster ? { backgroundImage: `url(${poster})` } : undefined}
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent pb-0.5 pt-3 text-center text-[11px] font-bold tabular-nums text-white">
                {formatSeconds(each.length)}
              </span>
              <span className="absolute left-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-black/65 px-1 text-[10px] font-bold text-white">
                {position + 1}
              </span>
              {each.clip.volume === 0 && (
                <span
                  className="absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-md bg-black/65 text-white"
                  aria-label="Muted"
                >
                  <VolumeIcon muted width={11} height={11} />
                </span>
              )}
            </button>
          );
        })}

        {onDeleteClip && (
          <button
            type="button"
            onClick={() => setConfirmDelete(clip.id)}
            data-editor-delete
            aria-label={many ? `Delete clip ${index + 1}` : 'Delete this clip'}
            className="flex h-[54px] w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.03] text-white/70 transition active:bg-white/10"
          >
            <TrashIcon width={18} height={18} />
          </button>
        )}

        {onAddClip && (
          <button
            type="button"
            onClick={onAddClip}
            data-editor-add-clip
            aria-label="Film another clip"
            className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-xl bg-fay text-white shadow-lg shadow-fay/25 transition active:scale-95"
          >
            <PlusIcon width={24} height={24} />
          </button>
        )}
      </div>

      {/* ============ asking before deleting ============ */}
      {/* A clip is a take somebody cannot film again, so this asks, and says
          which one it means: the clip in question is the selected one, lit in
          the row behind it. Small and low, next to the thumb that asked. */}
      {confirmDelete && (
        <ConfirmSheet
          kind="delete"
          title="Delete clip?"
          detail={
            many
              ? `Clip ${index + 1} of ${clips.length}. The others are not touched.`
              : 'It is the only clip, so this goes back to the camera.'
          }
          onNo={() => setConfirmDelete(null)}
          onYes={() => {
            const going = confirmDelete;
            setConfirmDelete(null);
            // Only the clip that was asked about, by id — not by position,
            // which could have moved under the question.
            onDeleteClip?.(going);
          }}
        />
      )}

      {/* Back is a retake: the camera reopens and the LAST take is dropped so
          it can be filmed again. Said plainly, with that clip lit in the row
          behind, because it is the same loss as Delete and used to happen on
          the tap. */}
      {confirmBack && (
        <ConfirmSheet
          kind="retake"
          title={many ? `Retake clip ${clips.length}?` : 'Discard this recording?'}
          detail={
            many
              ? `Going back to the camera discards clip ${clips.length} of ${clips.length}, the last one you filmed. Your other clips and their edits are kept.`
              : 'Going back to the camera discards this recording and its edits so you can film it again.'
          }
          onNo={() => setConfirmBack(false)}
          onYes={() => {
            setConfirmBack(false);
            onRetake();
          }}
        />
      )}

      {/* ============ putting it together, after Next ============ */}
      {/* Over the editor rather than instead of it: Cancel lands back exactly
          where somebody was, with every edit intact. */}
      {preparing && (
        <div
          data-editor-preparing
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-30 flex items-center justify-center bg-ink-950/80 px-8 backdrop-blur-sm"
        >
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-ink-900/95 p-4 text-center shadow-2xl">
            <p className="text-[15px] font-semibold text-white">{preparing.label}</p>
            <p className="mt-0.5 text-[11px] text-white/50">
              Every trim, level, crop and line of text goes in.
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                data-editor-preparing-ratio={preparing.ratio.toFixed(2)}
                className="h-full rounded-full bg-fay transition-[width] duration-200"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, preparing.ratio)) * 100)}%` }}
              />
            </div>
            {onCancelPreparing && (
              <button
                type="button"
                onClick={onCancelPreparing}
                data-editor-preparing-cancel
                className="btn-quiet mt-3 min-h-[40px] w-full py-2 text-[13px]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {problem && !preparing && (
        <p
          role="alert"
          data-editor-problem
          className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 rounded-xl border border-fay/40 bg-ink-900/95 px-3 py-2 text-[12px] text-fay-soft shadow-xl"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/** A tool's label row: what it is about on the left, a reading on the right. */
function PanelLabel({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-3.5 items-center justify-between gap-2 text-[12px] font-semibold leading-none text-white/80">
      <span className="min-w-0 truncate">{left}</span>
      {right !== undefined && <span className="shrink-0 text-white/55">{right}</span>}
    </div>
  );
}
