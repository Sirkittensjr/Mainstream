'use client';

import { useEffect, useRef, useState } from 'react';
import { CropIcon, PauseIcon, PlayIcon, RotateIcon, TrimIcon, VolumeIcon } from '@/components/Icons';
import { type Clip, type Crop, type Rotation, clipDuration, normaliseClip } from '@/lib/video/clips';
import { formatPreciseSeconds } from '@/lib/video/limits';

type Tool = 'trim' | 'crop' | 'rotate' | 'volume';

const TOOLS: { key: Tool; label: string; Icon: typeof TrimIcon }[] = [
  { key: 'trim', label: 'Trim', Icon: TrimIcon },
  { key: 'crop', label: 'Crop', Icon: CropIcon },
  { key: 'rotate', label: 'Rotate', Icon: RotateIcon },
  { key: 'volume', label: 'Volume', Icon: VolumeIcon },
];

/** The crops on offer. Freehand dragging on a phone is fiddly; these are not. */
const CROPS: { label: string; hint: string; ratio: number | null }[] = [
  { label: 'Original', hint: 'As filmed', ratio: null },
  { label: 'Square', hint: '1:1', ratio: 1 },
  { label: 'Portrait', hint: '4:5', ratio: 4 / 5 },
  { label: 'Tall', hint: '9:16', ratio: 9 / 16 },
  { label: 'Wide', hint: '16:9', ratio: 16 / 9 },
];

/** The centred crop rectangle that gives this aspect ratio, in frame fractions. */
export function cropForRatio(clip: Clip, ratio: number | null): Crop {
  if (ratio === null) return { x: 0, y: 0, width: 1, height: 1 };
  const sourceRatio = clip.sourceWidth / clip.sourceHeight;
  if (sourceRatio > ratio) {
    const width = ratio / sourceRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = sourceRatio / ratio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function ClipEditor({
  clip,
  onChange,
  onDone,
}: {
  clip: Clip;
  onChange: (patch: Partial<Clip>) => void;
  onDone: () => void;
}) {
  const [tool, setTool] = useState<Tool>('trim');
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(clip.trimStart);

  // Playback stays inside the trim, so what is previewed is what will be posted.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const onTime = () => {
      setAt(element.currentTime);
      if (element.currentTime >= clip.trimEnd - 0.03) {
        element.pause();
        element.currentTime = clip.trimStart;
        setPlaying(false);
      }
    };
    element.addEventListener('timeupdate', onTime);
    return () => element.removeEventListener('timeupdate', onTime);
  }, [clip.trimStart, clip.trimEnd]);

  function seek(time: number) {
    const element = video.current;
    if (!element) return;
    element.currentTime = Math.min(Math.max(time, clip.trimStart), clip.trimEnd);
    setAt(element.currentTime);
  }

  const upright = clip.rotation % 180 === 0;
  const visibleRatio =
    (clip.sourceWidth * clip.crop.width) / (clip.sourceHeight * clip.crop.height);

  return (
    <div className="space-y-4">
      {/* Preview ------------------------------------------------------- */}
      <div
        className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: upright ? `${visibleRatio}` : `${1 / visibleRatio}`, maxHeight: '46vh' }}
      >
        <div className="relative h-full w-full overflow-hidden">
          <video
            ref={video}
            src={clip.src}
            playsInline
            preload="metadata"
            muted={clip.volume === 0}
            className="absolute left-1/2 top-1/2 max-w-none"
            style={{
              // The crop is applied by scaling the frame up and sliding the
              // chosen rectangle under the window, so what is on screen here is
              // exactly what the render pass will draw.
              width: `${100 / clip.crop.width}%`,
              height: `${100 / clip.crop.height}%`,
              transform: `translate(-50%, -50%) rotate(${clip.rotation}deg) translate(${
                (0.5 - (clip.crop.x + clip.crop.width / 2)) * 100
              }%, ${(0.5 - (clip.crop.y + clip.crop.height / 2)) * 100}%)`,
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            const element = video.current;
            if (!element) return;
            if (playing) {
              element.pause();
            } else {
              if (element.currentTime < clip.trimStart || element.currentTime >= clip.trimEnd - 0.05) {
                element.currentTime = clip.trimStart;
              }
              void element.play();
            }
          }}
          className="absolute bottom-3 left-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
        </button>
        <span className="absolute bottom-4 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold tabular-nums text-white/90 backdrop-blur">
          {formatPreciseSeconds(Math.max(0, at - clip.trimStart))} / {formatPreciseSeconds(clipDuration(clip))}
        </span>
      </div>

      {/* Tools --------------------------------------------------------- */}
      <div className="grid grid-cols-4 gap-2">
        {TOOLS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTool(key)}
            aria-pressed={tool === key}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-xs font-semibold transition ${
              tool === key
                ? 'border-fay/60 bg-fay/15 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
            }`}
          >
            <Icon width={20} height={20} />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        {tool === 'trim' && (
          <TrimTool clip={clip} at={at} onChange={onChange} onSeek={seek} />
        )}

        {tool === 'crop' && (
          <div>
            <p className="label">Crop</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CROPS.map((option) => {
                const target = cropForRatio(clip, option.ratio);
                const active = Math.abs(target.width - clip.crop.width) < 0.005
                  && Math.abs(target.height - clip.crop.height) < 0.005;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => onChange({ crop: target })}
                    aria-pressed={active}
                    className={`min-h-[44px] rounded-full border px-4 py-2 text-sm transition ${
                      active
                        ? 'border-fay/60 bg-fay/15 text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08]'
                    }`}
                  >
                    {option.label} <span className="text-white/35">{option.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-white/35">
              The crop is taken from the middle of the frame. Nothing outside it is posted.
            </p>
          </div>
        )}

        {tool === 'rotate' && (
          <div>
            <p className="label">Rotate</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {([0, 90, 180, 270] as Rotation[]).map((angle) => (
                <button
                  key={angle}
                  type="button"
                  onClick={() => onChange({ rotation: angle })}
                  aria-pressed={clip.rotation === angle}
                  className={`min-h-[44px] rounded-full border px-5 py-2 text-sm transition ${
                    clip.rotation === angle
                      ? 'border-fay/60 bg-fay/15 text-white'
                      : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08]'
                  }`}
                >
                  {angle}°
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange({ rotation: ((clip.rotation + 90) % 360) as Rotation })}
                className="btn-ghost min-h-[44px] px-5 py-2 text-sm"
              >
                <RotateIcon width={16} height={16} /> Turn
              </button>
            </div>
          </div>
        )}

        {tool === 'volume' && (
          <div>
            <div className="flex items-center justify-between">
              <p className="label">Volume</p>
              <span className="text-sm tabular-nums text-white/60">
                {Math.round(clip.volume * 100)}%
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onChange({ volume: clip.volume === 0 ? 1 : 0 })}
                aria-label={clip.volume === 0 ? 'Unmute this clip' : 'Mute this clip'}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <VolumeIcon muted={clip.volume === 0} width={20} height={20} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={clip.volume}
                aria-label="Clip volume"
                onChange={(event) => onChange({ volume: Number(event.target.value) })}
                className="h-11 w-full accent-fay"
              />
            </div>
            <p className="mt-2 text-xs text-white/35">
              {clip.volume === 0
                ? 'This clip will be silent in the finished video.'
                : 'Applied when the video is put together.'}
            </p>
          </div>
        )}
      </div>

      <button type="button" onClick={onDone} className="btn-primary w-full py-3.5">
        Done
      </button>
    </div>
  );
}

/**
 * Trimming, as two handles on the clip's own length.
 *
 * Range inputs rather than a dragged timeline: they are the control every
 * touch keyboard and screen reader already understands, they cannot be
 * fat-fingered into a zero-length clip, and they work the same with a mouse.
 */
function TrimTool({
  clip,
  at,
  onChange,
  onSeek,
}: {
  clip: Clip;
  at: number;
  onChange: (patch: Partial<Clip>) => void;
  onSeek: (time: number) => void;
}) {
  const played = clipDuration(clip) > 0 ? (at - clip.trimStart) / clipDuration(clip) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="label">Trim</p>
        <span className="text-sm tabular-nums text-white/60">
          {formatPreciseSeconds(clipDuration(clip))} of {formatPreciseSeconds(clip.sourceDuration)}
        </span>
      </div>

      <div className="relative mt-4 h-2 rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 rounded-full bg-fay/40"
          style={{
            left: `${(clip.trimStart / clip.sourceDuration) * 100}%`,
            right: `${100 - (clip.trimEnd / clip.sourceDuration) * 100}%`,
          }}
        />
        <div
          className="absolute -top-1 h-4 w-0.5 rounded bg-white"
          style={{
            left: `${Math.min(100, Math.max(0, ((clip.trimStart + played * clipDuration(clip)) / clip.sourceDuration) * 100))}%`,
          }}
        />
      </div>

      <label className="mt-4 block text-xs text-white/45" htmlFor={`start-${clip.id}`}>
        Start · {formatPreciseSeconds(clip.trimStart)}
      </label>
      <input
        id={`start-${clip.id}`}
        type="range"
        min={0}
        max={clip.sourceDuration}
        step={0.1}
        value={clip.trimStart}
        onChange={(event) => {
          const next = normaliseClip({ ...clip, trimStart: Number(event.target.value) });
          onChange({ trimStart: next.trimStart, trimEnd: next.trimEnd });
          onSeek(next.trimStart);
        }}
        className="h-11 w-full accent-fay"
      />

      <label className="mt-2 block text-xs text-white/45" htmlFor={`end-${clip.id}`}>
        End · {formatPreciseSeconds(clip.trimEnd)}
      </label>
      <input
        id={`end-${clip.id}`}
        type="range"
        min={0}
        max={clip.sourceDuration}
        step={0.1}
        value={clip.trimEnd}
        onChange={(event) => {
          const next = normaliseClip({ ...clip, trimEnd: Number(event.target.value) });
          onChange({ trimStart: next.trimStart, trimEnd: next.trimEnd });
          onSeek(Math.max(clip.trimStart, next.trimEnd - 0.5));
        }}
        className="h-11 w-full accent-fay"
      />
    </div>
  );
}
