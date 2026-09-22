import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sniffType } from '@/lib/file-type';
import { newId } from '@/lib/ids';
import { checkUploadLimit } from '@/lib/services/rate-limit';
import { getViewer } from '@/lib/session';
import { probeVideo } from '@/lib/video/probe';
import {
  checkDuration,
  checkSize,
  extensionFor,
  isVideoType,
  maxBytesFor,
  UPLOADABLE,
} from '@/lib/video/uploads';

export const dynamic = 'force-dynamic';

/**
 * Uploads that come through the app rather than going straight to storage.
 *
 * This is the local driver's path — `npm run dev`, the test harnesses, and any
 * host without Supabase Storage. Serverless request bodies are far too small
 * for a 250MB video (Vercel stops at 4.5MB), so a production deployment signs
 * an upload instead: see /api/upload/sign. The rules applied here are the same
 * ones /api/upload/commit applies there.
 *
 * The stored type comes from the file's own bytes, never from the
 * `Content-Type` the browser claimed — otherwise anything at all could be
 * stored and later served as an image.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (viewer.status !== 'active') {
    return NextResponse.json({ error: 'Account is not active.' }, { status: 403 });
  }

  const limit = checkUploadLimit(viewer.id);
  if (!limit.ok) return NextResponse.json({ error: limit.error }, { status: 429 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  }
  // Checked before reading the body into memory. The largest thing allowed at
  // all is a video, so that is the bound until the real type is known.
  if (file.size > maxBytesFor('video/mp4')) {
    return NextResponse.json(
      { error: `That file is larger than ${maxBytesFor('video/mp4') / (1024 * 1024)}MB.` },
      { status: 413 },
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(data);
  if (!type || !UPLOADABLE.includes(type)) {
    return NextResponse.json(
      {
        error:
          'That is not an image or video we can read. Try JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.',
      },
      { status: 415 },
    );
  }

  const room = checkSize(type, data.length);
  if (!room.ok) return NextResponse.json({ error: room.error }, { status: room.status });

  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;

  if (isVideoType(type)) {
    const probe = probeVideo(data);
    const length = checkDuration(probe);
    if (!length.ok) return NextResponse.json({ error: length.error }, { status: length.status });
    width = probe.width;
    height = probe.height;
    duration = probe.seconds;
  }

  const url = await db().putMedia(`${newId()}${extensionFor(type)}`, type, data);
  return NextResponse.json({
    url,
    kind: isVideoType(type) ? 'video' : 'image',
    width,
    height,
    duration,
  });
}
