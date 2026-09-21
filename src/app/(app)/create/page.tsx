import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { requireViewer } from '@/lib/session';
import { CreateForm } from './CreateForm';

export const metadata: Metadata = { title: 'Create' };
export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const viewer = await requireViewer('/create');

  return (
    <>
      <PageTopBar title="Create" />
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Create</h1>
          <p className="mt-1 text-white/45">
            A photo, a video, or just something you want to say.
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
          <CreateForm />
        )}
      </div>
    </>
  );
}
