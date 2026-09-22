import { NextResponse } from 'next/server';
import { newId } from '@/lib/ids';
import { createPendingUpload, directUploadsAvailable } from '@/lib/media/storage';
import { checkUploadLimit } from '@/lib/services/rate-limit';
import { getViewer } from '@/lib/session';
import { extensionFor, checkSize, UPLOADABLE } from '@/lib/video/uploads';
import type { SniffedType } from '@/lib/file-type';

export const dynamic = 'force-dynamic';

/**
 * Asks for somewhere to put a file.
 *
 * The answer is either a signed URL straight to Supabase Storage — the only
 * way a 250MB video can be uploaded at all, since a serverless request body
 * tops out far below that — or an instruction to post it to /api/upload,
 * which is what a deployment on the local driver does.
 *
 * The declared type and size are the client's claim, and are checked here only
 * to refuse the obviously impossible before anybody waits on a transfer. What
 * the file really is gets decided from its bytes on commit.
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

  try {
    const ticket = await createPendingUpload(viewer.id, `${newId()}${extensionFor(type)}`);
    return NextResponse.json({ mode: 'direct' as const, ...ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start the upload.' },
      { status: 502 },
    );
  }
}
