'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { likeAction } from '@/app/actions';
import { formatCount } from '@/lib/progression';
import { timeAgo } from '@/lib/time';
import { formatCap } from '@/lib/shot';
import type { Media, Reaction } from '@/lib/types';
import { RateButton } from './RateSheet';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { LevelBadge } from './LevelBadge';
import { ReportDialog } from './ReportDialog';
import { CommentIcon, HeartIcon, ShareIcon, SparkIcon } from './Icons';

export interface PostCardData {
  id: string;
  caption: string;
  media: Media[];
  category: string;
  tags: string[];
  shot: boolean;
  featured: boolean;
  boosted: boolean;
  views: number;
  createdAt: string;
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  rating: number | null;
  ratingCount: number;
  myScore: number | null;
  myReactions: Reaction[];
  shotProgress: { stage: number; cap: number; progress: number; status: string } | null;
  reason?: string;
  challenge: { slug: string; title: string } | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    level: number;
    levelName: string;
    followers: number;
  };
}

export function PostCard({
  data,
  viewerId,
  compact = false,
}: {
  data: PostCardData;
  viewerId: string | null;
  compact?: boolean;
}) {
  const [liked, setLiked] = useState(data.liked);
  const [likes, setLikes] = useState(data.likes);
  const [burst, setBurst] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const isOwn = viewerId === data.author.id;

  function toggleLike() {
    if (!viewerId) {
      router.push('/login?next=/home');
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikes((value) => value + (next ? 1 : -1));
    if (next) {
      setBurst(true);
      setTimeout(() => setBurst(false), 350);
    }
    startTransition(async () => {
      const result = await likeAction(data.id);
      if (!result.ok) {
        setLiked(!next);
        setLikes((value) => value + (next ? -1 : 1));
      }
    });
  }

  async function share() {
    const url = `${window.location.origin}/post/${data.id}`;
    const shareData = {
      title: `${data.author.displayName} on FayTarra`,
      text: data.caption.slice(0, 120),
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user dismissed the sheet */
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
    <article className="card animate-fade-up overflow-hidden">
      <header className="flex items-start gap-3 p-4 pb-3">
        <Avatar
          username={data.author.username}
          displayName={data.author.displayName}
          src={data.author.avatarUrl}
          ring={data.featured}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/u/${data.author.username}`}
            className="block truncate font-semibold leading-tight hover:underline"
          >
            {data.author.displayName}
          </Link>
          <p className="mt-0.5 truncate text-[13px] text-white/45">
            @{data.author.username} · {timeAgo(data.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!isOwn && (
            <FollowButton
              userId={data.author.id}
              initialFollowing={data.following}
              signedIn={Boolean(viewerId)}
            />
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <LevelBadge level={data.author.level} name={data.author.levelName} size="xs" />
        {data.shot && (
          <span className="chip border-fay/40 bg-fay/10 text-fay-soft">
            <SparkIcon width={13} height={13} /> Give me a shot
          </span>
        )}
        {data.featured && (
          <span className="chip border-solar/40 bg-solar/10 text-solar">Featured</span>
        )}
        {data.challenge && (
          <Link href={`/challenges/${data.challenge.slug}`} className="chip hover:bg-white/10">
            🏆 {data.challenge.title}
          </Link>
        )}
        {data.boosted && (
          <span className="chip border-white/20 bg-white/[0.06] text-white/60">Paid boost</span>
        )}
        <span className="chip border-transparent bg-white/[0.03] text-white/40">
          {data.reason && !data.shot ? `${data.reason} · ` : ''}
          {formatCount(data.author.followers)} followers
        </span>
        {data.views > 0 && (
          <span className="chip border-transparent bg-white/[0.03] text-white/40">
            {formatCount(data.views)} views
          </span>
        )}
      </div>

      {data.shotProgress && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>
              Shot stage {data.shotProgress.stage + 1} · {formatCap(data.shotProgress.cap)}{' '}
              impressions
            </span>
            <span className="capitalize">{data.shotProgress.status}</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-aura to-fay"
              style={{ width: `${Math.max(3, data.shotProgress.progress)}%` }}
            />
          </div>
        </div>
      )}

      {data.caption && (
        <Link href={`/post/${data.id}`} className="block px-4 pb-3">
          <p
            className={`whitespace-pre-wrap text-[15px] leading-relaxed text-white/90 ${
              compact ? 'line-clamp-3' : ''
            }`}
          >
            {data.caption}
          </p>
        </Link>
      )}

      {data.media.length > 0 && <MediaStrip media={data.media} postId={data.id} />}

      <footer className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${
            liked ? 'text-fay' : 'text-white/55 hover:text-white'
          }`}
        >
          <HeartIcon filled={liked} className={burst ? 'animate-pop' : ''} />
          {formatCount(likes)}
        </button>
        <Link
          href={`/post/${data.id}#comments`}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:text-white"
        >
          <CommentIcon />
          {formatCount(data.comments)}
        </Link>
        <button
          type="button"
          onClick={share}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:text-white"
        >
          <ShareIcon />
          {copied ? 'Copied' : 'Share'}
        </button>
        <span className="ml-auto flex items-center pr-1">
          <RateButton
            compact
            targetType="post"
            targetId={data.id}
            rating={data.rating}
            count={data.ratingCount}
            myScore={data.myScore}
            myReactions={data.myReactions}
            signedIn={Boolean(viewerId)}
            subject="this post"
          />
        </span>
        <div className="relative ml-auto">
          <button
            type="button"
            aria-label="More options"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-full px-3 py-2 text-white/40 transition hover:text-white"
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
              <div className="absolute bottom-11 right-0 z-40 w-44 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-xl">
                <Link
                  href={`/post/${data.id}`}
                  className="block px-4 py-2.5 text-sm text-white/70 hover:bg-white/5"
                >
                  Open post
                </Link>
                <button
                  type="button"
                  onClick={share}
                  className="block w-full px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
                >
                  Copy link
                </button>
                {!isOwn && viewerId && <ReportDialog targetType="post" targetId={data.id} />}
              </div>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

function MediaStrip({ media, postId }: { media: Media[]; postId: string }) {
  const [index, setIndex] = useState(0);
  return (
    <div className="relative">
      <div
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {media.map((item, i) => (
          <div key={`${postId}-${i}`} className="w-full shrink-0 snap-center px-2">
            {item.kind === 'video' ? (
              <video
                src={item.url}
                poster={item.poster}
                controls
                playsInline
                className="aspect-[4/5] max-h-[68vh] w-full rounded-2xl bg-ink-850 object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt=""
                loading="lazy"
                className="aspect-[4/5] max-h-[68vh] w-full rounded-2xl bg-ink-850 object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur">
          {media.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === index ? 'bg-white' : 'bg-white/35'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
