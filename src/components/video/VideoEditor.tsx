'use client';

import { useEffect, useRef, useState } from 'react';
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
import { CoverPicker } from './CoverPicker';
import { VideoText } from './VideoText';
import { clipDuration, type Clip } from '@/lib/video/clips';
import { formatPreciseSeconds, formatSeconds } from '@/lib/video/limits';
import { MAX_TEXT_OVERLAYS, MAX_TEXT_OVERLAY_LENGTH, type TextOverlay } from '@/lib/types';

/**
 * The editing stage: one screen, one job.
 *
 * Between the camera and the posting screen, because the three are different
 * decisions and a single screen that asks for all of them at once is the thing
 * that made this feel like a form. Nothing about captions, categories, tags or
 * content warnings is here — those belong to posting, and this is editing.
 *
 * What it edits, and what each one costs:
 *
 *   Trim   — two numbers on the clip, applied by the render pass at the end.
 *            The pass is real time, which is why the panel says so; trimming
 *            makes the video SHORTER, so the cost is bounded by what is kept.
 *   Sound  — a playback property on the finished post. Silencing an audio track
 *            for real means re-encoding, and a two-minute video would cost two
 *            minutes to mute; "the viewer hears nothing" is what turning the
 *            sound off means anyway.
 *   Text   — also a playback property, drawn over the video by the player. Same
 *            reason: burning words into the frames would make every video that
 *            has any pay for a re-encode it does not otherwise need.
 *   Cover  — the existing picker, unchanged and shared with the posting screen.
 *
 * It owns nothing. Every change goes up to the composer that holds the clips and
 * will do the uploading, so backing out of here costs nothing and nothing has
 * left the device yet.
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
  clip,
  clipCount,
  src,
  muted,
  overlays,
  cover,
  tool,
  onTool,
  onTrim,
  onMuted,
  onOverlays,
  onAddClip,
  onRetake,
  onNext,
}: {
  /** The clip being edited. One clip is the case this is shaped around. */
  clip: Clip;
  /** How many there are in total, so a multi-clip video can say so. */
  clipCount: number;
  /** What to play. The single clip, or the combined preview once there is one. */
  src: string;
  muted: boolean;
  overlays: TextOverlay[];
  cover: EditorCover;
  /** Which tool is open. Controlled, so arriving here to pick a cover can say so. */
  tool: Tool;
  onTool: (tool: Tool) => void;
  onTrim: (patch: { trimStart: number; trimEnd: number }) => void;
  onMuted: (muted: boolean) => void;
  onOverlays: (overlays: TextOverlay[]) => void;
  /** Filming another clip, where the budget allows it. */
  onAddClip?: () => void;
  /** Back to the camera, dropping the take being edited. */
  onRetake: () => void;
  onNext: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(clip.trimStart);

  const kept = clipDuration(clip);
  const single = clipCount === 1;

  // Playback stays inside the trim, so what is being watched is what will be
  // posted. Without this, trimming is a promise rather than a preview.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const onTime = () => {
      setAt(element.currentTime);
      if (single && element.currentTime >= clip.trimEnd - 0.03) {
        element.pause();
        element.currentTime = clip.trimStart;
        setPlaying(false);
      }
    };
    element.addEventListener('timeupdate', onTime);
    return () => element.removeEventListener('timeupdate', onTime);
  }, [clip.trimStart, clip.trimEnd, single]);

  function seek(seconds: number) {
    const element = video.current;
    if (!element) return;
    const bounded = single
      ? Math.min(Math.max(seconds, clip.trimStart), clip.trimEnd)
      : Math.max(0, seconds);
    element.currentTime = bounded;
    setAt(bounded);
  }

  function toggle() {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      if (single && (element.currentTime < clip.trimStart || element.currentTime >= clip.trimEnd)) {
        element.currentTime = clip.trimStart;
      }
      void element.play().catch(() => undefined);
    } else {
      element.pause();
    }
  }

  /* -------------------------------------------------------------- the text */

  function addOverlay() {
    if (overlays.length >= MAX_TEXT_OVERLAYS) return;
    onOverlays([...overlays, { text: '', at: 'bottom', size: 'l', tone: 'light' }]);
  }

  function patchOverlay(index: number, patch: Partial<TextOverlay>) {
    onOverlays(overlays.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function removeOverlay(index: number) {
    onOverlays(overlays.filter((_, i) => i !== index));
  }

  /** Only the ones with words in them get previewed or posted. */
  const written = overlays.filter((entry) => entry.text.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* ------------------------------------------------------------- top */}
      <div className="safe-top safe-x flex shrink-0 items-center justify-between px-4 pb-2 pt-1">
        {/* "Retake", not "Back": going back past a take means filming it again,
            and this drops it. Keeping it and filming another is the button at the
            bottom of the panel, which is a different intention. */}
        <button
          type="button"
          onClick={onRetake}
          data-editor-retake
          className="flex h-11 items-center justify-center rounded-full bg-white/10 px-4 text-[14px] font-semibold text-white transition active:scale-95"
        >
          Retake
        </button>
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Edit
          </p>
          <p className="text-[13px] font-semibold tabular-nums text-white/70">
            {formatSeconds(kept)}
            {!single && ` · ${clipCount} clips`}
          </p>
        </div>
        <button
          type="button"
          onClick={onNext}
          data-editor-next
          className="btn-primary h-11 px-5 py-0 text-[14px]"
        >
          Next
        </button>
      </div>

      {/* ----------------------------------------------------------- video */}
      {/* The video keeps the room. It is the thing being edited, so it is what
          the screen is mostly made of, and every panel below is sized to leave
          it alone rather than the other way round. */}
      {/* `min-h` is the important half of this. `flex-1` alone gives the video
          whatever the panels leave, and the trim panel's two sliders left it a
          third of the screen — on the one screen where the video is the point.
          With a floor, a tall panel scrolls instead of shrinking the video. */}
      <div className="relative min-h-[40vh] flex-1 overflow-hidden">
        <video
          ref={video}
          key="editor-preview"
          src={src}
          playsInline
          muted={muted}
          preload="metadata"
          data-editor-preview
          onLoadedMetadata={() => seek(clip.trimStart)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {/* The text as it will really look, over the real video. An overlay
            previewed anywhere but here is a guess. */}
        <VideoText media={{ text: written }} />
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
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
      </div>

      {/* -------------------------------------------------------- timeline */}
      <div className="safe-x shrink-0 px-4 pt-3">
        <div className="flex items-center gap-3">
          <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-white/55">
            {formatSeconds(at)}
          </span>
          <input
            type="range"
            min={single ? clip.trimStart : 0}
            max={single ? Math.max(clip.trimStart + 0.1, clip.trimEnd) : Math.max(0.1, kept)}
            step={0.05}
            value={Math.min(Math.max(at, single ? clip.trimStart : 0), single ? clip.trimEnd : kept)}
            aria-label="Position in the video"
            data-editor-timeline
            onChange={(event) => seek(Number(event.target.value))}
            className="h-11 flex-1 accent-fay"
          />
          <span className="w-11 shrink-0 text-[11px] tabular-nums text-white/55">
            {formatSeconds(single ? clip.trimEnd : kept)}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------------ tools */}
      <div className="safe-x shrink-0 px-2 pt-1">
        <div className="flex items-stretch gap-1">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTool(key)}
              aria-pressed={tool === key}
              data-editor-tool={key}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition ${
                tool === key ? 'bg-white/[0.12] text-white' : 'text-white/50 active:bg-white/[0.06]'
              }`}
            >
              <Icon width={19} height={19} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------- the panel */}
      {/* One tool's controls at a time. All four on screen at once is how an
          editor becomes a control panel. */}
      <div className="safe-bottom safe-x max-h-[33vh] shrink-0 overflow-y-auto px-4 pb-2 pt-3">
        {tool === 'trim' && (
          <div data-editor-panel="trim">
            {single ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white/80">
                    Keeping {formatPreciseSeconds(kept)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onTrim({ trimStart: 0, trimEnd: clip.sourceDuration })}
                    disabled={clip.trimStart === 0 && clip.trimEnd === clip.sourceDuration}
                    className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-30"
                  >
                    Reset
                  </button>
                </div>
                <label className="mt-3 block text-xs text-white/45" htmlFor="editor-trim-start">
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
                    const next = Math.min(Number(event.target.value), clip.trimEnd - 0.3);
                    onTrim({ trimStart: Math.max(0, next), trimEnd: clip.trimEnd });
                    seek(Math.max(0, next));
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
                    const next = Math.max(Number(event.target.value), clip.trimStart + 0.3);
                    onTrim({
                      trimStart: clip.trimStart,
                      trimEnd: Math.min(clip.sourceDuration, next),
                    });
                    seek(Math.min(clip.sourceDuration, next) - 0.1);
                  }}
                  className="h-11 w-full accent-fay"
                />
                <p className="mt-2 text-[11px] text-white/35">
                  Put together when you post — about as long as what you keep.
                </p>
              </>
            ) : (
              <p className="py-3 text-sm text-white/50">
                This video is {clipCount} clips. They are joined when you post. Trimming a
                single clip is on the desktop editor.
              </p>
            )}
          </div>
        )}

        {tool === 'sound' && (
          <div data-editor-panel="sound" className="space-y-3">
            <div className="flex gap-2">
              {[
                { on: true, label: 'Sound on', hint: 'As recorded' },
                { on: false, label: 'Sound off', hint: 'Viewers watch it silent' },
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
          <div data-editor-panel="text" className="space-y-3">
            {overlays.length === 0 && (
              <p className="text-sm text-white/50">Put a line over the video.</p>
            )}
            {overlays.map((overlay, index) => (
              <div
                key={index}
                data-editor-overlay
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-start gap-2">
                  <input
                    value={overlay.text}
                    maxLength={MAX_TEXT_OVERLAY_LENGTH}
                    aria-label={`Text ${index + 1}`}
                    data-editor-text-input
                    placeholder="Say something"
                    onChange={(event) => patchOverlay(index, { text: event.target.value })}
                    className="min-h-[48px] w-full text-base"
                  />
                  <button
                    type="button"
                    onClick={() => removeOverlay(index)}
                    aria-label={`Remove text ${index + 1}`}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-white/60 transition active:scale-95"
                  >
                    <TrashIcon width={17} height={17} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(['top', 'middle', 'bottom'] as const).map((position) => (
                    <button
                      key={position}
                      type="button"
                      onClick={() => patchOverlay(index, { at: position })}
                      aria-pressed={overlay.at === position}
                      data-editor-text-at={position}
                      className={`chip capitalize ${overlay.at === position ? 'chip-active' : ''}`}
                    >
                      {position}
                    </button>
                  ))}
                  <span className="w-2" />
                  {(['m', 'l'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => patchOverlay(index, { size })}
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
                      onClick={() => patchOverlay(index, { tone })}
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
          <div data-editor-panel="cover">
            {/* The same picker the posting screen uses. One scrubber, one custom
                image path, one set of rules — reached from two places. */}
            <CoverPicker
              preview={cover.preview}
              custom={cover.custom}
              isCustom={cover.isCustom}
              at={cover.at}
              max={kept}
              error={cover.error}
              onAt={cover.onAt}
              onFile={cover.onFile}
              onClear={cover.onClear}
            />
          </div>
        )}

        {/* Filming another clip belongs with the camera, so this is a way back to
            it rather than a second recorder. */}
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
    </div>
  );
}
