import 'server-only';
import { NextResponse } from 'next/server';
import type { PostView } from '@/lib/services/posts';
import type { UserRatingSummary } from '@/lib/services/ratings';
import type { PublicUser, User } from '@/lib/types';

/**
 * Serialisers for the versioned JSON API.
 *
 * The website renders from the same services directly; this module exists so
 * an iOS or Android client can read exactly the same objects over HTTP.
 */

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function serialiseUser(user: PublicUser | User, rating?: UserRatingSummary) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    location: user.location,
    interests: user.interests,
    joinedAt: user.created_at,
    rating: rating
      ? {
          overall: rating.overall,
          overallVotes: rating.overallVotes,
          last30Days: rating.recent,
          last30DaysVotes: rating.recentVotes,
          trend: rating.trend,
          delta: rating.delta,
        }
      : undefined,
  };
}

export function serialisePost(view: PostView) {
  return {
    id: view.post.id,
    caption: view.post.caption,
    media: view.post.media,
    category: view.post.category,
    tags: view.post.tags,
    createdAt: view.post.created_at,
    counts: { likes: view.likes, comments: view.comments, views: view.post.views },
    rating: {
      value: view.rating.rating,
      votes: view.rating.votes,
      reactions: view.rating.reactions.filter((entry) => entry.count > 0),
      mine: view.myScore,
    },
    viewer: { liked: view.liked, following: view.following },
    author: {
      id: view.author.id,
      username: view.author.username,
      displayName: view.author.display_name,
      avatarUrl: view.author.avatar_url,
      followers: view.authorFollowers,
      rating: view.authorRating,
    },
    reason: view.reason ?? null,
  };
}
