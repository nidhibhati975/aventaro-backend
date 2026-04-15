import type { ImageSourcePropType } from 'react-native';

const INVALID_MEDIA_VALUES = new Set(['', 'null', 'undefined']);

export function getSafeMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (INVALID_MEDIA_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed;
}

export function getSafeImageSource(value: unknown): ImageSourcePropType | undefined {
  const uri = getSafeMediaUrl(value);
  return uri ? { uri } : undefined;
}
