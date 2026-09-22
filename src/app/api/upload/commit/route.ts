import { NextResponse } from 'next/server';
import { sniffType } from '@/lib/file-type';
import {
  discardPending,
  inspectPending,
  ownsPendingPath,
  probePending,
  publishPending,
} from '@/lib/media/storage';
import { getViewer } from '@/lib/session';
import { checkDuration, checkSize, isVideoType, UPLOADABLE } from '@/lib/video/uploads';

export const dynamic = 'force-dynamic';

/**
 * Checks an upload that went straight to storage, and publishes it if it passes.
 *
 * This is where the rules are actually applied, on the bytes that landed
 * rather than on anything the client said about them. Until this succeeds the
 * object sits under `pending/`, which src/lib/media.ts refuses to accept as
 * post media — so a client that skips this step ends up with a file it cannot
 * attach to anything.
 *
 * Anything that fails is deleted rather than left lying in the bucket.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (viewer.status !== 'active') {
    return NextResponse.json({ error: 'Account is not active.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  const path = String(body.path ?? '');
  // The path carries the uploader's id. Somebody else's is not theirs to commit.
  if (!ownsPendingPath(path, viewer.id)) {
    return NextResponse.json({ error: 'That upload is not yours.' }, { status: 403 });
  }

  const object = await inspectPending(path);
  if (!object) {
    return NextResponse.json({ error: 'That upload did not arrive.' }, { status: 404 });
  }

  const refuse = async (error: string, status: number) => {
    await discardPending(path);
    return NextResponse.json({ error }, { status });
  };

  const type = sniffType(object.head);
  if (!type || !UPLOADABLE.includes(type)) {
    return refuse(
      'That is not an image or video we can read. Try JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.',
      415,
    );
  }

  const room = checkSize(type, object.size);
  if (!room.ok) return refuse(room.error, room.status);

  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;

  if (isVideoType(type)) {
    const probe = probePending(object);
    const length = checkDuration(probe);
    if (!length.ok) return refuse(length.error, length.status);
    width = probe.width;
    height = probe.height;
    duration = probe.seconds;
  }

  try {
    const url = await publishPending(path);
    return NextResponse.json({
      url,
      kind: isVideoType(type) ? 'video' : 'image',
      width,
      height,
      duration,
    });
  } catch (error) {
    return refuse(error instanceof Error ? error.message : 'Could not store that file.', 502);
  }
}
