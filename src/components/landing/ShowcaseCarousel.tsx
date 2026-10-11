'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import { ChevronIcon, HeartIcon, PlayIcon } from '@/components/Icons';
import { RatingPill } from '@/components/RatingPill';
import { slideOffset, type PreviewArt, type ShowcaseCard } from '@/lib/landing';
import { isVectorImage } from '@/lib/image';

/** How far a finger has to travel sideways before it counts as a swipe. */
const SWIPE_PX = 40;
/** Movement smaller than this is still a tap. */
const SLOP_PX = 8;

/**
 * Where a card sits, in card steps from the centre, by how far it is from the
 * active one. The second card out only peeks from behind the first, and its
 * opacity is a variable the stage sets per width: there is no room for it
 * beside the hero's words at 1024.
 */
const PLACE = [0, 1, 1.3, 1.6];
const SCALE = [1, 0.86, 0.72, 0.6];
const OPACITY = ['1', '0.92', 'var(--far)', '0'];

/**
 * The hero's carousel of posts.
 *
 * Every card is laid in the same grid cell and moved sideways, so the stage is
 * exactly as tall as a card with no measuring. Arrows, the dots, the arrow keys
 * and a sideways swipe all move it; it never moves on its own, so there is
 * nothing to pause and nothing to sit through for someone who prefers less
 * motion — and for them the slide between cards is switched off as well.
 *
 * It loads no video. A video post shows its poster, so nothing can play, with
 * or without sound, and pictures load only once their card comes near.
 */
export function ShowcaseCarousel({
  cards,
  art,
}: {
  cards: ShowcaseCard[];
  /** The preview cards' illustrations, drawn on the server so their SVG is not shipped as script. */
  art: Partial<Record<PreviewArt, ReactNode>>;
}) {
  const total = cards.length;
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState(0);
  const [announce, setAnnounce] = useState(false);
  const [near, setNear] = useState<Set<number>>(() => within(0, total));
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; swiping: boolean } | null>(
    null,
  );
  const swiped = useRef(false);

  const go = useCallback(
    (next: number) => {
      if (total === 0) return;
      setActive(((next % total) + total) % total);
      setAnnounce(true);
    },
    [total],
  );

  // Pictures load as their card approaches, and stay loaded once they have.
  useEffect(() => {
    setNear((previous) => {
      const next = within(active, total);
      if ([...next].every((index) => previous.has(index))) return previous;
      return new Set([...previous, ...next]);
    });
  }, [active, total]);

  if (total === 0) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => go(active - 1),
      ArrowRight: () => go(active + 1),
      Home: () => go(0),
      End: () => go(total - 1),
    };
    const move = keys[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, swiping: false };
    swiped.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.swiping) {
      if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
        current.swiping = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } else if (Math.abs(dy) > SLOP_PX) {
        // Scrolling the page, which `touch-action: pan-y` leaves to the browser.
        gesture.current = null;
        return;
      } else {
        return;
      }
    }
    current.dx = dx;
    setDrag(dx);
  };

  const onPointerEnd = (event: React.PointerEvent) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (!current.swiping) return;
    swiped.current = true;
    setDrag(0);
    if (current.dx <= -SWIPE_PX) go(active + 1);
    else if (current.dx >= SWIPE_PX) go(active - 1);
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Posts on FayTarra"
      data-landing-carousel
      onKeyDown={onKeyDown}
      className="relative w-full"
    >
      <div
        data-landing-stage
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(event) => {
          // The click that ends a swipe is not a tap on a card.
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className="relative grid select-none justify-items-center [--far:0.45] [--card:232px] [--step:150px] [touch-action:pan-y] sm:[--card:264px] sm:[--step:186px] lg:[--card:244px] lg:[--far:0] lg:[--step:158px] xl:[--card:276px] xl:[--far:0.45] xl:[--step:184px]"
      >
        {cards.map((card, index) => {
          const offset = slideOffset(index, active, total);
          const depth = Math.min(Math.abs(offset), PLACE.length - 1);
          const isActive = offset === 0;
          const place = Math.sign(offset) * PLACE[depth];
          return (
            <div
              key={card.type === 'post' ? card.id : card.key}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${total}`}
              aria-hidden={!isActive}
              data-landing-slide={index}
              data-active={isActive || undefined}
              onClickCapture={
                isActive
                  ? undefined
                  : (event) => {
                      // A neighbouring card comes to the front rather than opening.
                      event.preventDefault();
                      event.stopPropagation();
                      go(index);
                    }
              }
              className={`w-[var(--card)] [grid-area:1/1] ${
                drag !== 0
                  ? ''
                  : 'transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
              } ${isActive ? '' : 'cursor-pointer'} ${
                depth >= 3 ? 'pointer-events-none' : depth === 2 ? 'lg:max-xl:pointer-events-none' : ''
              }`}
              style={{
                transform: `translateX(calc(${place} * var(--step) + ${drag}px)) scale(${SCALE[depth]})`,
                opacity: OPACITY[depth],
                zIndex: 30 - depth * 10,
              }}
            >
              <Slide
                card={card}
                art={card.type === 'preview' ? art[card.art] : null}
                active={isActive}
                load={near.has(index)}
                eager={index === 0}
              />
            </div>
          );
        })}
      </div>

      {total > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Previous post"
            data-landing-prev
            onClick={() => go(active - 1)}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] bg-white/[0.05] text-white/80 transition hover:bg-white/[0.1] hover:text-white"
          >
            <ChevronIcon direction="left" width={20} height={20} />
          </button>
          <div className="flex items-center" role="group" aria-label="Choose a post">
            {cards.map((card, index) => (
              <button
                key={card.type === 'post' ? card.id : card.key}
                type="button"
                aria-label={`Show post ${index + 1} of ${total}`}
                aria-current={index === active ? 'true' : undefined}
                data-landing-dot={index}
                onClick={() => go(index)}
                className="grid h-8 place-items-center px-1"
              >
                <span
                  className={`block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                    index === active ? 'w-6 bg-gradient-to-r from-aura via-fay to-solar' : 'w-2 bg-white/25'
                  }`}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Next post"
            data-landing-next
            onClick={() => go(active + 1)}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] bg-white/[0.05] text-white/80 transition hover:bg-white/[0.1] hover:text-white"
          >
            <ChevronIcon direction="right" width={20} height={20} />
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite" data-landing-status>
        {announce ? `Post ${active + 1} of ${total}` : ''}
      </p>
    </div>
  );
}

/** The cards within two places of the active one — the ones that can be seen. */
function within(active: number, total: number): Set<number> {
  const out = new Set<number>();
  for (let index = 0; index < total; index += 1) {
    if (Math.abs(slideOffset(index, active, total)) <= 2) out.add(index);
  }
  return out;
}

function Slide({
  card,
  art,
  active,
  load,
  eager,
}: {
  card: ShowcaseCard;
  art: ReactNode;
  active: boolean;
  load: boolean;
  eager: boolean;
}) {
  const preview = card.type === 'preview';
  const href = preview ? '/signup' : `/post/${card.id}`;
  const label = preview
    ? `Preview of a ${card.topic.toLowerCase()} post. Join FayTarra to see real posts like this.`
    : `Open the post by ${card.author.displayName}${card.caption ? `: ${card.caption}` : ''}`;

  return (
    <article
      data-landing-card={card.type}
      className={`relative overflow-hidden rounded-[1.6rem] border bg-ink-900 shadow-[0_32px_64px_-32px_rgba(0,0,0,0.95)] transition-colors ${
        active ? 'border-white/[0.16]' : 'border-white/[0.07]'
      }`}
    >
      <header className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
        {preview ? (
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-aura via-fay to-solar font-display text-xs font-bold text-ink-950"
          >
            {initials(card.topic)}
          </span>
        ) : (
          <Avatar
            username={card.author.username}
            displayName={card.author.displayName}
            src={card.author.avatarUrl}
            size="sm"
            href={false}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {preview ? card.topic : card.author.displayName}
          </p>
          <p className="truncate text-xs text-white/45">
            {preview ? 'Preview post' : `@${card.author.username}`}
          </p>
        </div>
        {!preview && (
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-white/65">
            {card.category}
          </span>
        )}
      </header>

      <div className="relative mx-2.5 aspect-square overflow-hidden rounded-2xl bg-ink-850 sm:aspect-[4/5]">
        {preview ? (
          art
        ) : (
          load && (
            <Image
              src={card.thumb.url}
              alt={
                card.thumb.kind === 'video'
                  ? `Video by @${card.author.username}`
                  : `Photo by @${card.author.username}`
              }
              fill
              sizes="(min-width: 1280px) 280px, (min-width: 640px) 264px, 232px"
              loading={eager ? 'eager' : 'lazy'}
              unoptimized={isVectorImage(card.thumb.url)}
              draggable={false}
              className="object-cover"
            />
          )
        )}
        {!preview && card.thumb.kind === 'video' && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            <PlayIcon width={12} height={12} /> Video
          </span>
        )}
        {preview && (
          <span
            data-landing-preview-badge
            className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur"
          >
            Preview
          </span>
        )}
      </div>

      <div className="px-3.5 pb-3.5 pt-3">
        <p className="line-clamp-2 min-h-10 text-[13px] leading-5 text-white/80">
          {card.caption || `A post in ${card.category}`}
        </p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {preview ? (
            <>
              <RatingPill value={card.exampleRating} label="Example" size="sm" />
              <span className="text-[11px] text-white/40">Rated out of 10</span>
            </>
          ) : (
            <>
              {card.rating !== null ? (
                <RatingPill value={card.rating} votes={card.votes} size="sm" />
              ) : (
                <span className="text-[11px] text-white/45">Not rated yet</span>
              )}
              {card.likes > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-white/55">
                  <HeartIcon width={14} height={14} />
                  <span className="sr-only">Likes:</span> {card.likes}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <Link
        href={href}
        aria-label={label}
        tabIndex={active ? undefined : -1}
        draggable={false}
        data-landing-open
        className="absolute inset-0 z-10 rounded-[1.6rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fay"
      />
    </article>
  );
}

function initials(topic: string): string {
  return topic
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
