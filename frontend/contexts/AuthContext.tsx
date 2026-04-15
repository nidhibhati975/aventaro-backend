import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ApiError,
  clearStoredAuthTokens,
  extractErrorMessage,
  getStoredAuthTokens,
  setAuthFailureHandler,
  setStoredAuthTokens,
} from '../services/api';
import {
  fetchCurrentUser,
  loginRequest,
  normalizeUser,
  signupRequest,
  type AuthSession,
  type SignUpPayload,
} from '../services/authService';
import { clearCachedValues } from '../services/cache';
import { errorLogger } from '../services/errorLogger';
import type { AppUser } from '../services/types';

type User = AppUser;
const AUTH_USER_CACHE_KEY = 'auth:currentUser';
const LEGACY_AUTH_TOKEN_KEY = 'auth_token';
const LEGACY_REFRESH_TOKEN_KEY = 'refresh_token';
const LEGACY_USER_CACHE_KEY = 'user';
const GUEST_NAVIGATION_STATE_KEY = 'navigation:guest';
const AUTHENTICATED_NAVIGATION_STATE_KEY = 'navigation:authenticated';
const AUTH_STORAGE_KEYS_TO_CLEAR = [
  AUTH_USER_CACHE_KEY,
  LEGACY_AUTH_TOKEN_KEY,
  LEGACY_REFRESH_TOKEN_KEY,
  LEGACY_USER_CACHE_KEY,
  GUEST_NAVIGATION_STATE_KEY,
  AUTHENTICATED_NAVIGATION_STATE_KEY,
] as const;

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (userData: SignUpPayload) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
  refreshUser: async () => undefined,
});

export const useAuth = () => useContext(AuthContext);

async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as User;
    } catch (parseError) {
      errorLogger.logAsyncStorageError(parseError, AUTH_USER_CACHE_KEY, 'parse');
      await AsyncStorage.removeItem(AUTH_USER_CACHE_KEY);
      return null;
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, AUTH_USER_CACHE_KEY, 'read');
    return null;
  }
}

async function writeCachedUser(user: User | null): Promise<void> {
  try {
    if (!user) {
      await AsyncStorage.removeItem(AUTH_USER_CACHE_KEY);
      return;
    }

    await AsyncStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, AUTH_USER_CACHE_KEY, 'write');
  }
}

async function clearStoredSessionArtifacts(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...AUTH_STORAGE_KEYS_TO_CLEAR]);
  } catch (error) {
    errorLogger.logError(error, { source: 'Auth', context: { action: 'clearStoredSessionArtifacts' } });
  }
}

async function migrateLegacySession(): Promise<AuthSession | null> {
  try {
    const [accessToken, refreshToken, rawUser] = await AsyncStorage.multiGet([
      LEGACY_AUTH_TOKEN_KEY,
      LEGACY_REFRESH_TOKEN_KEY,
      LEGACY_USER_CACHE_KEY,
    ]).then((entries) => entries.map(([, value]) => value));

    if (!accessToken || !rawUser) {
      return null;
    }

    const parsedUser = normalizeUser(JSON.parse(rawUser));
    if (!parsedUser?.id) {
      return null;
    }

    return {
      accessToken,
      refreshToken: refreshToken || null,
      user: parsedUser,
    };
  } catch (error) {
    errorLogger.logError(error, { source: 'Auth', context: { action: 'migrateLegacySession' } });
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clearLocalAuthState = useCallback(async () => {
    try {
      await clearStoredAuthTokens();
    } catch (error) {
      errorLogger.logError(error, { source: 'Auth', context: { action: 'clearTokens' } });
    }

    try {
      await clearCachedValues();
    } catch (error) {
      errorLogger.logError(error, { source: 'Auth', context: { action: 'clearCache' } });
    }

    await clearStoredSessionArtifacts();

    setToken(null);
    setUser(null);
  }, []);

  const applySession = useCallback(async (session: AuthSession) => {
    try {
      if (!session?.accessToken || !session?.user) {
        throw new Error('Invalid session: missing token or user');
      }

      await clearStoredSessionArtifacts();
      await setStoredAuthTokens(session.accessToken, session.refreshToken || null);
      await writeCachedUser(session.user);
      setToken(session.accessToken);
      setUser(session.user);
    } catch (error) {
      errorLogger.logError(error, { source: 'Auth', context: { action: 'applySession' } });
      await clearLocalAuthState();
      throw error;
    }
  }, [clearLocalAuthState]);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await fetchCurrentUser();
      if (currentUser) {
        await writeCachedUser(currentUser);
        setUser(currentUser);
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'Auth', context: { action: 'refreshUser' } });
      if (error instanceof ApiError && error.status === 401) {
        await clearLocalAuthState();
      }
    }
  }, [clearLocalAuthState]);

  const loadStoredAuth = useCallback(async () => {
    try {
      let storedTokens = await getStoredAuthTokens();

      if (!storedTokens?.accessToken) {
        const legacySession = await migrateLegacySession();
        if (legacySession) {
          await setStoredAuthTokens(legacySession.accessToken, legacySession.refreshToken || null);
          await writeCachedUser(legacySession.user);
          await AsyncStorage.multiRemove([
            LEGACY_AUTH_TOKEN_KEY,
            LEGACY_REFRESH_TOKEN_KEY,
            LEGACY_USER_CACHE_KEY,
          ]);
          storedTokens = {
            accessToken: legacySession.accessToken,
            refreshToken: legacySession.refreshToken,
          };
        }
      }

      if (!storedTokens?.accessToken) {
        await clearStoredSessionArtifacts();
        setToken(null);
        setUser(null);
        return;
      }

      setToken(storedTokens.accessToken);
      const cachedUser = await readCachedUser();
      if (cachedUser) {
        setUser(cachedUser);
      }

      try {
        const currentUser = await fetchCurrentUser();
        if (currentUser) {
          await writeCachedUser(currentUser);
          setUser(currentUser);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await clearLocalAuthState();
        } else if (!cachedUser) {
          errorLogger.logError(error, { source: 'Auth', context: { action: 'fetchCurrentUser' } });
        }
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'Auth', context: { action: 'loadStoredAuth' } });
      await clearLocalAuthState();
    } finally {
      setLoading(false);
    }
  }, [clearLocalAuthState]);

  useEffect(() => {
    void loadStoredAuth();
  }, [loadStoredAuth]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      void clearLocalAuthState();
    });

    return () => setAuthFailureHandler(null);
  }, [clearLocalAuthState]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const session = await loginRequest(email, password);
        await applySession(session);
      } catch (error) {
        errorLogger.logError(error, { source: 'Auth', context: { action: 'signIn' } });
        throw new Error(extractErrorMessage(error, 'Sign in failed'));
      }
    },
    [applySession]
  );

  const signUp = useCallback(
    async (userData: SignUpPayload) => {
      try {
        const session = await signupRequest(userData);
        await applySession(session);
      } catch (error) {
        errorLogger.logError(error, { source: 'Auth', context: { action: 'signUp' } });
        throw new Error(extractErrorMessage(error, 'Sign up failed'));
      }
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    await clearLocalAuthState();
  }, [clearLocalAuthState]);

  const value = useMemo(
    () => ({ user, token, loading, signIn, signUp, signOut, refreshUser }),
    [loading, refreshUser, signIn, signOut, signUp, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
