'use client';

import { useState } from 'react';
import { formatSeconds } from '@/lib/video/limits';
import type { Media } from '@/lib/types';

/**
 * How a video post plays.
 *
 * FayTarra is a general social network, not a vertical-video app, so the shape
 * of the video decides the shape of the post: a landscape clip is letterboxed
 * into nothing, a phone clip stays tall, a square one stays square. The
 * wrapper reserves the right aspect up front from the size recorded at upload,
 * so the feed does not jump as each video loads, and `object-contain` means
 * nothing is ever stretched or cropped to fit a house format.
 *
 * The controls are the browser's own. They are keyboard accessible, they are
 * the ones people already know, and on a phone they are the ones that can
 * actually go fullscreen — a hand-rolled bar would be worse at every one of
 * those and is not what "simple" should cost.
 */
export function VideoPlayer({
  media,
  className = '',
  autoPlayMuted = false,
}: {
  media: Media;
  className?: string;
  autoPlayMuted?: boolean;
}) {
  // Until the file says otherwise, trust what was measured at upload; 4:5 is
  // only ever a placeholder for the moment before the first frame arrives.
  const [ratio, setRatio] = useState<number | null>(
    media.width && media.height ? media.width / media.height : null,
  );

  return (
    <div
      className={`relative mx-auto w-full overflow-hidden rounded-2xl bg-black ${className}`}
      style={{
        aspectRatio: ratio ? `${ratio}` : '4 / 5',
        // A very tall video should not push everything else off the screen,
        // and a very wide one should not become a letterbox slit.
        maxHeight: '72vh',
        maxWidth: ratio && ratio > 1 ? '100%' : `min(100%, ${(ratio ?? 0.8) * 72}vh)`,
      }}
    >
      <video
        src={media.url}
        poster={media.poster}
        controls
        playsInline
        preload="metadata"
        muted={autoPlayMuted}
        autoPlay={autoPlayMuted}
        loop={autoPlayMuted}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setRatio(video.videoWidth / video.videoHeight);
          }
        }}
        className="h-full w-full object-contain"
      />
      {media.duration != null && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/90 backdrop-blur">
          {formatSeconds(media.duration)}
        </span>
      )}
    </div>
  );
}
