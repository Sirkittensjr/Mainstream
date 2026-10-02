import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { VideoIcon } from '@/components/Icons';
import { requireViewer } from '@/lib/session';
import { CreateForm } from './CreateForm';

export const metadata: Metadata = { title: 'New post' };
export const dynamic = 'force-dynamic';

/**
 * What the Create post sheet said somebody came here for.
 *
 * It changes the heading and which half of the composer leads — nothing else.
 * Both kinds post through the same action and neither loses anything the other
 * has, so arriving here with no `kind` at all (an old link, a bookmark, an empty
 * state's CTA) is the same page it always was.
 */
const LEADS = {
  photo: {
    title: 'New photo post',
    blurb: 'Pick your pictures, then say something about them.',
  },
  text: {
    title: 'Write something',
    blurb: 'Just words. Add a picture if you want one.',
  },
  /*
   * Nobody said which — an empty state's "Create a post", an old link, a
   * bookmark. It used to land on "Write something", which reads as the wrong
   * page when the button that got you here said post, so it says what it
   * actually is: the composer, with both halves on it.
   */
  post: {
    title: 'New post',
    blurb: 'Words, pictures, or both. Say what you are into.',
  },
} as const;

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  // Which half leads the composer, and which heading it is given. They are not
  // the same question: with nothing asked for, the words lead and the heading
  // stays neutral.
  const lead = kind === 'photo' ? 'photo' : 'text';
  const copy = LEADS[kind === 'photo' ? 'photo' : kind === 'text' ? 'text' : 'post'];
  const viewer = await requireViewer('/create');

  return (
    <>
      <PageTopBar title={copy.title} />
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
        <div className="mb-6">
          {/* Named after what it makes rather than after the verb: this is one of
              several places that make something now, and "Create" said nothing
              about which. */}
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-white/45">{copy.blurb}</p>
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
            <CreateForm lead={lead} />
          </>
        )}
      </div>
    </>
  );
}
