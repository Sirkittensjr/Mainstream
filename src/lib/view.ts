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
    views: view.post.views,
    createdAt: view.post.created_at,
    likes: view.likes,
    comments: view.comments,
    liked: view.liked,
    following: view.following,
    rating: view.rating.rating,
    ratingVotes: view.rating.votes,
    myScore: view.myScore,
    reason: view.reason,
    author: {
      id: view.author.id,
      username: view.author.username,
      displayName: view.author.display_name,
      avatarUrl: view.author.avatar_url,
      followers: view.authorFollowers,
      rating: view.authorRating,
    },
  };
}
