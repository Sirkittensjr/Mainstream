import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { VideoIcon } from '@/components/Icons';
import { requireViewer } from '@/lib/session';
import { CreateForm } from './CreateForm';

export const metadata: Metadata = { title: 'New post' };
export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const viewer = await requireViewer('/create');

  return (
    <>
      <PageTopBar title="New post" />
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
        <div className="mb-6">
          {/* "New post" rather than "Create": this page is one of three places
              that make something now, and the + button is the other one people
              will reach for. Naming it after what it makes is clearer than
              naming it after the verb. */}
          <h1 className="font-display text-3xl font-extrabold tracking-tight">New post</h1>
          <p className="mt-1 text-white/45">
            A photo and something to say. For a video, use the camera.
          </p>
        </div>

        {viewer.status !== 'active' ? (
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
        ) : (
          <>
            {/* The camera is its own route now. This is the way across for
                somebody who arrived here and wanted to film something. */}
            <Link
              href="/create/video"
              className="btn-ghost mb-5 min-h-[52px] w-full py-3.5"
              data-to-camera
            >
              <VideoIcon width={18} height={18} /> Record a video instead
            </Link>
            <CreateForm />
          </>
        )}
      </div>
    </>
  );
}
