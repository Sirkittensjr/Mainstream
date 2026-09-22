import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { conversations, messagingAvailable } from '@/lib/services/messages';
import { requireViewer } from '@/lib/session';
import { timeAgo } from '@/lib/time';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const viewer = await requireViewer('/messages');
  const [threads, available] = await Promise.all([
    conversations(viewer),
    messagingAvailable(),
  ]);

  return (
    <>
      <PageTopBar title="Messages" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Messages</h1>
          <p className="mt-1 text-white/45">
            Private, and only with people who follow you back.
          </p>
        </div>

        {!available ? (
          // Better than an inbox that looks normal and silently drops
          // everything: this deployment's database has not had the messaging
          // migration run against it yet.
          <EmptyState
            title="Messages are not switched on yet"
            body="Direct messages are not available on this deployment. Everything else works as normal."
            cta={{ href: '/home', label: 'Back to your feed' }}
          />
        ) : threads.length === 0 ? (
          <EmptyState
            title="No messages yet"
            body="You can message anyone who follows you back. Follow a few people and see who follows you in return."
            cta={{ href: '/discover?show=people', label: 'Find people' }}
          />
        ) : (
          <ul className="space-y-2 pb-10">
            {threads.map((entry) => (
              <li key={entry.person.id}>
                <Link
                  href={`/messages/${entry.person.username}`}
                  className="card flex items-center gap-3 p-4 transition hover:border-white/20"
                >
                  <Avatar
                    username={entry.person.username}
                    displayName={entry.person.display_name}
                    src={entry.person.avatar_url}
                    size="sm"
                    href={false}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="truncate font-semibold">{entry.person.display_name}</span>
                      <span className="shrink-0 text-xs text-white/30">
                        {timeAgo(entry.lastMessage.created_at)}
                      </span>
                    </p>
                    <p
                      className={`truncate text-sm ${
                        entry.unread > 0 ? 'text-white' : 'text-white/45'
                      }`}
                    >
                      {entry.lastMessage.sender_id === viewer.id ? 'You: ' : ''}
                      {entry.lastMessage.body}
                    </p>
                    {!entry.open && (
                      <p className="mt-0.5 text-xs text-white/30">
                        You no longer follow each other
                      </p>
                    )}
                  </div>
                  {entry.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-fay px-2 py-0.5 text-[11px] font-bold text-ink-950">
                      {entry.unread > 9 ? '9+' : entry.unread}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
