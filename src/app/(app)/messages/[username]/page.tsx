import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { ChevronIcon } from '@/components/Icons';
import { MessageThread } from '@/components/MessageThread';
import { PageTopBar } from '@/components/PageTopBar';
import { markThreadRead, thread } from '@/lib/services/messages';
import { getUserByUsername } from '@/lib/services/users';
import { requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `Messages with @${username}` };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const viewer = await requireViewer(`/messages/${username}`);
  const other = await getUserByUsername(username);
  if (!other) notFound();

  // Returns null when the viewer is not one of the two people, when either has
  // blocked the other, or when there is nothing to show and they are not
  // mutual. There is no path here to somebody else's conversation.
  const conversation = await thread(viewer, other);
  if (!conversation) notFound();

  // Marked here rather than in the browser so it works with JavaScript off.
  // Only messages the viewer received are touched; see markThreadRead.
  const marked = await markThreadRead(viewer.id, other.id);

  return (
    <>
      <PageTopBar title={`@${other.username}`} />
      <div className="mx-auto flex max-w-2xl flex-col px-4 pt-4 lg:pt-8">
        {/* Back first, the way the followers list does it: a conversation is
            somewhere you went INTO, and the way out was an 11px word called
            "All" in the far corner. */}
        <header className="card mb-4 flex items-center gap-3 p-3 sm:p-4">
          <Link
            href="/messages"
            aria-label="All conversations"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] transition hover:bg-white/[0.12]"
          >
            <ChevronIcon direction="left" />
          </Link>
          <Avatar
            username={other.username}
            displayName={other.display_name}
            src={other.avatar_url}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/u/${other.username}`}
              className="block truncate font-semibold hover:underline"
            >
              {other.display_name}
            </Link>
            <p className="truncate text-xs text-white/40">@{other.username}</p>
          </div>
        </header>

        <MessageThread
          username={other.username}
          displayName={other.display_name}
          viewerId={viewer.id}
          open={conversation.open}
          hadUnread={marked > 0}
          messages={conversation.messages.map((message) => ({
            id: message.id,
            body: message.body,
            mine: message.sender_id === viewer.id,
            createdAt: message.created_at,
          }))}
        />
      </div>
    </>
  );
}
