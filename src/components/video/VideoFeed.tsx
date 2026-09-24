'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { likeAction } from '@/app/actions';
import { formatCount } from '@/lib/format';
import { isVectorImage } from '@/lib/image';
import { firstVideo } from '@/lib/media';
import { formatVotes } from '@/lib/ratings';
import { timeAgo } from '@/lib/time';
import type { Media } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import type { PostCardData } from '@/components/PostCard';
import { RateButton } from '@/components/RateSheet';
import { ReportDialog } from '@/components/ReportDialog';
import {
  CommentIcon,
  HeartIcon,
  PlayIcon,
  ShareIcon,
  VolumeIcon,
} from '@/components/Icons';

/**
 * The full-screen video feed.
 *
 * Three rules shape this component, and everything else follows from them.
 *
 * One video plays at a time. An IntersectionObserver over the snap container
 * decides which slide is on screen; every other player is paused and rewound,
 * so leaving a clip stops it rather than leaving audio behind.
 *
 * Only what is about to be watched is ever fetched. A slide more than one
 * away from the current one has no <video> element at all — it is its poster
 * and nothing else — so scrolling through thirty clips does not mean thirty
 * downloads. The clip playing is the only one allowed to buffer ahead; the
 * one after it may read its metadata so the first frame is ready.
 *
 * The video keeps its own shape. `object-contain` inside a full-height slide
 * means a phone clip fills the screen, a landscape clip is letterboxed, and
 * neither is ever cropped into a format it was not shot in.
 */
export function VideoFeed({
  items,
  viewerId,
}: {
  items: PostCardData[];
  viewerId: string | null;
}) {
  const [active, setActive] = useState(0);
  // Autoplay is only allowed to start muted, so that is where everybody
  // starts. One tap turns the sound on and it stays on for the session.
  const [muted, setMuted] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const slides = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute('data-index'));
          if (Number.isInteger(index)) setActive(index);
        }
      },
      // Over half the slide has to be showing before it takes over, so a
      // scroll that stops between two clips does not start both.
      { root, threshold: 0.6 },
    );
    for (const slide of slides.current) if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [items.length]);

  const setSlide = useCallback((index: number, node: HTMLElement | null) => {
    slides.current[index] = node;
  }, []);

  return (
    <div className="relative bg-black lg:rounded-3xl lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
        <h1 className="font-display text-lg font-extrabold tracking-tight drop-shadow">Videos</h1>
        <button
          type="button"
          onClick={() => setMuted((value) => !value)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="pointer-events-auto ml-auto rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition active:scale-95"
        >
          <VolumeIcon muted={muted} width={20} height={20} />
        </button>
      </div>

      <div
        ref={scroller}
        tabIndex={-1}
        className="hide-scrollbar h-[calc(100dvh-6rem)] snap-y snap-mandatory overflow-y-scroll overscroll-contain lg:h-[calc(100dvh-2rem)]"
      >
        {items.map((data, index) => {
          const media = firstVideo(data.media);
          if (!media) return null;
          return (
            <Slide
              key={data.id}
              attach={(node) => setSlide(index, node)}
              index={index}
              data={data}
              media={media}
              viewerId={viewerId}
              // Three players at most: the one playing and its neighbours.
              mounted={Math.abs(index - active) <= 1}
              isActive={index === active}
              // Only the clip playing buffers ahead. The next one is allowed
              // to read its header so it starts instantly; nothing else on
              // the queue touches the network.
              preload={index === active ? 'auto' : index === active + 1 ? 'metadata' : 'none'}
              muted={muted}
              onUnmute={() => setMuted(false)}
              last={index === items.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function Slide({
  attach,
  index,
  data,
  media,
  viewerId,
  mounted,
  isActive,
  preload,
  muted,
  onUnmute,
  last,
}: {
  attach: (node: HTMLElement | null) => void;
  index: number;
  data: PostCardData;
  media: Media;
  viewerId: string | null;
  mounted: boolean;
  isActive: boolean;
  preload: 'auto' | 'metadata' | 'none';
  muted: boolean;
  onUnmute: () => void;
  last: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [covered, setCovered] = useState(data.contentWarning === true);
  const [liked, setLiked] = useState(data.liked);
  const [likes, setLikes] = useState(data.likes);
  const router = useRouter();
  const isOwn = viewerId === data.author.id;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (isActive && !covered) {
      // A rejected play() is normal — the browser refuses autoplay until it
      // trusts the page. The poster and the play button stay, and a tap
      // starts it.
      void element.play().catch(() => undefined);
    } else {
      element.pause();
      element.currentTime = 0;
      setProgress(0);
    }
  }, [isActive, mounted, covered]);

  // React will not re-mute a player that has already started, so the mute
  // state is applied to the element itself.
  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  function toggleLike() {
    if (!viewerId) {
      router.push(`/login?next=${encodeURIComponent('/videos')}`);
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikes((value) => value + (next ? 1 : -1));
    void likeAction(data.id).then((result) => {
      if (!result.ok) {
        setLiked(!next);
        setLikes((value) => value + (next ? -1 : 1));
      }
    });
  }

  async function share() {
    const url = `${window.location.origin}/post/${data.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${data.author.displayName} on FayTarra`, url });
        return;
      } catch {
        /* dismissed */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section
      ref={attach}
      data-index={index}
      aria-label={`${data.author.displayName}: ${data.caption || 'video'}`}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {mounted ? (
          <video
            ref={video}
            src={media.url}
            poster={media.poster}
            preload={preload}
            playsInline
            loop
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const element = event.currentTarget;
              if (element.duration > 0) setProgress(element.currentTime / element.duration);
            }}
            className="h-full w-full object-contain"
          />
        ) : media.poster ? (
          <Image
            src={media.poster}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 640px"
            loading="lazy"
            unoptimized={isVectorImage(media.poster)}
            className="object-contain"
          />
        ) : null}
      </div>

      {covered && (
        <button
          type="button"
          onClick={() => setCovered(false)}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-ink-950/85 px-8 text-center backdrop-blur-xl"
        >
          <span className="font-display text-base font-bold">Content warning</span>
          <span className="text-sm text-white/55">
            The author covered this video. Tap to watch.
          </span>
        </button>
      )}

      {/* The whole frame is the play/pause control, the way it is in every
          other video feed. It sits under the overlay so links still win. */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause video' : 'Play video'}
        className="absolute inset-0 z-10 flex items-center justify-center"
      >
        {!playing && (
          <span className="rounded-full bg-black/45 p-5 backdrop-blur-sm">
            <PlayIcon width={36} height={36} />
          </span>
        )}
      </button>

      {muted && isActive && (
        <button
          type="button"
          onClick={onUnmute}
          className="absolute left-1/2 top-[22%] z-20 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-xs font-semibold backdrop-blur"
        >
          Tap for sound
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end gap-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-6 pt-16">
        <div className="pointer-events-auto min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Avatar
              username={data.author.username}
              displayName={data.author.displayName}
              src={data.author.avatarUrl}
              size="sm"
            />
            <div className="min-w-0">
              <Link
                href={`/u/${data.author.username}`}
                className="block truncate text-sm font-semibold leading-tight hover:underline"
              >
                {data.author.displayName}
              </Link>
              <p className="truncate text-[12px] text-white/55">
                @{data.author.username} · {timeAgo(data.createdAt)}
              </p>
            </div>
            {!isOwn && (
              <FollowButton
                userId={data.author.id}
                initialFollowing={data.following}
                signedIn={Boolean(viewerId)}
              />
            )}
          </div>

          {data.caption && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-2.5 block w-full text-left"
            >
              <span
                className={`block whitespace-pre-wrap text-[14px] leading-snug text-white/90 ${
                  expanded ? '' : 'line-clamp-2'
                }`}
              >
                {data.caption}
              </span>
            </button>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link
              href={`/discover?category=${encodeURIComponent(data.category)}`}
              className="chip bg-white/10 hover:bg-white/15"
            >
              {data.category}
            </Link>
            {data.reason && (
              <span className="chip border-transparent bg-white/[0.06] text-white/45">
                {data.reason}
              </span>
            )}
            {last && (
              <Link href="/home" className="chip bg-white/10 hover:bg-white/15">
                That is everything — back to the feed
              </Link>
            )}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-3.5 pb-1">
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? 'Unlike' : 'Like'}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold transition active:scale-95 ${
              liked ? 'text-fay' : 'text-white'
            }`}
          >
            <HeartIcon filled={liked} width={26} height={26} />
            {formatCount(likes)}
          </button>
          <Link
            href={`/post/${data.id}#comments`}
            aria-label="Comments"
            className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white"
          >
            <CommentIcon width={26} height={26} />
            {formatCount(data.comments)}
          </Link>
          <button
            type="button"
            onClick={share}
            aria-label="Share"
            className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white"
          >
            <ShareIcon width={26} height={26} />
            {copied ? 'Copied' : 'Share'}
          </button>
          <div className="flex flex-col items-center gap-1">
            <RateButton
              compact
              targetType="post"
              targetId={data.id}
              rating={data.rating}
              votes={data.ratingVotes}
              myScore={data.myScore}
              myReactions={data.myReactions}
              signedIn={Boolean(viewerId)}
              subject="this video"
            />
            {data.ratingVotes > 0 && (
              <span className="text-[10px] text-white/45">{formatVotes(data.ratingVotes)}</span>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="More options"
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-full px-2 py-1 text-white/70 transition hover:text-white"
            >
              •••
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute bottom-9 right-0 z-40 w-44 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-xl">
                  <Link
                    href={`/post/${data.id}`}
                    className="block px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
                  >
                    Open post
                  </Link>
                  {!isOwn && viewerId && <ReportDialog targetType="post" targetId={data.id} />}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 bg-white/15">
        <div
          className="h-full bg-white/70 transition-[width] duration-200"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
    </section>
  );
}
