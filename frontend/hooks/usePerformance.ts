/**
 * Performance Optimization Hook
 * 
 * Features:
 * - Response caching
 * - Request deduplication
 * - Performance monitoring
 * - Memory management
 * - Network optimization
 */

import { useCallback, useRef, useEffect } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';

// Cache configuration
interface CacheConfig {
  maxSize: number;
  ttl: number; // Time to live in ms
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 50,
  ttl: 5 * 60 * 1000, // 5 minutes
};

// In-memory cache
class MemoryCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;

  constructor(config: CacheConfig = DEFAULT_CACHE_CONFIG) {
    this.config = config;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update hit count
    entry.hits++;
    return entry.data;
  }

  set(key: string, data: T): void {
    // Evict if at capacity
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let minHits = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < minHits) {
        minHits = entry.hits;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  getStats(): { size: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    const hitRate = this.cache.size > 0 ? totalHits / this.cache.size : 0;
    return { size: this.cache.size, hitRate };
  }
}

// Request deduplication
class RequestDeduplicator {
  private pendingRequests: Map<string, Promise<any>> = new Map();

  async deduplicate<T>(key: string, request: () => Promise<T>): Promise<T> {
    // Check if request is already pending
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Create new request
    const promise = request();
    this.pendingRequests.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  cancel(key: string): void {
    this.pendingRequests.delete(key);
  }

  cancelAll(): void {
    this.pendingRequests.clear();
  }
}

// Global instances
const cache = new MemoryCache();
const deduplicator = new RequestDeduplicator();

// Performance monitoring
interface PerformanceMetrics {
  apiCalls: number;
  cacheHits: number;
  cacheMisses: number;
  avgResponseTime: number;
  memoryUsage: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    apiCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgResponseTime: 0,
    memoryUsage: 0,
  };

  private responseTimes: number[] = [];

  recordAPICall(duration: number, cached: boolean): void {
    this.metrics.apiCalls++;
    this.responseTimes.push(duration);
    
    // Keep last 100 response times
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    // Calculate average
    this.metrics.avgResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

    if (cached) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      apiCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgResponseTime: 0,
      memoryUsage: 0,
    };
    this.responseTimes = [];
  }
}

const perfMonitor = new PerformanceMonitor();

// Hook for cached API calls
export function useCachedAPI<T>() {
  const cacheRef = useRef(cache);
  const dedupRef = useRef(deduplicator);

  const fetchWithCache = useCallback(async (
    key: string,
    fetchFn: () => Promise<T>,
    options: { useCache?: boolean; cacheTTL?: number } = {}
  ): Promise<T> => {
    const { useCache = true, cacheTTL } = options;
    const startTime = Date.now();

    // Check cache first
    if (useCache) {
      const cached = cacheRef.current.get(key);
      if (cached) {
        perfMonitor.recordAPICall(Date.now() - startTime, true);
        return cached;
      }
    }

    // Check for duplicate requests
    const data = await dedupRef.current.deduplicate(key, fetchFn);
    
    // Cache the result
    if (useCache) {
      cacheRef.current.set(key, data);
    }

    perfMonitor.recordAPICall(Date.now() - startTime, false);
    return data;
  }, []);

  const invalidateCache = useCallback((key?: string) => {
    if (key) {
      cacheRef.current.delete(key);
    } else {
      cacheRef.current.clear();
    }
  }, []);

  const getCacheStats = useCallback(() => {
    return cacheRef.current.getStats();
  }, []);

  return {
    fetchWithCache,
    invalidateCache,
    getCacheStats,
  };
}

// Hook for performance monitoring
export function usePerformanceMonitor() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>(perfMonitor.getMetrics());

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(perfMonitor.getMetrics());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const resetMetrics = useCallback(() => {
    perfMonitor.reset();
    setMetrics(perfMonitor.getMetrics());
  }, []);

  return {
    metrics,
    resetMetrics,
  };
}

// Hook for app state handling (background/foreground)
export function useAppState() {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [isActive, setIsActive] = useState(appState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setAppState(nextAppState);
      setIsActive(nextAppState === 'active');

      // Clear sensitive data when going to background
      if (nextAppState === 'background') {
        // Could clear sensitive cache here
        console.log('[Performance] App moved to background');
      }

      // Refresh data when coming to foreground
      if (nextAppState === 'active') {
        console.log('[Performance] App moved to foreground');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return { appState, isActive };
}

// Hook for memory management
export function useMemoryManagement() {
  const [lowMemory, setLowMemory] = useState(false);

  useEffect(() => {
    // In React Native, we'd use NativeModules for memory info
    // For now, we'll use a simple heuristic
    const checkMemory = () => {
      // This would be replaced with actual native memory API
      const simulatedLowMemory = false;
      setLowMemory(simulatedLowMemory);

      if (simulatedLowMemory) {
        // Clear non-essential cache
        cache.clear();
        Alert.alert(
          'Low Memory',
          'Clearing cached data to improve performance.'
        );
      }
    };

    const interval = setInterval(checkMemory, 30000);
    return () => clearInterval(interval);
  }, []);

  const clearAllCache = useCallback(() => {
    cache.clear();
    deduplicator.cancelAll();
  }, []);

  return { lowMemory, clearAllCache };
}

// Combined performance hook
export function usePerformance() {
  const cachedAPI = useCachedAPI();
  const { metrics, resetMetrics } = usePerformanceMonitor();
  const { appState, isActive } = useAppState();
  const { lowMemory, clearAllCache } = useMemoryManagement();

  return {
    // Caching
    fetchWithCache: cachedAPI.fetchWithCache,
    invalidateCache: cachedAPI.invalidateCache,
    getCacheStats: cachedAPI.getCacheStats,
    
    // Monitoring
    metrics,
    resetMetrics,
    
    // App state
    appState,
    isActive,
    
    // Memory
    lowMemory,
    clearAllCache,
  };
}

// Export utilities
export { cache, deduplicator, perfMonitor };
export type { CacheConfig, PerformanceMetrics };

// React import for useState
import { useState } from 'react';