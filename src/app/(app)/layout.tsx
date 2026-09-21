import Link from 'next/link';
import { BottomNav, Sidebar, type NavUser } from '@/components/Nav';
import { RightRail } from '@/components/RightRail';
import { levelFor } from '@/lib/progression';
import { unreadCount } from '@/lib/services/notifications';
import { getViewer, markActive } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  await markActive(viewer);
  const unread = viewer ? await unreadCount(viewer.id) : 0;

  const navUser: NavUser | null = viewer
    ? {
        username: viewer.username,
        displayName: viewer.display_name,
        avatarUrl: viewer.avatar_url,
        level: levelFor(viewer.points).level,
        isAdmin: viewer.role === 'admin',
        unread,
      }
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[1400px]">
      <Sidebar user={navUser} />
      <div className="min-w-0 flex-1 pb-24 lg:pb-8">
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
    </div>
  );
}
