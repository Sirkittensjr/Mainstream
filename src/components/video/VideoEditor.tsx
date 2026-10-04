'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TextIcon,
  TrashIcon,
  TrimIcon,
  VolumeIcon,
} from '@/components/Icons';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';
import { CoverPicker } from './CoverPicker';
import { VideoText } from './VideoText';
import { clipDuration, outputFrame, type Clip } from '@/lib/video/clips';
import { stripWidths, timeline, timelineDuration } from '@/lib/video/playlist';
import { formatPreciseSeconds, formatSeconds } from '@/lib/video/limits';
import { MAX_TEXT_OVERLAYS, MAX_TEXT_OVERLAY_LENGTH, type TextOverlay } from '@/lib/types';

/**
 * The editing stage: a vertical video, a timeline, and four tools.
 *
 * SHAPED LIKE A VIDEO APP, not like a page with a video on it. The picture is
 * full-bleed behind everything; the controls float over its lower part on a
 * scrim; and no panel ever covers the middle of the screen.
 *
 * THE BLACK BANDS, and why they were there. The picture used to be laid across
 * the whole screen with `object-contain`. A phone screen is taller than 9:16
 * (390x844 is 0.46 against 0.5625), so a vertical recording is WIDER than the
 * screen it was being fitted into: `contain` matched its width and left a band of
 * black above and below — about 150px on an iPhone, which is what the screenshot
 * showed. Meanwhile the render fills a 1080x1920 frame with `cover`, so the
 * preview was showing a shape the finished video does not have.
 *
 * Fixed at the layout, and the arithmetic decides the shape of the fix. On a
 * phone a full-width 9:16 frame is TALLER THAN THE SCREEN — 390 wide wants 693
 * tall, against a 664px Safari viewport — so a video that shares the height with
 * a toolbar cannot be 9:16. Putting the picture in the 390x415 space above a
 * toolbar and covering it threw away 40% of the frame's height; fitting it
 * instead brought the bands straight back.
 *
 * So the picture is the WHOLE screen, laid behind the controls, and met with the
 * same fit the render uses — `outputFrame(clips).fit`. A 9:16 source in a 390x664
 * window loses 14px top and bottom to `cover` rather than 40%, there is no black
 * anywhere, nothing is stretched, and what is on screen is what gets posted. The
 * controls then float over the bottom of it, which is also what keeps the frame
 * as large as it can be: every pixel the toolbar does not need is video.
 *
 * THE FREE AREA is what the toolbar leaves — `data-editor-stage`, a flex child
 * sized by the layout rather than by a guess at the toolbar's height. The words
 * and the tap target live in it, so text can never be typed somewhere it cannot
 * be seen.
 *
 * Nothing about captions, categories, tags or content warnings is here. Those
 * belong to posting, and this is editing.
 *
 * WHAT IT EDITS, and what each one costs:
 *
 *   Trim   — two numbers on ONE clip, applied by the render pass at the end.
 *            A multi-clip project is not one blob: each clip keeps its own
 *            boundaries and its own handles, and the preview re-cuts itself as
 *            soon as either moves.
 *   Sound  — a playback property on the finished post. Silencing an audio track
 *            for real means re-encoding, and a two-minute video would cost two
 *            minutes to mute.
 *   Text   — also a playback property, drawn over the video by the player, so a
 *            video carrying words costs no render it did not already need.
 *   Cover  — the existing picker, shared with the posting screen.
 *
 * It owns nothing except which clip is selected and which tool is open. Every
 * change goes up to the composer that holds the clips and does the uploading.
 */

export type EditorTool = 'trim' | 'sound' | 'text' | 'cover';
type Tool = EditorTool;

const TOOLS: { key: Tool; label: string; Icon: typeof TrimIcon }[] = [
  { key: 'trim', label: 'Trim', Icon: TrimIcon },
  { key: 'sound', label: 'Sound', Icon: VolumeIcon },
  { key: 'text', label: 'Text', Icon: TextIcon },
  { key: 'cover', label: 'Cover', Icon: ImageIcon },
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
  onMuted,
  onOverlays,
  onAddClip,
  onRetake,
  onNext,
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
  onMuted: (muted: boolean) => void;
  onOverlays: (overlays: TextOverlay[]) => void;
  /** Filming another clip, where the budget allows it. */
  onAddClip?: () => void;
  /** Back to the camera, dropping the take being edited. */
  onRetake: () => void;
  onNext: () => void;
}) {
  const player = useRef<ClipPlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  /** Project time, driven by the player. */
  const [at, setAt] = useState(0);
  /** Which clip the trim handles belong to. */
  const [selected, setSelected] = useState(0);

  /** The same fit the finished video is rendered with. See the note above. */
  const fit = outputFrame(clips).fit;

  const segments = useMemo(() => timeline(clips), [clips]);
  const total = timelineDuration(segments);
  const widths = useMemo(() => stripWidths(segments), [segments]);
  const many = clips.length > 1;

  // A clip can be dropped from under the selection — Retake drops the last one.
  const index = Math.min(selected, Math.max(0, clips.length - 1));
  const clip = clips[index];

  /** Keeps the selection following the playhead while it plays. */
  useEffect(() => {
    if (!playing) return;
    const here = segments.find((segment) => at >= segment.startsAt && at < segment.endsAt);
    if (here && here.index !== index) setSelected(here.index);
  }, [at, index, playing, segments]);

  /* -------------------------------------------------------------- the text */

  function addOverlay() {
    if (overlays.length >= MAX_TEXT_OVERLAYS) return;
    onOverlays([...overlays, { text: '', at: 'bottom', size: 'l', tone: 'light' }]);
  }

  function patchOverlay(position: number, patch: Partial<TextOverlay>) {
    onOverlays(overlays.map((entry, i) => (i === position ? { ...entry, ...patch } : entry)));
  }

  function removeOverlay(position: number) {
    onOverlays(overlays.filter((_, i) => i !== position));
  }

  /** Only the ones with words in them get previewed or posted. */
  const written = overlays.filter((entry) => entry.text.trim().length > 0);

  /**
   * Dragging a trim handle on the timeline.
   *
   * The selected clip is drawn as its WHOLE source length with a lit window over
   * the part being kept, which is what makes dragging stable: if the bar were the
   * kept part, every drag would resize the thing being dragged and the handle
   * would run away from the thumb. Pointer capture so a finger that slides off
   * the track keeps control of the handle.
   */
  const track = useRef<HTMLDivElement>(null);

  function dragHandle(edge: 'start' | 'end', event: React.PointerEvent<HTMLElement>) {
    const rail = track.current;
    if (!rail || clip.sourceDuration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const box = rail.getBoundingClientRect();
    const secondsAt = (clientX: number) =>
      ((clientX - box.left) / Math.max(1, box.width)) * clip.sourceDuration;

    const move = (moveEvent: PointerEvent) => {
      const seconds = secondsAt(moveEvent.clientX);
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

  return (
    // The picture is the whole screen; the column on top of it divides that screen
    // into the free area and the controls. See the note above for why the video
    // cannot share the height with the toolbar and still be 9:16.
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black"
      data-editor-fullscreen
    >
      {/* =========================== the picture =========================== */}
      <ClipPlayer
        ref={player}
        clips={clips}
        muted={muted}
        fit={fit}
        onTime={setAt}
        onPlayingChange={setPlaying}
        className="absolute inset-0"
      />

      {/* ========================== the free area ========================== */}
      {/* Everything the toolbar does not take. Sized by flex, so the words and
          the tap target are laid out against the real room rather than against a
          guess at how tall the toolbar is. */}
      <div className="relative z-10 min-h-0 flex-1" data-editor-stage>
        {/* The words, inside the free area — so text can never be put somewhere
            the controls will cover. */}
        <VideoText media={{ text: written }} variant="editor" />

        {/* Tap the picture to play or pause. The whole free area, because nothing
            else lives in it. */}
        <button
          type="button"
          onClick={() => player.current?.toggle()}
          aria-hidden="true"
          tabIndex={-1}
          data-editor-tap
          className="absolute inset-0 flex items-center justify-center"
        >
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-opacity ${
              playing ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {playing ? <PauseIcon width={24} height={24} /> : <PlayIcon width={24} height={24} />}
          </span>
        </button>

        {/* ------------------------------------------------------- top bar */}
        {/* Over the picture, on a scrim. `pointer-events-none` on the bar and
            `auto` on its buttons, so the scrim does not eat taps meant for the
            video underneath it. */}
        <div className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 via-black/25 to-transparent px-3 pb-10 pt-2">
          <button
            type="button"
            onClick={onRetake}
            data-editor-retake
            aria-label="Back to the camera"
            className="pointer-events-auto flex h-10 items-center justify-center rounded-full bg-black/45 px-4 text-[14px] font-semibold text-white backdrop-blur-md transition active:scale-95"
          >
            Retake
          </button>
          <div className="pointer-events-none pt-1 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Edit
            </p>
            <p className="text-[13px] font-semibold tabular-nums text-white/90">
              {formatSeconds(total)}
              {many && ` · ${clips.length} clips`}
            </p>
          </div>
          <button
            type="button"
            onClick={onNext}
            data-editor-next
            className="btn-primary pointer-events-auto h-10 px-5 py-0 text-[14px]"
          >
            Next
          </button>
        </div>
      </div>

      {/* =========================== the toolbar =========================== */}
      {/* Over the picture on a scrim rather than beside it in a solid bar: the
          video is full-bleed underneath, and a bar that took its own height would
          take it off the frame. Dark enough to read white controls against moving
          video, short enough to leave most of the video clear. */}
      <div
        data-editor-controls
        className="safe-bottom safe-x relative z-10 shrink-0 bg-gradient-to-t from-black/95 via-black/85 to-black/45 px-3 pb-1 pt-3"
      >
        {/* ---------------------------------------------------- the scrubber */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => player.current?.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}
            data-editor-playpause
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95"
          >
            {playing ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
          </button>
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/60">
            {formatSeconds(at)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, total)}
            step={0.05}
            value={Math.min(Math.max(at, 0), total)}
            aria-label="Position in the video"
            data-editor-timeline
            onChange={(event) => player.current?.seek(Number(event.target.value))}
            // 44px, not 36: it is dragged with a thumb, and the eight pixels it
            // costs the frame are worth a scrubber somebody can actually catch.
            className="h-11 flex-1 accent-fay"
          />
          <span className="w-9 shrink-0 text-[11px] tabular-nums text-white/60">
            {formatSeconds(total)}
          </span>
        </div>

        {/* ---------------------------------------------------- the timeline */}
        {/* One video made of segments. The selected one opens out to its whole
            source length with a lit window over what is kept and a handle at each
            end; the others stay on screen, narrower, so the project is always
            visible and nothing has to be opened to see it. */}
        <div className="mt-1 flex items-stretch gap-1" data-editor-strip>
          {segments.map((segment, position) => {
            const chosen = position === index;
            return (
              <button
                key={segment.clip.id}
                type="button"
                onClick={() => pick(position)}
                aria-pressed={chosen}
                aria-label={`Clip ${position + 1} of ${clips.length}`}
                data-editor-clip={position}
                style={{
                  // The selected clip earns room for its handles; the rest keep
                  // their share of the project's length.
                  flexGrow: chosen ? 2.2 : Math.max(0.35, widths[position] * 2),
                  flexBasis: 0,
                }}
                className={`relative h-11 overflow-hidden rounded-lg border transition ${
                  chosen ? 'min-w-[112px]' : 'min-w-[34px]'
                } ${
                  chosen
                    ? 'border-fay bg-fay/15'
                    : 'border-white/15 bg-white/[0.07] active:bg-white/[0.14]'
                }`}
              >
                {chosen ? (
                  // The whole source, with the kept part lit and draggable.
                  //
                  // Inset by a handle's half-width on each side. A handle is 28px
                  // wide and centred on its position, so a trim at 0s put half of
                  // it outside the clip's `overflow-hidden` box: it was drawn
                  // clipped and, worse, a tap on its centre landed on the border
                  // rather than on the grip, so dragging the start of an untrimmed
                  // clip did nothing at all. Insetting the rail means 0% and 100%
                  // are both far enough in for the whole grip to be on the clip.
                  <span
                    ref={track}
                    data-editor-track
                    className="absolute inset-y-0 left-4 right-4 block"
                  >
                    <span
                      className="absolute inset-y-0 bg-fay/35"
                      style={{
                        left: `${window0 * 100}%`,
                        right: `${(1 - window1) * 100}%`,
                      }}
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
                        // Wide enough for a thumb, drawn narrow.
                        className="absolute inset-y-0 flex w-7 cursor-ew-resize touch-none items-center justify-center"
                        style={
                          edge === 'start'
                            ? { left: `${window0 * 100}%`, marginLeft: '-14px' }
                            : { left: `${window1 * 100}%`, marginLeft: '-14px' }
                        }
                      >
                        <span className="h-7 w-[5px] rounded-full bg-white shadow" />
                      </span>
                    ))}
                    <span className="absolute inset-x-0 bottom-0.5 text-center text-[9px] font-bold tabular-nums text-white/85">
                      {formatPreciseSeconds(kept)}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="absolute inset-x-0 top-1 text-[10px] font-bold text-white/75">
                      {position + 1}
                    </span>
                    <span className="absolute inset-x-0 bottom-0.5 text-[9px] tabular-nums text-white/55">
                      {formatSeconds(segment.length)}
                    </span>
                  </>
                )}
                {/* Where the playhead is inside this segment. */}
                {at >= segment.startsAt && at < segment.endsAt && (
                  <span
                    className="absolute bottom-0 top-0 w-[2px] bg-white"
                    style={{
                      left: `${
                        segment.length > 0 ? ((at - segment.startsAt) / segment.length) * 100 : 0
                      }%`,
                    }}
                  />
                )}
              </button>
            );
          })}

          {/* Filming another clip belongs on the end of the timeline, where the
              clip will appear — not on a full-width button under it, which cost
              44px of video to say the same thing. */}
          {onAddClip && (
            <button
              type="button"
              onClick={onAddClip}
              data-editor-add-clip
              aria-label="Film another clip"
              className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/25 text-white/70 transition active:bg-white/10"
            >
              <PlusIcon width={16} height={16} />
            </button>
          )}
        </div>

        {/* ------------------------------------------------- the tool's sheet */}
        {/* Compact and capped: a tool's controls belong under the timeline, not
            over the video. Trim needs no sheet at all beyond its own numbers —
            the handles are on the timeline. */}
        <div
          className="mt-1 max-h-[26vh] overflow-y-auto"
          data-editor-panel={tool}
        >
          {tool === 'trim' && (
            <div className="flex items-center gap-2 py-1">
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/80">
                {many ? `Clip ${index + 1} of ${clips.length} · Keeping ` : 'Keeping '}
                <span className="tabular-nums text-white/55">{formatPreciseSeconds(kept)}</span>
              </p>
              {/* The handles are the way to trim; these are the same two numbers
                  for a keyboard, and what the suite drives. Narrow on purpose. */}
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
                className="h-9 w-16 shrink-0 accent-fay"
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
                  const segment = segments[index];
                  if (segment) {
                    player.current?.seek(
                      segment.startsAt + Math.max(0, next - clip.trimStart - 0.15),
                    );
                  }
                }}
                className="h-9 w-16 shrink-0 accent-fay"
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
            <div className="flex gap-2 py-1">
              {[
                { on: true, label: 'Sound on', hint: 'As recorded' },
                { on: false, label: 'Sound off', hint: 'Watched silent' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => onMuted(!option.on)}
                  aria-pressed={muted === !option.on}
                  data-editor-sound={option.on ? 'on' : 'off'}
                  className={`min-h-[52px] flex-1 rounded-xl border px-3 py-2 text-left transition ${
                    muted === !option.on
                      ? 'border-fay bg-fay/15'
                      : 'border-white/10 bg-white/[0.04] active:bg-white/[0.09]'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                    <VolumeIcon muted={!option.on} width={15} height={15} />
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-white/45">{option.hint}</span>
                </button>
              ))}
            </div>
          )}

          {tool === 'text' && (
            <div className="space-y-2 py-1">
              {overlays.length === 0 && (
                <p className="text-[12px] text-white/50">Put a line over the video.</p>
              )}
              {overlays.map((overlay, position) => (
                <div
                  key={position}
                  data-editor-overlay
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-2"
                >
                  <div className="flex items-start gap-2">
                    <input
                      value={overlay.text}
                      maxLength={MAX_TEXT_OVERLAY_LENGTH}
                      aria-label={`Text ${position + 1}`}
                      data-editor-text-input
                      placeholder="Say something"
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
                    {(['top', 'middle', 'bottom'] as const).map((spot) => (
                      <button
                        key={spot}
                        type="button"
                        onClick={() => patchOverlay(position, { at: spot })}
                        aria-pressed={overlay.at === spot}
                        data-editor-text-at={spot}
                        className={`chip px-2.5 py-1 text-[11px] capitalize ${overlay.at === spot ? 'chip-active' : ''}`}
                      >
                        {spot}
                      </button>
                    ))}
                    <span className="w-1" />
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
            <div className="py-1">
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
        </div>

        {/* ------------------------------------------------------ the tools */}
        <div className="mt-1 flex items-stretch gap-1">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTool(key)}
              aria-pressed={tool === key}
              data-editor-tool={key}
              className={`flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-semibold transition ${
                tool === key ? 'bg-white/[0.14] text-white' : 'text-white/60 active:bg-white/[0.07]'
              }`}
            >
              <Icon width={18} height={18} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
