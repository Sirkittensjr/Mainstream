import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { RatingPill } from '@/components/RatingPill';
import { formatVotes, MIN_VOTES_FOR_RANKING } from '@/lib/ratings';
import { POST_BOARDS, activeCategories, discoverPosts, type PostBoard } from '@/lib/services/discovery';
import {
  RANK_BOARDS,
  rankedCategories,
  rankings,
  userRanks,
  type RankBoard,
} from '@/lib/services/rankings';
import { followingIds } from '@/lib/services/users';
import { CATEGORIES, type Category } from '@/lib/types';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Discover' };
export const dynamic = 'force-dynamic';

type Kind = 'posts' | 'people';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; board?: string; category?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();

  // Posts first: somebody arriving at Discover wants something to look at
  // before they want a leaderboard.
  const kind: Kind = params.show === 'people' ? 'people' : 'posts';
  const category = (CATEGORIES as readonly string[]).includes(params.category ?? '')
    ? (params.category as Category)
    : null;

  const peopleBoard = (RANK_BOARDS.find((entry) => entry.key === params.board)?.key ??
    'overall') as RankBoard;
  const postBoard = (POST_BOARDS.find((entry) => entry.key === params.board)?.key ??
    'top') as PostBoard;

  const href = (next: { show?: Kind; board?: string | null; category?: string | null }) => {
    const merged = {
      show: kind,
      board: kind === 'people' ? peopleBoard : postBoard,
      category,
      ...next,
    };
    const search = new URLSearchParams();
    if (merged.show !== 'posts') search.set('show', merged.show);
    // Switching tab resets the board, because the two tabs have different ones.
    const defaultBoard = merged.show === 'people' ? 'overall' : 'top';
    if (merged.board && merged.board !== defaultBoard) search.set('board', String(merged.board));
    if (merged.category) search.set('category', String(merged.category));
    const value = search.toString();
    return value ? `/discover?${value}` : '/discover';
  };

  return (
    <>
      <PageTopBar title="Discover" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Discover</h1>
          <p className="mt-1 text-white/45">
            Posts and people the community rates — by how much people actually agree, not by
            follower count.
          </p>
        </div>

        <div className="mb-4 flex gap-2">
          <Link
            href={href({ show: 'posts', board: null })}
            className={`chip ${kind === 'posts' ? 'chip-active' : 'hover:bg-white/10'}`}
          >
            Posts
          </Link>
          <Link
            href={href({ show: 'people', board: null })}
            className={`chip ${kind === 'people' ? 'chip-active' : 'hover:bg-white/10'}`}
          >
            People
          </Link>
        </div>

        {kind === 'posts' ? (
          <PostsTab
            board={postBoard}
            category={category}
            viewerId={viewer?.id ?? null}
            href={href}
          />
        ) : (
          <PeopleTab
            board={peopleBoard}
            category={category}
            viewerId={viewer?.id ?? null}
            viewerUsername={viewer?.username ?? null}
            href={href}
          />
        )}
      </div>
    </>
  );
}

type HrefFn = (next: { show?: Kind; board?: string | null; category?: string | null }) => string;

function CategoryStrip({
  categories,
  active,
  href,
  unit,
}: {
  categories: { category: Category; count: number }[];
  active: Category | null;
  href: HrefFn;
  unit: string;
}) {
  return (
    <div className="hide-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <Link
        href={href({ category: null })}
        className={`chip shrink-0 ${!active ? 'chip-active' : 'hover:bg-white/10'}`}
      >
        All
      </Link>
      {categories.map((entry) => (
        <Link
          key={entry.category}
          href={href({ category: entry.category })}
          className={`chip shrink-0 ${active === entry.category ? 'chip-active' : 'hover:bg-white/10'}`}
          title={`${entry.count} ${unit}`}
        >
          {entry.category}
          <span className="text-[11px] opacity-50">{entry.count}</span>
        </Link>
      ))}
    </div>
  );
}

async function PostsTab({
  board,
  category,
  viewerId,
  href,
}: {
  board: PostBoard;
  category: Category | null;
  viewerId: string | null;
  href: HrefFn;
}) {
  const [posts, categories] = await Promise.all([
    discoverPosts({ board, category, viewerId, limit: 30 }),
    activeCategories(viewerId),
  ]);
  const active = POST_BOARDS.find((entry) => entry.key === board)!;

  return (
    <>
      <div className="flex gap-2">
        {POST_BOARDS.map((entry) => (
          <Link
            key={entry.key}
            href={href({ board: entry.key })}
            className={`chip ${board === entry.key ? 'chip-active' : 'hover:bg-white/10'}`}
          >
            {entry.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-white/45">{active.blurb}</p>

      <CategoryStrip
        categories={categories.map((entry) => ({ category: entry.category, count: entry.posts }))}
        active={category}
        href={href}
        unit="posts"
      />

      <h2 className="mt-7 font-display text-2xl font-extrabold tracking-tight">
        {category ?? 'Everything'}
      </h2>
      <p className="mb-4 text-sm text-white/35">{active.label}</p>

      <div className="pb-10">
        <PostList
          posts={posts}
          viewerId={viewerId}
          empty={
            <EmptyState
              title={board === 'top' ? 'Nothing rated here yet' : 'Nothing trending here yet'}
              body={
                board === 'top'
                  ? 'Posts appear once a few people have rated them, so one generous friend cannot put a post at the top.'
                  : 'Trending looks at the last week. Post something or rate a few things to get it moving.'
              }
              cta={{ href: '/home?tab=recommended', label: 'Browse the feed' }}
            />
          }
        />
      </div>
    </>
  );
}

async function PeopleTab({
  board,
  category,
  viewerId,
  viewerUsername,
  href,
}: {
  board: RankBoard;
  category: Category | null;
  viewerId: string | null;
  viewerUsername: string | null;
  href: HrefFn;
}) {
  const [rows, categories, mine, following] = await Promise.all([
    rankings({ board, category, limit: 50 }),
    rankedCategories(),
    viewerId ? userRanks(viewerId) : Promise.resolve(null),
    viewerId ? followingIds(viewerId) : Promise.resolve(new Set<string>()),
  ]);
  const active = RANK_BOARDS.find((entry) => entry.key === board)!;

  return (
    <>
      {viewerId && mine && viewerUsername && (
        <div className="card mb-5 flex items-center justify-between gap-4 p-5">
          <div>
            <p className="label">Where you sit</p>
            {mine.overall ? (
              <p className="mt-1 text-sm text-white/55">
                #{mine.overall} overall
                {mine.category && mine.categoryRank
                  ? ` · #${mine.categoryRank} in ${mine.category}`
                  : ''}{' '}
                of {mine.total.toLocaleString()} rated people
              </p>
            ) : (
              <p className="mt-1 text-sm text-white/55">
                {mine.votesNeeded} more rating{mine.votesNeeded === 1 ? '' : 's'} and you appear
                here. Everyone needs {MIN_VOTES_FOR_RANKING}.
              </p>
            )}
          </div>
          <Link
            href={`/u/${viewerUsername}`}
            className="shrink-0 text-sm font-semibold text-fay hover:underline"
          >
            Profile
          </Link>
        </div>
      )}

      <div className="flex gap-2">
        {RANK_BOARDS.map((entry) => (
          <Link
            key={entry.key}
            href={href({ board: entry.key })}
            className={`chip ${board === entry.key ? 'chip-active' : 'hover:bg-white/10'}`}
          >
            {entry.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-white/45">{active.blurb}</p>

      <CategoryStrip
        categories={categories.map((entry) => ({ category: entry.category, count: entry.people }))}
        active={category}
        href={href}
        unit="people"
      />

      <h2 className="mt-7 font-display text-2xl font-extrabold tracking-tight">
        {category ?? 'Everyone'}
      </h2>
      <p className="text-sm text-white/35">{active.label}</p>

      <ol className="mt-4 space-y-2 pb-10">
        {rows.map((row) => (
          <li
            key={row.user.id}
            className={`card flex items-center gap-3 p-4 ${
              row.user.id === viewerId ? 'border-fay/40' : ''
            }`}
          >
            <span
              className={`w-8 shrink-0 text-center font-display text-lg font-extrabold tabular-nums ${
                row.rank <= 3 ? 'gradient-text' : 'text-white/30'
              }`}
            >
              {row.rank}
            </span>
            <Avatar
              username={row.user.username}
              displayName={row.user.display_name}
              src={row.user.avatar_url}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${row.user.username}`}
                className="block truncate font-semibold hover:underline"
              >
                {row.user.display_name}
              </Link>
              <p className="truncate text-xs text-white/40">
                @{row.user.username} · {formatVotes(row.votes)}
                {row.category ? ` · ${row.category}` : ''}
              </p>
            </div>
            <RatingPill
              value={row.rating}
              trend={board === 'recent' ? row.trend : undefined}
              votes={row.votes}
            />
            {viewerId && viewerId !== row.user.id && (
              <div className="hidden sm:block">
                <FollowButton
                  userId={row.user.id}
                  initialFollowing={following.has(row.user.id)}
                  signedIn
                />
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <EmptyState
            title="Nobody here yet"
            body={`People appear once they have at least ${MIN_VOTES_FOR_RANKING} ratings, so a handful of votes cannot jump the queue.`}
            cta={{ href: '/discover', label: 'Browse posts' }}
          />
        )}
      </ol>
    </>
  );
}
