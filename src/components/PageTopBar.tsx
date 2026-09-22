import { unreadCount } from '@/lib/services/notifications';
import { unreadMessageCount } from '@/lib/services/messages';
import { getViewer } from '@/lib/session';
import { TopBar } from './Nav';

/**
 * Mobile top bar that knows who is signed in. Pages render this instead of
 * <TopBar> directly so the search/bell/join affordances are always correct.
 */
export async function PageTopBar({ title }: { title?: string }) {
  const viewer = await getViewer();
  const [unread, unreadMessages] = viewer
    ? await Promise.all([unreadCount(viewer.id), unreadMessageCount(viewer.id)])
    : [0, 0];
  return (
    <TopBar
      title={title}
      user={
        viewer
          ? {
              username: viewer.username,
              displayName: viewer.display_name,
              avatarUrl: viewer.avatar_url,
              isAdmin: viewer.role === 'admin',
              unread,
              unreadMessages,
            }
          : null
      }
    />
  );
}
