import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTopBar } from '@/components/PageTopBar';
import { VideoIcon } from '@/components/Icons';
import { requireViewer } from '@/lib/session';
import { CreateForm } from './CreateForm';
import { TextComposer } from './TextComposer';
import { TEXT_KINDS, TEXT_KIND_COPY, textKindOf, type TextKind } from '@/lib/text-posts';
import { BubbleLinesIcon, ChevronIcon, StoryIcon } from '@/components/Icons';

/**
 * The accent each kind carries, here and in the feed.
 *
 * Blue, purple, pink — three coordinated colours rather than three unrelated
 * ones, and the same association the bubbles use: a story's bubble is tinted
 * toward this purple, and a big message's default colour runs through this pink.
 */
const TEXT_KIND_LOOK: Record<
  TextKind,
  { Icon: typeof BubbleLinesIcon; tile: string; ink: string }
> = {
  short: { Icon: BubbleLinesIcon, tile: 'bg-[#38BDF8]/15', ink: 'text-[#7DD3FC]' },
  story: { Icon: StoryIcon, tile: 'bg-aura/15', ink: 'text-aura' },
  big: { Icon: BubbleLinesIcon, tile: 'bg-fay/15', ink: 'text-fay' },
};

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
} as const;

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; text?: string }>;
}) {
  const { kind, text } = await searchParams;
  const lead = kind === 'photo' ? 'photo' : 'text';
  const copy = LEADS[lead];
  const viewer = await requireViewer('/create');
  /**
   * The three-way choice belongs to the TEXT entry point, not to this route.
   *
   * Arriving with no `kind` at all — an old link, a bookmark, an empty state's
   * CTA — is the page it has always been: words and a picker, nothing taken
   * away. Only somebody who said "Text" is asked which of the three they meant.
   */
  const choosing = kind === 'text';
  const textKind = choosing ? textKindOf(text) : null;

  return (
    <>
      <PageTopBar title={copy.title} />
      <div className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
        <div className="mb-6">
          {/* Named after what it makes rather than after the verb: this is one of
              several places that make something now, and "Create" said nothing
              about which. */}
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-white/45">
            {choosing && !textKind ? 'What do you want to post?' : copy.blurb}
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

            {!choosing ? (
              <CreateForm lead={lead} />
            ) : textKind ? (
              <TextComposer kind={textKind} />
            ) : (
              /* Which of the three. A link each rather than a control, so a
                 composer can be linked to directly and the back button goes
                 back to the choice rather than out of the page.

                 Each carries its own accent — blue, purple, pink — and the feed
                 carries the same association through: a story's bubble is
                 tinted toward its purple, a big message's default colour is the
                 pink. The colour is how somebody recognises which of the three
                 they are looking at before they read a word. */
              <div className="space-y-3" data-text-chooser>
                {TEXT_KINDS.map((option) => {
                  const { Icon, tile, ink } = TEXT_KIND_LOOK[option];
                  return (
                    <Link
                      key={option}
                      href={`/create?kind=text&text=${option}`}
                      data-text-kind={option}
                      className="card flex w-full items-center gap-4 p-4 transition hover:bg-white/[0.06]"
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${tile} ${ink}`}
                      >
                        {option === 'big' ? (
                          <span className="font-statement text-[26px] leading-none">Aa</span>
                        ) : (
                          <Icon width={26} height={26} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-[17px] font-bold">
                          {TEXT_KIND_COPY[option].label}
                        </span>
                        <span className="mt-0.5 block text-sm text-white/55">
                          {TEXT_KIND_COPY[option].hint}
                        </span>
                        {TEXT_KIND_COPY[option].limits.map((line) => (
                          <span key={line} className="mt-1 block text-[12px] text-white/35">
                            {line}
                          </span>
                        ))}
                      </span>
                      <ChevronIcon width={18} height={18} className="shrink-0 text-white/30" />
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
