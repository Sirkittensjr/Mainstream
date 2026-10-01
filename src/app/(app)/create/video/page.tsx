import type { Metadata } from 'next';
import Link from 'next/link';
import { VideoStudio } from '@/components/video/VideoStudio';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Record' };
export const dynamic = 'force-dynamic';

/**
 * The camera.
 *
 * Its own route, and deliberately bare: no page title, no tabs, no card around
 * it. On a phone the studio opens the camera the moment this mounts, so what
 * somebody sees after tapping + is a viewfinder — not a page with a viewfinder
 * on it. The only chrome here is what shows when the camera cannot be the answer
 * (a desktop without a webcam somebody wants to use, or a suspended account).
 *
 * Photo and text posts are not here. They are at /create and on the profile, and
 * keeping them out is the point: + means record a video.
 */
export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ upload?: string }>;
}) {
  const { upload } = await searchParams;
  const viewer = await requireViewer('/create/video');

  if (viewer.status !== 'active') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="card p-6">
          <p className="font-display text-lg font-bold">Your account is suspended.</p>
          <p className="mt-2 text-sm text-white/55">
            {viewer.status_reason ?? 'A moderator paused posting on this account.'} You can still
            browse and read the{' '}
            <Link href="/rules" className="underline">
              community rules
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  // A padded column, because the camera and the editor do not live in it: both
  // are `fixed inset-0`, so they cover the screen whatever wraps them, and the
  // wrapper is there for the two stages that are ordinary page content — the
  // chooser and the posting screen. Without it the posting form ran edge to
  // edge and its full-bleed Post bar (`-mx-4`) pushed the document 16px wider
  // than the viewport, which scrolled the whole page sideways and left the
  // controls underneath it unclickable. Measured on a 390px phone: 406px wide.
  //
  // `?upload=1` is the profile's "upload a video": somebody who already has the
  // file does not want their camera switched on to hand it over.
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <VideoStudio start={upload ? 'chooser' : 'camera'} />
    </div>
  );
}
