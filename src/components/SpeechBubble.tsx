import Link from 'next/link';
import { previewOf, type TextKind } from '@/lib/text-posts';

/**
 * What somebody said, drawn as a bubble pointing back at them.
 *
 * ONE SHAPE FOR ALL THREE KINDS. A short message, a long one and a big one are
 * the same object with the same corners, the same surface and the same tail;
 * what differs is how much room the words get and how loud they are. That is
 * the point of the component existing at all — three kinds drawn by three
 * unrelated cards would read as three features rather than one.
 *
 * THE TAIL points up and to the left, at the avatar in the card's header, which
 * is what makes the words read as something that person is saying rather than a
 * block of text that happens to sit under their name. It is a rotated square
 * tucked under the bubble's top-left corner rather than a border triangle: a
 * square inherits the bubble's own background and border, so the two stay one
 * surface when either changes, and nothing has to be redrawn to match. Border
 * triangles cannot do that — they are two triangles stacked, and they go wrong
 * the moment the surface is translucent.
 *
 * MODERN, NOT COMIC. Soft large radii, a single hairline border, the app's own
 * translucent surface. No outline, no drop shadow, no pointed cartoon beak.
 *
 * It sizes to its words. The bubble is an inline-block inside a left-aligned
 * row, so a two-word message is a two-word bubble and nothing is padded out to
 * a fixed width.
 */

export function SpeechBubble({
  kind,
  title,
  body,
  /** The feed clips a long message and offers Read more; the post page does not. */
  preview = false,
  postId,
  className = '',
}: {
  kind: TextKind;
  title?: string | null;
  body: string;
  preview?: boolean;
  postId?: string;
  className?: string;
}) {
  const long = kind === 'long';
  const clipped = long && preview ? previewOf(body) : { text: body, clipped: false };

  return (
    // The row, not the bubble: this is what keeps the bubble hugging its words
    // instead of stretching to the card.
    <div className={`px-4 pb-3 ${className}`} data-text-post={kind}>
      <div
        data-speech-bubble
        className={`relative inline-block max-w-full rounded-[1.75rem] border border-white/10 bg-white/[0.06] ${
          kind === 'big' ? 'px-6 py-7' : 'px-4 py-3'
        }`}
      >
        {/* The tail. Same background and border as the bubble, rotated 45° and
            tucked under its corner, with the two inner edges hidden by the
            bubble itself so it reads as one surface with a point on it. */}
        <span
          aria-hidden="true"
          data-speech-tail
          className="absolute -top-[7px] left-5 h-3.5 w-3.5 rotate-45 rounded-[3px] border-l border-t border-white/10 bg-white/[0.06]"
        />

        {long && title && (
          <p
            data-text-title
            className="mb-1.5 font-display text-[17px] font-bold leading-tight text-white"
          >
            {title}
          </p>
        )}

        {kind === 'big' ? (
          <BigWords text={body} />
        ) : (
          <p
            data-text-body
            className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-white/90 ${
              long ? 'text-white/75' : ''
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
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-fay hover:underline"
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
 * run off a phone, and six characters at the smallest would look like a caption
 * that forgot what it was for — so the steps are chosen against the longest
 * line, which is what actually decides whether it fits.
 *
 * `break-words` and the steps together are what keep it inside the bubble: the
 * bubble has no fixed width to overflow, and the longest word can always wrap.
 */
function BigWords({ text }: { text: string }) {
  const longest = text.split(/\s+/).reduce((most, word) => Math.max(most, word.length), 0);
  // Measured against the LONGEST WORD as well as the whole length: one
  // unbreakable 20-character word is what overflows a phone, not twenty
  // characters of short ones.
  const step =
    text.length <= 10 && longest <= 10 ? 'l' : text.length <= 18 && longest <= 12 ? 'm' : 's';
  const size = {
    l: 'text-[44px] sm:text-[56px]',
    m: 'text-[36px] sm:text-[44px]',
    s: 'text-[28px] sm:text-[34px]',
  }[step];

  return (
    <p
      data-text-body
      data-big-step={step}
      className={`break-words text-center font-statement uppercase leading-[0.95] tracking-[0.02em] text-white ${size}`}
    >
      {text}
    </p>
  );
}
