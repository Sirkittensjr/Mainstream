import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EXTENSION_FOR, sniffType } from '@/lib/file-type';
import { newId } from '@/lib/ids';
import { checkUploadLimit } from '@/lib/services/rate-limit';
import { getViewer } from '@/lib/session';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Uploads go to the active driver: local disk in dev, Supabase Storage in prod.
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
  // Checked before reading the body into memory.
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is larger than 25MB.' }, { status: 413 });
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(data);
  if (!type) {
    return NextResponse.json(
      { error: 'That is not an image or video we can read. Try JPG, PNG, WEBP, GIF, MP4 or WEBM.' },
      { status: 415 },
    );
  }

  const url = await db().putMedia(`${newId()}${EXTENSION_FOR[type]}`, type, data);
  return NextResponse.json({ url, kind: type.startsWith('video/') ? 'video' : 'image' });
}
