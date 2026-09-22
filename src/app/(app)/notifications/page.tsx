import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { markNotificationsReadAction } from '@/app/actions';
import { listNotifications, type NotificationView } from '@/lib/services/notifications';
import { requireViewer } from '@/lib/session';
import { timeAgo } from '@/lib/time';
import type { NotificationType } from '@/lib/types';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const ICONS: Record<NotificationType, string> = {
  follow: '👤',
  rating: '★',
  like: '❤️',
  comment: '💬',
  reply: '↩',
  mention: '@',
};

export default async function NotificationsPage() {
  const viewer = await requireViewer('/notifications');
  const notifications = await listNotifications(viewer.id);
  const unread = notifications.filter((entry) => !entry.read).length;

  return (
    <>
      <PageTopBar title="Notifications" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Notifications</h1>
            <p className="mt-1 text-white/45">
              {unread > 0 ? `${unread} new` : 'You are all caught up'}
            </p>
          </div>
          {unread > 0 && (
            <form action={markNotificationsReadAction}>
              <button type="submit" className="btn-ghost px-4 py-2 text-sm">
                Mark all read
              </button>
            </form>
          )}
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            body="Follows, likes, comments, replies and ratings all land here. Post something or follow a few people to get started."
            cta={{ href: '/discover', label: 'Find people' }}
          />
        ) : (
          <ul className="space-y-2 pb-10">
            {notifications.map((entry) => (
              <li key={entry.id}>
                <NotificationRow entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * One notification.
 *
 * Two targets, not one. The avatar and the @handle go to the person who did
 * the thing; everything else goes to the thing they did. The card stays
 * clickable as a whole through an overlay link sitting underneath the two
 * identity links — siblings rather than nested, because an anchor inside an
 * anchor is not valid HTML and browsers resolve it however they like.
 *
 * The person is identified by `actor_id`, and the handle in the link comes
 * off the record that id resolved to, so a renamed account still lands in the
 * right place.
 */
function NotificationRow({ entry }: { entry: NotificationView }) {
  const actor = entry.actor;
  const actorHref = actor ? `/u/${actor.username}` : null;
  // What the notification is ABOUT: the post where there is one, the person
  // otherwise. A follow has no post, so it goes to their profile.
  const contentHref = entry.post_id ? `/post/${entry.post_id}` : (actorHref ?? '/home');

  // Bodies are written as "@handle did something". The handle becomes the
  // link and the rest stays as the sentence, so it is not read twice.
  const prefix = actor ? `@${actor.username} ` : null;
  const rest = prefix && entry.body.startsWith(prefix) ? entry.body.slice(prefix.length) : null;

  return (
    <div
      className={`card relative flex items-center gap-3 p-4 transition hover:border-white/20 ${
        entry.read ? 'opacity-60' : ''
      }`}
    >
      {/* Underneath everything: the whole-card target. */}
      <Link
        href={contentHref}
        aria-label={entry.post_id ? 'Open the post' : (entry.body ?? 'Open')}
        className="absolute inset-0 z-0 rounded-2xl"
      />

      {actor && actorHref ? (
        <Link href={actorHref} className="relative z-10 shrink-0 rounded-full">
          <Avatar
            username={actor.username}
            displayName={actor.display_name}
            src={actor.avatar_url}
            size="sm"
            href={false}
          />
        </Link>
      ) : (
        <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-base">
          {ICONS[entry.type]}
        </span>
      )}

      <p className="min-w-0 flex-1 text-sm text-white/80">
        {actor && actorHref && rest !== null ? (
          <>
            <Link
              href={actorHref}
              className="relative z-10 font-semibold text-white hover:underline"
            >
              @{actor.username}
            </Link>{' '}
            {rest}
          </>
        ) : (
          entry.body
        )}
      </p>

      <span className="relative z-10 shrink-0 text-xs text-white/30">
        {timeAgo(entry.created_at)}
      </span>
      {!entry.read && <span className="relative z-10 h-2 w-2 shrink-0 rounded-full bg-fay" />}
    </div>
  );
}
