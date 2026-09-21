import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { getViewer } from '@/lib/session';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

/** Uploads go to the active driver: local disk in dev, Supabase Storage in prod. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (viewer.status !== 'active') {
    return NextResponse.json({ error: 'Account is not active.' }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  }
  const extension = ALLOWED[file.type];
  if (!extension) {
    return NextResponse.json({ error: 'Images and videos only.' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is larger than 25MB.' }, { status: 413 });
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const url = await db().putMedia(`${newId()}${extension}`, file.type, data);
  return NextResponse.json({
    url,
    kind: file.type.startsWith('video/') ? 'video' : 'image',
  });
}
