import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Nav';
import { ShieldIcon } from '@/components/Icons';

export const metadata: Metadata = {
  title: 'Community rules',
  description: 'What is and is not allowed on RISE, and how to report it.',
};

const RULES = [
  {
    title: 'No harassment or bullying',
    body: 'Do not pile on, target, or follow someone around the platform. Criticism of work is fine. Attacks on a person are not.',
  },
  {
    title: 'No hate',
    body: 'Nothing that attacks or dehumanises people over race, ethnicity, religion, disability, sex, gender identity, sexual orientation, or national origin.',
  },
  {
    title: 'No threats or violence',
    body: 'No threats, no encouraging harm, no glorifying violence against anyone — including yourself.',
  },
  {
    title: 'No sexual exploitation',
    body: 'Absolutely no sexual content involving minors, no non-consensual imagery, and no sexual content of any kind involving people who cannot consent. This is reported to the authorities, not just removed.',
  },
  {
    title: 'No illegal content',
    body: 'No selling drugs or weapons, no stolen material, no content that breaks the law where you are.',
  },
  {
    title: 'No spam',
    body: 'No mass identical posts, no engagement farming rings, no automated liking. RISE points come from real participation.',
  },
  {
    title: 'No scams',
    body: 'No fake giveaways, no "pay me to grow your account", no crypto pitches disguised as creator advice.',
  },
  {
    title: 'No impersonation',
    body: 'Do not pretend to be someone else or claim a brand, team or person you are not.',
  },
];

export default function RulesPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/home" className="btn-quiet px-4 text-sm">
          Back to RISE
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24">
        <ShieldIcon width={30} height={30} className="text-ember" />
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-5xl">
          The rules are short.
          <br />
          <span className="gradient-text">We enforce them.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-white/55">
          RISE is built for people trying to get somewhere. That only works if the place feels
          safe. Break one of these and your post comes down; do it repeatedly and your account
          goes with it.
        </p>

        <ol className="mt-10 space-y-3">
          {RULES.map((rule, index) => (
            <li key={rule.title} className="card p-6">
              <p className="label">Rule {index + 1}</p>
              <h2 className="mt-2 font-display text-xl font-bold">{rule.title}</h2>
              <p className="mt-2 leading-relaxed text-white/55">{rule.body}</p>
            </li>
          ))}
        </ol>

        <section className="card mt-8 p-6">
          <h2 className="font-display text-xl font-bold">How to report something</h2>
          <p className="mt-2 leading-relaxed text-white/55">
            Every post has a ••• menu with <strong className="text-white">Report</strong>, and
            every profile has one too. Reports go straight to the moderation queue. We never tell
            the other person who reported them. You can also block anyone — that hides you from
            each other and removes any follows in both directions.
          </p>
          <p className="mt-4 leading-relaxed text-white/55">
            You can delete your own posts at any time from the post page.
          </p>
        </section>

        <section className="card mt-4 p-6">
          <h2 className="font-display text-xl font-bold">Privacy and younger users</h2>
          <ul className="mt-3 space-y-2 leading-relaxed text-white/55">
            <li>· RISE is not intended for anyone under 13, and we do not market it to children.</li>
            <li>· We ask for a city or country, never an exact address. Location is optional.</li>
            <li>· Your email is never shown on your profile or to other people.</li>
            <li>· Posts and images are served by RISE itself, not third party trackers.</li>
            <li>· You can delete any post you have made, at any time.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
