import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isAdminRole } from '@/lib/admin-badge';
import { EmptyState } from '@/components/EmptyState';
import { PageTopBar } from '@/components/PageTopBar';
import { VideoFeed } from '@/components/video/VideoFeed';
import { tagHref, tagKey } from '@/lib/hashtags';
import { hashtagVideos } from '@/lib/services/hashtags';
import { getViewer } from '@/lib/session';
import { toCardData } from '@/lib/view';

export const dynamic = 'force-dynamic';

/** The segment as typed, whether or not the router has decoded it already. */
function segment(raw: string): string {
  if (!raw.includes('%')) return raw;
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
  const key = tagKey(segment((await params).tag));
  return { title: key ? `#${key}` : 'Hashtag' };
}

/**
 * One hashtag's videos, in the Videos feed.
 *
 * The same player, the same full-screen feed, the same likes, comments and
 * menus as /videos — only the list is different: every public video that uses
 * this hashtag, newest first. Case does not matter, so every spelling is sent
 * to one address and #Gaming, #gaming and #GAMING are one page.
 */
export default async function HashtagPage({ params }: { params: Promise<{ tag: string }> }) {
  const raw = segment((await params).tag);
  const key = tagKey(raw);
  if (!key) notFound();
  if (raw !== key) redirect(tagHref(key));

  const viewer = await getViewer();
  const page = await hashtagVideos(key, viewer?.id ?? null);
  const others = page.otherPosts;
  const searchHref = `/search?q=${encodeURIComponent(`#${key}`)}`;
  const morePosts = others === 1 ? '1 post' : `${others} posts`;

  if (page.videos.length === 0) {
    return (
      <>
        <PageTopBar title={`#${key}`} />
        <div className="mx-auto max-w-2xl px-4 pt-10" data-hashtag-page={key}>
          <EmptyState
            title={`No videos with #${key} yet`}
            body={
              others > 0
                ? `There ${others === 1 ? 'is' : 'are'} ${morePosts} with #${key}, but no videos yet. Post one and it shows up here.`
                : `Add #${key} to a video when you post it and it shows up here.`
            }
            cta={
              others > 0
                ? { href: searchHref, label: `See ${morePosts} with #${key}` }
                : { href: '/videos', label: 'Watch videos' }
            }
          />
        </div>
      </>
    );
  }

  return (
    <div data-hashtag-page={key}>
      <VideoFeed
        items={page.videos.map(toCardData)}
        title={`#${key}`}
        end={
          others > 0
            ? { href: searchHref, label: `That is every video — see ${morePosts} with #${key}` }
            : { href: '/videos', label: `That is every video with #${key} — more videos` }
        }
        returnTo={tagHref(key)}
        viewerId={viewer?.id ?? null}
        viewer={
          viewer
            ? {
                username: viewer.username,
                displayName: viewer.display_name,
                avatarUrl: viewer.avatar_url,
                isAdmin: isAdminRole(viewer.role),
              }
            : null
        }
      />
    </div>
  );
}
