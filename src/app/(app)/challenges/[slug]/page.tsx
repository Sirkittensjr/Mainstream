import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, SectionHeader } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { TrophyIcon } from '@/components/Icons';
import { getChallengeBySlug, getChallengeDetail } from '@/lib/services/challenges';
import { getViewer } from '@/lib/session';
import { formatDate, timeLeft } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const challenge = await getChallengeBySlug(slug);
  return { title: challenge ? challenge.title : 'Challenge' };
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();
  const detail = await getChallengeDetail(slug, viewer);
  if (!detail) notFound();

  const { challenge, state } = detail;

  return (
    <>
      <PageTopBar title="Challenge" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <header
          className="card p-6 sm:p-8"
          style={{
            backgroundImage:
              'linear-gradient(130deg, rgba(255,92,57,0.2), rgba(124,92,255,0.12))',
          }}
        >
          <p className="label flex items-center gap-2">
            <TrophyIcon width={14} height={14} />
            {state === 'live' ? 'Live challenge' : state === 'upcoming' ? 'Starting soon' : 'Finished'}
          </p>
          <h1 className="mt-3 font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tight sm:text-5xl">
            {challenge.title}
          </h1>
          <p className="mt-4 text-white/65">{challenge.description}</p>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Entries" value={detail.entries.toLocaleString()} />
            <Stat label="Creators" value={detail.creators.toLocaleString()} />
            <Stat
              label={state === 'ended' ? 'Ended' : 'Closes'}
              value={state === 'live' ? timeLeft(challenge.ends_at) : formatDate(challenge.ends_at)}
            />
            <Stat label="Opened" value={formatDate(challenge.starts_at)} />
          </dl>

          {state === 'live' && (
            <Link
              href={viewer ? `/create?challenge=${challenge.slug}` : '/signup'}
              className="btn-primary mt-6 w-full py-4 sm:w-auto sm:px-8"
            >
              {detail.entered ? 'Add another entry' : 'Enter this challenge'}
            </Link>
          )}
        </header>

        {detail.featured.length > 0 && (
          <section className="mt-8">
            <SectionHeader
              title="Featured entries"
              subtitle="Picked for the whole platform to see"
            />
            <PostList posts={detail.featured} viewerId={viewer?.id ?? null} />
          </section>
        )}

        <section className="mt-8">
          <SectionHeader title="All entries" subtitle={`${detail.entries} so far`} />
          <PostList
            posts={detail.entriesList}
            viewerId={viewer?.id ?? null}
            empty={
              <EmptyState
                title="No entries yet"
                body="Nobody has entered this one. First entry gets the whole page to itself."
                cta={{ href: `/create?challenge=${challenge.slug}`, label: 'Enter first' }}
              />
            }
          />
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-white/40">{label}</dt>
      <dd className="mt-0.5 font-display text-sm font-bold">{value}</dd>
    </div>
  );
}
