/**
 * Performance optimization utilities
 * Helps prevent unnecessary re-renders and improve component performance
 */
import React from 'react';

/**
 * Deep equals comparison for props - useful for React.memo
 */
export function arePropsEqual<T extends Record<string, any>>(prevProps: T, nextProps: T): boolean {
  const keys = new Set([...Object.keys(prevProps), ...Object.keys(nextProps)]);
  
  for (const key of keys) {
    if (prevProps[key] !== nextProps[key]) {
      // For objects/arrays, do shallow check
      if (typeof prevProps[key] === 'object' && typeof nextProps[key] === 'object') {
        if (prevProps[key] === null || nextProps[key] === null) {
          if (prevProps[key] !== nextProps[key]) {
            return false;
          }
        } else if (Array.isArray(prevProps[key]) && Array.isArray(nextProps[key])) {
          if (prevProps[key].length !== nextProps[key].length) {
            return false;
          }
          // Shallow array comparison
          for (let i = 0; i < prevProps[key].length; i++) {
            if (prevProps[key][i] !== nextProps[key][i]) {
              return false;
            }
          }
        } else if (typeof prevProps[key] === 'object' && typeof nextProps[key] === 'object') {
          // Shallow object comparison
          const objKeys = new Set([
            ...Object.keys(prevProps[key] || {}),
            ...Object.keys(nextProps[key] || {}),
          ]);
          for (const objKey of objKeys) {
            if (prevProps[key][objKey] !== nextProps[key][objKey]) {
              return false;
            }
          }
        }
      } else {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Create memoized component with custom comparison
 */
export function createMemoComponent<P extends Record<string, any>>(
  Component: React.ComponentType<P>,
  propsEqual?: (prev: P, next: P) => boolean
): React.MemoExoticComponent<React.ComponentType<P>> {
  return React.memo(Component, propsEqual || arePropsEqual);
}

/**
 * FlatList key extractor that safely handles missing IDs
 */
export function createKeyExtractor<T extends { id?: number | string }>(prefix?: string) {
  return (item: T | null | undefined, index: number): string => {
    if (!item?.id) {
      return `${prefix || 'item'}-${index}`;
    }
    return `${prefix || 'item'}-${item.id}`;
  };
}

/**
 * Safe FlatList render function wrapper
 */
export function createSafeRenderItem<T>(
  renderFn: (item: T, index: number) => React.ReactNode
) {
  return ({ item, index }: { item: T | null | undefined; index: number }) => {
    try {
      if (!item) {
        return null;
      }
      return renderFn(item, index);
    } catch (error) {
      console.error(`Error rendering item at index ${index}:`, error);
      return null;
    }
  };
}

/**
 * Debounce utility for expensive operations
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
}

/**
 * Throttle utility for expensive operations
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let lastCallTime = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCallTime >= delayMs) {
      lastCallTime = now;
      fn(...args);
    }
  };
}
