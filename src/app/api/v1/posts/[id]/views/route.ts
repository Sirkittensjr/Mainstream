import { NextResponse, type NextRequest } from 'next/server';
import { recordVideoView } from '@/lib/services/video-views';
import { getViewer } from '@/lib/session';
import { VIEW_BROWSER_COOKIE, VIEW_BROWSER_COOKIE_OPTIONS } from '@/lib/video/viewer-cookie';
import { sanitiseSessionKey } from '@/lib/video/views';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * A video was watched: one playback session of it began.
 *
 * The client's entire say is which post, and an opaque key for the playback
 * session it is reporting. Whether that is a view, and what the total now is,
 * is decided by recordVideoView against the database; a count in the request
 * would be something this does not read.
 *
 *   200 { ok: true, count, counted, reason? }   decided — counted or not, with
 *                                               the total the database holds
 *   503 { ok: false }                           not stored; nothing was
 *                                               written, so send it again
 *
 * The player sends this with `fetch(…, { keepalive: true })` rather than as a
 * server action; lib/video/view-reports.ts says why.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Browsers say where a request came from. A view is only ever reported by
  // FayTarra's own pages (or a native app, which sends no such header), so a
  // page elsewhere cannot spend a visitor's views for them.
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ ok: false, error: 'cross-site' }, { status: 403, headers: NO_STORE });
  }

  const { id } = await params;
  const postId = String(id || '').slice(0, 64);
  if (!postId) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });

  let sessionKey: unknown = null;
  try {
    sessionKey = ((await request.json()) as { sessionKey?: unknown } | null)?.sessionKey ?? null;
  } catch {
    // No body, or not JSON: counted without a session key, which the rules
    // treat as one playback session per person.
  }

  try {
    const viewer = await getViewer();
    // Signed in: the account. Otherwise the browser's cookie, which the
    // middleware hands out on the first page; minted here only if a report
    // somehow arrives first.
    let browserId = viewer ? null : (request.cookies.get(VIEW_BROWSER_COOKIE)?.value ?? null);
    const minted = !viewer && !browserId;
    if (minted) browserId = crypto.randomUUID();

    const result = await recordVideoView({
      postId,
      viewerId: viewer?.id ?? null,
      browserId,
      sessionKey: sanitiseSessionKey(sessionKey),
    });
    const response = NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    if (minted && browserId) {
      response.cookies.set(VIEW_BROWSER_COOKIE, browserId, VIEW_BROWSER_COOKIE_OPTIONS);
    }
    return response;
  } catch {
    // recordVideoView has already logged why. Nothing was stored.
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
