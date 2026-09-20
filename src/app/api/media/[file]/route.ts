import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { LOCAL_MEDIA_DIR } from '@/lib/db/local';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** Serves uploads stored by the local driver. Supabase Storage serves its own. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  // Never let a request escape the uploads directory.
  const safe = path.basename(file);
  const ext = path.extname(safe).toLowerCase();
  if (!TYPES[ext]) return new NextResponse('Not found', { status: 404 });

  try {
    const data = await fs.readFile(path.join(LOCAL_MEDIA_DIR, safe));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': TYPES[ext],
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
