/**
 * API Response Validation Service
 * Ensures all API responses are properly validated before use
 */
import { errorLogger } from './errorLogger';

export interface ValidationResult<T> {
  valid: boolean;
  data: T | null;
  error?: string;
}

export function validateArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  return [];
}

export function validateObject<T extends Record<string, unknown>>(
  data: unknown,
  requiredKeys?: string[]
): T | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const obj = data as Record<string, unknown>;

  if (requiredKeys) {
    for (const key of requiredKeys) {
      if (!(key in obj)) {
        return null;
      }
    }
  }

  return obj as T;
}

export function validateString(value: unknown, minLength: number = 0): string | null {
  if (typeof value === 'string' && value.length >= minLength) {
    return value;
  }
  return null;
}

export function validateNumber(
  value: unknown,
  minValue?: number,
  maxValue?: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (typeof minValue === 'number' && value < minValue) {
    return null;
  }

  if (typeof maxValue === 'number' && value > maxValue) {
    return null;
  }

  return value;
}

export function validateBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function validateDate(value: unknown): Date | null {
  if (typeof value === 'string' || typeof value === 'number') {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch {
      // Fallthrough
    }
  }
  return null;
}

export function validateEmail(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function validateUrl(value: unknown): string | null {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      return value;
    } catch {
      // Fallthrough
    }
  }
  return null;
}

export function safeGet<T>(
  obj: unknown,
  path: string,
  defaultValue: T
): T {
  try {
    if (!obj || typeof obj !== 'object') {
      return defaultValue;
    }

    const keys = path.split('.');
    let current: any = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }

    return current !== undefined && current !== null ? current : defaultValue;
  } catch (error) {
    errorLogger.logError(error, { source: 'Validation', context: { action: 'safeGet', path } });
    return defaultValue;
  }
}
