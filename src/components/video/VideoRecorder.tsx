'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, RecordIcon, StopIcon, SwitchCameraIcon } from '@/components/Icons';
import { formatSeconds } from '@/lib/video/limits';
import { pickMimeType } from '@/lib/video/render';

/**
 * Recording a clip from the camera.
 *
 * Permission is asked for at the moment it is needed — when this opens — and
 * not before, so somebody browsing FayTarra is never prompted for their camera
 * out of nowhere. Stopping hands the clip back and leaves this open, because
 * recording three clips in a row is the normal case, not the exotic one.
 */
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
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);

  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [status, setStatus] = useState<'starting' | 'ready' | 'recording' | 'denied'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hasMic, setHasMic] = useState(true);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
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
      setStatus('ready');
      setElapsed(0);
      if (chunks.length > 0) {
        onRecorded({ blob: new Blob(chunks, { type: mimeType }), mimeType, seconds });
      }
    });
    recorderRef.current = recorder;
    startedAt.current = Date.now();
    setElapsed(0);
    setStatus('recording');
    recorder.start(1000);
  }

  const left = Math.max(0, remainingSeconds - elapsed);

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

      <div className="flex items-center justify-center gap-6 px-4 pb-10 pt-5">
        {status === 'recording' ? (
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-fay"
            aria-label="Stop recording"
          >
            <StopIcon width={34} height={34} />
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={status !== 'ready' || remainingSeconds < 0.5}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-fay text-ink-950 disabled:opacity-40"
            aria-label="Start recording"
          >
            <RecordIcon width={38} height={38} />
          </button>
        )}
      </div>
    </div>
  );
}
