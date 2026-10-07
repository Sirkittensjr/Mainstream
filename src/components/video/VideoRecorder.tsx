'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloseIcon,
  FlashIcon,
  GalleryIcon,
  ImageIcon,
  SwitchCameraIcon,
  TrashIcon,
  VolumeIcon,
} from '@/components/Icons';
import {
  budgetLeft,
  canContinue,
  canRecordAnother,
  keepsSegment,
  segmentBudget,
  segmentSummary,
} from '@/lib/video/camera';
import { RECORD_CAPS, capLabel, formatSeconds } from '@/lib/video/limits';
import { pickMimeType } from '@/lib/video/render';
import { ConfirmSheet } from './ConfirmSheet';

/**
 * The camera.
 *
 * One full-screen surface, and the picture is the whole screen. The controls
 * float over it — nothing is a bar that steals height from the viewfinder,
 * because on a phone the viewfinder IS the screen and a letterboxed preview
 * between two solid bars is what makes a web camera feel like a web page.
 *
 * Permission is asked for when this opens and not before.
 *
 * STOPPING DOES NOT LEAVE THE CAMERA. A finished segment is handed up and the
 * viewfinder is still there, live, ready for the next one — record, stop,
 * record, stop, as many times as the two-minute budget allows. The strip above
 * the shutter says what has been filmed so far and the last one can be thrown
 * away from there. Leaving is a decision somebody makes with Next, never
 * something releasing the shutter does to them.
 *
 * The budget is the TOTAL of every segment, not a per-clip allowance: three
 * clips of 10, 8 and 12 seconds have spent 30 seconds of the two minutes
 * between them. That arithmetic lives in lib/video/camera.ts.
 *
 * What this does NOT do: encode, transcode, upload, or know what a post is. It
 * hands Blobs to `onRecorded` and says when somebody pressed Next. That is the
 * entire contract.
 */

/** A round glass control. One definition, so every tool on screen matches. */
const TOOL =
  'flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md ' +
  'transition active:scale-95 disabled:opacity-30 [@media(max-height:520px)]:h-10 [@media(max-height:520px)]:w-10';

/**
 * How long the shutter has to be held for releasing it to stop the recording.
 *
 * Under this it was a tap, and a tap means "record until I tap again" — the
 * two gestures share one button, which is how every phone camera works. A
 * press-and-hold that released in 80ms would otherwise produce an empty clip.
 */
const HOLD_MS = 350;

export function VideoRecorder({
  segments,
  maxSeconds,
  onRecorded,
  onNext,
  onDropLast,
  onClose,
  onPickFile,
  onChooseCover,
}: {
  /**
   * The lengths of what has already been filmed or imported, in seconds.
   *
   * Passed in rather than counted here because the clips themselves live in
   * VideoStudio: one list, one truth, and the camera's budget is read off the
   * same numbers the editor and the render pass use.
   */
  segments: readonly number[];
  /** The full budget, so the progress ring has something to fill against. */
  maxSeconds: number;
  onRecorded: (clip: { blob: Blob; mimeType: string; seconds: number }) => void;
  /** Finished recording: on to the editor. */
  onNext: () => void;
  /** Throws away the most recent segment. Absent when there is nothing to throw. */
  onDropLast?: () => void;
  onClose: () => void;
  /** Opens the camera roll. The picker itself lives with the file it produces. */
  onPickFile?: () => void;
  /** Leaves for the cover picker, keeping everything filmed so far. */
  onChooseCover?: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  /** When the shutter went down, so releasing it can tell a hold from a tap. */
  const heldFrom = useRef(0);

  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [status, setStatus] = useState<'starting' | 'ready' | 'recording' | 'denied'>('starting');
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether "Last clip" is asking. It throws a take away for good, the same
   * loss as Back and Delete in the editor, so it asks the same way instead of
   * happening on the tap.
   */
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hasMic, setHasMic] = useState(true);
  /**
   * Whether to record sound at all.
   *
   * A decision, not a device fact — `hasMic` is whether a microphone is there,
   * this is whether it should be used. Filming something to put other audio over,
   * or in a room where the sound is not worth having, is a normal reason to want
   * the picture without it.
   *
   * NOT the same thing as the editor's Sound tool, which silences PLAYBACK on a
   * video that has audio. This one means the audio was never recorded.
   */
  const [wantsMic, setWantsMic] = useState(true);

  /**
   * The length this take is being filmed to.
   *
   * Defaults to the full budget, so nothing anybody could film before is out of
   * reach now. A shorter cap is a commitment to something short: the ring on the
   * shutter then means something the whole way round instead of creeping along a
   * two-minute track.
   */
  const [cap, setCap] = useState<number>(maxSeconds);

  /** What is left of the whole post's budget, and what this one take may run to. */
  const remaining = budgetLeft(segments, maxSeconds);
  const budget = segmentBudget(segments, cap, maxSeconds);
  const roomToFilm = canRecordAnother(segments, maxSeconds);

  /** Torch, where the camera has one. Rear cameras sometimes do; front ones do not. */
  const [canFlash, setCanFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setCanFlash(false);
    setFlashOn(false);
  }, []);

  /** Opens the camera. Falls back to video-only if the microphone is refused. */
  const open = useCallback(async () => {
    setError(null);
    setStatus('starting');
    // A second getUserMedia while the first stream is live is what makes some
    // phones hand back a black frame. Release, then ask.
    stopStream();

    const attempt = async (audio: boolean) =>
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          // `ideal` is a hint, not a promise, and cameras answer it with their
          // sensor's own orientation: an iPhone returns 1920x1080 for this and
          // Chromium's fake device returns 1216x2160. `aspectRatio` is honoured
          // by more of them than the pair of dimensions is, so it is worth
          // asking — but nothing downstream relies on the answer. The output
          // frame is settled by `fromCamera`, not by what arrives here.
          aspectRatio: { ideal: 9 / 16 },
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
        audio,
      });

    try {
      let stream: MediaStream;
      try {
        stream = await attempt(wantsMic);
        setHasMic(wantsMic);
      } catch (failure) {
        if (!wantsMic || (failure as DOMException)?.name === 'NotAllowedError') throw failure;
        // A device with no microphone, or one in use elsewhere: the picture is
        // still worth having.
        stream = await attempt(false);
        setHasMic(false);
      }

      streamRef.current = stream;
      const [videoTrack] = stream.getVideoTracks();
      // Asked of the TRACK rather than guessed at from the facing mode: it is a
      // per-device capability, absent entirely on most front cameras.
      const capabilities = videoTrack?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setCanFlash(Boolean(capabilities?.torch));

      if (preview.current) {
        preview.current.srcObject = stream;
        await preview.current.play().catch(() => undefined);
      }
      setStatus('ready');
    } catch (failure) {
      setStatus('denied');
      setError(
        (failure as DOMException)?.name === 'NotAllowedError'
          ? 'FayTarra needs permission to use your camera. Allow it in your browser, then try again.'
          : 'Your camera could not be opened. Another app may be using it.',
      );
    }
  }, [facing, wantsMic, stopStream]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('denied');
      setError('This browser cannot record video. You can upload a video instead.');
      return;
    }
    void open();
    return stopStream;
  }, [open, stopStream]);

  // The clock, and the hard stop when the time runs out.
  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= budget) recorderRef.current?.stop();
    }, 100);
    return () => window.clearInterval(timer);
  }, [status, budget]);

  async function toggleFlash() {
    const [videoTrack] = streamRef.current?.getVideoTracks() ?? [];
    if (!videoTrack) return;
    const next = !flashOn;
    try {
      // `torch` is not in the standard MediaTrackConstraintSet, which is why
      // this is cast rather than typed. A camera that claimed the capability can
      // still refuse, so the state only changes once it has been accepted.
      await videoTrack.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setFlashOn(next);
    } catch {
      setCanFlash(false);
      setFlashOn(false);
    }
  }

  function start() {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (!stream || !mimeType) {
      setError('This browser cannot record video. You can upload a video instead.');
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(0);
      // Straight back to the viewfinder, every time. The stream was never
      // released, so the picture is already live again; the segment is handed
      // up and whoever is holding the phone decides what happens next.
      setStatus('ready');
      if (chunks.length === 0) {
        // Nothing was captured — a camera that was pulled mid-take, or a
        // recorder that produced no data.
        setError('That take did not record. Try again.');
        return;
      }
      if (!keepsSegment(seconds)) {
        // A shutter that went down and up in the same instant is not a clip,
        // and a frame of nothing in the middle of somebody's video is worse
        // than no clip at all.
        return;
      }
      onRecorded({ blob: new Blob(chunks, { type: mimeType }), mimeType, seconds });
    });
    recorderRef.current = recorder;
    startedAt.current = Date.now();
    setElapsed(0);
    setStatus('recording');
    setError(null);
    recorder.start(1000);
  }

  const left = Math.max(0, budget - elapsed);
  const recording = status === 'recording';

  /** Down on the shutter: stop if it is running, otherwise begin. */
  function shutterDown() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (status !== 'ready' || !roomToFilm) return;
    heldFrom.current = Date.now();
    start();
  }

  /**
   * Up off the shutter.
   *
   * A hold ends the segment — press, film, release, which is what somebody
   * holding the button means by it. A tap does not, because a tap means
   * "record until I tap again" and both gestures share this one button.
   */
  const shutterUp = useCallback(() => {
    if (status !== 'recording') return;
    if (Date.now() - heldFrom.current < HOLD_MS) return;
    recorderRef.current?.stop();
  }, [status]);

  // A pointer released off the edge of the shutter — a thumb that slid, or a
  // browser that cancelled the gesture — would otherwise leave the recorder
  // running with nobody holding it.
  useEffect(() => {
    if (status !== 'recording') return;
    const release = () => shutterUp();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [status, shutterUp]);

  const filmed = canContinue(segments);

  /* ==================================================== the viewfinder ==== */

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      {/* The picture fills the screen. `cover` rather than `contain`, because a
          viewfinder framed by black bars is the single thing that makes a web
          camera feel like a web page instead of a camera. */}
      <video
        key="camera-viewfinder"
        ref={preview}
        muted
        playsInline
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        // A selfie camera that is not mirrored is disorienting to film with.
        // The RECORDING is not mirrored — that matches every phone camera app.
        style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
      />

      {/* How much of the two minutes is gone, across the very top. Thin, and
          gone entirely when not recording. */}
      {recording && (
        <div className="absolute inset-x-0 top-0 z-10 h-[3px] bg-white/15">
          <div
            className="h-full bg-gradient-to-r from-solar via-fay to-fay-soft transition-[width] duration-100"
            style={{ width: `${Math.min(100, (elapsed / Math.max(1, budget)) * 100)}%` }}
          />
        </div>
      )}

      {/* ---------------------------------------------------------- top */}
      <div className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/60 to-transparent pb-12">
        <div className="pointer-events-auto flex items-center justify-between px-4 pt-1">
          <button
            type="button"
            onClick={() => {
              recorderRef.current?.stop();
              stopStream();
              onClose();
            }}
            className={TOOL}
            aria-label="Close the camera"
          >
            <CloseIcon />
          </button>

          {/* Recording says so, in words and in colour, not only by a number
              ticking. */}
          {recording ? (
            <span
              data-recording-indicator
              className="flex items-center gap-2 rounded-full bg-fay px-3 py-1.5 text-[13px] font-bold tabular-nums text-white shadow-glow"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              REC {formatSeconds(elapsed)}
            </span>
          ) : (
            <span className="rounded-full bg-black/35 px-3 py-1.5 text-[13px] font-semibold tabular-nums text-white/80 backdrop-blur-md">
              {formatSeconds(budget)}
            </span>
          )}

          <button
            type="button"
            onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
            disabled={recording}
            className={TOOL}
            aria-label="Switch camera"
          >
            <SwitchCameraIcon />
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- tool rail */}
      {/* Down the right edge, thumb-reachable, and deliberately a column: this
          is where the next camera tool goes, and one more item in a column adds
          nothing to the clutter. Flip lives in the top bar rather than here as
          well — two controls doing one job on one screen is the clutter. */}
      <div className="safe-x absolute right-3 top-1/2 z-10 -translate-y-1/2">
        <div className="flex flex-col gap-3">
          {canFlash && (
            <button
              type="button"
              onClick={() => void toggleFlash()}
              className={`${TOOL} ${flashOn ? 'bg-white text-ink-950' : ''}`}
              aria-label={flashOn ? 'Turn the light off' : 'Turn the light on'}
              aria-pressed={flashOn}
              data-camera-flash
            >
              <FlashIcon off={!flashOn} />
            </button>
          )}

          {/* Sound: whether the microphone is used at all. NOT the editor's Sound
              tool, which silences playback on a video that has audio — this one
              decides whether there is any audio to silence. Filming something to
              put other audio over is a normal reason to want the picture alone. */}
          <button
            type="button"
            onClick={() => setWantsMic((current) => !current)}
            disabled={recording}
            className={`${TOOL} ${wantsMic ? '' : 'bg-white text-ink-950'}`}
            aria-label={wantsMic ? 'Record without sound' : 'Record with sound'}
            aria-pressed={!wantsMic}
            data-camera-mic={wantsMic ? 'on' : 'off'}
          >
            <VolumeIcon muted={!wantsMic} />
          </button>

          {/* The cover, for somebody who wants to choose it now rather than in
              the editor. It keeps everything filmed so far. */}
          {onChooseCover && filmed && !recording && (
            <button
              type="button"
              onClick={onChooseCover}
              className={TOOL}
              aria-label="Choose the cover"
              data-camera-cover
            >
              <ImageIcon width={18} height={18} />
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- notices */}
      {status === 'starting' && (
        <p className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center text-sm text-white/60">
          Asking for your camera…
        </p>
      )}
      {error && (
        <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2">
          <div className="card p-5 text-center">
            <p className="text-sm text-white/80">{error}</p>
            <div className="mt-4 flex flex-col gap-2">
              {status === 'denied' && (
                <button type="button" onClick={() => void open()} className="btn-ghost py-2.5 text-sm">
                  Try again
                </button>
              )}
              {onPickFile && (
                <button type="button" onClick={onPickFile} className="btn-quiet py-2.5 text-sm">
                  Choose a video instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Only when a microphone was WANTED and is not available. Switching sound
          off deliberately is not a problem to be told about. */}
      {wantsMic && !hasMic && status !== 'denied' && !error && (
        <p className="absolute inset-x-0 bottom-[244px] z-10 mx-auto w-fit rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md">
          No microphone — this will record without sound
        </p>
      )}

      {/* -------------------------------------------------------- bottom */}
      <div className="safe-bottom safe-x absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-6 pb-2 pt-16">
        {/* What has been filmed, and the two things to do about it: throw the
            last one away, or go to the editor. Only once something is on the
            strip — an empty camera has nothing to say here. */}
        {filmed && !recording && (
          <div
            className="mb-4 flex items-center justify-between gap-2"
            data-camera-clips
          >
            <span className="rounded-full bg-black/45 px-3 py-1.5 text-[13px] font-semibold tabular-nums text-white/85 backdrop-blur-md">
              {segmentSummary(segments)}
            </span>
            {onDropLast && (
              <button
                type="button"
                onClick={() => setConfirmDrop(true)}
                className="flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[13px] font-semibold text-white/75 backdrop-blur-md transition active:scale-95"
                aria-label="Delete the last clip"
                data-camera-drop-last
              >
                <TrashIcon width={15} height={15} /> Last clip
              </button>
            )}
          </div>
        )}

        {/* How long this one is going to be, chosen before filming and gone once
            it starts — the length of a take is not something to change mid-take.
            All three stay selectable while there is any budget left, and the clock
            above tells the truth about what a choice actually buys: it shows
            `budget`, which is the cap or what is left of the two minutes,
            whichever is smaller. So picking 2m on a second clip with twenty
            seconds left reads 0:20 rather than promising two minutes. */}
        {!recording && status !== 'denied' && remaining >= 1 && (
          <div className="mb-4 flex items-center justify-center gap-2" data-camera-caps>
            {RECORD_CAPS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCap(option)}
                aria-pressed={cap === option}
                data-camera-cap={option}
                className={`min-h-[34px] rounded-full px-3.5 text-[13px] font-bold transition ${
                  cap === option
                    ? 'bg-white text-ink-950'
                    : 'bg-black/35 text-white/70 backdrop-blur-md'
                }`}
              >
                {capLabel(option)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Camera roll. Left, so the record button stays dead centre. */}
          <div className="w-20">
            {onPickFile && !recording && (
              <button
                type="button"
                onClick={onPickFile}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-black/35 text-white backdrop-blur-md transition active:scale-95"
                aria-label="Choose a video from your camera roll"
                data-camera-roll
              >
                <GalleryIcon width={20} height={20} />
              </button>
            )}
          </div>

          <RecordButton
            recording={recording}
            disabled={status !== 'ready' && !recording}
            spent={!roomToFilm}
            // Against the CHOSEN length, which is the point of choosing one.
            progress={recording ? Math.min(1, elapsed / Math.max(1, budget)) : 0}
            onDown={shutterDown}
            onUp={shutterUp}
          />

          {/* Next: the only way out of the camera, and the reason stopping a
              segment can safely leave somebody here. Balanced against the
              camera roll so the shutter stays centred; the time left takes its
              place while filming, next to the thumb that will stop it. */}
          <div className="flex w-20 justify-end">
            {recording ? (
              <span className="text-[13px] font-semibold tabular-nums text-white/70">
                {formatSeconds(left)}
              </span>
            ) : (
              filmed && (
                <button
                  type="button"
                  onClick={onNext}
                  className="btn-primary min-h-[48px] shrink-0 px-3 py-2.5 text-[14px]"
                  data-camera-next
                >
                  Next
                </button>
              )
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
          {recording
            ? 'Release or tap to end the clip'
            : status !== 'ready'
              ? ' '
              : !roomToFilm
                ? 'That is the full two minutes — tap Next'
                : filmed
                  ? 'Hold to add another clip · Next when you are done'
                  : 'Hold to record · tap to keep filming'}
        </p>
      </div>

      {confirmDrop && onDropLast && !recording && (
        <ConfirmSheet
          kind="drop-last"
          title={segments.length > 1 ? `Delete clip ${segments.length}?` : 'Delete this clip?'}
          detail={
            segments.length > 1
              ? `This deletes clip ${segments.length} of ${segments.length}, the last one you filmed. Your other clips are kept.`
              : 'This deletes the clip you filmed so you can film it again.'
          }
          onNo={() => setConfirmDrop(false)}
          onYes={() => {
            setConfirmDrop(false);
            onDropLast();
          }}
        />
      )}
    </div>
  );
}

/**
 * The shutter.
 *
 * A ring with the elapsed time drawn around it and the control inside, so the
 * one thing a thumb is reaching for is also the thing showing how long is left.
 * The inner shape changes rather than the button moving: a circle to start, a
 * square to stop, in the same place both times.
 *
 * Two gestures, one button, the way a phone camera does it: hold it to film and
 * release to end the clip, or tap it to start and tap again to stop. `onDown`
 * and `onUp` are both given the raw gesture; which of the two it was is decided
 * by how long the press lasted, in the recorder.
 */
function RecordButton({
  recording,
  disabled,
  spent,
  progress,
  onDown,
  onUp,
}: {
  recording: boolean;
  disabled: boolean;
  spent: boolean;
  progress: number;
  onDown: () => void;
  onUp: () => void;
}) {
  const size = 84;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        // The gesture is the shutter's; a long press should not also select the
        // screen or bring up a context menu over the viewfinder.
        event.preventDefault();
        onDown();
      }}
      onPointerUp={onUp}
      onContextMenu={(event) => event.preventDefault()}
      // Keyboard only: a click whose `detail` is 0 came from Enter or Space,
      // not from a pointer, and a keyboard has no hold to release. Pointer
      // clicks are already handled above and must not fire twice.
      onClick={(event) => {
        if (event.detail === 0) onDown();
      }}
      disabled={disabled || (spent && !recording)}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
      className="relative flex h-[84px] w-[84px] touch-none select-none items-center justify-center transition active:scale-95 disabled:opacity-40 [@media(max-height:520px)]:h-[68px] [@media(max-height:520px)]:w-[68px]"
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 h-full w-full -rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth={stroke}
        />
        {recording && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#fay-shutter)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        )}
        <defs>
          <linearGradient id="fay-shutter" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c5cff" />
            <stop offset="52%" stopColor="#ff3d9a" />
            <stop offset="100%" stopColor="#ffb443" />
          </linearGradient>
        </defs>
      </svg>

      <span
        className={
          recording
            ? 'h-7 w-7 rounded-[9px] bg-white transition-all duration-200'
            : 'h-[64px] w-[64px] rounded-full transition-all duration-200 [@media(max-height:520px)]:h-[52px] [@media(max-height:520px)]:w-[52px]'
        }
        style={
          recording
            ? undefined
            : {
                backgroundImage:
                  'linear-gradient(120deg, #7c5cff 0%, #ff3d9a 52%, #ffb443 100%)',
              }
        }
      />
    </button>
  );
}
