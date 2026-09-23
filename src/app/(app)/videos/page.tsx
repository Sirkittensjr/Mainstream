import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { VideoFeed } from '@/components/video/VideoFeed';
import { VIDEO_PAGE, videoFeed } from '@/lib/services/feed';
import { getViewer } from '@/lib/session';
import { toCardData } from '@/lib/view';

export const metadata: Metadata = { title: 'Videos' };
export const dynamic = 'force-dynamic';

/**
 * Videos: the same recommendation FayTarra runs everywhere else, narrowed to
 * clips and played full screen.
 *
 * `?v=<post id>` opens the feed on one video, which is how a link to a video
 * post leads back into the experience rather than out of it.
 */
export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const viewer = await getViewer();
  const feed = await videoFeed(viewer, VIDEO_PAGE, v ?? null);

  if (feed.posts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10">
        <EmptyState
          title="No videos yet"
          body="Videos posted to FayTarra show up here, full screen. Record or upload one and it is the first thing people see."
          cta={{ href: '/create', label: 'Make a video' }}
        />
      </div>
    );
  }

  return <VideoFeed items={feed.posts.map(toCardData)} viewerId={viewer?.id ?? null} />;
}
