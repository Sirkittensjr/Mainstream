import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, SectionHeader } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { ArrowIcon, TrophyIcon } from '@/components/Icons';
import { listChallenges } from '@/lib/services/challenges';
import { getViewer } from '@/lib/session';
import { formatShortDate, timeLeft } from '@/lib/time';

export const metadata: Metadata = { title: 'Challenges' };
export const dynamic = 'force-dynamic';

export default async function ChallengesPage() {
  const viewer = await getViewer();
  const challenges = await listChallenges(viewer?.id ?? null);
  const live = challenges.filter((entry) => entry.state === 'live');
  const upcoming = challenges.filter((entry) => entry.state === 'upcoming');
  const ended = challenges.filter((entry) => entry.state === 'ended');
  const headline = live[0];

  return (
    <>
      <PageTopBar title="Challenges" />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:pt-8">
        <div className="mb-5 hidden lg:block">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Challenges</h1>
          <p className="mt-1 text-white/45">
            Same prompt, same start line, everyone from zero. Entries are worth 25 RISE points.
          </p>
        </div>

        {headline && (
          <Link
            href={`/challenges/${headline.challenge.slug}`}
            className="card mb-6 block overflow-hidden p-6 transition hover:border-white/20 sm:p-8"
            style={{
              backgroundImage:
                'linear-gradient(130deg, rgba(255,92,57,0.22), rgba(124,92,255,0.14))',
            }}
          >
            <p className="label flex items-center gap-2">
              <TrophyIcon width={14} height={14} /> Weekly challenge
            </p>
            <h2 className="mt-3 font-display text-3xl font-extrabold uppercase leading-[0.95] tracking-tight sm:text-4xl">
              {headline.challenge.title}
            </h2>
            <p className="mt-3 text-white/65">{headline.challenge.description}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
              <span className="chip border-solar/40 bg-solar/10 text-solar">
                {timeLeft(headline.challenge.ends_at)}
              </span>
              <span className="chip">{headline.entries} entries</span>
              <span className="chip">{headline.creators} creators</span>
              {headline.entered && (
                <span className="chip border-mint/40 bg-mint/10 text-mint">You entered</span>
              )}
            </div>
            <span className="mt-6 inline-flex items-center gap-2 font-semibold text-white">
              See entries <ArrowIcon width={16} height={16} />
            </span>
          </Link>
        )}

        {live.length > 1 && (
          <section className="mb-8">
            <SectionHeader title="Also live" subtitle="Enter as many as you want" />
            <ul className="space-y-3">
              {live.slice(1).map((entry) => (
                <ChallengeRow key={entry.challenge.id} entry={entry} />
              ))}
            </ul>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="mb-8">
            <SectionHeader title="Starting soon" />
            <ul className="space-y-3">
              {upcoming.map((entry) => (
                <ChallengeRow key={entry.challenge.id} entry={entry} />
              ))}
            </ul>
          </section>
        )}

        {ended.length > 0 && (
          <section className="mb-10">
            <SectionHeader title="Finished" subtitle="Entries stay up — go see who won the room" />
            <ul className="space-y-3">
              {ended.map((entry) => (
                <ChallengeRow key={entry.challenge.id} entry={entry} />
              ))}
            </ul>
          </section>
        )}

        {challenges.length === 0 && (
          <EmptyState
            title="No challenges yet"
            body="Weekly challenges show up here. In the meantime, post something — everything is eligible for Discover."
            cta={{ href: '/create', label: 'Create a post' }}
          />
        )}
      </div>
    </>
  );
}

function ChallengeRow({
  entry,
}: {
  entry: Awaited<ReturnType<typeof listChallenges>>[number];
}) {
  const { challenge, state } = entry;
  return (
    <li>
      <Link
        href={`/challenges/${challenge.slug}`}
        className="card flex items-center gap-4 p-5 transition hover:border-white/20"
      >
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold">{challenge.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-white/50">{challenge.description}</p>
          <p className="mt-2 text-xs text-white/35">
            {state === 'live'
              ? timeLeft(challenge.ends_at)
              : state === 'upcoming'
                ? `Starts ${formatShortDate(challenge.starts_at)}`
                : `Ended ${formatShortDate(challenge.ends_at)}`}
            {' · '}
            {entry.entries} entries
            {entry.entered ? ' · you entered' : ''}
          </p>
        </div>
        <ArrowIcon className="shrink-0 text-white/30" />
      </Link>
    </li>
  );
}
