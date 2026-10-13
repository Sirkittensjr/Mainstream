import Link from 'next/link';
import { headers } from 'next/headers';
import { BottomNav, Sidebar, type NavUser } from '@/components/Nav';
import { RightRail } from '@/components/RightRail';
import { UnreadWatch } from '@/components/UnreadWatch';
import { ViewerRoleProvider } from '@/components/ViewerRole';
import { unreadCount } from '@/lib/services/notifications';
import { unreadMessageCount } from '@/lib/services/messages';
import { getViewer, markActive } from '@/lib/session';

/**
 * A phone, by its own account: it can never be wide enough for the right-hand
 * column (1280px and up). iPads send a desktop user agent and are left alone.
 */
function isPhone(request: Headers): boolean {
  if (request.get('sec-ch-ua-mobile') === '?1') return true;
  return /\b(iPhone|iPod)\b|Android.+Mobile|Windows Phone/.test(request.get('user-agent') ?? '');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const phone = isPhone(await headers());
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
    <ViewerRoleProvider isAdmin={viewer?.role === 'admin'}>
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
      {/* Desktop only (it is hidden below 1280px), so a phone is not made to
          wait for — or download — a column it can never show: suggestions,
          rankings and counts were being read for every page a phone opened. */}
      {!phone && <RightRail viewer={viewer} />}
      <BottomNav user={navUser} />
      {/* Nothing rendered: it refreshes the route when the badges above go
          stale, so a message that arrives mid-read still announces itself. */}
      {viewer && <UnreadWatch messages={unreadMessages} notifications={unread} />}
    </div>
    </ViewerRoleProvider>
  );
}
