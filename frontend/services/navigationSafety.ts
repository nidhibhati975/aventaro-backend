/**
 * Navigation safety utilities
 * Handles undefined route params and provides safe fallbacks
 */
import { errorLogger } from './errorLogger';

export function safeGetParam<T>(
  params: unknown,
  key: string,
  defaultValue: T,
  validator?: (value: unknown) => boolean
): T {
  try {
    if (!params || typeof params !== 'object') {
      return defaultValue;
    }

    const value = (params as Record<string, unknown>)[key];
    
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (validator && !validator(value)) {
      return defaultValue;
    }

    return value as T;
  } catch (error) {
    errorLogger.logError(error, {
      source: 'Navigation',
      context: { key, defaultValue },
    });
    return defaultValue;
  }
}

export function safeParseNumber(value: unknown, defaultValue: number = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

export function safeParseString(value: unknown, defaultValue: string = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  return defaultValue;
}

export function safeParseBoolean(value: unknown, defaultValue: boolean = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return defaultValue;
}

export function safeParseObject<T extends Record<string, unknown>>(
  value: unknown,
  defaultValue: T
): T {
  try {
    if (typeof value === 'object' && value !== null) {
      return value as T;
    }
  } catch {
    // Fallthrough
  }
  return defaultValue;
}
