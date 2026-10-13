import { NextResponse, type NextRequest } from 'next/server';
import { recordVideoView } from '@/lib/services/video-views';
import { getViewer } from '@/lib/session';
import { VIEW_BROWSER_COOKIE, VIEW_BROWSER_COOKIE_OPTIONS } from '@/lib/video/viewer-cookie';
import { isPostId, sanitiseSessionKey } from '@/lib/video/views';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/** A report is `{"sessionKey":"…"}`. Anything much bigger than that is not one. */
const MAX_BODY_BYTES = 1024;

/**
 * A video started playing: one playback session of it began.
 *
 * The client's entire say is which post, and an opaque key for the playback
 * session it is reporting. Whether that is a view, and what the total now is,
 * is decided by recordVideoView against the database; a count in the request
 * would be something this does not read.
 *
 *   200 { ok: true, count, counted, reason? }   decided — counted or not, with
 *                                               the total the database holds
 *   400 / 404 / 413 { ok: false, error }        not a report; sending it again
 *                                               would change nothing
 *   403 { ok: false, error: 'cross-site' }      sent by some other site
 *   503 { ok: false }                           not stored; nothing was
 *                                               written, so send it again
 *
 * The player sends this with `fetch(…, { keepalive: true })` rather than as a
 * server action; lib/video/view-reports.ts says why. It never waits for the
 * answer before playing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Browsers say where a request came from. A view is only ever reported by
  // FayTarra's own pages (or a native app, which sends no such header), so a
  // page elsewhere cannot spend a visitor's views for them.
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ ok: false, error: 'cross-site' }, { status: 403, headers: NO_STORE });
  }

  // Every post id is a UUID: anything else is answered without asking the
  // database, which would otherwise refuse it as a malformed query — a 5xx the
  // player would retry.
  const { id } = await params;
  if (!isPostId(id)) {
    return NextResponse.json({ ok: false, error: 'no-post' }, { status: 404, headers: NO_STORE });
  }

  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'too-large' }, { status: 413, headers: NO_STORE });
  }
  let sessionKey: string | null = null;
  try {
    sessionKey = sanitiseSessionKey((JSON.parse(raw) as { sessionKey?: unknown } | null)?.sessionKey);
  } catch {
    sessionKey = null;
  }
  // The key is what makes a retried or duplicated report count once. Without
  // one there is no telling a second play from a second copy of the first.
  if (!sessionKey) {
    return NextResponse.json({ ok: false, error: 'session-key' }, { status: 400, headers: NO_STORE });
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
      postId: id,
      viewerId: viewer?.id ?? null,
      browserId,
      sessionKey,
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
