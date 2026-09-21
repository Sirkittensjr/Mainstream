import 'server-only';
import { NextResponse } from 'next/server';
import { levelFor } from '@/lib/progression';
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
  const level = levelFor(user.points);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    location: user.location,
    interests: user.interests,
    goal: user.goal,
    points: user.points,
    level: { level: level.level, name: level.name },
    joinedAt: user.created_at,
    rating: rating
      ? {
          overall: rating.overall,
          current: rating.current,
          trend: rating.trend,
          delta: rating.delta,
          count: rating.ratingsReceived,
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
    shot: view.post.shot,
    boosted: view.post.boosted,
    featured: view.post.featured,
    counts: {
      likes: view.likes,
      comments: view.comments,
      views: view.post.views,
      impressions: view.post.impressions,
    },
    rating: {
      value: view.rating.rating,
      count: view.rating.count,
      reactions: view.rating.reactions.filter((entry) => entry.count > 0),
      mine: view.myScore,
    },
    shotProgress: view.shot,
    challenge: view.challenge,
    viewer: { liked: view.liked, following: view.following },
    author: {
      id: view.author.id,
      username: view.author.username,
      displayName: view.author.display_name,
      avatarUrl: view.author.avatar_url,
      followers: view.authorFollowers,
      level: view.authorLevel,
    },
    reason: view.reason ?? null,
  };
}
