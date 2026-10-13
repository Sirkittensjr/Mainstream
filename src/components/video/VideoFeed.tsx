'use client';
import { AdminBadge } from '@/components/AdminBadge';

import Image from 'next/image';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
import { DeletePost } from '@/components/DeletePost';
import { ReportDialog } from '@/components/ReportDialog';
import { AdminRemovePost } from '@/components/AdminRemovePost';
import { useViewerIsAdmin } from '@/components/ViewerRole';
import { HashtagChips, HashtagText } from '@/components/HashtagText';
import { extraTags } from '@/lib/hashtags';
import {
  claimAudio,
  classifyPlayError,
  readSoundChoice,
  readyForSound,
  saveSoundChoice,
  type SoundChoice,
} from '@/lib/video/sound';
import { useVideoView } from './useVideoView';
import { VideoComments, type CommenterInfo, type VideoComment } from './VideoComments';
import { VideoText } from './VideoText';
import {
  CommentIcon,
  EyeIcon,
  HeartIcon,
  PlayIcon,
  ShareIcon,
  VolumeIcon,
} from '@/components/Icons';

/**
 * Where the last video points by default. A constant, not a default written
 * into the parameter list: that would be a new object on every render, and
 * every slide would re-render with it.
 */
const BACK_TO_FEED = { href: '/home', label: 'That is everything — back to the feed' };

/**
 * The links laid over a clip — its author, hashtags, category — are not
 * prefetched. Next fetches every link that scrolls into view, and in a feed
 * that is three or four new requests to the server with every swipe, each
 * competing with the video for a phone's connection. A tap still goes
 * straight there; it just is not fetched before anybody asks.
 */
const NO_PREFETCH = false;

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
  viewer = null,
  title = 'Videos',
  end = BACK_TO_FEED,
  returnTo = '/videos',
}: {
  items: PostCardData[];
  viewerId: string | null;
  /** Who is watching, for the row their own comment appears as. */
  viewer?: CommenterInfo | null;
  /** What this feed is: "Videos", or a hashtag on its own page. */
  title?: string;
  /** Where the last video points once there is nothing after it. */
  end?: { href: string; label: string };
  /** Where signing in from here comes back to. */
  returnTo?: string;
}) {
  const [active, setActive] = useState(0);
  /** Videos their author deleted from this feed: gone from it at once. */
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const shown = useMemo(() => items.filter((item) => !deleted.has(item.id)), [items, deleted]);
  /**
   * What the viewer wants, and what the browser has allowed.
   *
   * The intended experience is sound, so unless the viewer has turned it off
   * every clip asks to play with it (lib/video/sound.ts). Safari — and Chrome,
   * on a page nobody has touched yet — can refuse that, and the refusal
   * arrives as a play() rejected with NotAllowedError: the slide then plays
   * muted instead, says so here by setting `blocked`, and shows "Tap for
   * sound". That tap is the interaction those policies were waiting for: it
   * turns the sound on inside the tap itself, and readies every other player
   * in the feed for sound so the clips after it keep it.
   *
   * The choice is the viewer's and is remembered (localStorage): turning the
   * sound off is never undone by the feed, on this page or the next. The page
   * is rendered before that can be read, so `choice` catches up after
   * hydration; a slide starting playback reads the stored choice itself, so a
   * viewer who muted yesterday does not hear the first second of today's first
   * clip, and nothing waits for a re-render before it starts.
   */
  const [choice, setChoice] = useState<SoundChoice>('on');
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setChoice(readSoundChoice());
  }, []);
  const muted = choice === 'off' || blocked;
  /**
   * Whether every slide keeps a player element, rather than only the slide on
   * screen and its neighbours. Off until somebody taps for sound — the page
   * starts exactly as light as it always has — and then on for good: Safari
   * readies an element for sound once, inside a tap, and the clips further
   * down need theirs to exist in that tap to be readied with it.
   */
  const [keepPlayers, setKeepPlayers] = useState(false);
  /** Every slide's player, by post, and whether its creator posted it silent. */
  const players = useRef(new Map<string, { element: HTMLVideoElement; silent: boolean }>());
  /** Players already readied for sound inside a tap (see readyForSound). */
  const readied = useRef(new WeakSet<HTMLMediaElement>());
  const registerPlayer = useCallback((postId: string, element: HTMLVideoElement | null, silent: boolean) => {
    if (element) players.current.set(postId, { element, silent });
    else players.current.delete(postId);
  }, []);
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
  }, [shown.length]);

  const setSlide = useCallback((index: number, node: HTMLElement | null) => {
    slides.current[index] = node;
  }, []);

  /**
   * Comments, opened over the video rather than on another page.
   *
   * The sheet is one instance for the whole feed, and what it has loaded is
   * kept here by post id: nothing is fetched until somebody opens a video's
   * comments, and opening the same one again costs nothing. Opening it
   * touches no player, so the video behind carries on exactly as it was.
   */
  const [openFor, setOpenFor] = useState<string | null>(null);
  /** Comment counts that have moved since the page was rendered. */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, VideoComment[]>>({});
  const [loading, setLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  useEffect(() => {
    if (!openFor || comments[openFor]) return;
    let cancelled = false;
    setLoading(true);
    setCommentsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/posts/${openFor}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load the comments.');
        const payload = (await response.json()) as { comments?: VideoComment[] };
        if (cancelled) return;
        setComments((current) => ({ ...current, [openFor]: payload.comments ?? [] }));
      } catch {
        if (!cancelled) setCommentsError('Could not load the comments. Try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openFor, comments]);

  // Stable, because a slide re-runs its playback effect when these change —
  // and because a slide only re-renders when one of its props does, so a
  // swipe re-renders the two or three slides it actually changes rather than
  // all thirty.
  const handleBlocked = useCallback(() => setBlocked(true), []);
  /**
   * Sound on, from a tap — so it runs inside the tap, where every browser
   * allows it: the clip on screen is unmuted and played right here rather than
   * after a re-render, and the other players are readied for sound.
   */
  const enableSound = useCallback((postId: string | null) => {
    const player = postId ? players.current.get(postId) : undefined;
    if (player && !player.silent) {
      player.element.muted = false;
      if (player.element.paused) void player.element.play().catch(() => undefined);
    }
    // Every slide's player, created now — synchronously, still inside the tap
    // — so that all of them can be readied for sound by it.
    flushSync(() => setKeepPlayers(true));
    readyForSound(
      [...players.current.values()].map((entry) => entry.element),
      readied.current,
    );
    saveSoundChoice('on');
    setChoice('on');
    setBlocked(false);
  }, []);
  /** Sound off, from a tap. Remembered, and never undone by the feed. */
  const disableSound = useCallback((postId: string | null) => {
    const player = postId ? players.current.get(postId) : undefined;
    if (player) player.element.muted = true;
    saveSoundChoice('off');
    setChoice('off');
  }, []);
  const openComments = useCallback((postId: string) => setOpenFor(postId), []);
  const removeVideo = useCallback(
    (postId: string) => setDeleted((current) => new Set(current).add(postId)),
    [],
  );

  return (
    <div className="relative bg-black lg:rounded-3xl lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8">
        <h1 className="min-w-0 truncate font-display text-lg font-extrabold tracking-tight drop-shadow">{title}</h1>
        <button
          type="button"
          onClick={(event) => {
            // This tap is a control, not a tap on the video: it must not
            // reach the play/pause layer underneath.
            event.stopPropagation();
            const onScreen = shown[active]?.id ?? null;
            if (muted) enableSound(onScreen);
            else disableSound(onScreen);
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={!muted}
          className="pointer-events-auto ml-auto flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-2.5 text-white backdrop-blur transition active:scale-95"
        >
          <VolumeIcon muted={muted} width={20} height={20} />
          <span className="text-[11px] font-semibold">{muted ? 'Sound off' : 'Sound on'}</span>
        </button>
      </div>

      <div
        ref={scroller}
        tabIndex={-1}
        className="hide-scrollbar h-[calc(100dvh-6rem)] snap-y snap-mandatory overflow-y-scroll overscroll-contain lg:h-[calc(100dvh-2rem)]"
      >
        {shown.map((data, index) => {
          const media = firstVideo(data.media);
          if (!media) return null;
          return (
            <Slide
              key={data.id}
              attach={setSlide}
              index={index}
              data={data}
              media={media}
              viewerId={viewerId}
              // Three players at most: the one playing and its neighbours.
              // Those three are also the only slides drawn in full — the
              // rest are their poster until a swipe brings them close.
              mounted={Math.abs(index - active) <= 1}
              isActive={index === active}
              // Only the clip playing buffers ahead. The next one is allowed
              // to read its start so it plays the moment it is swiped to;
              // nothing else on the queue touches the network.
              preload={index === active ? 'auto' : index === active + 1 ? 'metadata' : 'none'}
              keepPlayer={keepPlayers}
              muted={muted}
              soundBlocked={blocked && choice === 'on'}
              commentCount={counts[data.id] ?? data.comments}
              onOpenComments={openComments}
              onBlocked={handleBlocked}
              onEnableSound={enableSound}
              onPlayer={registerPlayer}
              onDeleted={removeVideo}
              last={index === shown.length - 1}
              end={end}
              returnTo={returnTo}
            />
          );
        })}
      </div>

      {openFor && (
        <VideoComments
          postId={openFor}
          comments={comments[openFor] ?? null}
          loading={loading}
          error={commentsError}
          viewer={viewer}
          returnTo={returnTo}
          onClose={() => setOpenFor(null)}
          onDeleted={(commentId, removed) => {
            setComments((current) => ({
              ...current,
              [openFor]: (current[openFor] ?? []).filter((comment) => comment.id !== commentId),
            }));
            setCounts((current) => ({
              ...current,
              [openFor]: Math.max(
                0,
                (current[openFor] ?? items.find((item) => item.id === openFor)?.comments ?? 0) - removed,
              ),
            }));
          }}
          onPosted={(comment) => {
            setComments((current) => ({
              ...current,
              [openFor]: [...(current[openFor] ?? []), comment],
            }));
            setCounts((current) => ({
              ...current,
              [openFor]: (current[openFor] ?? items.find((item) => item.id === openFor)?.comments ?? 0) + 1,
            }));
          }}
        />
      )}
    </div>
  );
}

const Slide = memo(function Slide({
  attach,
  index,
  data,
  media,
  viewerId,
  mounted,
  isActive,
  preload,
  keepPlayer,
  muted,
  soundBlocked,
  commentCount,
  onOpenComments,
  onBlocked,
  onEnableSound,
  onPlayer,
  onDeleted,
  last,
  end,
  returnTo,
}: {
  attach: (index: number, node: HTMLElement | null) => void;
  index: number;
  data: PostCardData;
  media: Media;
  viewerId: string | null;
  mounted: boolean;
  isActive: boolean;
  preload: 'auto' | 'metadata' | 'none';
  /** Keep a player element even while far away (see `keepPlayers`). */
  keepPlayer: boolean;
  muted: boolean;
  /** Sound is wanted but the browser refused it: "Tap for sound" is shown. */
  soundBlocked: boolean;
  commentCount: number;
  onOpenComments: (postId: string) => void;
  /** Autoplay with sound was refused, so everything from here plays muted. */
  onBlocked: () => void;
  /** A tap asking for sound, for the clip with this post id. */
  onEnableSound: (postId: string | null) => void;
  /** This slide's player element, for the feed to ready for sound. */
  onPlayer: (postId: string, element: HTMLVideoElement | null, silent: boolean) => void;
  /** Its author deleted it. */
  onDeleted: (postId: string) => void;
  last: boolean;
  end: { href: string; label: string };
  returnTo: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  /** The creator posted it without sound: no viewer choice turns it on. */
  const silent = media.muted === true;
  /**
   * Whether this player should be muted. The stored choice as well as the
   * feed's: just after the page loads, the feed has not caught up with what
   * the viewer chose last time (see VideoFeed), and a viewer who turned the
   * sound off must not hear a moment of the first clip.
   */
  const quiet = useCallback(() => muted || silent || readSoundChoice() === 'off', [muted, silent]);
  const attachHere = useCallback((node: HTMLElement | null) => attach(index, node), [attach, index]);
  const attachPlayer = useCallback(
    (node: HTMLVideoElement | null) => {
      video.current = node;
      onPlayer(data.id, node, silent);
    },
    [onPlayer, data.id, silent],
  );
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  /**
   * The playhead in seconds, for timed text. Kept apart from `progress`
   * because a browser-recorded WebM often reports `duration` as Infinity, which
   * made `progress` — and with it every line's timing — stick at zero.
   */
  const [seconds, setSeconds] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [covered, setCovered] = useState(data.contentWarning === true);
  const [liked, setLiked] = useState(data.liked);
  const [likes, setLikes] = useState(data.likes);
  const router = useRouter();
  const isOwn = viewerId === data.author.id;
  const viewerIsAdmin = useViewerIsAdmin();

  /**
   * The view count, and the one thing in this slide that reports a view.
   *
   * Not the IntersectionObserver, and not mounting: a slide becoming the
   * active one is the feed deciding to try playing it, which is not the same
   * as somebody watching it — autoplay can be refused, a scroll can pass
   * through four slides in a second, and a slide next to the current one
   * mounts its player without ever playing. A view is the clip actually
   * starting to play, which is why this hangs off the player's own events.
   * Leaving the slide ends that viewing; coming back to it is another.
   */
  const watch = useVideoView({
    postId: data.id,
    enabled: true,
    duration: media.duration,
    initialCount: data.videoViews,
  });
  const { restart: endViewing } = watch;

  useEffect(() => {
    const element = video.current;
    if (!isActive || covered || !mounted) {
      // Scrolled away (or covered): this viewing is over, and playing it again
      // when somebody comes back is a new one.
      endViewing();
      if (!element) return;
      element.pause();
      element.currentTime = 0;
      setProgress(0);
      setSeconds(0);
      return;
    }
    if (!element) return;

    let cancelled = false;
    void (async () => {
      element.muted = quiet();
      try {
        await element.play();
      } catch (error) {
        // Interrupted — a swipe on, a newer play() — is not a refusal, and
        // muting the feed for it would take sound away from somebody who was
        // allowed it. Refused even muted (Low Power Mode): the poster and the
        // play button stay, and a tap starts it.
        if (cancelled || element.muted || classifyPlayError(error) !== 'needs-gesture') return;
        // Refused with sound. Mute and try once more, which is the one thing
        // every autoplay policy does allow, and tell the feed so the rest of
        // the clips do not each repeat this.
        element.muted = true;
        onBlocked();
        await element.play().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, mounted, covered, quiet, onBlocked, endViewing]);

  // React will not re-mute a player that has already started, so the mute
  // state is applied to the element itself.
  useEffect(() => {
    if (video.current) video.current.muted = quiet();
  }, [muted, silent, quiet]);

  // Out of reach of the screen: let go of the video it was holding. The element
  // itself stays — on Safari it may already have been readied for sound, and a
  // new one would need another tap.
  useEffect(() => {
    const element = video.current;
    if (mounted || !element || !element.currentSrc) return;
    element.removeAttribute('src');
    element.load();
  }, [mounted]);

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    // A tap to play is an interaction: if sound is wanted and was only refused
    // for want of one, this is when it comes on.
    if (soundBlocked && !silent) onEnableSound(data.id);
    else void element.play().catch(() => undefined);
  }

  function toggleLike() {
    if (!viewerId) {
      router.push(`/login?next=${encodeURIComponent(returnTo)}`);
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
      ref={attachHere}
      data-index={index}
      data-post-id={data.id}
      aria-label={`${data.author.displayName}: ${data.caption || 'video'}`}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
    >
      <div className="video-picture-stage absolute inset-0 flex items-center justify-center">
        {/* The slide on screen and its neighbours have a player. Once somebody
            has tapped for sound every slide keeps one, so a player readied for
            sound (Safari asks for that per element) is still the one used when
            its clip comes round; further away it has no source, fetches
            nothing and is hidden. */}
        {mounted || keepPlayer ? (
          <video
            ref={attachPlayer}
            src={mounted ? media.url : undefined}
            poster={mounted ? media.poster : undefined}
            preload={mounted ? preload : 'none'}
            playsInline
            loop
            // The feed's own mute toggle, or the creator's — whichever silences it.
            // A video posted with the sound off does not start making noise
            // because a viewer unmuted the feed.
            muted={muted || silent}
            onPlay={(event) => {
              setPlaying(true);
              // One video heard at a time, page-wide.
              claimAudio(event.currentTarget);
              watch.onPlay(event);
            }}
            onPlaying={watch.onPlaying}
            onPause={() => setPlaying(false)}
            onVolumeChange={(event) => claimAudio(event.currentTarget)}
            // `loop` means `ended` never fires here; the loop coming round is
            // a seek back to the start, which is where a replay is noticed.
            onSeeked={watch.onSeeked}
            onEnded={watch.onEnded}
            onTimeUpdate={(event) => {
              const element = event.currentTarget;
              const length = Number.isFinite(element.duration) && element.duration > 0
                ? element.duration
                : (media.duration ?? 0);
              if (length > 0) setProgress(element.currentTime / length);
              setSeconds(element.currentTime);
              watch.onTimeUpdate(event);
            }}
            className={mounted ? 'h-full w-full object-contain' : 'hidden'}
          />
        ) : null}
        {!mounted && media.poster ? (
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
        {/* Whatever the creator wrote over it, on the mounted slide and on the
            poster alike — a slide that has not mounted its player yet is still
            showing this video. */}
        {/* The playhead in seconds, straight from the player. Paused is still a
            moment in the video — with several lines on different windows,
            showing them all at once when it stops would put words on screen
            that never appear together. A slide showing only its poster has no
            playhead and shows every line, which is right: a still frame is not
            a moment in the video.

            Laid over the PICTURE, not the slide: the video letterboxes inside
            the slide, and a line placed at a fraction of the frame in the
            editor belongs at that fraction of the picture. */}
        {media.width && media.height ? (
          <div
            className="video-picture-box pointer-events-none"
            data-video-picture-box
            style={{ '--picture-ratio': `${media.width / media.height}` } as React.CSSProperties}
          >
            <VideoText
              media={media}
              now={mounted ? seconds : undefined}
            />
          </div>
        ) : (
          <VideoText
            media={media}
            now={mounted ? seconds : undefined}
          />
        )}
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

      {/* Everything you can touch is drawn for the slide on screen and its two
          neighbours only. A slide further away is its poster (and anything
          covering it) — thirty full sets of buttons, links and menus were most
          of what a phone had to build and hydrate before the first clip could
          start. Each slide keeps its own state either way: a like or an opened
          warning is still there when you swipe back to it. */}
      {mounted && (
        <>
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

          {/* Only when the browser refused sound the viewer wanted. A viewer
              who turned the sound off has the speaker at the top for that,
              and is not asked again; a clip posted silent has none to give. */}
          {soundBlocked && isActive && !silent && (
            <button
              type="button"
              onClick={(event) => {
                // The tap is the interaction the browser was waiting for, and
                // it is handled right here, inside it. Not a tap on the video.
                event.stopPropagation();
                onEnableSound(data.id);
              }}
              data-tap-for-sound
              className="absolute left-1/2 top-[22%] z-20 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-black/65 px-5 py-2.5 text-sm font-semibold shadow-lg backdrop-blur transition active:scale-95"
            >
              <VolumeIcon muted width={18} height={18} />
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
                  prefetch={NO_PREFETCH}
                />
                <div className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Link
                      href={`/u/${data.author.username}`}
                      prefetch={NO_PREFETCH}
                      className="truncate text-sm font-semibold leading-tight hover:underline"
                    >
                      {data.author.displayName}
                    </Link>
                    {data.author.isAdmin && <AdminBadge />}
                  </span>
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
                // Tapping the caption opens it out, as it always has — apart from
                // its hashtags, which open their own pages. The expand control is
                // laid under the words rather than wrapped round them, because a
                // link cannot live inside a button, and so a tap on a hashtag can
                // only ever be the hashtag.
                <div className="relative mt-2.5" data-video-caption>
                  <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Show less of the caption' : 'Show all of the caption'}
                    className="absolute inset-0"
                  />
                  <span
                    className={`pointer-events-none relative block whitespace-pre-wrap text-[14px] leading-snug text-white/90 ${
                      expanded ? '' : 'line-clamp-2'
                    }`}
                  >
                    <HashtagText text={data.caption} prefetch={NO_PREFETCH} />
                  </span>
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Link
                  href={`/discover?category=${encodeURIComponent(data.category)}`}
                  prefetch={NO_PREFETCH}
                  className="chip bg-white/10 hover:bg-white/15"
                >
                  {data.category}
                </Link>
                {data.reason && (
                  <span className="chip border-transparent bg-white/[0.06] text-white/45">
                    {data.reason}
                  </span>
                )}
                {/* The hashtags it was posted with, each one its hashtag's page. */}
                <HashtagChips
                  tags={extraTags({ caption: data.caption, text_title: data.textTitle, tags: data.tags })}
                  className="bg-white/10 hover:bg-white/15"
                  prefetch={NO_PREFETCH}
                />
                {last && (
                  <Link href={end.href} prefetch={NO_PREFETCH} className="chip bg-white/10 hover:bg-white/15">
                    {end.label}
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
              <button
                type="button"
                onClick={(event) => {
                  // A control, not a tap on the video: the play/pause layer is
                  // underneath and must not hear this.
                  event.stopPropagation();
                  onOpenComments(data.id);
                }}
                aria-label="Comments"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white"
              >
                <CommentIcon width={26} height={26} />
                {formatCount(commentCount)}
              </button>
              <button
                type="button"
                onClick={share}
                aria-label="Share"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white"
              >
                <ShareIcon width={26} height={26} />
                {copied ? 'Copied' : 'Share'}
              </button>
              {/* How many times this has been watched. Not a button — there is
                  nothing to do with it. */}
              <span
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white/75"
                data-video-views={watch.count}
                role="img"
                aria-label={`${watch.count.toLocaleString()} ${watch.count === 1 ? 'view' : 'views'}`}
              >
                <EyeIcon width={24} height={24} />
                {formatCount(watch.count)}
              </span>
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
                        prefetch={NO_PREFETCH}
                        className="block px-4 py-2.5 text-left text-sm text-white/70 hover:bg-white/5"
                      >
                        Open post
                      </Link>
                      {!isOwn && viewerId && <ReportDialog targetType="post" targetId={data.id} />}
                      {/* Administrators only, and only as a convenience: the server
                          action re-checks the role whoever sends it. */}
                      {viewerIsAdmin && !isOwn && !data.removed && (
                        <AdminRemovePost
                          postId={data.id}
                          onRemoved={() => {
                            setMenuOpen(false);
                            onDeleted(data.id);
                          }}
                          onCancel={() => setMenuOpen(false)}
                        />
                      )}
                      {/* Your own video only reaches this feed from a link to it. */}
                      {isOwn && !data.removed && (
                        <DeletePost
                          postId={data.id}
                          onDeleted={() => {
                            setMenuOpen(false);
                            onDeleted(data.id);
                          }}
                          onCancel={() => setMenuOpen(false)}
                        />
                      )}
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
        </>
      )}
    </section>
  );
});
