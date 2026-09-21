import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { Logo } from '@/components/Nav';
import { RatingPill } from '@/components/RatingPill';
import { ArrowIcon, CompassIcon } from '@/components/Icons';
import { MIN_VOTES_FOR_RANKING, formatVotes } from '@/lib/ratings';
import { rankings } from '@/lib/services/rankings';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const viewer = await getViewer();
  const top = await rankings({ board: 'overall', limit: 5 });

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {viewer ? (
            <Link href="/home" className="btn-primary px-5 py-2.5 text-sm">
              Open FayTarra
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost px-4 py-2.5 text-sm">
                Sign in
              </Link>
              <Link href="/signup" className="btn-primary px-5 py-2.5 text-sm">
                Join
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero ------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-20">
        <h1 className="max-w-4xl animate-fade-up font-display font-extrabold uppercase tracking-[-0.04em]">
          <span className="block gradient-text text-[17vw] leading-[0.85] sm:text-8xl lg:text-9xl">
            FAYTARRA
          </span>
          <span className="mt-3 block text-[7.4vw] leading-[0.95] text-white sm:text-4xl lg:text-5xl">
            WHERE THE COMMUNITY DECIDES WHAT THEY LIKE.
          </span>
        </h1>
        <p className="mt-7 max-w-xl animate-fade-up text-lg leading-relaxed text-white/60 sm:text-xl">
          Music, art, gaming, food, jokes, random moments — post whatever you are into.
        </p>
        <p className="mt-4 animate-fade-up font-display text-xl font-bold text-white sm:text-2xl">
          Then everyone weighs in: likes, comments, and a rating out of 10.
        </p>
        <div className="mt-8 flex animate-fade-up flex-wrap gap-3">
          <Link href="/signup" className="btn-primary px-8 py-4 text-base">
            Join FayTarra
          </Link>
          <Link href="/home?tab=recommended" className="btn-ghost px-8 py-4 text-base">
            <CompassIcon width={18} height={18} /> Look around first
          </Link>
        </div>
      </section>

      {/* What it is ------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: 'Post anything',
              body: 'Photos, video, or just a thought. Pick a category so the right people find it.',
            },
            {
              title: 'Follow and get followed',
              body: 'A Following feed for the people you like, and a Recommended feed for everyone else worth seeing.',
            },
            {
              title: 'Rate what is good',
              body: 'Anything can be rated 1–10 — posts and profiles. It is how good work gets noticed here.',
            },
          ].map((item) => (
            <div key={item.title} className="card p-6">
              <h2 className="font-display text-lg font-bold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Ratings ---------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="label">Ratings</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold leading-tight sm:text-4xl">
          A rating that means something.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/60">
          Every profile carries two numbers: an <strong className="text-white">overall</strong>{' '}
          rating built from everything you have ever been rated on, and a{' '}
          <strong className="text-white">last 30 days</strong> rating that moves with how people
          are responding lately.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <RatingPill value={8.7} size="lg" />
              <h3 className="font-display text-xl font-bold">Overall</h3>
            </div>
            <p className="mt-3 leading-relaxed text-white/55">
              Slow and steady. It weighs every rating you have received, so one bad day does not
              move it and one good day does not either.
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <RatingPill value={9.2} trend="up" size="lg" />
              <h3 className="font-display text-xl font-bold">Last 30 days</h3>
            </div>
            <p className="mt-3 leading-relaxed text-white/55">
              How it is going right now. Post something people love this month and it climbs; go
              quiet and it drifts back.
            </p>
          </div>
        </div>

        <div className="card mt-4 p-6">
          <h3 className="font-display text-xl font-bold">Votes count, not just the average</h3>
          <p className="mt-3 max-w-3xl leading-relaxed text-white/55">
            A 10.0 from three friends is not better than a 9.2 from eight hundred people, and
            FayTarra does not pretend otherwise. Ratings are weighted by how much agreement stands
            behind them, and nothing appears in the rankings at all until it has at least{' '}
            {MIN_VOTES_FOR_RANKING} ratings. One rating per person, and new accounts carry less
            weight until they are real participants.
          </p>
        </div>
      </section>

      {/* Ranked people ----------------------------------------------------- */}
      {top.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-10">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight">
                Best rated right now
              </h2>
              <p className="mt-1 text-white/45">Ranked by ratings, never by follower count.</p>
            </div>
            <Link href="/discover" className="btn-ghost hidden px-5 py-2.5 text-sm sm:inline-flex">
              See Discover <ArrowIcon width={16} height={16} />
            </Link>
          </div>
          <ol className="card divide-y divide-white/[0.06] p-2">
            {top.map((row) => (
              <li key={row.user.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 font-display text-lg font-extrabold text-white/30">
                  {row.rank}
                </span>
                <Avatar
                  username={row.user.username}
                  displayName={row.user.display_name}
                  src={row.user.avatar_url}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row.user.display_name}</span>
                  <span className="block truncate text-xs text-white/40">
                    @{row.user.username} · {formatVotes(row.votes)}
                  </span>
                </span>
                <RatingPill value={row.rating} votes={row.votes} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-5 pb-24 pt-8">
        <div className="card px-6 py-16 text-center sm:px-12">
          <h2 className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
            Post something.
            <br />
            <span className="gradient-text">See where it goes.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-white/55">
            Takes about a minute to join. Post the first thing you feel like sharing.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-primary px-8 py-4 text-base">
              Join FayTarra
            </Link>
            <Link href="/home?tab=recommended" className="btn-ghost px-8 py-4 text-base">
              Browse first
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-white/35">
          <Logo small />
          <div className="flex flex-wrap gap-4">
            <Link href="/discover" className="hover:text-white">
              Discover
            </Link>
            <Link href="/rules" className="hover:text-white">
              Community rules
            </Link>
          </div>
          <p>Where the community decides what they like.</p>
        </div>
      </footer>
    </div>
  );
}
