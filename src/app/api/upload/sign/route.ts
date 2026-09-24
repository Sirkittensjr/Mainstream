import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import {
  bucketName,
  createPendingUpload,
  directUploadsAvailable,
  pendingPathFor,
  resumableEndpoint,
} from '@/lib/media/storage';
import { checkUploadLimit } from '@/lib/services/rate-limit';
import { getViewer } from '@/lib/session';
import { createAuthClient } from '@/lib/supabase/server';
import { supabaseAnonKey } from '@/lib/supabase/config';
import { extensionFor, checkSize, isVideoType, UPLOADABLE } from '@/lib/video/uploads';
import type { SniffedType } from '@/lib/file-type';

export const dynamic = 'force-dynamic';

/**
 * Asks for somewhere to put a file.
 *
 * Three answers, and which one you get depends on the file and the
 * deployment:
 *
 *   resumable — a video on Supabase. The browser uploads it in chunks
 *     straight to Storage's TUS endpoint, so a dropped connection resumes
 *     instead of starting again, and no part of the file is ever a request
 *     body this app has to hold. This is the only one of the three that can
 *     carry a phone's video.
 *   direct — a picture on Supabase. One signed PUT, straight to Storage.
 *   post — no Supabase Storage on this deployment (the local driver, and the
 *     test harnesses), so the file is posted to /api/upload instead.
 *
 * The bytes never travel through FayTarra in the first two. The declared type
 * and size are the client's claim and are checked here only to refuse the
 * obviously impossible before anybody waits on a transfer; what the file
 * really is gets decided from its bytes on commit.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (viewer.status !== 'active') {
    return NextResponse.json({ error: 'Account is not active.' }, { status: 403 });
  }

  const limit = checkUploadLimit(viewer.id);
  if (!limit.ok) return NextResponse.json({ error: limit.error }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as {
    contentType?: unknown;
    size?: unknown;
  };
  const declared = String(body.contentType ?? '');
  const type = UPLOADABLE.find((candidate) => candidate === declared) as SniffedType | undefined;
  if (!type) {
    return NextResponse.json(
      { error: 'That file type is not supported. Try JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.' },
      { status: 415 },
    );
  }

  const size = typeof body.size === 'number' && Number.isFinite(body.size) ? body.size : 0;
  const room = checkSize(type, size);
  if (!room.ok) return NextResponse.json({ error: room.error }, { status: room.status });

  if (!directUploadsAvailable()) {
    return NextResponse.json({ mode: 'post' as const });
  }

  const path = pendingPathFor(viewer.id, `${newId()}${extensionFor(type)}`);

  if (isVideoType(type)) {
    // Authorised as the uploader, not as the server: the storage policies
    // from migration 0007 let an account write under `pending/<its own id>/`
    // and nowhere else, so this token cannot touch anybody else's upload —
    // and the path it is given here was built from the session, never from
    // anything the browser sent.
    const auth = await createAuthClient();
    const { data } = (await auth?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) {
      return NextResponse.json({ error: 'Sign in again to upload.' }, { status: 401 });
    }
    return NextResponse.json(
      {
        mode: 'resumable' as const,
        endpoint: resumableEndpoint(),
        bucket: bucketName(),
        path,
        token,
        apikey: supabaseAnonKey(),
        contentType: type,
      },
      // It carries a session token, so nothing between here and the browser
      // may keep a copy.
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const ticket = await createPendingUpload(viewer.id, path.slice(path.lastIndexOf('/') + 1));
    return NextResponse.json({ mode: 'direct' as const, ...ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start the upload.' },
      { status: 502 },
    );
  }
}
