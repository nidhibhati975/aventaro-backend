import { API_BASE_URL, BACKEND_URL } from '@env';

const LOCALHOST_PATTERN = /(localhost|127\.0\.0\.1|10\.0\.2\.2)/i;

export function assertProductionRuntimeConfig() {
  if (__DEV__) {
    return;
  }

  const rawBaseUrl = (API_BASE_URL || BACKEND_URL || '').trim();
  if (!rawBaseUrl) {
    throw new Error('API_BASE_URL (or BACKEND_URL) is required in production.');
  }

  if (!rawBaseUrl.startsWith('https://')) {
    throw new Error('Production API base URL must start with https://');
  }

  if (rawBaseUrl.startsWith('http://')) {
    throw new Error('HTTP endpoints are blocked in production.');
  }

  if (LOCALHOST_PATTERN.test(rawBaseUrl)) {
    throw new Error('localhost URLs are blocked in production.');
  }
}
