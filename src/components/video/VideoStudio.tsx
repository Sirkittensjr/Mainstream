'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createVideoPostAction } from '@/app/actions';
import {
  ChevronIcon,
  CloseIcon,
  PlusIcon,
  RecordIcon,
  TrashIcon,
  VideoIcon,
  VolumeIcon,
} from '@/components/Icons';
import { CATEGORIES, type Category, type Media } from '@/lib/types';
import {
  FULL_FRAME,
  type Clip,
  canAdd,
  clipDuration,
  moveClip,
  needsRender,
  normaliseClip,
  outputSize,
  remainingSeconds,
  totalDuration,
  updateClip,
} from '@/lib/video/clips';
import { grabFrame, probeLocalVideo } from '@/lib/video/capture';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_ACCEPT,
  formatMegabytes,
  formatPreciseSeconds,
  formatSeconds,
} from '@/lib/video/limits';
import { canRender, renderClips } from '@/lib/video/render';
import { UploadError, contentTypeFor, uploadMedia } from '@/lib/video/upload-client';
import { ClipEditor } from './ClipEditor';
import { VideoRecorder } from './VideoRecorder';

/**
 * Create → record or upload → edit → preview → caption → post.
 *
 * The clips only ever exist in this browser tab until the last step: editing
 * is a set of numbers on each clip, and one render pass at the end turns them
 * into the single video that gets uploaded. Nothing is sent while somebody is
 * still deciding, and what they preview is what they post.
 */

type Stage = 'clips' | 'editing' | 'posting';

let counter = 0;
const nextId = () => `clip-${(counter += 1)}-${Date.now().toString(36)}`;

interface Finished {
  media: Media;
  previewUrl: string;
}

export function VideoStudio() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const [clips, setClips] = useState<Clip[]>([]);
  const [stage, setStage] = useState<Stage>('clips');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; ratio: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [finished, setFinished] = useState<Finished | null>(null);
  const [thumbnailAt, setThumbnailAt] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState<Category>('Life');
  const [tags, setTags] = useState('');
  const [posting, setPosting] = useState(false);

  const cancelled = useRef<AbortController | null>(null);

  const trackUrl = useCallback((url: string) => {
    objectUrls.current.push(url);
    return url;
  }, []);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const total = totalDuration(clips);
  const left = remainingSeconds(clips);
  const editing = clips.find((clip) => clip.id === editingId) ?? null;

  /** Turns a file or a recording into a clip, once we know how long it is. */
  const addSource = useCallback(
    async (source: Blob, label: string, file?: File) => {
      const url = trackUrl(URL.createObjectURL(source));
      let facts;
      try {
        facts = await probeLocalVideo(url);
      } catch {
        setError(`${label} could not be opened. It may not be a video this browser can play.`);
        return;
      }

      let added = false;
      setClips((current) => {
        const room = canAdd(current, facts.duration);
        if (!room.ok) {
          setError(room.error);
          return current;
        }
        added = true;
        return [
          ...current,
          normaliseClip({
            id: nextId(),
            src: url,
            label,
            sourceDuration: facts.duration,
            sourceWidth: facts.width,
            sourceHeight: facts.height,
            trimStart: 0,
            trimEnd: facts.duration,
            crop: FULL_FRAME,
            rotation: 0,
            volume: 1,
            file,
          }),
        ];
      });
      if (added) {
        setError(null);
        // A new clip invalidates whatever was rendered from the old list.
        setFinished(null);
      }
    },
    [trackUrl],
  );

  async function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy('Reading your video…');
    try {
      for (const file of Array.from(list)) {
        if (file.size > MAX_VIDEO_BYTES) {
          setError(
            `${file.name} is ${formatMegabytes(file.size)}. Videos can be up to ${formatMegabytes(MAX_VIDEO_BYTES)}.`,
          );
          continue;
        }
        if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
          setError(`${file.name} is not a video FayTarra can read. Try an MP4, MOV or WEBM.`);
          continue;
        }
        await addSource(file, file.name, file);
      }
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  /* ----------------------------------------------- putting the video together */

  async function buildVideo(): Promise<Finished | null> {
    if (clips.length === 0) return null;
    setError(null);
    const controller = new AbortController();
    cancelled.current = controller;

    try {
      let blob: Blob;
      let contentType: string;
      let size = outputSize(clips);

      if (!needsRender(clips)) {
        // One clip, untouched: it is already the video. Re-encoding it would
        // cost minutes and some quality to end up where we started.
        const [only] = clips;
        blob = only.file as File;
        contentType = contentTypeFor(only.file as File);
        size = { width: only.sourceWidth, height: only.sourceHeight };
      } else {
        if (!canRender()) {
          setError(
            'This browser cannot combine video clips. Post a single clip without edits, or try another browser.',
          );
          return null;
        }
        setProgress({ label: 'Putting your video together…', ratio: 0 });
        const rendered = await renderClips(clips, {
          signal: controller.signal,
          onProgress: ({ seconds, total: length, clip, clips: count }) =>
            setProgress({
              label: `Putting your video together — clip ${clip} of ${count}`,
              ratio: length > 0 ? seconds / length : 0,
            }),
        });
        blob = rendered.blob;
        contentType = rendered.mimeType.split(';')[0];
        size = { width: rendered.width, height: rendered.height };
      }

      setProgress({ label: 'Uploading…', ratio: 0 });
      const media = await uploadMedia(blob, contentType, {
        signal: controller.signal,
        onProgress: ({ ratio, phase }) =>
          setProgress({
            label: phase === 'checking' ? 'Checking your video…' : 'Uploading…',
            ratio,
          }),
      });

      const previewUrl = trackUrl(URL.createObjectURL(blob));
      const result: Finished = {
        media: {
          ...media,
          width: media.width ?? size.width,
          height: media.height ?? size.height,
          duration: media.duration ?? total,
        },
        previewUrl,
      };
      setFinished(result);
      setThumbnailAt(0);
      return result;
    } catch (failure) {
      if ((failure as DOMException)?.name === 'AbortError') return null;
      setError(
        failure instanceof UploadError || failure instanceof Error
          ? failure.message
          : 'Something went wrong putting your video together.',
      );
      return null;
    } finally {
      setProgress(null);
      cancelled.current = null;
    }
  }

  async function goToPosting() {
    const built = finished ?? (await buildVideo());
    if (built) setStage('posting');
  }

  /* --------------------------------------------------------------- thumbnail */

  useEffect(() => {
    if (!finished) return;
    let cancelledHere = false;
    void (async () => {
      try {
        const frame = await grabFrame(finished.previewUrl, thumbnailAt);
        if (cancelledHere) return;
        setThumbnail((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return trackUrl(URL.createObjectURL(frame));
        });
      } catch {
        // A thumbnail is a nicety. The post still works without one.
      }
    })();
    return () => {
      cancelledHere = true;
    };
  }, [finished, thumbnailAt, trackUrl]);

  async function post() {
    if (!finished) return;
    setPosting(true);
    setError(null);
    try {
      let poster: string | undefined;
      if (thumbnail) {
        try {
          const frame = await grabFrame(finished.previewUrl, thumbnailAt, { maxEdge: 720 });
          const uploaded = await uploadMedia(frame, 'image/jpeg');
          poster = uploaded.url;
        } catch {
          // A failed thumbnail must not cost somebody their post.
        }
      }

      const result = await createVideoPostAction({
        media: { ...finished.media, ...(poster ? { poster } : {}) },
        caption,
        category,
        tags,
      });
      if (result?.error) {
        setError(result.error);
        setPosting(false);
        return;
      }
      if (result?.postId) router.push(`/post/${result.postId}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The post did not go through.');
      setPosting(false);
    }
  }

  /* ------------------------------------------------------------------- views */

  if (recording) {
    return (
      <VideoRecorder
        remainingSeconds={left}
        onClose={() => setRecording(false)}
        onRecorded={({ blob, seconds }) => {
          void addSource(blob, `Recording ${clips.length + 1}`);
          if (seconds >= left - 0.5) setRecording(false);
        }}
      />
    );
  }

  if (stage === 'editing' && editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setStage('clips');
              setEditingId(null);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"
            aria-label="Back to the clips"
          >
            <ChevronIcon direction="left" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold">{editing.label}</p>
            <p className="text-xs text-white/40">
              {formatPreciseSeconds(clipDuration(editing))} in this clip
            </p>
          </div>
        </div>
        <ClipEditor
          clip={editing}
          onChange={(patch) => {
            setClips((current) => updateClip(current, editing.id, patch));
            setFinished(null);
          }}
          onDone={() => {
            setStage('clips');
            setEditingId(null);
          }}
        />
      </div>
    );
  }

  if (stage === 'posting' && finished) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStage('clips')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"
            aria-label="Back to the editor"
          >
            <ChevronIcon direction="left" />
          </button>
          <p className="font-display text-lg font-bold">Ready to post</p>
        </div>

        <video
          src={finished.previewUrl}
          poster={thumbnail ?? undefined}
          controls
          playsInline
          className="mx-auto max-h-[48vh] w-full rounded-2xl bg-black object-contain"
        />

        <div>
          <label className="label" htmlFor="thumbnail">
            Thumbnail
          </label>
          <p className="mt-1 text-xs text-white/40">
            Scrub to the frame you want people to see before they press play.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnail}
                alt="The frame chosen for this post"
                className="h-16 w-16 shrink-0 rounded-xl bg-black object-contain"
              />
            )}
            <input
              id="thumbnail"
              type="range"
              min={0}
              max={Math.max(0.1, (finished.media.duration ?? total) - 0.1)}
              step={0.1}
              value={thumbnailAt}
              onChange={(event) => setThumbnailAt(Number(event.target.value))}
              className="h-11 w-full accent-fay"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="video-caption">
            Caption
          </label>
          <textarea
            id="video-caption"
            rows={3}
            maxLength={1200}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Say something about it. @mention anyone you want to bring in."
            className="mt-2 w-full text-base"
          />
        </div>

        <div>
          <label className="label" htmlFor="video-category">
            Category
          </label>
          <select
            id="video-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
            className="mt-2 w-full"
          >
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="video-tags">
            Tags (optional)
          </label>
          <input
            id="video-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="firstvideo, studio, behindthescenes"
            className="mt-2 w-full"
          />
        </div>

        {error && (
          <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
            {error}
          </p>
        )}

        <button type="button" onClick={post} disabled={posting} className="btn-primary w-full py-4">
          {posting ? 'Posting…' : 'Post video'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* The strip ------------------------------------------------------ */}
      {clips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
          <VideoIcon width={30} height={30} className="mx-auto text-white/35" />
          <p className="mt-3 font-display text-lg font-bold">Start your video</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-white/45">
            Record it here or add one you already have. You can put several clips together, up to{' '}
            {MAX_VIDEO_SECONDS / 60} minutes in total.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {clips.map((clip, index) => (
            <li
              key={clip.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold tabular-nums">
                {index + 1}
              </span>
              <video
                src={clip.src}
                muted
                playsInline
                preload="metadata"
                className="h-14 w-14 shrink-0 rounded-xl bg-black object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{clip.label}</p>
                <p className="flex items-center gap-2 text-xs text-white/40">
                  <span className="tabular-nums">{formatPreciseSeconds(clipDuration(clip))}</span>
                  {clip.volume === 0 && <VolumeIcon muted width={13} height={13} />}
                  {clip.rotation !== 0 && <span>{clip.rotation}°</span>}
                  {clip.crop.width < 0.999 && <span>cropped</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${clip.label} earlier`}
                  disabled={index === 0}
                  onClick={() => {
                    setClips((current) => moveClip(current, index, index - 1));
                    setFinished(null);
                  }}
                  className="flex h-10 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
                >
                  <ChevronIcon direction="left" width={17} height={17} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${clip.label} later`}
                  disabled={index === clips.length - 1}
                  onClick={() => {
                    setClips((current) => moveClip(current, index, index + 1));
                    setFinished(null);
                  }}
                  className="flex h-10 w-8 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
                >
                  <ChevronIcon width={17} height={17} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(clip.id);
                    setStage('editing');
                  }}
                  className="min-h-[40px] rounded-lg px-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${clip.label}`}
                  onClick={() => {
                    setClips((current) => current.filter((entry) => entry.id !== clip.id));
                    setFinished(null);
                    setError(null);
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-white/50 transition hover:bg-fay/15 hover:text-fay"
                >
                  <TrashIcon width={17} height={17} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Length --------------------------------------------------------- */}
      {clips.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-white/45">
              {clips.length} clip{clips.length === 1 ? '' : 's'} · {formatSeconds(total)}
            </span>
            <span className={left < 10 ? 'text-fay' : 'text-white/35'}>
              {formatSeconds(left)} left of {MAX_VIDEO_SECONDS / 60} minutes
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-fay transition-[width]"
              style={{ width: `${Math.min(100, (total / MAX_VIDEO_SECONDS) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Add ------------------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={Boolean(busy) || left < 0.5}
          className="btn-ghost min-h-[56px] py-4 disabled:opacity-40"
        >
          <PlusIcon width={18} height={18} /> Add video
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRecording(true);
          }}
          disabled={left < 0.5}
          className="btn-ghost min-h-[56px] py-4 disabled:opacity-40"
        >
          <RecordIcon width={18} height={18} /> Record video
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => void pickFiles(event.target.files)}
      />

      {busy && <p className="text-sm text-white/45">{busy}</p>}

      {error && (
        <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
          {error}
        </p>
      )}

      {progress && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between text-sm">
            <span>{progress.label}</span>
            <span className="tabular-nums text-white/50">{Math.round(progress.ratio * 100)}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-fay transition-[width]"
              style={{ width: `${Math.max(2, progress.ratio * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/35">
            Combining clips plays them through once, so it takes about as long as the video itself.
            You can leave this tab open and watch.
          </p>
          <button
            type="button"
            onClick={() => cancelled.current?.abort()}
            className="btn-ghost mt-3 w-full py-2.5 text-sm"
          >
            <CloseIcon width={15} height={15} /> Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void goToPosting()}
        disabled={clips.length === 0 || Boolean(progress) || Boolean(busy)}
        className="btn-primary w-full py-4"
      >
        {finished ? 'Preview and post' : 'Preview'}
      </button>
    </div>
  );
}
