import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { PageTopBar } from '@/components/PageTopBar';
import { PostList } from '@/components/PostList';
import { hashtagHref, normaliseHashtag } from '@/lib/hashtags';
import { HASHTAG_MAX, HASHTAG_PAGE, hashtagPage } from '@/lib/services/hashtags';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The tag as it arrived in the address, decoded once whichever way Next handed it over. */
function fromAddress(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const normalised = normaliseHashtag(fromAddress(tag));
  return { title: normalised ? `#${normalised}` : 'Hashtag' };
}

/**
 * One hashtag's page: every public video, photo and text post that carries it,
 * from everybody who used it, newest first.
 *
 * One page per hashtag whatever the capitalisation — `/tag/Gaming` and
 * `/tag/%23GAMING` are sent on to `/tag/gaming` — and what is shown is decided
 * on the server, per viewer, by the same rules as the feeds: nothing removed,
 * hidden for review, by a suspended account or by somebody blocked in either
 * direction. See lib/services/hashtags.ts.
 */
export default async function HashtagPage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ tag: raw }, { show }] = await Promise.all([params, searchParams]);
  const asked = fromAddress(raw);
  const tag = normaliseHashtag(asked);
  if (!tag) notFound();

  const requested = Number.parseInt(show ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, HASHTAG_PAGE), HASHTAG_MAX)
    : HASHTAG_PAGE;

  // Every spelling of a hashtag is the same page, at one address.
  if (asked !== tag) {
    redirect(`${hashtagHref(tag)}${limit > HASHTAG_PAGE ? `?show=${limit}` : ''}`);
  }

  const viewer = await getViewer();
  const page = await hashtagPage(tag, viewer?.id ?? null, limit);
  if (!page) notFound();

  const moreHref = `${hashtagHref(tag)}?show=${Math.min(limit + HASHTAG_PAGE, HASHTAG_MAX)}`;

  return (
    <>
      {/* No title in the bar: the hashtag below is this page's one heading. */}
      <PageTopBar />
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:max-w-[768px] lg:px-6 lg:pt-8 2xl:max-w-[808px]">
        <header className="mb-5 px-1" data-hashtag-page={page.tag}>
          <p className="label">Hashtag</p>
          <h1 className="mt-1 break-words font-display text-3xl font-extrabold tracking-tight lg:text-4xl">
            #{page.display}
          </h1>
          <p className="mt-2 text-sm text-white/45">
            Public videos, photos and posts from everyone who used #{page.display}, newest first.
          </p>
        </header>

        <PostList
          posts={page.posts}
          viewerId={viewer?.id ?? null}
          empty={
            <EmptyState
              title={`Nothing public uses #${page.display} yet`}
              body={`When somebody posts a video, photo or message with #${page.display}, it shows up here. It could be you.`}
              cta={viewer ? { href: '/create', label: 'Make a post' } : { href: '/signup', label: 'Join FayTarra' }}
            />
          }
        />

        <LoadMore
          href={moreHref}
          hasMore={page.hasMore && limit < HASHTAG_MAX}
          endNote={page.posts.length > 0 ? `That is everything public with #${page.display}.` : undefined}
        />
      </div>
    </>
  );
}
