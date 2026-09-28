'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  StopIcon,
  SwitchCameraIcon,
} from '@/components/Icons';
import { settleDuration } from '@/lib/video/capture';
import { formatSeconds } from '@/lib/video/limits';
import { pickMimeType } from '@/lib/video/render';

/**
 * Recording a clip from the camera.
 *
 * Permission is asked for at the moment it is needed — when this opens — and
 * not before, so somebody browsing FayTarra is never prompted for their camera
 * out of nowhere.
 *
 * Stopping does not commit anything. It shows the take back, because the first
 * one is usually not the one people want and finding that out on the posting
 * screen means deleting a clip to try again. From there: keep it and carry on to
 * the caption, keep it and film another, or throw it away and re-film. Nothing
 * has left the device at any point in here — it is a blob in this tab until the
 * posting screen uploads it.
 */
interface Take {
  blob: Blob;
  mimeType: string;
  seconds: number;
  url: string;
}

export function VideoRecorder({
  remainingSeconds,
  onRecorded,
  onClose,
}: {
  remainingSeconds: number;
  onRecorded: (clip: { blob: Blob; mimeType: string; seconds: number }) => void;
  onClose: () => void;
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
  const [playing, setPlaying] = useState(false);

  /** The finished take, held here until it is kept or thrown away. */
  const [take, setTake] = useState<Take | null>(null);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  /** Throws away the take being reviewed, and the blob URL holding it. */
  const dropTake = useCallback(() => {
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    takeUrl.current = null;
    setTake(null);
    setPlaying(false);
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

  /** Keeps the take. `andClose` carries on to the caption; otherwise film another. */
  function keep(andClose: boolean) {
    if (!take) return;
    onRecorded({ blob: take.blob, mimeType: take.mimeType, seconds: take.seconds });
    dropTake();
    if (andClose) {
      onClose();
      return;
    }
    // Filming another: the camera was released for the review, so reopen it.
    void open();
  }

  /* ------------------------------------------------------------ the review */

  if (status === 'reviewing' && take) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => {
              dropTake();
              onClose();
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label="Close the camera"
          >
            <CloseIcon />
          </button>
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-white/70">
            {formatSeconds(take.seconds)}
          </span>
          {/* Balances the row so the length stays centred. */}
          <span className="h-11 w-11" aria-hidden />
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <video
            // `key` is not decoration. The viewfinder below is the same shape —
            // a header, a flex-1 box holding a <video>, a control bar — so React
            // reconciles the two branches onto the SAME DOM node and hands this
            // one the viewfinder's element with its `srcObject` still attached.
            // srcObject beats src, so the take played back as a dead camera
            // stream: duration Infinity, nothing seekable, no frames. A distinct
            // key means a distinct element.
            key="take-playback"
            ref={(element) => {
              playback.current = element;
              // Belt and braces. Correctness here should not rest on the
              // reconciler's choices, and clearing this is free when it is
              // already null.
              if (element && element.srcObject) element.srcObject = null;
            }}
            src={take.url}
            playsInline
            controls={false}
            data-recorder-playback
            // A recording has no duration in its header, and until the browser
            // has been made to work one out the element will not reliably play
            // or seek — so this is not cosmetic. See settleDuration.
            onLoadedMetadata={(event) => void settleDuration(event.currentTarget)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            className="h-full w-full object-contain"
          />
          {/* One big target over the video, because a 44px control in the
              corner of a phone screen is not how anybody plays a video back. */}
          <button
            type="button"
            onClick={() => {
              const element = playback.current;
              if (!element) return;
              if (!element.paused) {
                element.pause();
                return;
              }
              // Settling first, because a tap on a recording whose duration is
              // still Infinity is a tap that does nothing.
              void settleDuration(element, 2000).then(() =>
                element.play().catch(() => undefined),
              );
            }}
            aria-label={playing ? 'Pause' : 'Play'}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span
              className={`flex h-20 w-20 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition ${
                playing ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {playing ? <PauseIcon width={30} height={30} /> : <PlayIcon width={30} height={30} />}
            </span>
          </button>
        </div>

        <div className="safe-bottom space-y-3 px-4 pb-3 pt-4">
          <button
            type="button"
            onClick={() => keep(true)}
            className="btn-primary min-h-[56px] w-full py-4"
          >
            <CheckIcon width={18} height={18} /> Use this video
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                dropTake();
                setError(null);
                void open();
              }}
              className="btn-ghost min-h-[48px] py-3"
            >
              <RecordIcon width={16} height={16} /> Re-record
            </button>
            {/* The multi-clip path: keep this one and film the next. Hidden once
                the two minutes are spent, since there is nothing left to film. */}
            <button
              type="button"
              onClick={() => keep(false)}
              disabled={remainingSeconds - take.seconds < 0.5}
              className="btn-ghost min-h-[48px] py-3 disabled:opacity-40"
            >
              Film another
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------- the viewfinder */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => {
            recorderRef.current?.stop();
            stopStream();
            onClose();
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
          aria-label="Close the camera"
        >
          <CloseIcon />
        </button>
        <span
          className={`rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums ${
            status === 'recording' ? 'bg-fay text-ink-950' : 'bg-white/10 text-white/70'
          }`}
        >
          {status === 'recording' ? `${formatSeconds(elapsed)} · ${formatSeconds(left)} left` : `${formatSeconds(remainingSeconds)} left`}
        </span>
        <button
          type="button"
          onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
          disabled={status === 'recording'}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30"
          aria-label="Switch camera"
        >
          <SwitchCameraIcon />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          key="camera-viewfinder"
          ref={preview}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-contain"
          // A selfie camera that is not mirrored is disorienting to film with.
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
        />
        {status === 'starting' && (
          <p className="absolute text-sm text-white/60">Asking for your camera…</p>
        )}
        {error && (
          <div className="absolute inset-x-6 rounded-2xl bg-ink-900/95 p-5 text-center">
            <p className="text-sm text-white/80">{error}</p>
            {status === 'denied' && (
              <button type="button" onClick={() => void open()} className="btn-ghost mt-4 px-5 py-2.5 text-sm">
                Try again
              </button>
            )}
          </div>
        )}
        {!hasMic && status !== 'denied' && (
          <p className="absolute bottom-3 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/70">
            Recording without sound — the microphone is not available.
          </p>
        )}
      </div>

      {/* `safe-bottom` matters here: the app is viewportFit: 'cover', so without
          it the record button sits under an iPhone's home indicator. The shorter
          spacing in landscape keeps the same button reachable when there are only
          a few hundred pixels of height to work with. */}
      <div className="safe-bottom flex items-center justify-center gap-6 px-4 pb-4 pt-5 [@media(max-height:520px)]:pt-2">
        {status === 'recording' ? (
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-fay [@media(max-height:520px)]:h-16 [@media(max-height:520px)]:w-16"
            aria-label="Stop recording"
          >
            <StopIcon width={34} height={34} />
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={status !== 'ready' || remainingSeconds < 0.5}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-fay text-ink-950 disabled:opacity-40 [@media(max-height:520px)]:h-16 [@media(max-height:520px)]:w-16"
            aria-label="Start recording"
          >
            <RecordIcon width={38} height={38} />
          </button>
        )}
      </div>
    </div>
  );
}
