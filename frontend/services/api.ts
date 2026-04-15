import { API_BASE_URL, BACKEND_URL } from '@env';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import NetInfo from '@react-native-community/netinfo';

import {
  clearAuthTokensFromKeychain,
  getAuthTokensFromKeychain,
  setAuthTokensInKeychain,
  type StoredAuthTokens,
} from './secureStorage';
import { errorLogger } from './errorLogger';

type AuthFailureHandler = () => void;
type PremiumRequiredHandler = (payload: { message: string; requestId?: string }) => void;
type ServerErrorHandler = (payload: { message: string; requestId?: string; status: number }) => void;

type ApiErrorCode =
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVER_ERROR'
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'NETWORK'
  | 'UNKNOWN';

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  __isRetryRequest?: boolean;
  __retryCount?: number;
};

export interface ApiMeta {
  status: number;
  requestId?: string;
  receivedAt: string;
}

export interface ApiEnvelopeError {
  code: ApiErrorCode | string;
  message: string;
  status?: number;
  requestId?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message: string;
  error: ApiEnvelopeError | null;
  meta: ApiMeta;
}

const MAX_IDEMPOTENT_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 350;
const REQUEST_TIMEOUT_MS = 30000;
const LOCALHOST_PATTERN = /(localhost|127\.0\.0\.1|10\.0\.2\.2)/i;

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function resolveApiUrl(): string {
  const rawBaseUrl = (API_BASE_URL || BACKEND_URL || '').trim();

  if (!rawBaseUrl) {
    if (__DEV__) {
      return 'http://127.0.0.1:8000';
    }

    throw new Error('API_BASE_URL (or BACKEND_URL) is required in production.');
  }

  const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');

  if (__DEV__) {
    return normalizedBaseUrl.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1');
  }

  if (!__DEV__) {
    if (!normalizedBaseUrl.startsWith('https://')) {
      throw new Error('Production API base URL must start with https://');
    }

    if (LOCALHOST_PATTERN.test(normalizedBaseUrl)) {
      throw new Error('Production API base URL cannot use localhost.');
    }
  }

  return normalizedBaseUrl;
}

const API_URL = resolveApiUrl();

function debugLog(message: string, details?: Record<string, unknown>) {
  if (__DEV__) {
    console.log(message, details || {});
  }
}

function toLoggableValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  response?: { status: number; data: ApiEnvelope<null> };
  originalError?: unknown;
  isApiError: boolean;
  errorKey?: string;
  requestId?: string;

  constructor(
    message: string,
    code: ApiErrorCode,
    status?: number,
    responseData?: unknown,
    originalError?: unknown,
    metadata?: { errorKey?: string; requestId?: string }
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.isApiError = true;
    this.originalError = originalError;
    this.errorKey = metadata?.errorKey;
    this.requestId = metadata?.requestId;
    if (typeof status === 'number') {
      this.response = {
        status,
        data: {
          success: false,
          data: null,
          message,
          error: {
            code,
            message,
            status,
            requestId: metadata?.requestId,
          },
          meta: buildMeta(status, responseData, undefined),
        },
      };
    }
  }
}

let authFailureHandler: AuthFailureHandler | null = null;
let premiumRequiredHandler: PremiumRequiredHandler | null = null;
let serverErrorHandler: ServerErrorHandler | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let isNetworkReachable = true;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function camelizeKey(value: string): string {
  return value.replace(/[_-]([a-z0-9])/gi, (_, character: string) => character.toUpperCase());
}

function normalizeKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeys(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, rawValue]) => {
    const nextValue = normalizeKeys(rawValue);
    normalized[key] = nextValue;

    const camelKey = camelizeKey(key);
    if (camelKey !== key && !Object.prototype.hasOwnProperty.call(normalized, camelKey)) {
      normalized[camelKey] = nextValue;
    }
  });

  return normalized as T;
}

function safeParseJson<T>(value: unknown): T {
  if (typeof value !== 'string') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new ApiError(
      'Server returned invalid JSON response',
      'INVALID_JSON',
      undefined,
      undefined,
      value
    );
  }
}

function extractRequestId(payload: unknown, headers?: Record<string, unknown>): string | undefined {
  const parsed = normalizeKeys(payload);
  if (isPlainObject(parsed)) {
    const directValue = parsed.requestId;
    if (typeof directValue === 'string' && directValue.trim()) {
      return directValue.trim();
    }

    if (isPlainObject(parsed.meta) && typeof parsed.meta.requestId === 'string' && parsed.meta.requestId.trim()) {
      return parsed.meta.requestId.trim();
    }

    if (isPlainObject(parsed.detail) && typeof parsed.detail.requestId === 'string' && parsed.detail.requestId.trim()) {
      return parsed.detail.requestId.trim();
    }

    if (isPlainObject(parsed.details) && typeof parsed.details.requestId === 'string' && parsed.details.requestId.trim()) {
      return parsed.details.requestId.trim();
    }

    if (isPlainObject(parsed.error)) {
      if (typeof parsed.error.requestId === 'string' && parsed.error.requestId.trim()) {
        return parsed.error.requestId.trim();
      }
      if (typeof parsed.error.request_id === 'string' && parsed.error.request_id.trim()) {
        return parsed.error.request_id.trim();
      }
    }
  }

  const headerValue =
    headers?.['x-request-id'] ||
    headers?.['X-Request-Id'] ||
    headers?.['x_request_id'] ||
    headers?.['X_REQUEST_ID'];

  return typeof headerValue === 'string' && headerValue.trim() ? headerValue.trim() : undefined;
}

function buildMeta(status: number, payload: unknown, headers?: Record<string, unknown>): ApiMeta {
  return {
    status,
    requestId: extractRequestId(payload, headers),
    receivedAt: new Date().toISOString(),
  };
}

function normalizeSuccessPayload<T>(
  response: AxiosResponse<T>
): AxiosResponse<ApiEnvelope<T>> {
  const parsed = normalizeKeys(safeParseJson<T>(response.data));
  let data: unknown = parsed;
  let message = 'Request completed successfully';

  if (isPlainObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'success')) {
    if (parsed.success === true) {
      data = Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : null;
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message.trim();
      }
    } else if (parsed.success === false) {
      const errorMetadata = extractErrorMetadata(parsed);
      throw new ApiError(
        errorMetadata.message || extractDetailFromData(parsed) || 'Request failed',
        'BAD_REQUEST',
        response.status,
        parsed,
        undefined,
        errorMetadata
      );
    }
  }

  return {
    ...response,
    data: {
      success: true,
      data: normalizeKeys(data) as T,
      message,
      error: null,
      meta: buildMeta(response.status, parsed, response.headers as Record<string, unknown>),
    },
  };
}

function resolveWebsocketBaseUrl(): string {
  if (API_URL.startsWith('https://')) {
    return API_URL.replace(/^https:\/\//, 'wss://');
  }
  return API_URL.replace(/^http:\/\//, 'ws://');
}

export const WS_BASE_URL = resolveWebsocketBaseUrl();

export function buildWebsocketUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const search = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `${WS_BASE_URL}${normalizedPath}${search ? `?${search}` : ''}`;
}

const api = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  validateStatus: (status) => status >= 200 && status < 300,
  headers: {
    'Content-Type': 'application/json',
  },
});

const refreshClient = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

NetInfo.addEventListener((state) => {
  isNetworkReachable = Boolean(state.isConnected) && state.isInternetReachable !== false;
});

export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;
}

export function setPremiumRequiredHandler(handler: PremiumRequiredHandler | null) {
  premiumRequiredHandler = handler;
}

export function setServerErrorHandler(handler: ServerErrorHandler | null) {
  serverErrorHandler = handler;
}

export async function setStoredAuthTokens(accessToken: string, refreshToken?: string | null) {
  await setAuthTokensInKeychain(accessToken, refreshToken || null);
}

export async function clearStoredAuthTokens() {
  await clearAuthTokensFromKeychain();
}

export async function getStoredAuthTokens(): Promise<StoredAuthTokens | null> {
  return getAuthTokensFromKeychain();
}

export async function getStoredRefreshToken(): Promise<string | null> {
  const tokens = await getAuthTokensFromKeychain();
  return tokens?.refreshToken || null;
}

export function getApiBaseUrl(): string {
  return API_URL;
}

function extractDetailFromData(data: unknown): string | null {
  if (!data) {
    return null;
  }

  const parsed = normalizeKeys(safeParseJson<Record<string, unknown>>(data));

  if (isPlainObject(parsed.error)) {
    if (typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.error.error === 'string' && parsed.error.error.trim()) {
      return parsed.error.error.trim();
    }
  }

  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return parsed.message.trim();
  }

  if (typeof parsed.error === 'string' && parsed.error.trim() && parsed.error !== 'premium_required') {
    return parsed.error.trim();
  }

  if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
    return parsed.detail.trim();
  }

  if (isPlainObject(parsed.detail)) {
    if (typeof parsed.detail.message === 'string' && parsed.detail.message.trim()) {
      return parsed.detail.message.trim();
    }
    if (typeof parsed.detail.error === 'string' && parsed.detail.error.trim()) {
      return parsed.detail.error.trim();
    }
  }

  if (isPlainObject(parsed.details)) {
    if (typeof parsed.details.message === 'string' && parsed.details.message.trim()) {
      return parsed.details.message.trim();
    }
    if (typeof parsed.details.error === 'string' && parsed.details.error.trim()) {
      return parsed.details.error.trim();
    }
  }

  return null;
}

function extractErrorMetadata(data: unknown): { errorKey?: string; requestId?: string; message?: string } {
  if (!data) {
    return {};
  }

  const parsed = normalizeKeys(safeParseJson<Record<string, unknown>>(data));
  const detailPayload = isPlainObject(parsed.detail) ? parsed.detail : null;
  const detailsPayload = isPlainObject(parsed.details) ? parsed.details : null;
  const errorPayload = isPlainObject(parsed.error) ? parsed.error : null;
  const source = detailPayload || detailsPayload || errorPayload || parsed;

  return {
    errorKey:
      (typeof source.code === 'string' && source.code) ||
      (typeof source.error === 'string' && source.error) ||
      (typeof parsed.error === 'string' && parsed.error) ||
      (isPlainObject(parsed.error) && typeof parsed.error.code === 'string' ? parsed.error.code : undefined) ||
      undefined,
    requestId: extractRequestId(parsed),
    message:
      (typeof source.message === 'string' && source.message) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      undefined,
  };
}

function normalizeAxiosError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!axios.isAxiosError(error)) {
    return new ApiError('Unexpected error occurred', 'UNKNOWN', undefined, undefined, error);
  }

  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;
  const data = axiosError.response?.data;
  const detail = extractDetailFromData(data);
  const errorMetadata = extractErrorMetadata(data);

  if (axiosError.code === 'ECONNABORTED' || /timeout/i.test(axiosError.message || '')) {
    return new ApiError('Request timed out. Please try again.', 'TIMEOUT', status, data, error, errorMetadata);
  }

  if (!axiosError.response) {
    return new ApiError(
      isNetworkReachable
        ? 'Unable to reach server. Please try again.'
        : 'No internet connection. Check your network and retry.',
      isNetworkReachable ? 'NETWORK' : 'OFFLINE',
      undefined,
      undefined,
      error
    );
  }

  switch (status) {
    case 400:
      return new ApiError(detail || 'Invalid request', 'BAD_REQUEST', status, data, error, errorMetadata);
    case 401:
      return new ApiError(
        detail || 'Session expired. Please sign in again.',
        'UNAUTHORIZED',
        status,
        data,
        error,
        errorMetadata
      );
    case 403:
      return new ApiError(
        errorMetadata.message || detail || 'You are not allowed to perform this action.',
        'FORBIDDEN',
        status,
        data,
        error,
        errorMetadata
      );
    case 404:
      return new ApiError(
        detail || 'Requested resource was not found.',
        'NOT_FOUND',
        status,
        data,
        error,
        errorMetadata
      );
    case 409:
      return new ApiError(detail || 'Request conflict', 'CONFLICT', status, data, error, errorMetadata);
    case 429:
      return new ApiError(
        detail || 'Too many requests. Please wait and try again.',
        'RATE_LIMITED',
        status,
        data,
        error,
        errorMetadata
      );
    case 503:
      return new ApiError(
        detail || 'Service is temporarily unavailable.',
        'SERVICE_UNAVAILABLE',
        status,
        data,
        error,
        errorMetadata
      );
    default:
      if (status && status >= 500) {
        return new ApiError(
          detail || 'Server error. Please try again shortly.',
          'SERVER_ERROR',
          status,
          data,
          error,
          errorMetadata
        );
      }
      return new ApiError(detail || 'Request failed', 'UNKNOWN', status, data, error, errorMetadata);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryRequest(request: RetryableRequestConfig, parsedError: ApiError) {
  const method = (request.method || 'get').toLowerCase();
  const isIdempotent = ['get', 'head', 'options'].includes(method);
  if (!isIdempotent || parsedError.code === 'OFFLINE') {
    return false;
  }

  const status = parsedError.status || 0;
  return (
    parsedError.code === 'TIMEOUT' ||
    parsedError.code === 'NETWORK' ||
    RETRYABLE_STATUS_CODES.has(status)
  );
}

async function attemptTokenRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const tokens = await getAuthTokensFromKeychain();
      const refreshToken = tokens?.refreshToken;
      if (!refreshToken) {
        return null;
      }

      try {
        const response = await refreshClient.post('/auth/refresh', { refresh_token: refreshToken });
        const parsed = normalizeKeys(safeParseJson<Record<string, unknown>>(response.data));
        const payload =
          isPlainObject(parsed) && parsed.success === true && Object.prototype.hasOwnProperty.call(parsed, 'data')
            ? normalizeKeys(parsed.data)
            : parsed;
        const newAccessToken =
          (isPlainObject(payload) && typeof payload.accessToken === 'string' && payload.accessToken) ||
          (isPlainObject(payload) && typeof payload.access_token === 'string' && payload.access_token) ||
          null;
        const newRefreshToken =
          (isPlainObject(payload) && typeof payload.refreshToken === 'string' && payload.refreshToken) ||
          (isPlainObject(payload) && typeof payload.refresh_token === 'string' && payload.refresh_token) ||
          refreshToken;

        if (!newAccessToken) {
          return null;
        }

        await setAuthTokensInKeychain(newAccessToken, newRefreshToken);
        return newAccessToken;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

api.interceptors.request.use(async (config) => {
  if (!isNetworkReachable) {
    return Promise.reject(
      new ApiError('No internet connection. Check your network and retry.', 'OFFLINE')
    );
  }
  const tokens = await getAuthTokensFromKeychain();
  const accessToken = tokens?.accessToken;
  config.headers = config.headers || {};
  config.headers['Content-Type'] = 'application/json';
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  debugLog('API REQUEST', {
    url: `${API_URL}${config.url || ''}`,
    method: config.method?.toUpperCase(),
    body: toLoggableValue(config.data),
  });
  return config;
});

api.interceptors.response.use(
  (response) => {
    debugLog('API RESPONSE', {
      url: response.config.url || '',
      status: response.status,
      data: toLoggableValue(response.data),
    });
    return normalizeSuccessPayload(response);
  },
  async (error: unknown) => {
    const parsedError = normalizeAxiosError(error);
    const axiosError = axios.isAxiosError(error) ? (error as AxiosError) : null;
    const originalRequest = (axiosError?.config || {}) as RetryableRequestConfig;

    errorLogger.logApiError(parsedError, axiosError?.config?.url || 'unknown', {
      context: {
        code: parsedError.code,
        status: parsedError.status,
        requestId: parsedError.requestId,
      },
    });
    debugLog('API ERROR', {
      url: axiosError?.config?.url || 'unknown',
      method: axiosError?.config?.method?.toUpperCase(),
      type: parsedError.code,
      status: parsedError.status,
      requestBody: toLoggableValue(axiosError?.config?.data),
      responseData: toLoggableValue(axiosError?.response?.data),
      message: parsedError.message,
    });

    if (shouldRetryRequest(originalRequest, parsedError)) {
      const retryCount = originalRequest.__retryCount || 0;
      if (retryCount < MAX_IDEMPOTENT_RETRIES) {
        originalRequest.__retryCount = retryCount + 1;
        await sleep(BASE_RETRY_DELAY_MS * 2 ** retryCount);
        return api(originalRequest);
      }
    }

    if (parsedError.status === 401 && !originalRequest.__isRetryRequest) {
      originalRequest.__isRetryRequest = true;
      const newAccessToken = await attemptTokenRefresh();
      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      }

      await clearStoredAuthTokens();
      authFailureHandler?.();
    }

    if (parsedError.errorKey === 'premium_required') {
      premiumRequiredHandler?.({
        message: parsedError.message || 'Upgrade to access this feature',
        requestId: parsedError.requestId,
      });
    }

    if ((parsedError.status || 0) >= 500) {
      serverErrorHandler?.({
        message: parsedError.message || 'Server error. Please try again shortly.',
        requestId: parsedError.requestId,
        status: parsedError.status || 500,
      });
    }

    // Fallback: show proper error if API is unreachable
    if (
      parsedError.code === 'OFFLINE' ||
      parsedError.code === 'NETWORK' ||
      parsedError.code === 'TIMEOUT' ||
      (parsedError.status === undefined && !isNetworkReachable)
    ) {
      debugLog('API UNREACHABLE', {
        baseUrl: API_URL,
        code: parsedError.code,
      });
    }

    return Promise.reject(parsedError);
  }
);

export function getApiData<T>(response: AxiosResponse<ApiEnvelope<T>>): T {
  return response.data.data as T;
}

export function getApiMeta<T>(response: AxiosResponse<ApiEnvelope<T>>): ApiMeta {
  return response.data.meta;
}

export function isPremiumRequiredError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.errorKey === 'premium_required';
  }
  if (typeof error === 'object' && error !== null) {
    const responseData = (error as {
      response?: {
        data?: {
          error?: { code?: string } | string;
          detail?: { error?: string } | string;
        };
      };
    }).response?.data;
    if (
      responseData?.error === 'premium_required' ||
      (typeof responseData?.error === 'object' && responseData.error?.code === 'premium_required') ||
      (typeof responseData?.detail === 'object' && responseData.detail?.error === 'premium_required')
    ) {
      return true;
    }
  }
  return false;
}

export function extractErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (!error) {
    return fallback;
  }
  if (error instanceof ApiError && error.message) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    const maybeResponse = (error as {
      response?: {
        data?: {
          error?: { message?: string } | string;
          detail?: { message?: string; error?: string } | string;
          details?: { message?: string; error?: string };
          message?: string;
        };
      };
      message?: string;
    }).response;
    const detail =
      (typeof maybeResponse?.data?.error === 'object' && maybeResponse.data.error?.message) ||
      (typeof maybeResponse?.data?.detail === 'object' && maybeResponse.data.detail?.message) ||
      (typeof maybeResponse?.data?.detail === 'object' && maybeResponse.data.detail?.error) ||
      maybeResponse?.data?.details?.message ||
      maybeResponse?.data?.details?.error ||
      (typeof maybeResponse?.data?.detail === 'string' ? maybeResponse.data.detail : null) ||
      maybeResponse?.data?.message ||
      ((error as { message?: string }).message || null);
    if (typeof detail === 'string' && detail.trim()) {
      return detail.trim();
    }
  }
  return fallback;
}

export default api;
