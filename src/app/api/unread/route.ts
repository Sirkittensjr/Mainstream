import { NextResponse } from 'next/server';
import { unreadCount } from '@/lib/services/notifications';
import { unreadMessageCount } from '@/lib/services/messages';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * What the navigation badges should say right now.
 *
 * Exists so the badge can catch up with a message that arrived while somebody
 * was reading something else, without re-rendering a page to find out. It
 * answers only for whoever is asking — there is no id in the request, so there
 * is nothing to point at anybody else's inbox.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ messages: 0, notifications: 0 });
  const [messages, notifications] = await Promise.all([
    unreadMessageCount(viewer.id),
    unreadCount(viewer.id),
  ]);
  return NextResponse.json(
    { messages, notifications },
    { headers: { 'cache-control': 'no-store' } },
  );
}
