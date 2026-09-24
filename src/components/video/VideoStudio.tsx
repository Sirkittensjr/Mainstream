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
import { UploadError, contentTypeFor, discardMedia, uploadMedia } from '@/lib/video/upload-client';
import { ClipEditor } from './ClipEditor';
import { VideoRecorder } from './VideoRecorder';

/**
 * Posting a video.
 *
 * The common case is one video off a phone, and that is what this is shaped
 * around: choose it, see it, write a caption, post. Nothing about clips,
 * combining, rendering or uploading is on screen until somebody asks for it,
 * because none of it is their problem. Trimming, cropping, rotating, muting
 * and putting several clips together are all still here — behind "Edit" and
 * "Add another clip" — but they are the exception, not the doorway.
 *
 * Nothing is uploaded until Post video is pressed. Before that everything is
 * a blob URL in this tab, so backing out costs nothing and nobody has waited
 * on a transfer they then abandoned. After it, the progress shown is the real
 * number of bytes Supabase Storage has acknowledged.
 */

type Stage = 'compose' | 'clips' | 'editing';

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
  const [stage, setStage] = useState<Stage>('compose');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; ratio: number; bytes?: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  /** The combined video, once one has had to be built. */
  const [finished, setFinished] = useState<Finished | null>(null);
  const [thumbnailAt, setThumbnailAt] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState<Category>('Life');
  const [tags, setTags] = useState('');
  const [contentWarning, setContentWarning] = useState(false);
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

  // The cover frame, kept in step with the scrubber. A nicety: a post with
  // no poster still works, it just costs the Videos feed a download.
  useEffect(() => {
    if (!previewUrl) return;
    let cancelledHere = false;
    void (async () => {
      try {
        const frame = await grabFrame(previewUrl, thumbnailAt);
        if (cancelledHere) return;
        setThumbnail((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return trackUrl(URL.createObjectURL(frame));
        });
      } catch {
        // Some browsers refuse to draw a frame from a file they will still
        // play. The post simply goes without a cover.
      }
    })();
    return () => {
      cancelledHere = true;
    };
  });

  const total = totalDuration(clips);
  const left = remainingSeconds(clips);
  const editing = clips.find((clip) => clip.id === editingId) ?? null;
  /** What the compose screen plays: the combined video if there is one, else the only clip. */
  const previewUrl = finished?.previewUrl ?? (clips.length === 1 ? clips[0].src : null);
  const simple = clips.length === 1 && !needsRender(clips);

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
          // The first video is the common case and deserves the plain
          // version of this: nothing is "left" yet, it is simply too long.
          setError(
            current.length === 0
              ? `That video is ${formatSeconds(facts.duration)} long. FayTarra videos can be up to ${MAX_VIDEO_SECONDS / 60} minutes — trim it and try again.`
              : room.error,
          );
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
        // Both of these are checked here, before anything is sent anywhere:
        // a file that cannot be posted should cost nobody an upload.
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

  /* ------------------------------------------------- putting the video together */

  /** Renders the clips into one video, or hands back the single untouched one. */
  async function build(signal: AbortSignal): Promise<Finished | null> {
    if (finished) return finished;
    if (clips.length === 0) return null;

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
      setProgress({ label: 'Preparing your video…', ratio: 0 });
      const rendered = await renderClips(clips, {
        signal,
        onProgress: ({ seconds, total: length, clip, clips: count }) =>
          setProgress({
            label:
              count > 1
                ? `Preparing your video — clip ${clip} of ${count}`
                : 'Preparing your video…',
            ratio: length > 0 ? seconds / length : 0,
          }),
      });
      blob = rendered.blob;
      contentType = rendered.mimeType.split(';')[0];
      size = { width: rendered.width, height: rendered.height };
    }

    setProgress({ label: 'Uploading…', ratio: 0 });
    const media = await uploadMedia(blob, contentType, {
      signal,
      onProgress: ({ ratio, phase }) =>
        setProgress({
          label: phase === 'checking' ? 'Checking your video…' : 'Uploading…',
          ratio,
          bytes: blob.size,
        }),
    });

    const built: Finished = {
      media: {
        ...media,
        width: media.width ?? size.width,
        height: media.height ?? size.height,
        duration: media.duration ?? total,
      },
      previewUrl: needsRender(clips) ? trackUrl(URL.createObjectURL(blob)) : clips[0].src,
    };
    setFinished(built);
    return built;
  }

  async function post() {
    if (clips.length === 0 || posting) return;
    setPosting(true);
    setError(null);
    const controller = new AbortController();
    cancelled.current = controller;

    let uploaded: Finished | null = null;
    try {
      uploaded = await build(controller.signal);
      if (!uploaded) return;

      // The poster is grabbed from the local copy and uploaded separately: it
      // is a few KB, and a video post without one costs everybody who scrolls
      // past it in the Videos feed.
      let poster: string | undefined;
      try {
        const frame = await grabFrame(uploaded.previewUrl, thumbnailAt, { maxEdge: 720 });
        const image = await uploadMedia(frame, 'image/jpeg', { signal: controller.signal });
        poster = image.url;
      } catch {
        // A failed thumbnail must not cost somebody their post.
      }

      setProgress({ label: 'Posting…', ratio: 1 });
      const result = await createVideoPostAction({
        media: { ...uploaded.media, ...(poster ? { poster } : {}) },
        // A video post is an ordinary FayTarra post, so the title is the first
        // line of its caption rather than a second field in the database that
        // only videos would ever use. It is what the feed, the Videos feed,
        // search and the post page all already show.
        caption: [title.trim(), caption.trim()].filter(Boolean).join('\n\n'),
        category,
        tags,
        contentWarning,
      });
      if (result?.error) {
        // The video is in storage and no post points at it. Take it back out
        // rather than leaving it there for nobody.
        await discardMedia(uploaded.media.url);
        setFinished(null);
        setError(result.error);
        return;
      }
      if (result?.postId) {
        setProgress({ label: 'Posted', ratio: 1 });
        router.push(`/post/${result.postId}`);
        return;
      }
    } catch (failure) {
      if ((failure as DOMException)?.name === 'AbortError') {
        setError(null);
      } else {
        setError(
          failure instanceof UploadError || failure instanceof Error
            ? failure.message
            : 'The post did not go through.',
        );
      }
    } finally {
      cancelled.current = null;
      setProgress(null);
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
        <ClipEditor
          clip={editing}
          onChange={(patch) => {
            setClips((current) => updateClip(current, editing.id, patch));
            setFinished(null);
          }}
          onDone={() => {
            setStage(clips.length > 1 ? 'clips' : 'compose');
            setEditingId(null);
          }}
        />
      </div>
    );
  }

  if (stage === 'clips') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStage('compose')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"
            aria-label="Back"
          >
            <ChevronIcon direction="left" />
          </button>
          <div>
            <p className="font-display text-lg font-bold">Your clips</p>
            <p className="text-xs text-white/45">
              {clips.length} clip{clips.length === 1 ? '' : 's'} · {formatSeconds(total)} ·{' '}
              {formatSeconds(left)} left
            </p>
          </div>
        </div>

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
        <FilePicker inputRef={fileInput} onFiles={pickFiles} />

        {busy && <p className="text-sm text-white/45">{busy}</p>}
        {error && <Problem>{error}</Problem>}

        <button type="button" onClick={() => setStage('compose')} className="btn-primary w-full py-4">
          Done
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------------- the simple one */

  if (clips.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
          <VideoIcon width={30} height={30} className="mx-auto text-white/35" />
          <p className="mt-3 font-display text-lg font-bold">Post a video</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-white/45">
            Up to {MAX_VIDEO_SECONDS / 60} minutes and {formatMegabytes(MAX_VIDEO_BYTES)}. MP4, MOV
            or WEBM — straight off your phone is fine.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={Boolean(busy)}
              className="btn-primary min-h-[56px] py-4"
            >
              <PlusIcon width={18} height={18} /> Select video
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRecording(true);
              }}
              className="btn-ghost min-h-[56px] py-4"
            >
              <RecordIcon width={18} height={18} /> Record
            </button>
          </div>
        </div>
        <FilePicker inputRef={fileInput} onFiles={pickFiles} />
        {busy && <p className="text-sm text-white/45">{busy}</p>}
        {error && <Problem>{error}</Problem>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[52vh] w-full rounded-2xl bg-black object-contain"
        />
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/45">
          {clips.length} clips, {formatSeconds(total)} in total. They are put together when you
          post.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="chip tabular-nums">{formatSeconds(total)}</span>
        {simple && clips[0].file && (
          <span className="chip text-white/45">{formatMegabytes(clips[0].file.size)}</span>
        )}
        <button
          type="button"
          onClick={() => {
            setEditingId(clips[0].id);
            setStage('editing');
          }}
          disabled={posting}
          className="chip hover:bg-white/10 disabled:opacity-40"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setStage('clips')}
          disabled={posting}
          className="chip hover:bg-white/10 disabled:opacity-40"
        >
          {clips.length > 1 ? `${clips.length} clips` : 'Add another clip'}
        </button>
        <button
          type="button"
          onClick={() => {
            setClips([]);
            setFinished(null);
            setError(null);
          }}
          disabled={posting}
          className="chip ml-auto text-white/45 hover:bg-white/10 disabled:opacity-40"
        >
          Start over
        </button>
      </div>

      {previewUrl && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-white/70">
            Cover frame
          </summary>
          <p className="mt-1 text-xs text-white/40">
            The frame people see before they press play. The start of the video by default.
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
              max={Math.max(0.1, total - 0.1)}
              step={0.1}
              value={thumbnailAt}
              onChange={(event) => setThumbnailAt(Number(event.target.value))}
              className="h-11 w-full accent-fay"
            />
          </div>
        </details>
      )}

      <div>
        <label className="label" htmlFor="video-title">
          Title
        </label>
        <input
          id="video-title"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What is this video?"
          className="mt-2 w-full text-base"
        />
      </div>

      <div>
        <label className="label" htmlFor="video-caption">
          Description (optional)
        </label>
        <textarea
          id="video-caption"
          rows={3}
          maxLength={1200}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Say more about it. @mention anyone you want to bring in."
          className="mt-2 w-full text-base"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
            placeholder="firstvideo, studio"
            className="mt-2 w-full"
          />
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <input
          id="video-content-warning"
          type="checkbox"
          checked={contentWarning}
          onChange={(event) => setContentWarning(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-fay"
        />
        <span>
          <span className="block text-sm font-semibold">Content warning</span>
          <span className="block text-xs text-white/45">
            The video stays covered until somebody chooses to watch it.
          </span>
        </span>
      </label>

      {error && <Problem>{error}</Problem>}

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
          {progress.bytes ? (
            <p className="mt-2 text-xs tabular-nums text-white/35">
              {formatMegabytes(progress.ratio * progress.bytes)} of{' '}
              {formatMegabytes(progress.bytes)} · it carries on if your connection drops
            </p>
          ) : null}
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
        onClick={() => void post()}
        disabled={posting || Boolean(busy)}
        className="btn-primary w-full py-4"
      >
        {posting ? 'Posting…' : 'Post video'}
      </button>
    </div>
  );
}

function FilePicker({
  inputRef,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (list: FileList | null) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={VIDEO_ACCEPT}
      multiple
      className="hidden"
      onChange={(event) => void onFiles(event.target.files)}
    />
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-fay/40 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
      {children}
    </p>
  );
}
