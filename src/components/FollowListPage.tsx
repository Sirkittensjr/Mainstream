import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { ChevronIcon } from '@/components/Icons';
import { PageTopBar } from '@/components/PageTopBar';
import { PeopleList } from '@/components/PeopleList';
import { formatCount } from '@/lib/format';
import {
  followersOf,
  followingOf,
  getUserByUsername,
  getUserStats,
  isBlockedEitherWay,
} from '@/lib/services/users';
import { getViewer } from '@/lib/session';

/**
 * The followers and following lists, which are the same page twice.
 *
 * It reads as part of the profile rather than as a new screen: the same top
 * bar, the same card, and a link back to the person whose list this is.
 */
export async function FollowListPage({
  username,
  list,
}: {
  username: string;
  list: 'followers' | 'following';
}) {
  const viewer = await getViewer();
  const user = await getUserByUsername(username);
  if (!user) notFound();
  if (user.status === 'banned' && viewer?.role !== 'admin') notFound();

  const isSelf = viewer?.id === user.id;
  const blocked = viewer && !isSelf ? await isBlockedEitherWay(viewer.id, user.id) : false;

  const [people, stats] = await Promise.all([
    blocked
      ? Promise.resolve([])
      : list === 'followers'
        ? followersOf(user.id, viewer?.id ?? null)
        : followingOf(user.id, viewer?.id ?? null),
    getUserStats(user.id),
  ]);

  const title = list === 'followers' ? 'Followers' : 'Following';
  const count = list === 'followers' ? stats.followers : stats.following;
  const who = isSelf ? 'You' : user.display_name;

  return (
    <>
      <PageTopBar title={title} />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 flex items-center gap-3">
          <Link
            href={`/u/${user.username}`}
            aria-label={`Back to ${user.display_name}'s profile`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15"
          >
            <ChevronIcon direction="left" />
          </Link>
          <Avatar
            username={user.username}
            displayName={user.display_name}
            src={user.avatar_url}
            size="sm"
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-extrabold tracking-tight">{title}</h1>
            <Link
              href={`/u/${user.username}`}
              className="block truncate text-sm text-white/45 hover:text-white"
            >
              @{user.username} · {formatCount(count)}
            </Link>
          </div>
        </div>

        <nav className="mb-4 flex gap-2" aria-label="Followers and following">
          {(['followers', 'following'] as const).map((tab) => (
            <Link
              key={tab}
              href={`/u/${user.username}/${tab}`}
              aria-current={tab === list ? 'page' : undefined}
              className={`min-h-[44px] rounded-full border px-5 py-2.5 text-sm font-semibold transition ${
                tab === list
                  ? 'border-fay/60 bg-fay/15 text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.07]'
              }`}
            >
              {tab === 'followers' ? 'Followers' : 'Following'}
            </Link>
          ))}
        </nav>

        {blocked ? (
          <div className="card p-6 text-sm text-white/55">
            <p className="font-semibold text-white">This list is not available.</p>
            <p className="mt-1">You and this person have blocked each other.</p>
          </div>
        ) : (
          <PeopleList
            people={people}
            signedIn={Boolean(viewer)}
            emptyTitle={list === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
            emptyBody={
              list === 'followers'
                ? `${who === 'You' ? 'Nobody follows you' : `Nobody follows ${who}`} yet. Post something and people will find their way here.`
                : `${who === 'You' ? 'You have not followed' : `${who} has not followed`} anyone yet.`
            }
          />
        )}
      </div>
    </>
  );
}
