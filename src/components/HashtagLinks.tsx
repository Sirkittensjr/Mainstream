import Link from 'next/link';
import { postHashtags, tagHref } from '@/lib/hashtags';

/**
 * How many hashtags from a caption are repeated here as links. A post's own
 * tags are always shown, every one (there are at most eight); a caption's are
 * already on screen in the caption itself, so a long run of them is not
 * repeated in full under it.
 */
const FROM_CAPTION = 4;

/**
 * A post's hashtags, each one a link to its page.
 *
 * Shown as the author wrote them — case and all — and linked by the shared,
 * case-insensitive form, so #Gaming and #gaming open the same page. Used by
 * the post card and the Videos feed alike.
 */
export function HashtagLinks({
  tags,
  caption,
  className = '',
  tone = 'card',
}: {
  tags: readonly string[] | null | undefined;
  caption?: string | null;
  className?: string;
  /** `video` sits over the picture, so it is white with a shadow to stay legible. */
  tone?: 'card' | 'video';
}) {
  let fromCaption = 0;
  const shown = postHashtags({ tags, caption }).filter(
    (tag) => !tag.fromCaption || fromCaption++ < FROM_CAPTION,
  );
  if (shown.length === 0) return null;

  const link =
    tone === 'video'
      ? 'text-white drop-shadow hover:underline'
      : 'text-fay-soft hover:underline';
  return (
    <ul className={`flex flex-wrap gap-x-3 gap-y-0.5 ${className}`} aria-label="Hashtags" data-hashtags>
      {shown.map((tag) => (
        <li key={tag.key ?? tag.label} className="min-w-0 max-w-full">
          {tag.key ? (
            <Link
              href={tagHref(tag.key)}
              data-hashtag={tag.key}
              // A comfortable target on a phone without spacing the line out.
              className={`inline-block max-w-full break-all py-1 text-[14px] font-semibold leading-snug ${link}`}
            >
              #{tag.label}
            </Link>
          ) : (
            <span className="inline-block max-w-full break-all py-1 text-[14px] leading-snug text-white/60">
              #{tag.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
