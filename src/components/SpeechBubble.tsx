import Link from 'next/link';
import { bigStyleOf, previewOf, type BigStyle, type TextKind } from '@/lib/text-posts';

/**
 * What somebody said, drawn as a bubble pointing back at them.
 *
 * ONE SHAPE FOR ALL THREE KINDS. A short message, a story and a big one are the
 * same object with the same corners, the same tail and the same relationship to
 * the avatar above them; what differs is how much room the words get and how
 * loud they are. Three unrelated cards would read as three features rather than
 * one — and the three ARE meant to look different in the feed, which is a
 * difference of surface and type, not of shape.
 *
 * LIGHT ON DARK, which is what makes it read as speech. FayTarra is a dark app
 * and a dark bubble on a dark card is just a paragraph with a border; a light
 * surface is the thing that looks like it was said. Short is plain white, a
 * story is tinted toward its own purple, and a big one is whichever of four
 * treatments its author chose.
 *
 * THE TAIL points up and to the left, at the avatar in the card's header. It is
 * a rotated square tucked under the bubble's corner rather than a border
 * triangle: a square inherits the bubble's own background so the two stay one
 * surface when either changes, and nothing has to be redrawn to match. Border
 * triangles cannot do that — they are two stacked triangles, and they go wrong
 * the moment the surface is a gradient, which for a big message it is.
 *
 * MODERN, NOT COMIC. Soft large radii, no outline, no drop shadow, no pointed
 * cartoon beak.
 *
 * It sizes to its words: an inline-block in a left-aligned row, so a two-word
 * message is a two-word bubble.
 */

/** The surface each kind sits on, and the ink that reads on it. */
const SURFACE: Record<Exclude<TextKind, 'big'>, { bubble: string; tail: string }> = {
  short: { bubble: 'bg-white', tail: 'bg-white' },
  // Tinted toward the purple the chooser gives stories, so the feed says which
  // kind it is before a word is read.
  story: { bubble: 'bg-[#EFE7FF]', tail: 'bg-[#EFE7FF]' },
};

/**
 * The four ways a BIG message can look.
 *
 * `text` is applied to the words, `bubble` to the surface behind them. A
 * gradient on the words needs `bg-clip-text` and a transparent fill, which is
 * why the two cannot share one shape.
 */
export const BIG_LOOKS: Record<BigStyle, { bubble: string; text: string }> = {
  // The quietest: a plain light bubble with the colour on the words.
  glow: {
    bubble: 'bg-white',
    text: 'bg-gradient-to-r from-aura via-fay to-fay bg-clip-text text-transparent',
  },
  // Dark bubble, one bright colour — option A of the brief.
  night: { bubble: 'bg-ink-950', text: 'text-fay' },
  violet: { bubble: 'bg-gradient-to-br from-aura to-fay', text: 'text-white' },
  dusk: { bubble: 'bg-gradient-to-br from-[#38BDF8] to-aura', text: 'text-white' },
};

export function SpeechBubble({
  kind,
  title,
  body,
  style,
  /** The feed clips a story and offers Read more; its own page does not. */
  preview = false,
  postId,
  className = '',
}: {
  kind: TextKind;
  title?: string | null;
  body: string;
  style?: string | null;
  preview?: boolean;
  postId?: string;
  className?: string;
}) {
  const story = kind === 'story';
  const clipped = story && preview ? previewOf(body) : { text: body, clipped: false };
  const look = kind === 'big' ? BIG_LOOKS[bigStyleOf(style)] : null;
  const surface = look ? look.bubble : SURFACE[kind as Exclude<TextKind, 'big'>].bubble;
  const tail = look ? look.bubble : SURFACE[kind as Exclude<TextKind, 'big'>].tail;

  return (
    // The row, not the bubble: this is what keeps the bubble hugging its words
    // instead of stretching to the card.
    <div className={`px-4 pb-3 ${className}`} data-text-post={kind} data-text-style={style ?? ''}>
      <div
        data-speech-bubble
        className={`relative inline-block max-w-full rounded-[1.75rem] ${surface} ${
          kind === 'big' ? 'px-6 py-7' : story ? 'px-5 py-4' : 'px-4 py-3'
        }`}
      >
        {/* The tail: the same surface, rotated 45° and tucked under the corner,
            with its inner edges hidden by the bubble so the two read as one. A
            gradient bubble's tail takes the gradient's own top-left, which is
            where a tail in that corner would be anyway. */}
        <span
          aria-hidden="true"
          data-speech-tail
          className={`absolute -top-[6px] left-6 h-3.5 w-3.5 rotate-45 rounded-[3px] ${tail}`}
        />

        {story && title && (
          <>
            <p
              data-text-title
              className="font-display text-[19px] font-extrabold leading-tight text-ink-950"
            >
              {title}
            </p>
            {/* The rule under the title, as in the reference: it separates the
                two without a second colour or a heavier weight. */}
            <span aria-hidden="true" className="mb-2 mt-2 block h-px bg-ink-950/10" />
          </>
        )}

        {kind === 'big' ? (
          <BigWords text={body} look={look!} />
        ) : (
          <p
            data-text-body
            className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
              story ? 'text-ink-900/80' : 'text-ink-950'
            }`}
          >
            {clipped.text}
            {clipped.clipped && '…'}
          </p>
        )}

        {clipped.clipped && postId && (
          <Link
            href={`/post/${postId}`}
            data-read-more
            className="mt-2.5 inline-flex items-center gap-1 text-[14px] font-bold text-aura hover:underline"
          >
            Read more <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A BIG message: thirty characters at most, set as large as they will go.
 *
 * The size steps down with the length rather than being one size that either
 * overflows or wastes the bubble. Thirty characters at the largest step would
 * run off a phone, and six at the smallest would look like a caption that forgot
 * what it was for — so the steps are measured against the longest WORD as well
 * as the whole length, because one unbreakable 20-character word is what
 * overflows, not twenty characters of short ones.
 *
 * `break-words` and the steps together are what keep it inside: the bubble has
 * no fixed width to overflow, and the longest word can always wrap.
 */
function BigWords({ text, look }: { text: string; look: { text: string } }) {
  const longest = text.split(/\s+/).reduce((most, word) => Math.max(most, word.length), 0);
  const step =
    text.length <= 10 && longest <= 10 ? 'l' : text.length <= 18 && longest <= 12 ? 'm' : 's';
  const size = {
    l: 'text-[46px] sm:text-[60px]',
    m: 'text-[38px] sm:text-[48px]',
    s: 'text-[29px] sm:text-[36px]',
  }[step];

  return (
    <p
      data-text-body
      data-big-step={step}
      className={`break-words text-center font-statement uppercase leading-[0.92] tracking-[0.01em] ${look.text} ${size}`}
    >
      {text}
    </p>
  );
}
