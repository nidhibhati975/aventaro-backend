import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes, writeCachedValue } from './cache';
import type {
  FeedPage,
  ReelWatchResult,
  SocialPost,
  StoryGroup,
  StoryRecord,
} from './types';

const SHORT_CACHE_TTL_MS = 30 * 1000;
const MAX_POSTS_FEED_LIMIT = 50;

export async function fetchStoriesFeed(limit: number = 20): Promise<FeedPage<StoryGroup>> {
  return getCachedOrFetch(`social:stories:${limit}`, SHORT_CACHE_TTL_MS, async () => {
    const response = await api.get('/stories/feed', { params: { limit, offset: 0 } });
    return getApiData<FeedPage<StoryGroup>>(response);
  });
}

export async function markStoryViewed(storyId: number): Promise<StoryRecord> {
  const response = await api.post(`/stories/${storyId}/view`);
  await invalidateCacheByPrefixes(['social:stories']);
  return getApiData<StoryRecord>(response);
}

export async function fetchPostsFeed(params?: {
  limit?: number;
  offset?: number;
  cursor?: string | null;
}): Promise<FeedPage<SocialPost>> {
  const requestedLimit = params?.limit ?? 20;
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_POSTS_FEED_LIMIT);
  const offset = params?.offset ?? 0;
  const cursor = params?.cursor ?? null;
  const cacheKey = `social:posts:${limit}:${offset}:${cursor || 'none'}`;

  return getCachedOrFetch(cacheKey, SHORT_CACHE_TTL_MS, async () => {
    const response = await api.get('/posts/feed', {
      params: {
        limit,
        offset,
        ...(cursor ? { cursor } : {}),
      },
    });
    return getApiData<FeedPage<SocialPost>>(response);
  });
}

export async function fetchSavedPosts(params?: {
  limit?: number;
  offset?: number;
}): Promise<FeedPage<SocialPost>> {
  const limit = params?.limit ?? 20;
  const offset = params?.offset ?? 0;
  const cacheKey = `social:saved:${limit}:${offset}`;

  return getCachedOrFetch(cacheKey, SHORT_CACHE_TTL_MS, async () => {
    const response = await api.get('/posts/saved', {
      params: {
        limit,
        offset,
      },
    });
    return getApiData<FeedPage<SocialPost>>(response);
  });
}

export async function likePost(postId: number): Promise<SocialPost> {
  const response = await api.post(`/posts/${postId}/like`);
  await invalidateCacheByPrefixes(['social:posts', 'social:reels', 'notifications']);
  return getApiData<SocialPost>(response);
}

export async function unlikePost(postId: number): Promise<SocialPost> {
  const response = await api.post(`/posts/${postId}/unlike`);
  await invalidateCacheByPrefixes(['social:posts', 'social:reels', 'notifications']);
  return getApiData<SocialPost>(response);
}

export async function fetchReelsFeed(params?: {
  limit?: number;
  offset?: number;
  cursor?: string | null;
}): Promise<FeedPage<SocialPost>> {
  const limit = params?.limit ?? 10;
  const offset = params?.offset ?? 0;
  const cursor = params?.cursor ?? null;
  const cacheKey = `social:reels:${limit}:${offset}:${cursor || 'none'}`;

  return getCachedOrFetch(cacheKey, SHORT_CACHE_TTL_MS, async () => {
    const response = await api.get('/reels/feed', {
      params: {
        limit,
        offset,
        ...(cursor ? { cursor } : {}),
      },
    });
    return getApiData<FeedPage<SocialPost>>(response);
  });
}

export async function recordReelWatch(
  postId: number,
  watchTime: number,
  durationSeconds?: number | null
): Promise<ReelWatchResult> {
  const response = await api.post(`/reels/${postId}/watch`, {
    watch_time: watchTime,
    ...(typeof durationSeconds === 'number' && durationSeconds > 0
      ? { duration_seconds: durationSeconds }
      : {}),
  });
  return getApiData<ReelWatchResult>(response);
}

export async function fetchMyProfilePosts(limit: number = MAX_POSTS_FEED_LIMIT): Promise<SocialPost[]> {
  const feed = await fetchPostsFeed({ limit, offset: 0 });
  return feed.items.filter((post) => post.is_owner);
}

export async function primeReelsCache(posts: SocialPost[]): Promise<void> {
  await writeCachedValue('social:reels:prime', posts);
}
