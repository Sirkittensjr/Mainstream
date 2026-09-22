import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import type { PersonSummary } from '@/lib/services/users';

/**
 * A list of people you can actually get to.
 *
 * Every row is a link to that person's profile — the avatar, the display name
 * and the @handle all go to the same place — because a list of names you
 * cannot click is a dead end. The row is one link with the follow button
 * beside it rather than inside it, so the button does not navigate and the
 * link does not swallow the button.
 */
export function PeopleList({
  people,
  signedIn,
  emptyTitle,
  emptyBody,
}: {
  people: PersonSummary[];
  signedIn: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (people.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <ul className="space-y-2 pb-10">
      {people.map(({ user, viewerFollows, isViewer }) => (
        <li key={user.id} className="card flex items-center gap-3 p-3 sm:p-4">
          <Link
            href={`/u/${user.username}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl transition hover:opacity-90"
          >
            <Avatar
              username={user.username}
              displayName={user.display_name}
              src={user.avatar_url}
              size="sm"
              href={false}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{user.display_name}</span>
              <span className="block truncate text-sm text-white/40">@{user.username}</span>
            </span>
          </Link>
          {!isViewer && (
            <span className="shrink-0">
              <FollowButton userId={user.id} initialFollowing={viewerFollows} signedIn={signedIn} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
