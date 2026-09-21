import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { markNotificationsReadAction } from '@/app/actions';
import { listNotifications } from '@/lib/services/notifications';
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
            {notifications.map((entry) => {
              const href = entry.post_id
                ? `/post/${entry.post_id}`
                : entry.actor
                  ? `/u/${entry.actor.username}`
                  : '/home';
              return (
                <li key={entry.id}>
                  <Link
                    href={href}
                    className={`card flex items-center gap-3 p-4 transition hover:border-white/20 ${
                      entry.read ? 'opacity-60' : ''
                    }`}
                  >
                    {entry.actor ? (
                      <Avatar
                        username={entry.actor.username}
                        displayName={entry.actor.display_name}
                        src={entry.actor.avatar_url}
                        size="sm"
                        href={false}
                      />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-base">
                        {ICONS[entry.type]}
                      </span>
                    )}
                    <p className="min-w-0 flex-1 text-sm text-white/80">{entry.body}</p>
                    <span className="shrink-0 text-xs text-white/30">
                      {timeAgo(entry.created_at)}
                    </span>
                    {!entry.read && <span className="h-2 w-2 shrink-0 rounded-full bg-fay" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
