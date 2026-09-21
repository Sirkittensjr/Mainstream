import Link from 'next/link';
import { Logo } from '@/components/Nav';
import { Avatar } from '@/components/Avatar';
import { LevelBadge } from '@/components/LevelBadge';
import { ArrowIcon, CompassIcon, FireIcon, SparkIcon, TrophyIcon } from '@/components/Icons';
import { LEVELS } from '@/lib/progression';
import { RatingPill } from '@/components/RatingPill';
import { activeChallenges } from '@/lib/services/challenges';
import { risingCreatorCards } from '@/lib/services/discover';
import { rankings } from '@/lib/services/rankings';
import { getViewer } from '@/lib/session';
import { timeLeft } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const viewer = await getViewer();
  const [creators, challenges, top] = await Promise.all([
    risingCreatorCards(null, null, 6),
    activeChallenges(),
    rankings({ board: 'rising', period: 'month', limit: 5 }),
  ]);
  const challenge = challenges[0];

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/discover" className="btn-quiet hidden px-4 text-sm sm:inline-flex">
            Explore
          </Link>
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
                Join FayTarra
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero ------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-20">
        <p className="chip animate-fade-up border-fay/30 bg-fay/10 text-fay-soft">
          <FireIcon width={14} height={14} /> New creators get discovered here every day
        </p>
        <h1 className="mt-6 max-w-4xl animate-fade-up font-display text-[15vw] font-extrabold leading-[0.88] tracking-[-0.04em] sm:text-7xl lg:text-8xl">
          EVERYONE
          <br />
          STARTS AT{' '}
          <span className="gradient-text">ZERO.</span>
        </h1>
        <p className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-white/60 sm:text-xl">
          A social platform for people who are still becoming somebody. Creators, musicians,
          gamers, artists, athletes, entrepreneurs — anyone trying to be known for something.
        </p>
        <div className="mt-8 flex animate-fade-up flex-wrap gap-3">
          <Link href="/signup" className="btn-primary px-8 py-4 text-base">
            Join FayTarra
          </Link>
          <Link href="/discover" className="btn-ghost px-8 py-4 text-base">
            <CompassIcon width={18} height={18} /> Explore
          </Link>
        </div>

        <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-4">
          {[
            { value: '0', label: 'Followers needed to be seen' },
            { value: '1–10', label: 'Rated by the community, not bots' },
            { value: '∞', label: 'Chances to get discovered' },
          ].map((stat) => (
            <div key={stat.label} className="card px-4 py-5">
              <dt className="font-display text-3xl font-bold gradient-text">{stat.value}</dt>
              <dd className="mt-1 text-[13px] leading-snug text-white/45">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The promise ------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="card overflow-hidden p-8 sm:p-12">
          <p className="label">How discovery works here</p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">
            Followers do not decide who gets discovered.
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/60">
            On FayTarra, discovery ranks posts by how well they perform{' '}
            <em className="not-italic text-white">relative to the audience you already have</em>.
            Forty people loving a post from an account with twelve followers beats four hundred
            likes on an account with two hundred thousand. Every day, new creators rotate into
            Discover — including you.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: 'Rising',
                body: 'Smaller creators whose work is actually performing. Ranked by momentum, not size.',
              },
              {
                title: 'Give me a shot',
                body: 'Ask the community to discover you. Shot posts rotate through Discover so everyone gets a turn.',
              },
              {
                title: 'Challenges',
                body: 'Weekly prompts everyone enters from zero. Best entries get featured to the whole platform.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/[0.07] p-5">
                <h3 className="font-display text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Creators --------------------------------------------------------- */}
      {creators.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-10">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight">
                People rising right now
              </h2>
              <p className="mt-1 text-white/45">
                Real accounts on FayTarra today. Most of them started this month.
              </p>
            </div>
            <Link href="/discover" className="btn-ghost hidden px-5 py-2.5 text-sm sm:inline-flex">
              See Discover <ArrowIcon width={16} height={16} />
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {creators.map((creator) => (
              <li key={creator.user.id} className="card flex items-center gap-4 p-5">
                <Avatar
                  username={creator.user.username}
                  displayName={creator.user.display_name}
                  src={creator.user.avatar_url}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold">
                    {creator.user.display_name}
                  </p>
                  <p className="truncate text-sm text-white/40">@{creator.user.username}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RatingPill value={creator.rating} trend={creator.trend} size="sm" />
                    <LevelBadge level={creator.level} name={creator.levelName} size="xs" />
                    <span className="text-xs text-white/40">
                      {creator.followers} followers
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Challenge -------------------------------------------------------- */}
      {challenge && (
        <section className="mx-auto max-w-6xl px-5 py-10">
          <div
            className="card relative overflow-hidden p-8 sm:p-12"
            style={{
              backgroundImage:
                'linear-gradient(120deg, rgba(255,61,154,0.18), rgba(124,92,255,0.12))',
            }}
          >
            <p className="label flex items-center gap-2">
              <TrophyIcon width={14} height={14} /> Weekly challenge
            </p>
            <h2 className="mt-3 font-display text-4xl font-extrabold uppercase tracking-tight sm:text-5xl">
              {challenge.title}
            </h2>
            <p className="mt-4 max-w-xl text-lg text-white/65">{challenge.description}</p>
            <p className="mt-4 text-sm font-semibold text-solar">{timeLeft(challenge.ends_at)}</p>
            <Link href={`/challenges/${challenge.slug}`} className="btn-primary mt-7">
              See the entries
            </Link>
          </div>
        </section>
      )}

      {/* Ratings ---------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="label">The FayTarra rating</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold leading-tight sm:text-4xl">
          A number that answers how well you are actually doing.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/60">
          Followers and likes still exist. They are not your rating. Anyone can rate a post or a
          profile from 1 to 10 and add a reaction, and those ratings become two separate numbers.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <RatingPill value={8.7} size="lg" />
              <h3 className="font-display text-xl font-bold">Overall rating</h3>
            </div>
            <p className="mt-3 leading-relaxed text-white/55">
              Your long-term reputation. It moves slowly, because it weighs every rating you have
              ever received alongside consistency, engagement, growth, challenges and how long you
              have been here. One bad post does not sink it.
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-3">
              <RatingPill value={9.4} trend="up" size="lg" />
              <h3 className="font-display text-xl font-bold">Current rating</h3>
            </div>
            <p className="mt-3 leading-relaxed text-white/55">
              How you are doing right now, from the last 30 days only. It starts at your overall
              rating and moves fast. Post something great this week and it climbs; go quiet and it
              drifts back down.
            </p>
          </div>
        </div>

        <div className="card mt-4 p-6">
          <h3 className="font-display text-xl font-bold">Ratings you cannot buy or fake</h3>
          <p className="mt-3 max-w-3xl leading-relaxed text-white/55">
            One rating per person per post. Brand new accounts carry less weight until they are
            real participants. Rate the same creator over and over and your weight collapses. Hard
            daily limits, duplicate prevention, blocking, reporting and a moderation queue sit
            behind all of it. You will eventually be able to pay to be <em className="not-italic text-white">seen</em>
            {' '}— never to be rated higher.
          </p>
        </div>
      </section>

      {/* Ranking ---------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="label">Ranking</p>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">
              500 followers can outrank 50,000.
            </h2>
            <p className="mt-4 leading-relaxed text-white/60">
              Rank is built from your rating, your recent response, your growth relative to the
              audience you already had, and whether you show up. Overall, Current and Rising, by
              category and by day, week, month or all time. Your profile keeps the history so you
              can watch yourself climb.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/rankings" className="btn-ghost px-6 py-3">
                See the rankings
              </Link>
              <Link href="/signup" className="btn-primary px-6 py-3">
                Get your rating
              </Link>
            </div>
          </div>

          <ol className="card divide-y divide-white/[0.06] p-2">
            {top.map((row) => (
              <li key={row.user.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 font-display text-lg font-extrabold text-white/30">
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row.user.display_name}</span>
                  <span className="block truncate text-xs text-white/40">
                    @{row.user.username} · {row.followers} followers
                  </span>
                </span>
                <RatingPill value={row.current} trend={row.trend} size="sm" />
              </li>
            ))}
            {top.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-white/40">
                The first rankings appear as soon as people start rating.
              </li>
            )}
          </ol>
        </div>
      </section>

      {/* Levels ----------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-display text-3xl font-bold tracking-tight">
          Create → Get rated → Improve → Rise
        </h2>
        <p className="mt-2 max-w-2xl text-white/50">
          Alongside your rating you earn FayTarra points for taking part — posting, being rated,
          commenting, entering challenges, showing up. Points cannot be bought, only earned.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((level) => (
            <li key={level.level} className="card p-5">
              <p className="font-display text-sm font-bold text-fay">LEVEL {level.level}</p>
              <p className="mt-1 font-display text-xl font-bold">{level.name}</p>
              <p className="mt-2 text-[13px] leading-snug text-white/45">{level.blurb}</p>
              <p className="mt-3 text-xs text-white/30">
                {level.minPoints.toLocaleString()} points
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Closer ----------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 pb-24 pt-8">
        <div className="card px-6 py-16 text-center sm:px-12">
          <SparkIcon width={28} height={28} className="mx-auto text-solar" />
          <h2 className="mt-6 font-display text-4xl font-extrabold uppercase leading-[0.95] tracking-tight sm:text-6xl">
            Create. Compete.
            <br />
            <span className="gradient-text">Get Discovered. Rise.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-white/55">
            Takes about ninety seconds to join. Your first post can be on Discover today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-primary px-8 py-4 text-base">
              Join FayTarra
            </Link>
            <Link href="/discover" className="btn-ghost px-8 py-4 text-base">
              Explore first
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
            <Link href="/challenges" className="hover:text-white">
              Challenges
            </Link>
            <Link href="/rankings" className="hover:text-white">
              Rankings
            </Link>
            <Link href="/rules" className="hover:text-white">
              Community rules
            </Link>
          </div>
          <p>Everyone starts at zero.</p>
        </div>
      </footer>
    </div>
  );
}
