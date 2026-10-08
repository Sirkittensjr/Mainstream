'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { likeAction } from '@/app/actions';
import { formatCount } from '@/lib/format';
import { isVectorImage } from '@/lib/image';
import { formatVotes } from '@/lib/ratings';
import { timeAgo } from '@/lib/time';
import { VideoPlayer } from './VideoPlayer';
import { AdminBadge } from './AdminBadge';
import type { Media, Reaction } from '@/lib/types';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { RateButton } from './RateSheet';
import { DeletePost } from './DeletePost';
import { ReportDialog } from './ReportDialog';
import { CommentIcon, EyeIcon, HeartIcon, ShareIcon } from './Icons';
import { SpeechBubble } from './SpeechBubble';
import { drawnAs } from '@/lib/text-posts';

export interface PostCardData {
  id: string;
  caption: string;
  media: Media[];
  category: string;
  tags: string[];
  views: number;
  /**
   * How many times the video on this post has been watched, as the database
   * holds it. Zero on a post with no video — a photo has nothing to play.
   */
  videoViews: number;
  createdAt: string;
  /** Which of the three shapes a text post is. Null for a post with media. */
  textKind?: 'short' | 'story' | 'big' | 'long' | null;
  /** A story's title. */
  textTitle?: string | null;
  /** How a big message is coloured. */
  textStyle?: string | null;
  /** The author asked for this to stay covered until somebody taps it. */
  contentWarning?: boolean;
  /** A moderator removed it. Only its author and moderators ever see such a post. */
  removed?: boolean;
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  rating: number | null;
  ratingVotes: number;
  myScore: number | null;
  myReactions?: Reaction[];
  reason?: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    followers: number;
    rating: number | null;
    /** Decided on the server from the role column. Never the raw role. */
    isAdmin?: boolean;
  };
}

export function PostCard({
  data,
  viewerId,
  compact = false,
  full = false,
}: {
  data: PostCardData;
  viewerId: string | null;
  compact?: boolean;
  /**
   * This is the post's own page, so a long message is shown whole.
   *
   * Defaulted to false rather than keyed off `compact`, which no list passes:
   * every surface that shows a card in a list — Home, Following, Recommended,
   * Discover, Profile, Search — gets the preview without having to ask for it,
   * and the one page that should show everything says so.
   */
  full?: boolean;
}) {
  const [liked, setLiked] = useState(data.liked);
  const [likes, setLikes] = useState(data.likes);
  const [burst, setBurst] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Deleted by its author from this card: off the screen at once. */
  const [deleted, setDeleted] = useState(false);
  /** Which bubble this post is, or null when it is a post with media. */
  const bubble = drawnAs({
    text_kind: data.textKind,
    caption: data.caption,
    media: data.media,
  });
  /**
   * The watch count, which the server rendered and the player updates.
   *
   * Only a video post has one. It is a different number from `views`, which
   * counts the post page being opened and has always been shown here.
   */
  const [videoViews, setVideoViews] = useState(data.videoViews);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const isOwn = viewerId === data.author.id;
  const isVideo = data.media.some((item) => item.kind === 'video');

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

  if (deleted) return null;

  return (
    <article className="card animate-fade-up overflow-hidden">
      <header className="flex items-start gap-3 p-4 pb-3 lg:gap-3.5 lg:px-5 lg:pt-5">
        <Avatar
          username={data.author.username}
          displayName={data.author.displayName}
          src={data.author.avatarUrl}
        />
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/u/${data.author.username}`}
              className="truncate font-semibold leading-tight hover:underline lg:text-[16px]"
            >
              {data.author.displayName}
            </Link>
            {data.author.isAdmin && <AdminBadge />}
          </span>
          <p className="mt-0.5 truncate text-[13px] text-white/45 lg:text-[13.5px]">
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
      </header>

      {(data.reason || data.category) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 lg:px-5">
          <Link
            href={`/discover?category=${encodeURIComponent(data.category)}`}
            className="chip hover:bg-white/10"
          >
            {data.category}
          </Link>
          {data.reason && (
            <span className="chip border-transparent bg-white/[0.03] text-white/40">
              {data.reason}
            </span>
          )}
        </div>
      )}

      {/* A text post is its words in a bubble pointing at the avatar above; a
          caption on a post that has media is still a caption. `drawnAs` decides
          which, and answers 'short' for a text post written before kinds
          existed — so every post already in the database gains the bubble
          without being touched. */}
      {bubble ? (
        <SpeechBubble
          kind={bubble}
          title={data.textTitle}
          body={data.caption}
          style={data.textStyle}
          preview={!full}
          postId={data.id}
          className="lg:px-5"
        />
      ) : (
        data.caption && (
          <Link href={`/post/${data.id}`} className="block px-4 pb-3 lg:px-5 lg:pb-4">
            <p
              className={`whitespace-pre-wrap text-[15px] leading-relaxed text-white/90 lg:text-base ${
                compact ? 'line-clamp-3' : ''
              }`}
            >
              {data.caption}
            </p>
          </Link>
        )
      )}

      {data.media.length > 0 && (
        <MediaStrip
          media={data.media}
          postId={data.id}
          author={data.author.username}
          warned={data.contentWarning === true}
          videoViews={videoViews}
          onVideoViews={setVideoViews}
        />
      )}

      <footer className="flex items-center gap-1 px-2 py-2 lg:mt-1 lg:border-t lg:border-white/[0.06] lg:px-3 lg:py-2.5">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition lg:hover:bg-white/[0.06] ${
            liked ? 'text-fay' : 'text-white/55 hover:text-white'
          }`}
        >
          <HeartIcon filled={liked} className={burst ? 'animate-pop' : ''} />
          {formatCount(likes)}
        </button>
        <Link
          href={`/post/${data.id}#comments`}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:text-white lg:hover:bg-white/[0.06]"
          aria-label="Comments"
        >
          <CommentIcon />
          {formatCount(data.comments)}
        </Link>
        <button
          type="button"
          onClick={share}
          aria-label="Share"
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:text-white lg:hover:bg-white/[0.06]"
        >
          <ShareIcon />
          {copied && <span className="text-xs">Copied</span>}
        </button>
        {/* A video shows how many times it has been WATCHED; everything else
            shows how many times the post has been opened. Two different
            questions, so never both at once, and a photo never gets a watch
            count it could not have earned. */}
        {isVideo
          ? videoViews > 0 && (
              <span
                className="hidden items-center gap-1.5 px-2 text-xs text-white/30 sm:flex"
                data-video-views
                title={`${videoViews.toLocaleString()} ${videoViews === 1 ? 'view' : 'views'}`}
              >
                <EyeIcon width={15} height={15} />
                {formatCount(videoViews)}
              </span>
            )
          : data.views > 0 && (
              <span className="hidden items-center gap-1.5 px-2 text-xs text-white/30 sm:flex">
                <EyeIcon width={15} height={15} />
                {formatCount(data.views)}
              </span>
            )}

        <span className="ml-auto flex items-center gap-1">
          {data.ratingVotes > 0 && (
            <span className="hidden text-[11px] text-white/30 sm:inline">
              {formatVotes(data.ratingVotes)}
            </span>
          )}
          <RateButton
            compact
            targetType="post"
            targetId={data.id}
            rating={data.rating}
            votes={data.ratingVotes}
            myScore={data.myScore}
            myReactions={data.myReactions}
            signedIn={Boolean(viewerId)}
            subject="this post"
          />
          <div className="relative">
            <button
              type="button"
              aria-label="More options"
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-full px-2.5 py-2 text-white/40 transition hover:text-white"
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
                  {/* The author's own post, unless a moderator removed it —
                      that one stays as the record. The server holds both
                      rules whatever this shows. */}
                  {isOwn && !data.removed && (
                    <DeletePost
                      postId={data.id}
                      // `full` is the post's own page, which has nothing left
                      // to show once the post is gone.
                      then={full ? 'profile' : undefined}
                      onDeleted={() => {
                        setMenuOpen(false);
                        setDeleted(true);
                      }}
                      onCancel={() => setMenuOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </span>
      </footer>
    </article>
  );
}

function MediaStrip({
  media,
  postId,
  author,
  warned,
  videoViews = 0,
  onVideoViews,
}: {
  media: Media[];
  postId: string;
  /** Whose post, so a screen reader can say whose photo it is. */
  author: string;
  warned: boolean;
  /** The watch count as the server rendered it, handed to the player. */
  videoViews?: number;
  onVideoViews?: (count: number) => void;
}) {
  const [index, setIndex] = useState(0);
  // The cover is in front of the media rather than instead of it: the post,
  // its caption and everything under it read normally, and one tap gets to
  // what the author flagged.
  const [covered, setCovered] = useState(warned);
  return (
    <div className="relative">
      {covered && (
        <button
          type="button"
          onClick={() => setCovered(false)}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-ink-950/80 px-6 text-center backdrop-blur-xl"
        >
          <span className="font-display text-sm font-bold">Content warning</span>
          <span className="text-xs text-white/55">
            {media[0]?.kind === 'video' ? 'The author covered this video.' : 'The author covered this.'}{' '}
            Tap to view.
          </span>
        </button>
      )}
      <div
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {media.map((item, i) => (
          <div key={`${postId}-${i}`} className="w-full shrink-0 snap-center px-2 lg:px-3">
            {item.kind === 'video' ? (
              <VideoPlayer
                media={item}
                // With the post id the player reports a watch once somebody
                // actually plays it. A covered post is mounted but never
                // autoplays, so nothing behind a content warning can be
                // counted as watched without a deliberate press of play.
                postId={postId}
                views={videoViews}
                onViewCount={onVideoViews}
              />
            ) : (
              // Sized to the column it lands in rather than to whatever came
              // off the camera: a feed of full-resolution phone photos is the
              // single heaviest thing a phone has to download here.
              <div className="relative aspect-[4/5] max-h-[68vh] w-full overflow-hidden rounded-2xl bg-ink-850 lg:max-h-[78vh]">
                <Image
                  src={item.url}
                  alt={
                    media.length > 1
                      ? `Photo ${i + 1} of ${media.length} by @${author}`
                      : `Photo by @${author}`
                  }
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 640px, 760px"
                  // The first card is usually on screen before anything is
                  // scrolled, so it is worth fetching straight away; the rest
                  // wait until they are approached.
                  priority={i === 0 && index === 0}
                  loading={i === 0 && index === 0 ? undefined : 'lazy'}
                  unoptimized={isVectorImage(item.url)}
                  className="h-full w-full object-cover"
                />
              </div>
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
