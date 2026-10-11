import 'server-only';
import {
  pickShowcase,
  showcaseThumb,
  withPreviews,
  SHOWCASE_MAX,
  type ShowcaseCard,
  type ShowcasePostCard,
} from '@/lib/landing';
import { hydratePosts, visiblePosts } from './posts';
import { ratingsIndex } from './ratings';

/**
 * The landing page's carousel: real public posts, topped up with previews.
 *
 * Read as nobody — the visitor has not signed in, and the page should show
 * the same posts to everyone who has not. `visiblePosts` already leaves out
 * removed posts, posts under review and suspended accounts.
 */
export async function landingShowcase(): Promise<ShowcaseCard[]> {
  const [posts, index] = await Promise.all([visiblePosts(null), ratingsIndex()]);
  const picked = pickShowcase(
    posts.map((post) => ({
      post,
      id: post.id,
      authorId: post.author_id,
      category: post.category,
      media: post.media,
      contentWarning: post.content_warning === true,
      score: index.posts.get(post.id)?.score ?? 0,
      createdAt: post.created_at,
    })),
    SHOWCASE_MAX,
  );

  const views = await hydratePosts(
    picked.map((entry) => entry.post),
    null,
  );
  const real = views.flatMap((view): ShowcasePostCard[] => {
    const thumb = showcaseThumb(view.post.media);
    if (!thumb) return [];
    return [
      {
        type: 'post',
        id: view.post.id,
        thumb,
        caption: view.post.caption,
        category: view.post.category,
        author: {
          username: view.author.username,
          displayName: view.author.display_name,
          avatarUrl: view.author.avatar_url,
        },
        rating: view.rating.rating,
        votes: view.rating.votes,
        likes: view.likes,
      },
    ];
  });

  return withPreviews(real);
}
