'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  FlashIcon,
  GalleryIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  SwitchCameraIcon,
  VolumeIcon,
} from '@/components/Icons';
import { settleDuration } from '@/lib/video/capture';
import { formatSeconds } from '@/lib/video/limits';
import { pickMimeType } from '@/lib/video/render';

/**
 * The camera.
 *
 * Two full-screen surfaces, and the picture is the whole screen on both. The
 * controls float over it — nothing is a bar that steals height from the
 * viewfinder, because on a phone the viewfinder IS the screen and a letterboxed
 * preview between two solid bars is what makes a web camera feel like a web
 * page.
 *
 * Permission is asked for when this opens and not before. Stopping does not
 * commit anything: it shows the take back, full screen, with a scrubber, so the
 * whole thing can be watched before anybody decides. From there — keep it and
 * write a caption, keep it and film another, or throw it away and re-film.
 * Nothing leaves the device anywhere in here. It is a blob in this tab until the
 * posting screen uploads it.
 *
 * What this does NOT do: encode, transcode, upload, or know what a post is. It
 * hands a Blob to `onRecorded` and that is the entire contract.
 */

interface Take {
  blob: Blob;
  mimeType: string;
  seconds: number;
  url: string;
}

/** A round glass control. One definition, so every tool on screen matches. */
const TOOL =
  'flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md ' +
  'transition active:scale-95 disabled:opacity-30 [@media(max-height:520px)]:h-10 [@media(max-height:520px)]:w-10';

export function VideoRecorder({
  remainingSeconds,
  maxSeconds,
  onRecorded,
  onClose,
  onPickFile,
  onChooseCover,
}: {
  remainingSeconds: number;
  /** The full budget, so the progress ring has something to fill against. */
  maxSeconds: number;
  onRecorded: (clip: { blob: Blob; mimeType: string; seconds: number }) => void;
  onClose: () => void;
  /** Opens the camera roll. The picker itself lives with the file it produces. */
  onPickFile?: () => void;
  /** Keeps the take and continues to the posting screen with the cover editor open. */
  onChooseCover?: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const playback = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  /** The blob URL of the take being reviewed, so it can be revoked. */
  const takeUrl = useRef<string | null>(null);

  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [status, setStatus] = useState<
    'starting' | 'ready' | 'recording' | 'reviewing' | 'denied'
  >('starting');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hasMic, setHasMic] = useState(true);

  /** Torch, where the camera has one. Rear cameras sometimes do; front ones do not. */
  const [canFlash, setCanFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  /** The finished take, held here until it is kept or thrown away. */
  const [take, setTake] = useState<Take | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setCanFlash(false);
    setFlashOn(false);
  }, []);

  /** Throws away the take being reviewed, and the blob URL holding it. */
  const dropTake = useCallback(() => {
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    takeUrl.current = null;
    setTake(null);
    setPlaying(false);
    setAt(0);
    setLength(0);
  }, []);

  /** Opens the camera. Falls back to video-only if the microphone is refused. */
  const open = useCallback(async () => {
    setStatus('starting');
    setError(null);
    stopStream();
    try {
      let stream: MediaStream;
      let withMic = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      } catch (micFailure) {
        // A refused microphone should not cost somebody the camera as well.
        if ((micFailure as DOMException)?.name === 'NotAllowedError') throw micFailure;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        withMic = false;
      }
      setHasMic(withMic && stream.getAudioTracks().length > 0);
      streamRef.current = stream;

      // Is there a torch on this camera? Asked of the track rather than assumed
      // from the facing mode: it is a per-device capability, absent entirely on
      // iOS Safari, and the control is not shown when it would do nothing.
      const [videoTrack] = stream.getVideoTracks();
      const capabilities = videoTrack?.getCapabilities?.() as
        | { torch?: boolean }
        | undefined;
      setCanFlash(Boolean(capabilities?.torch));

      if (preview.current) {
        preview.current.srcObject = stream;
        await preview.current.play().catch(() => undefined);
      }
      setStatus('ready');
    } catch (failure) {
      const name = (failure as DOMException)?.name;
      setStatus('denied');
      setError(
        name === 'NotAllowedError'
          ? 'FayTarra needs permission to use your camera and microphone. Allow it in your browser, then try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device. You can upload a video instead.'
            : 'The camera could not be opened. You can upload a video instead.',
      );
    }
  }, [facing, stopStream]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('denied');
      setError('This browser cannot record video. You can upload a video instead.');
      return;
    }
    void open();
    return stopStream;
  }, [open, stopStream]);

  // Nothing holds the camera open while a take is being watched. The recording
  // light staying on over a playback screen looks like FayTarra is still
  // filming, and on a phone it is also a battery and a heat cost for nothing.
  useEffect(() => {
    if (status === 'reviewing') stopStream();
  }, [status, stopStream]);

  // Whatever is left when this closes: the stream, and the take's blob URL.
  useEffect(() => dropTake, [dropTake]);

  // The clock, and the hard stop when the time runs out.
  useEffect(() => {
    if (status !== 'recording') return;
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= remainingSeconds) recorderRef.current?.stop();
    }, 100);
    return () => window.clearInterval(timer);
  }, [status, remainingSeconds]);

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
      if (chunks.length === 0) {
        // Nothing was captured — a camera that was pulled mid-take, or a
        // recorder that produced no data. Back to the viewfinder rather than a
        // review screen with nothing on it.
        setStatus('ready');
        setError('That take did not record. Try again.');
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      takeUrl.current = url;
      setTake({ blob, mimeType, seconds, url });
      setStatus('reviewing');
    });
    recorderRef.current = recorder;
    startedAt.current = Date.now();
    setElapsed(0);
    setStatus('recording');
    recorder.start(1000);
  }

  const left = Math.max(0, remainingSeconds - elapsed);
  const recording = status === 'recording';

  /** Keeps the take and hands it up. `then` says where the caller goes next. */
  function keep(then: 'caption' | 'another' | 'cover') {
    if (!take) return;
    onRecorded({ blob: take.blob, mimeType: take.mimeType, seconds: take.seconds });
    dropTake();
    if (then === 'another') {
      // The camera was released for the review, so reopen it.
      void open();
      return;
    }
    if (then === 'cover') {
      onChooseCover?.();
      onClose();
      return;
    }
    onClose();
  }

  /* ======================================================== the review ==== */

  if (status === 'reviewing' && take) {
    const duration = length || take.seconds;
    const progress = duration > 0 ? Math.min(1, at / duration) : 0;

    const toggle = () => {
      const element = playback.current;
      if (!element) return;
      if (!element.paused) {
        element.pause();
        return;
      }
      // Settling first, because a tap on a recording whose duration is still
      // Infinity is a tap that does nothing. See settleDuration.
      void settleDuration(element, 2000).then(() => element.play().catch(() => undefined));
    };

    return (
      <div className="fixed inset-0 z-50 bg-black">
        {/* The take, full screen. `contain` rather than `cover`: this is the
            thing being judged, so nothing about it may be cropped away. */}
        <video
          // `key` is not decoration. The viewfinder below is a similar shape, so
          // React would reconcile the two branches onto the SAME DOM node and
          // hand this one the viewfinder's element with its `srcObject` still
          // attached — and srcObject beats src, so the take played back as a
          // dead camera stream: duration Infinity, nothing seekable, no frames.
          key="take-playback"
          ref={(element) => {
            playback.current = element;
            // Belt and braces: correctness here should not rest on the
            // reconciler's choices, and clearing this is free when already null.
            if (element && element.srcObject) element.srcObject = null;
          }}
          src={take.url}
          playsInline
          controls={false}
          muted={muted}
          data-recorder-playback
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            void settleDuration(element).then(() => {
              if (Number.isFinite(element.duration)) setLength(element.duration);
            });
          }}
          onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* Tap anywhere to play or pause. The badge fades out while it plays so
            the picture is not permanently covered by a control. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span
            className={`flex h-[72px] w-[72px] items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-opacity duration-200 ${
              playing ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {playing ? <PauseIcon width={28} height={28} /> : <PlayIcon width={28} height={28} />}
          </span>
        </button>

        {/* ------------------------------------------------------- top */}
        <div className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent pb-10">
          <div className="pointer-events-auto flex items-center justify-between px-4 pt-1">
            <button
              type="button"
              onClick={() => {
                dropTake();
                setError(null);
                void open();
              }}
              className={TOOL}
              aria-label="Back to the camera"
            >
              <ChevronIcon direction="left" />
            </button>
            <span className="rounded-full bg-black/35 px-3 py-1.5 text-[13px] font-semibold tabular-nums text-white/80 backdrop-blur-md">
              {formatSeconds(duration)}
            </span>
            <button
              type="button"
              onClick={() => setMuted((current) => !current)}
              className={TOOL}
              aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
              aria-pressed={muted}
              data-review-sound={muted ? 'off' : 'on'}
            >
              <VolumeIcon muted={muted} />
            </button>
          </div>
        </div>

        {/* ---------------------------------------------------- bottom */}
        <div className="safe-bottom safe-x absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-2 pt-12">
          {/* The whole take is reachable: drag to any point in it. */}
          <div className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/60">
              {formatSeconds(at)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.05}
              value={Math.min(at, duration)}
              aria-label="Position in the recording"
              data-review-scrub
              onChange={(event) => {
                const next = Number(event.target.value);
                setAt(next);
                if (playback.current) playback.current.currentTime = next;
              }}
              className="h-11 flex-1 accent-fay"
            />
            <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/60">
              {formatSeconds(duration)}
            </span>
          </div>
          {/* A plain bar under it, because a range input's own track is thin and
              differently styled in every browser. */}
          <div className="mx-[52px] h-[3px] overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-fay" style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => keep('cover')}
              className="btn-ghost min-h-[52px] flex-1 px-3 py-3 text-[13px]"
            >
              <ImageIcon width={16} height={16} /> Cover
            </button>
            <button
              type="button"
              onClick={() => keep('another')}
              disabled={remainingSeconds - take.seconds < 0.5}
              className="btn-ghost min-h-[52px] flex-1 px-3 py-3 text-[13px] disabled:opacity-40"
            >
              <RecordIcon width={16} height={16} /> Another
            </button>
            <button
              type="button"
              onClick={() => keep('caption')}
              className="btn-primary min-h-[52px] flex-[1.4] px-3 py-3 text-[14px]"
            >
              Continue <CheckIcon width={16} height={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            style={{ width: `${Math.min(100, (elapsed / Math.max(1, maxSeconds)) * 100)}%` }}
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
              {formatSeconds(remainingSeconds)}
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
      {!hasMic && status !== 'denied' && !error && (
        <p className="absolute inset-x-0 bottom-[164px] z-10 mx-auto w-fit rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md">
          No microphone — this will record without sound
        </p>
      )}

      {/* -------------------------------------------------------- bottom */}
      <div className="safe-bottom safe-x absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-6 pb-2 pt-16">
        <div className="flex items-center justify-between">
          {/* Camera roll. Left, so the record button stays dead centre. */}
          <div className="w-14">
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
            spent={remainingSeconds < 0.5}
            progress={recording ? Math.min(1, elapsed / Math.max(1, maxSeconds)) : 0}
            onClick={() => (recording ? recorderRef.current?.stop() : start())}
          />

          {/* Balances the record button to centre. Time left while filming, so
              the number is next to the thumb that will stop it. */}
          <div className="flex w-14 justify-end">
            {recording && (
              <span className="text-[13px] font-semibold tabular-nums text-white/70">
                {formatSeconds(left)}
              </span>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
          {recording ? 'Tap to stop' : status === 'ready' ? 'Hold steady · tap to record' : ' '}
        </p>
      </div>
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
 */
function RecordButton({
  recording,
  disabled,
  spent,
  progress,
  onClick,
}: {
  recording: boolean;
  disabled: boolean;
  spent: boolean;
  progress: number;
  onClick: () => void;
}) {
  const size = 84;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || (spent && !recording)}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
      className="relative flex h-[84px] w-[84px] items-center justify-center transition active:scale-95 disabled:opacity-40 [@media(max-height:520px)]:h-[68px] [@media(max-height:520px)]:w-[68px]"
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
