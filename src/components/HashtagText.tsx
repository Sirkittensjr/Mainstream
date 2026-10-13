'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { hashtagHref, splitHashtags } from '@/lib/hashtags';

/**
 * How a hashtag link is coloured against what it sits on: the dark cards and
 * overlays, a light speech bubble, or a coloured one where it keeps the
 * bubble's own colour and is told apart by weight and underline.
 */
const TONES = {
  dark: 'text-fay-soft',
  light: 'text-fay-deep',
  inherit: 'underline decoration-current/50 underline-offset-2',
  /** Styled entirely by the caller — a chip. */
  plain: '',
} as const;

export type HashtagTone = keyof typeof TONES;

/**
 * A link to one hashtag's page, and to nothing else.
 *
 * Hashtags sit inside things that are themselves tappable — a card that opens
 * its post, a video that pauses when tapped, a caption that expands — so the
 * click stops here: whatever is around the link never hears it, and tapping a
 * hashtag can only ever open the hashtag. The browser still follows the link
 * itself, so a new tab, a middle click and a long press work as for any link.
 */
export function HashtagLink({
  tag,
  children,
  tone = 'dark',
  className = '',
}: {
  /** The hashtag, in any capitalisation. The link goes to its one page. */
  tag: string;
  children: React.ReactNode;
  tone?: HashtagTone;
  className?: string;
}) {
  return (
    <Link
      href={hashtagHref(tag)}
      data-hashtag-link={tag.toLowerCase()}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={`pointer-events-auto relative z-10 ${tone === 'plain' ? '' : 'font-semibold hover:underline'} ${TONES[tone]} ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * Text with every #hashtag in it a link to that hashtag's page.
 *
 * Exactly the text it is given, character for character; only the hashtags
 * become links. What counts as a hashtag is lib/hashtags.ts's to say, so a
 * link here always goes to a page the hashtag is actually filed under.
 */
export function HashtagText({ text, tone = 'dark' }: { text: string; tone?: HashtagTone }) {
  const parts = splitHashtags(text);
  if (!parts.some((part) => part.hashtag)) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.hashtag ? (
          <HashtagLink key={index} tag={part.hashtag.tag} tone={tone}>
            {part.text}
          </HashtagLink>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** A post's tags that are not already written in its words, as hashtag chips. */
export function HashtagChips({
  tags,
  className = '',
}: {
  tags: { tag: string; display: string }[];
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((hashtag) => (
        <HashtagLink
          key={hashtag.tag}
          tag={hashtag.tag}
          tone="plain"
          className={`chip font-medium hover:bg-white/10 hover:no-underline ${className}`}
        >
          #{hashtag.display}
        </HashtagLink>
      ))}
    </>
  );
}
