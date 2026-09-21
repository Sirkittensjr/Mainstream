import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowIcon, CompassIcon, PlusIcon, TrophyIcon } from '@/components/Icons';
import { requireViewer } from '@/lib/session';
import { activeChallenges } from '@/lib/services/challenges';

export const metadata: Metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

/** The 30 second orientation a brand new account sees once. */
export default async function WelcomePage() {
  const viewer = await requireViewer('/welcome');
  const challenge = (await activeChallenges())[0];

  const steps = [
    {
      icon: PlusIcon,
      title: 'Post something today',
      body: 'Anything. A clip, a photo, a sentence. Your first post can be rated by anyone, and it goes straight into Discover.',
      href: '/create',
      cta: 'Create your first post',
    },
    {
      icon: CompassIcon,
      title: 'Find five people',
      body: 'Discover ranks by rating and momentum, not follower count. Rate what you like while you are there — it is how everyone here gets a real score.',
      href: '/discover',
      cta: 'Open Discover',
    },
    {
      icon: TrophyIcon,
      title: challenge ? `Enter “${challenge.title}”` : 'Enter a challenge',
      body: 'Challenges are the fastest way to get featured. Entries are worth 25 FayTarra points each.',
      href: challenge ? `/challenges/${challenge.slug}` : '/challenges',
      cta: 'See the challenge',
    },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="chip border-fay/30 bg-fay/10 text-fay-soft">Level 1 — Rookie</p>
      <h1 className="mt-5 font-display text-4xl font-extrabold leading-[0.95] tracking-tight">
        You are in, {viewer.display_name}.
        <br />
        <span className="gradient-text">You start at zero.</span>
      </h1>
      <p className="mt-4 text-white/55">
        So does everyone else here. Three things get you moving — they take about five minutes
        total.
      </p>

      <ol className="mt-8 space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="card p-5">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-fay">
                <step.icon />
              </span>
              <div className="min-w-0">
                <p className="label">Step {index + 1}</p>
                <h2 className="mt-1 font-display text-lg font-bold">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-white/50">{step.body}</p>
                <Link
                  href={step.href}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-fay hover:underline"
                >
                  {step.cta} <ArrowIcon width={15} height={15} />
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Link href="/home" className="btn-ghost mt-8 w-full py-4">
        Go to my feed
      </Link>
    </div>
  );
}
