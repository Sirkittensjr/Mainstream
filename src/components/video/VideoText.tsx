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

/**
 * Positions, sizes and tones are fixed sets — see sanitiseMedia.
 *
 * Two sets of insets, because the same overlay has to clear different furniture
 * depending on where it is drawn. In a post or the Videos feed the bottom holds
 * a caption and the action buttons, and the top holds the status bar and the
 * notch. In the EDITOR the bottom is a panel, a clip strip, a scrubber and a
 * tool rail, which is most of the lower third — text pinned 16% up from the
 * bottom there would sit behind the controls while somebody is positioning it,
 * which is the one moment it has to be visible.
 */
const AT: Record<TextOverlay['at'], string> = {
  top: 'items-start pt-[12%]',
  middle: 'items-center',
  bottom: 'items-end pb-[16%]',
};

/**
 * The editor draws this inside the free part of the screen — the area its
 * controls do not cover — so that region is the safe area and these only need to
 * keep text off its very edges. The percentages that used to be here were an
 * attempt to guess how tall whichever panel was open happened to be.
 */
const AT_EDITOR: Record<TextOverlay['at'], string> = {
  top: 'items-start pt-[6%]',
  middle: 'items-center',
  bottom: 'items-end pb-[6%]',
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
  /**
   * `post` is a finished video anywhere it plays. `editor` insets further, to
   * clear the editing controls overlaid on the lower part of the screen.
   */
  variant = 'post',
}: {
  media: Pick<Media, 'text'>;
  className?: string;
  variant?: 'post' | 'editor';
}) {
  const overlays = media.text;
  if (!overlays || overlays.length === 0) return null;
  const spots = variant === 'editor' ? AT_EDITOR : AT;

  return (
    // Over the video and out of the way of it: nothing here takes a tap, so the
    // player's own controls underneath still work.
    <div
      aria-hidden={false}
      data-video-text
      data-video-text-variant={variant}
      className={`pointer-events-none absolute inset-0 z-[5] flex flex-col justify-between px-5 py-4 ${className}`}
    >
      {(['top', 'middle', 'bottom'] as const).map((position) => {
        const here = overlays.filter((overlay) => overlay.at === position);
        if (here.length === 0) return <span key={position} />;
        return (
          <div key={position} className={`flex flex-1 justify-center ${spots[position]}`}>
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
