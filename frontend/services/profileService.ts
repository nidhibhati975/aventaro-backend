import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import type { AppUser, UserProfile } from './types';

export interface EditProfilePayload {
  name?: string;
  age?: number | null;
  bio?: string | null;
}

export async function fetchMyProfile(): Promise<AppUser> {
  return getCachedOrFetch('profile:me', 30 * 1000, async () => {
    const userResponse = await api.get('/users/me');
    const currentUser = getApiData<any>(userResponse);
    const userId = Number(currentUser?.id || 0);
    const stats =
      userId > 0
        ? getApiData<any>(await api.get(`/users/${userId}`))
        : currentUser;

    return {
      id: Number(stats?.id || currentUser?.id || 0),
      email: String(stats?.email || currentUser?.email || ''),
      created_at: stats?.createdAt || stats?.created_at || currentUser?.createdAt || currentUser?.created_at,
      profile: stats?.profile || currentUser?.profile || null,
      posts_count: stats?.postsCount || stats?.posts_count,
      followers_count: stats?.followersCount || stats?.followers_count,
      following_count: stats?.followingCount || stats?.following_count,
      saved_count: stats?.savedCount || stats?.saved_count,
    };
  });
}

export async function updateMyProfile(payload: EditProfilePayload): Promise<UserProfile> {
  const response = await api.put('/profile/me', payload);
  await invalidateCacheByPrefixes(['profile:me', 'discover:people']);
  return getApiData<UserProfile>(response);
}

export async function fetchPublicProfile(userId: number, fallback?: AppUser | null): Promise<AppUser> {
  try {
    const response = await api.get(`/users/${userId}`);
    const data = getApiData<any>(response);
    return {
      id: Number(data?.id),
      email: String(data?.email || ''),
      created_at: data?.createdAt || data?.created_at,
      profile: data?.profile || null,
      posts_count: data?.postsCount || data?.posts_count,
      followers_count: data?.followersCount || data?.followers_count,
      following_count: data?.followingCount || data?.following_count,
      saved_count: data?.savedCount || data?.saved_count,
    };
  } catch (error) {
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}
