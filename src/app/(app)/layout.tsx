import Link from 'next/link';
import { BottomNav, Sidebar, type NavUser } from '@/components/Nav';
import { RightRail } from '@/components/RightRail';
import { UnreadWatch } from '@/components/UnreadWatch';
import { unreadCount } from '@/lib/services/notifications';
import { unreadMessageCount } from '@/lib/services/messages';
import { getViewer, markActive } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  await markActive(viewer);
  const [unread, unreadMessages] = viewer
    ? await Promise.all([unreadCount(viewer.id), unreadMessageCount(viewer.id)])
    : [0, 0];

  const navUser: NavUser | null = viewer
    ? {
        username: viewer.username,
        displayName: viewer.display_name,
        avatarUrl: viewer.avatar_url,
        isAdmin: viewer.role === 'admin',
        unread,
        unreadMessages,
      }
    : null;

  return (
    // Three columns on a desktop: navigation, the page, and the rail. The frame
    // stops growing at 1480px so a wide monitor gets margins rather than a
    // feed stretched past reading width.
    <div className="mx-auto flex w-full max-w-[1480px]">
      <Sidebar user={navUser} />
      {/* Clears the bottom navigation, which grows by the home-indicator inset
          on an iPhone — a fixed pb-24 left the last item 2px from under it. */}
      <div className="min-w-0 flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8">
        {viewer?.status === 'suspended' && (
          <div className="border-b border-fay/30 bg-fay/10 px-4 py-3 text-sm text-fay-soft">
            Your account is suspended
            {viewer.status_reason ? `: ${viewer.status_reason}` : '.'} You can still browse, but you
            cannot post.{' '}
            <Link href="/rules" className="underline">
              Read the rules
            </Link>
          </div>
        )}
        {children}
      </div>
      <RightRail viewer={viewer} />
      <BottomNav user={navUser} />
      {/* Nothing rendered: it refreshes the route when the badges above go
          stale, so a message that arrives mid-read still announces itself. */}
      {viewer && <UnreadWatch messages={unreadMessages} notifications={unread} />}
    </div>
  );
}
