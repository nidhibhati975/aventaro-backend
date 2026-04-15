import { navigateToPath, navigationRef, APP_PATHS } from '../navigation/router';

const APP_SCHEME = 'aventaro://';
const navigate = navigationRef.navigate as (...args: any[]) => void;

function toNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function waitForNavigationReady(timeoutMs: number = 5000) {
  if (navigationRef.isReady()) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (navigationRef.isReady()) {
        clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

export function buildAppDeepLink(path: string, params?: Record<string, string | number | null | undefined>) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const searchParts: string[] = [];

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  });

  const suffix = searchParts.join('&');
  return `${APP_SCHEME}${normalizedPath}${suffix ? `?${suffix}` : ''}`;
}

function parseDeepLink(url: string) {
  if (!url.startsWith(APP_SCHEME)) {
    return null;
  }

  const normalized = url.slice(APP_SCHEME.length);
  const [pathPart, queryPart = ''] = normalized.split('?');
  const path = `/${pathPart.replace(/^\/+/, '')}`;
  const params: Record<string, string> = {};

  if (queryPart) {
    queryPart.split('&').forEach((entry) => {
      if (!entry) {
        return;
      }

      const [rawKey, rawValue = ''] = entry.split('=');
      if (!rawKey) {
        return;
      }

      params[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
    });
  }

  return { path, params };
}

export async function handleIncomingUrl(url: string | null | undefined) {
  if (!url) {
    return false;
  }

  const parsedUrl = parseDeepLink(url);
  if (!parsedUrl) {
    return false;
  }

  const navigationReady = await waitForNavigationReady();
  if (!navigationReady) {
    return false;
  }

  const normalizedPath = parsedUrl.path;

  if (normalizedPath === '/notifications') {
    navigateToPath(APP_PATHS.SCREEN_NOTIFICATIONS);
    return true;
  }

  if (normalizedPath === '/payments') {
    navigateToPath(APP_PATHS.SCREEN_PAYMENTS);
    return true;
  }

  if (normalizedPath === '/reels') {
    navigate('AppStack', {
      screen: 'Reels',
      params: {
        initialPostId: toNumber(parsedUrl.params.postId || null),
      },
    });
    return true;
  }

  if (normalizedPath === '/trip-details') {
    const tripId = toNumber(parsedUrl.params.tripId || null);
    if (!tripId) {
      return false;
    }

    navigate('AppStack', {
      screen: 'TripDetails',
      params: { tripId },
    });
    return true;
  }

  if (normalizedPath === '/chat/conversation') {
    const conversationId = parsedUrl.params.conversationId || null;
    if (!conversationId) {
      return false;
    }

    navigate('AppStack', {
      screen: 'Conversation',
      params: { conversationId },
    });
    return true;
  }

  if (normalizedPath === '/profile/public') {
    const userId = toNumber(parsedUrl.params.userId || null);
    if (!userId) {
      return false;
    }

    navigate('AppStack', {
      screen: 'PublicProfile',
      params: { userId },
    });
    return true;
  }

  return false;
}
