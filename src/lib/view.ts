import type { PostView } from '@/lib/services/posts';
import type { PostCardData } from '@/components/PostCard';

/** Maps a hydrated server-side post into the serialisable shape the card uses. */
export function toCardData(view: PostView): PostCardData {
  return {
    id: view.post.id,
    caption: view.post.caption,
    media: view.post.media,
    category: view.post.category,
    tags: view.post.tags,
    shot: view.post.shot,
    featured: view.post.featured,
    boosted: view.post.boosted,
    views: view.post.views,
    createdAt: view.post.created_at,
    likes: view.likes,
    comments: view.comments,
    liked: view.liked,
    following: view.following,
    rating: view.rating.rating,
    ratingCount: view.rating.count,
    myScore: view.myScore,
    myReactions: [],
    shotProgress: view.shot
      ? {
          stage: view.shot.stage,
          cap: view.shot.cap,
          progress: view.shot.progress,
          status: view.shot.status,
        }
      : null,
    reason: view.reason,
    challenge: view.challenge ? { slug: view.challenge.slug, title: view.challenge.title } : null,
    author: {
      id: view.author.id,
      username: view.author.username,
      displayName: view.author.display_name,
      avatarUrl: view.author.avatar_url,
      level: view.authorLevel.level,
      levelName: view.authorLevel.name,
      followers: view.authorFollowers,
    },
  };
}
