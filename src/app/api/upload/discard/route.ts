import { NextResponse } from 'next/server';
import { discardPublished, ownsPublishedUrl } from '@/lib/media/storage';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Deletes a just-published upload whose post never happened.
 *
 * The browser calls this when creating the post fails after the file has
 * already reached storage, so the bucket does not fill up with videos nothing
 * points at. It only ever accepts a URL under the caller's own folder, and it
 * refuses one that a post already uses — so this cannot be turned into a way
 * to delete somebody's media, or your own after the fact.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const url = String(body.url ?? '');
  if (!ownsPublishedUrl(url, viewer.id)) {
    return NextResponse.json({ error: 'That upload is not yours.' }, { status: 403 });
  }

  const { inUse, removed } = await discardPublished(url);
  if (inUse) return NextResponse.json({ error: 'That file is in use.' }, { status: 409 });
  return NextResponse.json({ removed });
}
