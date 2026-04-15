import api, {
  extractErrorMessage,
  getApiData,
} from './api';
import type { AppUser } from './types';

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  user: AppUser;
}

export interface SignUpPayload {
  email: string;
  password: string;
  name?: string;
  age?: number | null;
  bio?: string | null;
}

export function normalizeUser(user: any): AppUser {
  return {
    id: Number(user?.id),
    email: String(user?.email || ''),
    created_at: user?.createdAt || user?.created_at,
    profile: user?.profile || null,
    posts_count: user?.postsCount ?? user?.posts_count,
    followers_count: user?.followersCount ?? user?.followers_count,
    following_count: user?.followingCount ?? user?.following_count,
    saved_count: user?.savedCount ?? user?.saved_count,
  };
}

export function normalizeSessionPayload(data: any): AuthSession {
  const accessToken = data?.accessToken || data?.access_token || data?.token;
  const refreshToken = data?.refreshToken || data?.refresh_token || null;
  const user = data?.user;

  if (!accessToken || !user) {
    throw new Error('Invalid auth response');
  }

  return {
    accessToken,
    refreshToken,
    user: normalizeUser(user),
  };
}

export async function loginRequest(email: string, password: string): Promise<AuthSession> {
  try {
    const response = await api.post('/auth/login', { email, password });
    return normalizeSessionPayload(getApiData<any>(response));
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to sign in'));
  }
}

export async function signupRequest(payload: SignUpPayload): Promise<AuthSession> {
  try {
    const response = await api.post('/auth/signup', payload);
    return normalizeSessionPayload(getApiData<any>(response));
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to create account'));
  }
}

export async function fetchCurrentUser(): Promise<AppUser> {
  const response = await api.get('/users/me');
  return normalizeUser(getApiData<any>(response));
}
