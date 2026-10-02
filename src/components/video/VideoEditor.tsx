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
import { clipDuration, type Clip } from '@/lib/video/clips';
import { stripWidths, timeline, timelineDuration } from '@/lib/video/playlist';
import { formatPreciseSeconds, formatSeconds } from '@/lib/video/limits';
import { MAX_TEXT_OVERLAYS, MAX_TEXT_OVERLAY_LENGTH, type TextOverlay } from '@/lib/types';

/**
 * The editing stage: one screen, one job, and the video is the screen.
 *
 * Full screen, with every control laid OVER the picture rather than beside it.
 * The earlier version stacked the video, a scrubber, a tool rail and a panel in
 * a column, which left the video about 40% of a phone — on the one screen where
 * the video is the entire point. Now it fills the viewport and the chrome floats
 * on scrims above it.
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

  /** Jumps the preview to a clip's first kept frame and selects it. */
  function pick(segmentIndex: number) {
    const segment = segments[segmentIndex];
    if (!segment) return;
    setSelected(segmentIndex);
    player.current?.seek(segment.startsAt);
  }

  if (!clip) return null;

  return (
    // `fixed inset-0` and nothing else: the editor IS the screen, 9:16 on a
    // phone, and the picture fills it rather than sitting in a column.
    <div className="fixed inset-0 z-50 overflow-hidden bg-black" data-editor-fullscreen>
      {/* ----------------------------------------------------------- video */}
      <ClipPlayer
        ref={player}
        clips={clips}
        muted={muted}
        onTime={setAt}
        onPlayingChange={setPlaying}
        className="absolute inset-0"
      />

      {/* The chrome, as a column over the picture.

          A column rather than three absolutely-positioned pieces, because the
          tappable part of the video has to be EXACTLY what the controls leave —
          no more and no less. A tap region of `inset-0` put its own centre under
          the editing panel, so tapping the middle of the screen hit a trim label
          (measured: the panel's top edge was 230px down a 664px screen). A
          percentage would have been another guess at the same number. As a
          `flex-1` sibling between the top bar and the controls it is right at any
          screen size, and the play glyph centres in the free space by itself. */}
      <div className="absolute inset-0 z-10 flex flex-col">
        {/* ----------------------------------------------------------- top */}
        {/* `pointer-events-none` on the bar, `auto` on its buttons: the scrim lies
          over the video and must not eat taps meant for it. */}
        <div className="safe-top safe-x pointer-events-none flex shrink-0 items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-1">
          {/* "Retake", not "Back": going back past a take means filming it again,
            and this drops it. Keeping it and filming another is the other
            button, which is a different intention. */}
          <button
            type="button"
            onClick={onRetake}
            data-editor-retake
            className="pointer-events-auto flex h-11 items-center justify-center rounded-full bg-black/40 px-4 text-[14px] font-semibold text-white backdrop-blur-md transition active:scale-95"
          >
            Retake
          </button>
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              Edit
            </p>
            <p className="text-[13px] font-semibold tabular-nums text-white/85">
              {formatSeconds(total)}
              {many && ` · ${clips.length} clips`}
            </p>
          </div>
          <button
            type="button"
            onClick={onNext}
            data-editor-next
            className="btn-primary pointer-events-auto h-11 px-5 py-0 text-[14px]"
          >
            Next
          </button>
        </div>

        {/* ------------------------------------------------- the free picture */}
        {/* Whatever the controls leave: the part of the video nothing covers.
            Tapping it plays or pauses, the way every short-video app behaves. */}
        <div className="relative flex min-h-0 flex-1">
          <button
            type="button"
            onClick={() => player.current?.toggle()}
            // Hidden from assistive tech and from the tab order on purpose: it is
            // a convenience over the picture, and the real Play/Pause control is
            // the button down in the scrubber row. Two elements carrying the same
            // label would be two entries for one action.
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

          {/* The text, drawn inside the free zone rather than over the whole
              frame — which makes this region the safe area, structurally, instead
              of guessing a percentage that clears whichever panel happens to be
              open. "Bottom" here means the bottom of the part you can see, so a
              line can never end up behind the panel while you are the one
              choosing where to put it.

              The trade-off, stated plainly: a bottom-anchored line sits a little
              higher here than in the finished video, where it is drawn over the
              full frame. The posting screen and the post itself both use the
              `post` variant over the whole frame, so the faithful preview is one
              screen away and the last thing seen before posting. */}
          <VideoText media={{ text: written }} variant="editor" />
        </div>

        {/* -------------------------------------------------------- controls */}
        {/* Everything else, on one scrim at the foot of the screen. The video
            behind it does not shrink to make room for any of it. */}
        <div
          data-editor-controls
          className="safe-bottom safe-x shrink-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-2 pt-6"
        >
          {/* -------------------------------------------------- the panel */}
          {/* One tool's controls at a time, in a sheet over the picture. All four
            at once is how an editor becomes a control panel. Capped and
            scrollable so a long panel never pushes the rest off screen. */}
          <div
            className="mb-2 max-h-[34vh] overflow-y-auto rounded-3xl border border-white/10 bg-ink-950/80 p-3 backdrop-blur-xl"
            data-editor-panel={tool}
          >
            {tool === 'trim' && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  {/* "Keeping", not "Trim": the number beside it is what SURVIVES
                      the trim, and a label that does not say so leaves somebody
                      guessing whether they just cut two seconds or kept two. */}
                  <p className="text-sm font-semibold text-white/85">
                    {many ? `Clip ${index + 1} of ${clips.length} · Keeping ` : 'Keeping '}
                    <span className="tabular-nums text-white/55">
                      {formatPreciseSeconds(clipDuration(clip))}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onTrimClip(clip.id, {
                        trimStart: 0,
                        trimEnd: clip.sourceDuration,
                      })
                    }
                    disabled={clip.trimStart === 0 && clip.trimEnd === clip.sourceDuration}
                    data-editor-trim-reset
                    className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-30"
                  >
                    Reset
                  </button>
                </div>

                <label className="mt-2 block text-xs text-white/45" htmlFor="editor-trim-start">
                  Start · {formatPreciseSeconds(clip.trimStart)}
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
                    const next = Math.max(
                      0,
                      Math.min(Number(event.target.value), clip.trimEnd - 0.3),
                    );
                    onTrimClip(clip.id, {
                      trimStart: next,
                      trimEnd: clip.trimEnd,
                    });
                    // Show the new first frame of THIS clip, which is where its
                    // segment now starts on the timeline.
                    player.current?.seek(segments[index]?.startsAt ?? 0);
                  }}
                  className="h-11 w-full accent-fay"
                />
                <label className="mt-1 block text-xs text-white/45" htmlFor="editor-trim-end">
                  End · {formatPreciseSeconds(clip.trimEnd)}
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
                    onTrimClip(clip.id, {
                      trimStart: clip.trimStart,
                      trimEnd: next,
                    });
                    // Just before the new last frame, so the cut is what is seen.
                    const segment = segments[index];
                    if (segment) {
                      const kept = Math.max(0, next - clip.trimStart);
                      player.current?.seek(segment.startsAt + Math.max(0, kept - 0.15));
                    }
                  }}
                  className="h-11 w-full accent-fay"
                />
                <p className="mt-1 text-[11px] text-white/35">
                  {many
                    ? 'Each clip trims on its own. They are joined in this order when you post.'
                    : 'Put together when you post — about as long as what you keep.'}
                </p>
              </div>
            )}

            {tool === 'sound' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {[
                    { on: true, label: 'Sound on', hint: 'As recorded' },
                    {
                      on: false,
                      label: 'Sound off',
                      hint: 'Viewers watch it silent',
                    },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => onMuted(!option.on)}
                      aria-pressed={muted === !option.on}
                      data-editor-sound={option.on ? 'on' : 'off'}
                      className={`min-h-[64px] flex-1 rounded-2xl border px-3 py-2 text-left transition ${
                        muted === !option.on
                          ? 'border-fay bg-fay/15'
                          : 'border-white/10 bg-white/[0.03] active:bg-white/[0.07]'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-white">
                        <VolumeIcon muted={!option.on} width={16} height={16} />
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-white/45">{option.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-white/35">
                  Turning the sound off costs nothing and can be changed later — the audio stays in
                  the file, nothing plays it.
                </p>
              </div>
            )}

            {tool === 'text' && (
              <div className="space-y-3">
                {overlays.length === 0 && (
                  <p className="text-sm text-white/50">Put a line over the video.</p>
                )}
                {overlays.map((overlay, position) => (
                  <div
                    key={position}
                    data-editor-overlay
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        value={overlay.text}
                        maxLength={MAX_TEXT_OVERLAY_LENGTH}
                        aria-label={`Text ${position + 1}`}
                        data-editor-text-input
                        placeholder="Say something"
                        onChange={(event) => patchOverlay(position, { text: event.target.value })}
                        className="min-h-[48px] w-full text-base"
                      />
                      <button
                        type="button"
                        onClick={() => removeOverlay(position)}
                        aria-label={`Remove text ${position + 1}`}
                        data-editor-text-remove
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/60 transition active:scale-95"
                      >
                        <TrashIcon width={17} height={17} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(['top', 'middle', 'bottom'] as const).map((spot) => (
                        <button
                          key={spot}
                          type="button"
                          onClick={() => patchOverlay(position, { at: spot })}
                          aria-pressed={overlay.at === spot}
                          data-editor-text-at={spot}
                          className={`chip capitalize ${overlay.at === spot ? 'chip-active' : ''}`}
                        >
                          {spot}
                        </button>
                      ))}
                      <span className="w-2" />
                      {(['m', 'l'] as const).map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => patchOverlay(position, { size })}
                          aria-pressed={overlay.size === size}
                          className={`chip ${overlay.size === size ? 'chip-active' : ''}`}
                        >
                          {size === 'm' ? 'Small' : 'Big'}
                        </button>
                      ))}
                      <span className="w-2" />
                      {(['light', 'dark', 'fay'] as const).map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => patchOverlay(position, { tone })}
                          aria-pressed={overlay.tone === tone}
                          aria-label={`${tone} background`}
                          className={`h-8 w-8 rounded-full border-2 transition ${
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
                    className="btn-ghost min-h-[48px] w-full py-3 text-sm"
                  >
                    <PlusIcon width={16} height={16} /> Add text
                  </button>
                )}
              </div>
            )}

            {tool === 'cover' && (
              // The same picker the posting screen uses. One scrubber, one custom
              // image path, one set of rules — reached from two places.
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
            )}

            {/* Filming another clip belongs with the camera, so this is a way back
              to it rather than a second recorder. */}
            {onAddClip && (
              <button
                type="button"
                onClick={onAddClip}
                data-editor-add-clip
                className="btn-quiet mt-3 min-h-[44px] w-full py-2.5 text-xs"
              >
                <PlusIcon width={14} height={14} /> Film another clip
              </button>
            )}
          </div>

          {/* ------------------------------------------------- the clip strip */}
          {/* The project's shape, each clip as wide as what it keeps. Tapping one
            selects it for trimming and jumps the preview to its first frame, so
            "which clip am I editing" is never a guess. One clip needs no strip —
            there is nothing to choose between. */}
          {many && (
            <div className="mb-2 flex items-stretch gap-1" data-editor-strip>
              {segments.map((segment, position) => (
                <button
                  key={segment.clip.id}
                  type="button"
                  onClick={() => pick(position)}
                  aria-pressed={position === index}
                  aria-label={`Clip ${position + 1} of ${clips.length}`}
                  data-editor-clip={position}
                  style={{ flexBasis: `${widths[position] * 100}%` }}
                  className={`relative min-h-[44px] shrink grow-0 overflow-hidden rounded-xl border-2 transition ${
                    position === index
                      ? 'border-fay bg-fay/20'
                      : 'border-white/15 bg-white/[0.06] active:bg-white/[0.12]'
                  }`}
                >
                  <span className="absolute inset-x-0 top-1 text-[10px] font-bold text-white/80">
                    {position + 1}
                  </span>
                  <span className="absolute inset-x-0 bottom-1 text-[9px] tabular-nums text-white/55">
                    {formatSeconds(segment.length)}
                  </span>
                  {/* How far the playhead is through THIS clip. */}
                  {at >= segment.startsAt && at < segment.endsAt && (
                    <span
                      className="absolute bottom-0 left-0 top-0 w-[2px] bg-white"
                      style={{
                        left: `${
                          segment.length > 0 ? ((at - segment.startsAt) / segment.length) * 100 : 0
                        }%`,
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* --------------------------------------------------- the scrubber */}
          {/* Across the WHOLE project, in project time, so dragging it walks the
            finished video rather than one clip's file. */}
          <div className="flex items-center gap-2">
            {/* An explicit control as well as the tap region: a button that is
              always in the same place and always reachable, whatever the panel
              above it is doing. */}
            <button
              type="button"
              onClick={() => player.current?.toggle()}
              aria-label={playing ? 'Pause' : 'Play'}
              data-editor-playpause
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition active:scale-95"
            >
              {playing ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
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
              className="h-11 flex-1 accent-fay"
            />
            <span className="w-9 shrink-0 text-[11px] tabular-nums text-white/60">
              {formatSeconds(total)}
            </span>
          </div>

          {/* ------------------------------------------------------- the tools */}
          <div className="flex items-stretch gap-1">
            {TOOLS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => onTool(key)}
                aria-pressed={tool === key}
                data-editor-tool={key}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition ${
                  tool === key
                    ? 'bg-white/[0.14] text-white'
                    : 'text-white/60 active:bg-white/[0.06]'
                }`}
              >
                <Icon width={19} height={19} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
