'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createVideoPostAction } from '@/app/actions';
import {
  ChevronIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RecordIcon,
  TrashIcon,
  VideoIcon,
  VolumeIcon,
} from '@/components/Icons';
import { CATEGORIES, type Category, type Media, type TextOverlay } from '@/lib/types';
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
import { stageAfterNext, stageAfterSegment } from '@/lib/video/camera';
import { postCaption } from '@/lib/video/compose';
import { grabFrame, probeLocalVideo } from '@/lib/video/capture';
import { locate, timeline } from '@/lib/video/playlist';
import {
  MAX_COVER_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_ACCEPT,
  formatMegabytes,
  formatPreciseSeconds,
  formatSeconds,
} from '@/lib/video/limits';
import { recordedFile } from '@/lib/video/recording';
import { canRender, renderClips } from '@/lib/video/render';
import { UploadError, contentTypeFor, discardMedia, uploadMedia } from '@/lib/video/upload-client';
import { ClipEditor } from './ClipEditor';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';
import { HashtagField } from './HashtagField';
import { CoverPicker } from './CoverPicker';
import { VideoEditor, type EditorTool } from './VideoEditor';
import { VideoText } from './VideoText';
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

/**
 * The posting screen's preview frame: a real 9:16 window.
 *
 * Driven by HEIGHT, with the width following from the ratio. Setting
 * `aspectRatio` and a `maxHeight` together does not give a 9:16 box — the cap
 * wins and the frame comes out whatever shape is left, measured at 0.84 on a
 * phone when 0.5625 was asked for. So the height is the knob and the ratio does
 * the rest; `maxWidth` keeps it inside a narrow column.
 *
 * Shorter than the viewport on purpose: this screen is a form as well as a
 * preview, and a full-height video would push the caption, the cover and the Post
 * button below the fold. The editor is where the video gets the whole screen.
 */
const POST_FRAME = {
  aspectRatio: '9 / 16',
  height: '56vh',
  maxWidth: '100%',
} as const;

export function VideoStudio({
  /**
   * What to show first.
   *
   * `camera` is the + button: a viewfinder, immediately, because that is what was
   * asked for. `chooser` is the profile's "upload a video": somebody who already
   * has the file does not want their camera turned on to give it to us. Stated
   * rather than inferred from the device, because the two routes mean different
   * things on the same phone.
   */
  start = 'chooser',
}: {
  start?: 'camera' | 'chooser';
} = {}) {
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

  /**
   * A picture the creator supplied instead of a frame.
   *
   * Held as a File until Post, never uploaded on pick. That is what makes
   * "replace it" and "change your mind" free: nothing has been stored yet, so
   * there is nothing to orphan. The only upload happens on publish, and the
   * one failure path after that — the post itself failing — discards it
   * alongside the video.
   */
  /**
   * Whether the camera should open the moment the Video tab does.
   *
   * On a phone, tapping + and then Video is already a decision to use the
   * camera — making somebody pass a chooser card first is a form in front of the
   * thing they asked for. On a desktop it is not: a webcam is rarely what
   * somebody at a desk came here for, and a camera permission prompt out of
   * nowhere would be worse than a tap. So this is narrow AND coarse — a phone,
   * not a small window — and it fires once, so closing the camera does not
   * reopen it.
   */
  const autoOpened = useRef(false);
  /**
   * Whether this is a phone, decided once.
   *
   * Once, and not on every resize, because rotating a phone into landscape makes
   * it 844 wide — re-reading this mid-edit would move somebody from the staged
   * mobile flow to the desktop one while they were using it.
   */
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Still needed after `start`: it decides whether the three mobile stages run
    // at all, which is a question about the screen rather than about the route.
    setPhone(window.matchMedia('(max-width: 639px) and (pointer: coarse)').matches);
    const canRecordHere = Boolean(navigator.mediaDevices?.getUserMedia);
    if (start === 'camera' && canRecordHere) setRecording(true);
  }, [start]);

  /**
   * Which of the three mobile stages is showing.
   *
   * Deliberately not the `stage` above, which is the DESKTOP editor's
   * compose/clips/editing state and is left alone.
   *
   * Camera, then editing, then posting — three decisions, three screens, because
   * one screen asking for all of them is what made this feel like a form with a
   * preview in it. Only consulted on a phone: the desktop flow is one page with
   * the clip editor behind "Edit", and it is not changed by any of this.
   */
  const [mobileStage, setMobileStage] = useState<'camera' | 'edit' | 'post'>('post');

  /**
   * Out of the camera and into the editor.
   *
   * CAMERA → EDIT → POST, and this is the one step that makes the first arrow.
   * Called by Next, and by the camera running out of budget — never by a
   * segment simply finishing.
   */
  const leaveCamera = useCallback(() => {
    setRecording(false);
    setMobileStage('edit');
    // A fresh arrival lands on Trim, the first thing anybody does to a take.
    // The tool is otherwise remembered, which is right while editing and wrong
    // on arrival. Arriving to pick a cover overrides this, because that handler
    // sets the tool after calling here.
    setEditorTool('trim');
  }, []);

  /** Playback properties of the finished post, set in the editing stage. */
  const [mutedOnPost, setMutedOnPost] = useState(false);
  /** The posting screen's own preview, for a project with no rendered file yet. */
  const postPlayer = useRef<ClipPlayerHandle>(null);
  const [postPlaying, setPostPlaying] = useState(false);
  /** Which editing tool is open, so arriving to pick a cover can start there. */
  const [editorTool, setEditorTool] = useState<EditorTool>('trim');
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);

  /** Set when the camera hands a take over for its cover to be chosen. */
  const [coverWanted, setCoverWanted] = useState(false);
  const coverSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!coverWanted || !coverSection.current) return;
    coverSection.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setCoverWanted(false);
  }, [coverWanted, clips.length]);

  const [customCover, setCustomCover] = useState<File | null>(null);
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState<Category>('Life');
  /** Hashtags, as tags. Collected and sent as a list, never appended to the caption. */
  const [tags, setTags] = useState<string[]>([]);
  const [contentWarning, setContentWarning] = useState(false);
  /** Whether the folded-away fields are showing. Phones only; always open at sm+. */
  const [showMore, setShowMore] = useState(false);
  const [posting, setPosting] = useState(false);

  const cancelled = useRef<AbortController | null>(null);

  /** What the post will actually be covered with, for the preview. */
  const coverPreview = customCoverUrl ?? thumbnail;

  function chooseCover(file: File | undefined) {
    if (!file) return;
    setCoverError(null);

    if (!file.type.startsWith('image/')) {
      setCoverError('Choose an image — JPG, PNG, WEBP or GIF.');
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCoverError(
        `That image is ${formatMegabytes(file.size)}. Covers can be up to ${formatMegabytes(MAX_COVER_BYTES)}.`,
      );
      return;
    }

    setCustomCover(file);
    setCustomCoverUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return trackUrl(URL.createObjectURL(file));
    });
  }

  function clearCover() {
    setCoverError(null);
    setCustomCover(null);
    setCustomCoverUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }

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
    // A supplied image is the cover, so there is no frame to keep in step.
    if (customCover) return;
    // Where that moment of the finished video actually lives. With one clip, or
    // once a render exists, it is the preview file at that second. With several
    // unrendered clips there is no combined file yet, so the frame is taken from
    // whichever clip is on screen at that point — which is the same frame the
    // render will produce there. Without this the cover picker was blank for
    // every multi-clip video until the render ran.
    const grabFrom = previewUrl
      ? { src: previewUrl, at: thumbnailAt }
      : (() => {
          const found = locate(timeline(clips), thumbnailAt);
          return found ? { src: found.segment.clip.src, at: found.sourceTime } : null;
        })();
    if (!grabFrom) return;
    let cancelledHere = false;
    void (async () => {
      try {
        const frame = await grabFrame(grabFrom.src, grabFrom.at);
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
  /**
   * What the camera is holding, as plain lengths.
   *
   * Derived from the clips rather than counted in the camera, so the budget the
   * viewfinder shows and the budget the render pass obeys are the same number.
   * An imported clip counts towards it exactly as a filmed one does.
   */
  const segments = clips.map(clipDuration);
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
        // Chosen from the camera roll: the camera has done its job, and an
        // imported video gets the same editing stage a recorded one does —
        // trimming, a cover, sound and text are no less useful for it.
        setRecording(false);
        setMobileStage('edit');
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

      // The cover is stored as its own file and only referenced by the post,
      // so it never touches the video: replacing one leaves the other alone.
      //
      // A custom picture wins over the scrubbed frame when there is one. When
      // there is not, a frame is grabbed anyway — a video post with no cover
      // costs everybody who scrolls past it in the Videos feed a download.
      let poster: string | undefined;
      try {
        const cover = customCover
          ? { body: customCover as Blob, type: contentTypeFor(customCover) }
          : {
              body: await grabFrame(uploaded.previewUrl, thumbnailAt, { maxEdge: 720 }),
              type: 'image/jpeg',
            };
        const image = await uploadMedia(cover.body, cover.type, { signal: controller.signal });
        poster = image.url;
      } catch (failure) {
        // A cover that will not upload must never cost somebody their post —
        // the video is the thing they made. It goes up without one.
        if ((failure as DOMException)?.name === 'AbortError') throw failure;
      }

      setProgress({ label: 'Posting…', ratio: 1 });
      // The playback properties chosen in the editing stage travel with the post
      // rather than with the file. sanitiseMedia re-validates both server-side —
      // these are a client's claim until it has.
      const written = overlays.filter((entry) => entry.text.trim().length > 0);
      const result = await createVideoPostAction({
        media: {
          ...uploaded.media,
          ...(poster ? { poster } : {}),
          ...(mutedOnPost ? { muted: true } : {}),
          ...(written.length > 0 ? { text: written } : {}),
        },
        // A video post is an ordinary FayTarra post, so the title is the first
        // line of its caption rather than a second field in the database that
        // only videos would ever use. It is what the feed, the Videos feed,
        // search and the post page all already show.
        caption: postCaption(title, caption),
        category,
        tags,
        contentWarning,
      });
      if (result?.error) {
        // The video is in storage and no post points at it. Take it back out
        // rather than leaving it there for nobody — and the cover with it,
        // which is the only way an uploaded cover can be left unreferenced.
        await discardMedia(uploaded.media.url);
        if (poster) await discardMedia(poster);
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
      <>
        {/* Mounted beside the camera, not instead of it: the camera-roll button
            clicks this input, so it has to exist while the camera is open. */}
        <FilePicker inputRef={fileInput} onFiles={pickFiles} />
        <VideoRecorder
        segments={segments}
        maxSeconds={MAX_VIDEO_SECONDS}
        onClose={() => setRecording(false)}
        onPickFile={() => fileInput.current?.click()}
        onChooseCover={() => {
          // On a phone the cover lives in the editing stage, so that is where
          // this goes — opened on the right tool. On a desktop there is no such
          // stage, so it scrolls the posting screen's picker into view instead.
          leaveCamera();
          if (phone) {
            setEditorTool('cover');
            setMobileStage('edit');
          } else {
            setCoverWanted(true);
          }
        }}
        onRecorded={({ blob, mimeType, seconds }) => {
          // Wrapped as a File, which is what keeps an untouched recording OUT
          // of the render pass: `needsRender` reads `clip.file` as "we still
          // have the original bytes", and without one a two-minute recording
          // was re-encoded in real time before it could be uploaded. See
          // lib/video/recording.ts.
          const index = clips.length + 1;
          const file = recordedFile(blob, mimeType, index);
          void addSource(file, `Recording ${index}`, file);
          // And that is all a finished segment does. The camera stays open, on
          // the viewfinder, ready for the next one — releasing the shutter is
          // not a decision to stop filming, and it used to be treated as one.
          //
          // The single exception is the budget running out: with no room for
          // another clip there is nothing to stay for, so the editor is where
          // somebody goes. `stageAfterSegment` is that rule, measured against
          // the TOTAL of every segment including this one.
          if (stageAfterSegment([...segments, seconds]) === 'edit') leaveCamera();
        }}
        onDropLast={
          clips.length > 0
            ? () => {
                setClips((current) => current.slice(0, -1));
                setFinished(null);
                setError(null);
              }
            : undefined
        }
        onNext={() => {
          // The one way out of the camera, and the reason stopping a segment can
          // safely leave somebody in it.
          if (stageAfterNext(segments) !== 'edit') return;
          leaveCamera();
        }}
        />
      </>
    );
  }

  /* ------------------------------------------------- the mobile edit stage */

  // Between the camera and the caption, on a phone. The video is the screen and
  // the only decisions here are about the video itself; posting comes next.
  if (phone && mobileStage === 'edit' && clips.length > 0) {
    return (
      <VideoEditor
        // The whole project. The editor plays it as one video by running the
        // clips in sequence — see ClipPlayer — so nothing has to be rendered
        // before somebody can watch back what they are about to post, and each
        // clip keeps its own trim handles.
        clips={clips}
        muted={mutedOnPost}
        overlays={overlays}
        cover={{
          preview: coverPreview,
          custom: customCover,
          isCustom: Boolean(customCoverUrl),
          at: thumbnailAt,
          error: coverError,
          onAt: setThumbnailAt,
          onFile: chooseCover,
          onClear: clearCover,
        }}
        tool={editorTool}
        onTool={setEditorTool}
        onTrimClip={(id, patch) => {
          setClips((current) => updateClip(current, id, patch));
          // The rendered video is now out of date, so it is thrown away rather
          // than posted as the pre-trim version.
          setFinished(null);
        }}
        onPatchClip={(id, patch) => {
          setClips((current) => updateClip(current, id, patch));
          setFinished(null);
        }}
        onMuted={setMutedOnPost}
        onOverlays={setOverlays}
        onAddClip={left > 0.5 ? () => setRecording(true) : undefined}
        onDeleteClip={(id) => {
          // Computed out here rather than inside the updater: an updater can be
          // called twice, and moving the whole screen twice is not idempotent.
          const kept = clips.filter((entry) => entry.id !== id);
          setClips(kept);
          setFinished(null);
          // Deleting the only clip leaves nothing to edit, so it goes back to the
          // camera rather than to an empty editor — the same place Retake lands,
          // because it is the same situation.
          if (kept.length === 0) {
            setMobileStage('camera');
            setRecording(true);
          }
        }}
        onRetake={() => {
          // Going back past a take means that take is being redone, so it is
          // dropped — the LAST one, which is the one just filmed. Keeping it and
          // filming another is the other button.
          setClips((current) => current.slice(0, -1));
          setFinished(null);
          setMobileStage('camera');
          setRecording(true);
        }}
        onNext={() => setMobileStage('post')}
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
          {/* Recording comes first on a phone and second on a desktop, by
              `order` rather than by rendering different things: the camera is what
              somebody holding a phone came here for. Both buttons are always
              present and neither is a different code path, so the desktop file
              upload is exactly where it was. */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRecording(true);
              }}
              className="btn-primary order-1 min-h-[56px] py-4 sm:order-2"
            >
              <RecordIcon width={18} height={18} /> Record a video
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={Boolean(busy)}
              className="btn-ghost order-2 min-h-[56px] py-4 sm:order-1"
            >
              <PlusIcon width={18} height={18} /> Choose a file
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
      {/* A phone arrived here from the editor, so it says so and offers the way
          back. Editing is finished; this screen is for posting. */}
      {phone && clips.length > 0 && (
        <div className="flex items-center justify-between" data-post-stage>
          <button
            type="button"
            onClick={() => setMobileStage('edit')}
            className="btn-quiet px-3 py-2 text-sm"
          >
            <ChevronIcon direction="left" width={15} height={15} /> Edit
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Post video
          </p>
          <span className="w-16" aria-hidden />
        </div>
      )}

      {/* The post's own preview. The overlays and the sound choice are applied,
          so what is shown is the POST rather than the raw file.

          Tall and full width rather than a short card: short-form video is
          vertical, and a 9:16 frame is the shape the thing being posted actually
          is. `object-contain` inside it, so a landscape clip letterboxes instead
          of being stretched or cropped — the frame is a stage, not a crop. */}
      {previewUrl ? (
        <div
          className="relative mx-auto overflow-hidden rounded-2xl bg-black"
          style={POST_FRAME}
          data-post-preview="file"
        >
          <video
            src={previewUrl}
            controls
            playsInline
            muted={mutedOnPost}
            preload="metadata"
            className="absolute inset-0 h-full w-full object-contain"
          />
          <VideoText media={{ text: overlays.filter((entry) => entry.text.trim().length > 0) }} />
        </div>
      ) : (
        // Several clips and no render yet. Played in sequence rather than
        // described in a sentence: "they are put together when you post" asked
        // somebody to post something they had never seen.
        <div
          className="relative mx-auto overflow-hidden rounded-2xl bg-black"
          style={POST_FRAME}
          data-post-preview="clips"
        >
          <ClipPlayer
            ref={postPlayer}
            clips={clips}
            muted={mutedOnPost}
            onPlayingChange={setPostPlaying}
            className="absolute inset-0"
          />
          <VideoText media={{ text: overlays.filter((entry) => entry.text.trim().length > 0) }} />
          <button
            type="button"
            onClick={() => postPlayer.current?.toggle()}
            aria-label={postPlaying ? 'Pause' : 'Play'}
            data-post-preview-playpause
            className="absolute inset-0 flex items-center justify-center"
          >
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-opacity ${
                postPlaying ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {postPlaying ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
            </span>
          </button>
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white/85 backdrop-blur">
            {clips.length} clips · {formatSeconds(total)}
          </span>
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

      {/* ------------------------------------------------------------ cover */}
      {previewUrl && (
        <section
          ref={coverSection}
          aria-labelledby="cover-heading"
          data-cover-section
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
        >
          <CoverPicker
            preview={coverPreview}
            custom={customCover}
            isCustom={Boolean(customCoverUrl)}
            at={thumbnailAt}
            max={total}
            error={coverError}
            onAt={setThumbnailAt}
            onFile={chooseCover}
            onClear={clearCover}
          />
        </section>
      )}

      {/* The one field that always shows. It is the first line of the post's
          caption, which on a phone is simply "the caption" — so it is called
          that there. On a desktop, where the longer description sits right
          underneath it, "Title" is the more accurate of the two words and the
          screen is unchanged. */}
      <div>
        <label className="label" htmlFor="video-title">
          <span className="sm:hidden">Caption</span>
          <span className="hidden sm:inline">Title</span>
        </label>
        <input
          id="video-title"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Say something about it"
          className="mt-2 w-full text-base"
        />
      </div>

      {/* Hashtags, always on screen rather than folded away with the rest.
          They are one of the five things this screen is for — video, title,
          hashtags, cover, content warning — and they are the one that decides
          whether anybody who is not already following finds the video. */}
      <HashtagField tags={tags} onTags={setTags} disabled={posting} />

      {/* Everything else is folded away on a phone and open on a desktop.
          Nothing is removed — a mobile creator can still write a description,
          set a category and add tags — but the posting screen a phone opens on
          is the video, a caption, a cover, a content warning and Post, and not
          a five-field form standing between somebody and their own video. */}
      <button
        type="button"
        onClick={() => setShowMore((current) => !current)}
        aria-expanded={showMore}
        aria-controls="video-more"
        data-more-options
        className="chip w-full justify-center py-2.5 hover:bg-white/10 sm:hidden"
      >
        {showMore ? 'Fewer options' : 'More options'}
        <ChevronIcon
          direction="right"
          width={14}
          height={14}
          className={`transition ${showMore ? '-rotate-90' : 'rotate-90'}`}
        />
      </button>

      <div id="video-more" className={`space-y-4 ${showMore ? '' : 'hidden sm:block'}`}>
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

      {/* Sticky at the bottom on a phone: the posting screen scrolls once More
          options is open, and the one button somebody came here to press should
          not be the one they have to go looking for. Static from `sm:` up, where
          the whole screen fits and a floating bar would be noise. */}
      {/* `pointer-events-none` on the bar and `auto` on the button: the bar's
          transparent gradient sits over whatever is scrolled underneath it, and
          without this it swallows taps on those controls rather than letting them
          through. Measured — it ate the More options button. */}
      <div className="safe-bottom pointer-events-none sticky bottom-0 -mx-4 bg-gradient-to-t from-ink-950 via-ink-950/95 to-transparent px-4 pb-2 pt-4 sm:static sm:mx-0 sm:bg-none sm:p-0">
        <button
          type="button"
          onClick={() => void post()}
          disabled={posting || Boolean(busy)}
          data-post-button
          className="btn-primary pointer-events-auto min-h-[56px] w-full py-4"
        >
          {posting ? 'Posting…' : 'Post video'}
        </button>
      </div>
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
