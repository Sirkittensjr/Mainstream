import type { Media, TextOverlay } from '@/lib/types';

/**
 * The words somebody put over their video, drawn by the player.
 *
 * Not burnt into the file, and that is the whole point: `needsRender` returns
 * false for an untouched recording, which is the only reason a two-minute take
 * does not cost a two-minute re-encode before it can be uploaded. Text that had
 * to be rendered in would flip that for every video carrying any. Drawn here
 * instead — free, and still editable after the fact.
 *
 * Used by every surface that plays a video, so one overlay looks the same on the
 * post page, in the feed and in the full-screen Videos feed. The editor uses it
 * too, which is what makes the preview honest.
 */

/** Positions, sizes and tones are fixed sets — see sanitiseMedia. */
const AT: Record<TextOverlay['at'], string> = {
  top: 'items-start pt-[12%]',
  middle: 'items-center',
  bottom: 'items-end pb-[16%]',
};

const SIZE: Record<TextOverlay['size'], string> = {
  m: 'text-[15px] leading-snug sm:text-base',
  l: 'text-[22px] leading-tight sm:text-2xl',
};

const TONE: Record<TextOverlay['tone'], string> = {
  light: 'bg-black/45 text-white',
  dark: 'bg-white/85 text-ink-950',
  fay: 'bg-fay/85 text-white',
};

export function VideoText({
  media,
  className = '',
}: {
  media: Pick<Media, 'text'>;
  className?: string;
}) {
  const overlays = media.text;
  if (!overlays || overlays.length === 0) return null;

  return (
    // Over the video and out of the way of it: nothing here takes a tap, so the
    // player's own controls underneath still work.
    <div
      aria-hidden={false}
      data-video-text
      className={`pointer-events-none absolute inset-0 flex flex-col justify-between px-5 py-4 ${className}`}
    >
      {(['top', 'middle', 'bottom'] as const).map((position) => {
        const here = overlays.filter((overlay) => overlay.at === position);
        if (here.length === 0) return <span key={position} />;
        return (
          <div key={position} className={`flex flex-1 justify-center ${AT[position]}`}>
            <div className="flex max-w-full flex-col items-center gap-1.5">
              {here.map((overlay, index) => (
                <p
                  key={`${position}-${index}`}
                  className={`max-w-full break-words rounded-2xl px-3 py-1.5 text-center font-display font-bold backdrop-blur-sm ${SIZE[overlay.size]} ${TONE[overlay.tone]}`}
                >
                  {overlay.text}
                </p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
