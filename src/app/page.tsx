import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { Logo } from '@/components/Nav';
import { RatingPill } from '@/components/RatingPill';
import { ArrowIcon, CompassIcon, PeopleIcon, PlusIcon, StarIcon } from '@/components/Icons';
import { LandingNav } from '@/components/landing/LandingNav';
import { PreviewArt } from '@/components/landing/PreviewArt';
import { ShowcaseCarousel } from '@/components/landing/ShowcaseCarousel';
import { formatRating, formatVotes, TREND_ARROW, type Trend } from '@/lib/ratings';
import { landingShowcase } from '@/lib/services/landing';
import { rankings, type RankedUser } from '@/lib/services/rankings';
import { isFollowing } from '@/lib/services/users';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Exactly three. Following is a feature of FayTarra, not a selling point of this page. */
const FEATURES = [
  {
    title: 'Post anything',
    body: 'Photos, video, or just a thought. Pick a category so the right people find it.',
    Icon: PlusIcon,
    glow: 'rgba(255, 61, 154, 0.28)',
    tile: 'from-fay/30 to-fay/5 text-fay-soft',
    line: 'via-fay/60',
  },
  {
    title: 'Rate what you like',
    body: 'Everyone can rate posts and profiles out of 10. Helpful, fun, and all community driven.',
    Icon: StarIcon,
    glow: 'rgba(255, 180, 67, 0.24)',
    tile: 'from-solar/30 to-solar/5 text-solar',
    line: 'via-solar/60',
  },
  {
    title: 'Find your people',
    body: 'Music, art, gaming, food, jokes, random moments — whatever you are into.',
    Icon: PeopleIcon,
    glow: 'rgba(124, 92, 255, 0.3)',
    tile: 'from-aura/35 to-aura/5 text-[#B9A8FF]',
    line: 'via-aura/70',
  },
] as const;

export default async function LandingPage() {
  const viewer = await getViewer();
  const [top, showcase] = await Promise.all([
    rankings({ board: 'overall', limit: 5 }),
    landingShowcase(),
  ]);

  // The best rated person on FayTarra, when anybody has enough ratings to be
  // ranked at all. Until then the card is an example, and says so.
  const featured = top[0] ?? null;
  const featuredIsViewer = Boolean(viewer && featured && featured.user.id === viewer.id);
  const followingFeatured =
    viewer && featured && !featuredIsViewer ? await isFollowing(viewer.id, featured.user.id) : false;

  return (
    <div className="relative isolate min-h-dvh">
      <Ambient />
      <LandingNav signedIn={Boolean(viewer)} />

      <main>
        {/* Hero ----------------------------------------------------------- */}
        {/* Full width and clipped, so the cards either side run off the edge of
            the screen rather than widening the page. */}
        <section aria-labelledby="landing-title" className="overflow-hidden">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-6 lg:pb-20 lg:pt-16">
            <div className="animate-fade-up motion-reduce:animate-none">
              <h1
                id="landing-title"
                className="font-display font-extrabold uppercase tracking-[-0.045em]"
              >
                <span className="block gradient-text pb-1 text-[16.5vw] leading-[0.84] sm:text-[6.5rem] lg:text-[5.4rem] xl:text-[6.9rem]">
                  FAYTARRA
                </span>
                <span className="mt-4 block text-[7.6vw] leading-[0.98] text-white sm:text-5xl lg:text-[2.6rem] xl:text-[3.25rem]">
                  WHERE THE COMMUNITY DECIDES WHAT THEY LIKE.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/65 sm:text-lg">
                Share what you’re into. Discover new creators. Post photos, videos, thoughts,
                art, gaming, music, jokes, and anything else you enjoy.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {viewer ? (
                  <Link href="/home" className="btn-primary px-7 py-3.5 text-base">
                    Open FayTarra
                  </Link>
                ) : (
                  <Link href="/signup" data-landing-hero-join className="btn-primary px-7 py-3.5 text-base">
                    Join FayTarra
                  </Link>
                )}
                <Link
                  href="/home?tab=recommended"
                  data-landing-explore
                  className="btn-ghost px-7 py-3.5 text-base"
                >
                  <CompassIcon width={18} height={18} /> Explore the community
                </Link>
              </div>
            </div>

            <ShowcaseCarousel
              cards={showcase}
              art={Object.fromEntries(
                showcase.flatMap((card) =>
                  card.type === 'preview' ? [[card.art, <PreviewArt key={card.art} art={card.art} />]] : [],
                ),
              )}
            />
          </div>
        </section>

        {/* Features ------------------------------------------------------- */}
        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto max-w-7xl scroll-mt-24 px-4 py-8 sm:px-6 lg:py-12"
        >
          <h2 id="features-title" className="sr-only">
            What you can do on FayTarra
          </h2>
          <div className="grid gap-4 md:grid-cols-3 lg:gap-5" data-landing-features>
            {FEATURES.map(({ title, body, Icon, glow, tile, line }) => (
              <article
                key={title}
                data-landing-feature
                className="card relative overflow-hidden p-6 sm:p-7"
              >
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent ${line} to-transparent`}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full"
                  style={{ backgroundImage: `radial-gradient(closest-side, ${glow}, transparent)` }}
                />
                <span
                  aria-hidden
                  className={`relative grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br ${tile}`}
                >
                  <Icon width={22} height={22} />
                </span>
                <h3 className="relative mt-5 font-display text-xl font-bold text-white">
                  {title}
                </h3>
                <p className="relative mt-2 text-[15px] leading-relaxed text-white/60">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Ratings -------------------------------------------------------- */}
        <section id="about" aria-labelledby="ratings-title" className="scroll-mt-16 overflow-hidden">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-20">
            <div>
              <p className="label">How FayTarra works</p>
              <h2
                id="ratings-title"
                className="mt-3 font-display text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl"
              >
                A rating that <span className="gradient-text">means something.</span>
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/60">
                Every profile has an overall rating from everything you have been rated on, and a
                last 30 days rating that shows how people are responding lately.
              </p>
            </div>
            <ProfilePreview
              featured={featured}
              signedIn={Boolean(viewer)}
              ownProfile={featuredIsViewer}
              following={followingFeatured}
            />
          </div>
        </section>

        {/* Ranked people -------------------------------------------------- */}
        {top.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight">
                  Best rated right now
                </h2>
                <p className="mt-1 max-w-xl text-white/45">
                  Rankings are based on community ratings and the strength of those ratings — not
                  simply how many followers someone has.
                </p>
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

        <section className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
          <div className="card relative overflow-hidden px-6 py-16 text-center sm:px-12">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(40rem 18rem at 50% 0%, rgba(255, 61, 154, 0.16), transparent 70%)',
              }}
            />
            <h2 className="relative font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
              Post something.
              <br />
              <span className="gradient-text">See where it goes.</span>
            </h2>
            <p className="relative mx-auto mt-5 max-w-lg text-white/55">
              Takes about a minute to join. Post the first thing you feel like sharing.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href={viewer ? '/home' : '/signup'} className="btn-primary px-8 py-4 text-base">
                {viewer ? 'Open FayTarra' : 'Join FayTarra'}
              </Link>
              <Link href="/home?tab=recommended" className="btn-ghost px-8 py-4 text-base">
                Browse first
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-sm text-white/35">
          <Logo small />
          <div className="flex flex-wrap gap-4">
            <Link href="/discover" className="-my-3 py-3 hover:text-white">
              Discover
            </Link>
            <Link href="/rules" className="-my-3 py-3 hover:text-white">
              Community rules
            </Link>
          </div>
          <p>Where the community decides what they like.</p>
        </div>
      </footer>
    </div>
  );
}

/** The purple and pink light behind the page. Gradients, not blur filters: cheap on a phone. */
function Ambient() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1400px] overflow-hidden"
    >
      <div
        className="absolute -left-48 top-10 h-[40rem] w-[40rem]"
        style={{ backgroundImage: 'radial-gradient(closest-side, rgba(255, 61, 154, 0.2), transparent)' }}
      />
      <div
        className="absolute -right-40 -top-24 h-[46rem] w-[46rem]"
        style={{ backgroundImage: 'radial-gradient(closest-side, rgba(124, 92, 255, 0.26), transparent)' }}
      />
      <div
        className="absolute left-1/3 top-[44rem] h-[34rem] w-[34rem]"
        style={{ backgroundImage: 'radial-gradient(closest-side, rgba(124, 92, 255, 0.14), transparent)' }}
      />
    </div>
  );
}

/**
 * A profile card, as it looks on FayTarra.
 *
 * The real best rated person when there is one — their actual numbers, from
 * the same rankings Discover shows. Otherwise an example with a placeholder
 * name and numbers labelled as examples, so nothing on this page claims a
 * rating that nobody gave.
 */
function ProfilePreview({
  featured,
  signedIn,
  ownProfile,
  following,
}: {
  featured: RankedUser | null;
  signedIn: boolean;
  ownProfile: boolean;
  following: boolean;
}) {
  const example = featured === null;
  const name = featured?.user.display_name ?? 'Your name';
  const username = featured?.user.username ?? 'yourname';

  return (
    <div className="relative" data-landing-profile={example ? 'example' : 'live'}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 rounded-[3rem]"
        style={{
          backgroundImage:
            'radial-gradient(closest-side, rgba(255, 61, 154, 0.18), rgba(124, 92, 255, 0.1) 55%, transparent)',
        }}
      />
      <div className="card relative overflow-hidden p-5 sm:p-7">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-fay/60 to-transparent"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
            {example ? 'Example profile' : 'Top rated right now'}
          </span>
          {!example && (
            <Link
              href={`/u/${username}`}
              className="inline-flex items-center gap-1 text-sm text-white/55 transition hover:text-white"
            >
              View profile <ArrowIcon width={14} height={14} />
            </Link>
          )}
        </div>

        <div className="mt-6 flex items-center gap-4">
          <Avatar
            username={username}
            displayName={name}
            src={featured?.user.avatar_url ?? null}
            size="lg"
            href={example ? false : undefined}
            ring
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-bold text-white sm:text-2xl">{name}</p>
            <p className="truncate text-sm text-white/45">@{username}</p>
          </div>
          {example ? (
            <Link
              href="/signup"
              aria-label="Follow — join FayTarra to follow people"
              className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-white/90"
            >
              Follow
            </Link>
          ) : (
            !ownProfile && (
              <FollowButton
                userId={featured.user.id}
                initialFollowing={following}
                signedIn={signedIn}
              />
            )
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <RatingStat
            label="Overall rating"
            value={example ? 8.6 : featured.overall}
            note={example ? 'Example' : formatVotes(featured.overallVotes)}
          />
          <RatingStat
            label="Last 30 days"
            value={example ? 9.2 : featured.recentVotes > 0 ? featured.recent : null}
            trend={example ? 'up' : featured.trend}
            note={
              example
                ? 'Example'
                : featured.recentVotes > 0
                  ? `${formatVotes(featured.recentVotes)} this month`
                  : 'No ratings this month'
            }
          />
        </div>

        {example && (
          <p className="mt-4 text-xs leading-relaxed text-white/40">
            An example of a profile card. Every number on yours comes from real ratings.
          </p>
        )}
      </div>
    </div>
  );
}

function RatingStat({
  label,
  value,
  note,
  trend,
}: {
  label: string;
  value: number | null;
  note: string;
  trend?: Trend;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <p className="label">{label}</p>
      <p className="mt-2 flex items-baseline gap-1 font-display font-extrabold tabular-nums">
        <span className="gradient-text text-4xl sm:text-5xl">{formatRating(value)}</span>
        {trend && trend !== 'steady' && value !== null && (
          <span
            className={`text-xl ${trend === 'up' ? 'text-mint' : 'text-white/45'}`}
            aria-label={trend === 'up' ? 'rising' : 'falling'}
          >
            {TREND_ARROW[trend]}
          </span>
        )}
        <span className="ml-0.5 text-base font-bold text-white/30">/10</span>
      </p>
      <p className="mt-1 text-xs text-white/45">{note}</p>
    </div>
  );
}
