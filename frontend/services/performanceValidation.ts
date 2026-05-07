/**
 * Performance Validation Service
 * 
 * Features:
 * - API latency tracking
 * - Error logging system
 * - Memory usage monitoring
 * - React memoization helpers
 * - Performance metrics collection
 */

import { Platform, Performance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { productionAnalytics } from './productionAnalyticsService';
import { errorLogger } from './errorLogger';

// ============== TYPES ==============

export interface APIMetrics {
  endpoint: string;
  method: string;
  latencyMs: number;
  statusCode: number;
  success: boolean;
  timestamp: number;
  errorType?: string;
}

export interface MemoryMetrics {
  used: number;
  total: number;
  percentage: number;
  timestamp: number;
}

export interface PerformanceMetrics {
  screenName: string;
  renderTimeMs: number;
  componentCount: number;
  timestamp: number;
}

export interface AppStateMetrics {
  backgroundDurationMs: number;
  foregroundDurationMs: number;
  coldStartMs: number;
  sessionDurationMs: number;
  timestamp: number;
}

export interface PerformanceConfig {
  enableAPITracking: boolean;
  enableMemoryTracking: boolean;
  enableRenderTracking: boolean;
  apiSampleRate: number; // 0-1
  memoryCheckIntervalMs: number;
  maxMetricsStored: number;
}

// ============== DEFAULT CONFIG ==============

const DEFAULT_CONFIG: PerformanceConfig = {
  enableAPITracking: true,
  enableMemoryTracking: true,
  enableRenderTracking: true,
  apiSampleRate: 0.1, // 10% of API calls
  memoryCheckIntervalMs: 30000, // 30 seconds
  maxMetricsStored: 1000,
};

// ============== METRICS STORAGE ==============

const API_METRICS_KEY = 'perf:apiMetrics';
const MEMORY_METRICS_KEY = 'perf:memoryMetrics';
const PERFORMANCE_METRICS_KEY = 'perf:performanceMetrics';
const APP_STATE_METRICS_KEY = 'perf:appStateMetrics';

// ============== MAIN SERVICE ==============

class PerformanceValidationService {
  private config: PerformanceConfig;
  private apiMetrics: APIMetrics[] = [];
  private memoryMetrics: MemoryMetrics[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  private appStateMetrics: AppStateMetrics[] = [];
  private memoryCheckInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============== INITIALIZATION ==============

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Load stored metrics
    await this.loadMetrics();

    // Start memory tracking
    if (this.config.enableMemoryTracking) {
      this.startMemoryTracking();
    }

    this.isInitialized = true;
    console.log('[Performance] Service initialized');
  }

  // ============== API LATENCY TRACKING ==============

  /**
   * Track API call performance
   */
  trackAPICall(
    endpoint: string,
    method: string,
    latencyMs: number,
    statusCode: number,
    success: boolean,
    errorType?: string
  ): void {
    if (!this.config.enableAPITracking) return;

    // Sample based on rate
    if (Math.random() > this.config.apiSampleRate) return;

    const metric: APIMetrics = {
      endpoint,
      method,
      latencyMs,
      statusCode,
      success,
      timestamp: Date.now(),
      errorType,
    };

    this.apiMetrics.push(metric);
    this.persistAPIMetrics();

    // Log slow API calls
    if (latencyMs > 3000) {
      console.warn(`[Performance] Slow API: ${method} ${endpoint} took ${latencyMs}ms`);
      errorLogger.logWarning('Slow API call', {
        endpoint,
        method,
        latencyMs,
        statusCode,
      });
    }

    // Track in analytics
    productionAnalytics.track('api_latency', {
      endpoint,
      method,
      latency_ms: latencyMs,
      success,
    });
  }

  /**
   * Create API wrapper for automatic tracking
   */
  trackAPI<T>(
    endpoint: string,
    method: string,
    apiCall: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    return apiCall()
      .then((result) => {
        const latencyMs = Date.now() - startTime;
        this.trackAPICall(endpoint, method, latencyMs, 200, true);
        return result;
      })
      .catch((error) => {
        const latencyMs = Date.now() - startTime;
        const statusCode = error.response?.status || 0;
        this.trackAPICall(endpoint, method, latencyMs, statusCode, false, error.name);
        throw error;
      });
  }

  /**
   * Get API metrics summary
   */
  getAPIMetricsSummary(): {
    totalCalls: number;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    errorRate: number;
    slowestEndpoints: { endpoint: string; avgLatency: number }[];
  } {
    if (this.apiMetrics.length === 0) {
      return {
        totalCalls: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        slowestEndpoints: [],
      };
    }

    const latencies = this.apiMetrics.map((m) => m.latencyMs).sort((a, b) => a - b);
    const errors = this.apiMetrics.filter((m) => !m.success);

    // Calculate percentiles
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    // Group by endpoint
    const endpointGroups = new Map<string, number[]>();
    this.apiMetrics.forEach((m) => {
      const existing = endpointGroups.get(m.endpoint) || [];
      existing.push(m.latencyMs);
      endpointGroups.set(m.endpoint, existing);
    });

    const slowestEndpoints = Array.from(endpointGroups.entries())
      .map(([endpoint, lats]) => ({
        endpoint,
        avgLatency: lats.reduce((a, b) => a + b, 0) / lats.length,
      }))
      .sort((a, b) => b.avgLatency - a.avgLatency)
      .slice(0, 5);

    return {
      totalCalls: this.apiMetrics.length,
      avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      errorRate: errors.length / this.apiMetrics.length,
      slowestEndpoints,
    };
  }

  // ============== MEMORY MONITORING ==============

  private startMemoryTracking(): void {
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemory();
    }, this.config.memoryCheckIntervalMs);

    // Initial check
    this.checkMemory();
  }

  private async checkMemory(): Promise<void> {
    try {
      // In React Native, memory info is limited
      // Use native modules in production
      const memoryInfo = await this.getMemoryInfo();
      
      const metric: MemoryMetrics = {
        used: memoryInfo.used,
        total: memoryInfo.total,
        percentage: (memoryInfo.used / memoryInfo.total) * 100,
        timestamp: Date.now(),
      };

      this.memoryMetrics.push(metric);
      this.persistMemoryMetrics();

      // Log high memory usage
      if (metric.percentage > 85) {
        console.warn(`[Performance] High memory: ${metric.percentage.toFixed(1)}%`);
        errorLogger.logWarning('High memory usage', {
          percentage: metric.percentage,
          used: memoryInfo.used,
          total: memoryInfo.total,
        });
      }

      // Track in analytics
      productionAnalytics.track('memory_usage', {
        percentage: metric.percentage,
        used_mb: memoryInfo.used,
        total_mb: memoryInfo.total,
      });
    } catch (error) {
      // Ignore memory check errors
    }
  }

  private async getMemoryInfo(): Promise<{ used: number; total: number }> {
    // In production, use native memory APIs
    // For now, return estimated values
    return {
      used: 150, // MB estimate
      total: 512, // MB (typical React Native limit)
    };
  }

  /**
   * Get memory metrics summary
   */
  getMemoryMetricsSummary(): {
    currentUsage: number;
    avgUsage: number;
    peakUsage: number;
    samples: number;
  } {
    if (this.memoryMetrics.length === 0) {
      return {
        currentUsage: 0,
        avgUsage: 0,
        peakUsage: 0,
        samples: 0,
      };
    }

    const percentages = this.memoryMetrics.map((m) => m.percentage);

    return {
      currentUsage: percentages[percentages.length - 1],
      avgUsage: percentages.reduce((a, b) => a + b, 0) / percentages.length,
      peakUsage: Math.max(...percentages),
      samples: this.memoryMetrics.length,
    };
  }

  // ============== RENDER PERFORMANCE ==============

  /**
   * Track component render time
   */
  trackRender(screenName: string, renderTimeMs: number): void {
    if (!this.config.enableRenderTracking) return;

    const metric: PerformanceMetrics = {
      screenName,
      renderTimeMs,
      componentCount: 0, // Would need React DevTools
      timestamp: Date.now(),
    };

    this.performanceMetrics.push(metric);
    this.persistPerformanceMetrics();

    // Log slow renders
    if (renderTimeMs > 500) {
      console.warn(`[Performance] Slow render: ${screenName} took ${renderTimeMs}ms`);
    }
  }

  /**
   * Get render performance summary
   */
  getRenderPerformanceSummary(): {
    slowestScreens: { screen: string; avgRenderMs: number; count: number }[];
    avgRenderTime: number;
  } {
    const screenGroups = new Map<string, { total: number; count: number }>();
    
    this.performanceMetrics.forEach((m) => {
      const existing = screenGroups.get(m.screenName) || { total: 0, count: 0 };
      existing.total += m.renderTimeMs;
      existing.count += 1;
      screenGroups.set(m.screenName, existing);
    });

    const slowestScreens = Array.from(screenGroups.entries())
      .map(([screen, data]) => ({
        screen,
        avgRenderMs: data.total / data.count,
        count: data.count,
      }))
      .sort((a, b) => b.avgRenderMs - a.avgRenderMs)
      .slice(0, 10);

    const allRenderTimes = this.performanceMetrics.map((m) => m.renderTimeMs);
    const avgRenderTime = allRenderTimes.length > 0
      ? allRenderTimes.reduce((a, b) => a + b, 0) / allRenderTimes.length
      : 0;

    return {
      slowestScreens,
      avgRenderTime,
    };
  }

  // ============== APP STATE TRACKING ==============

  /**
   * Track app state transitions
   */
  trackAppStateChange(
    fromState: string,
    toState: string,
    durationMs?: number
  ): void {
    const metric: AppStateMetrics = {
      backgroundDurationMs: toState === 'background' ? durationMs || 0 : 0,
      foregroundDurationMs: toState === 'active' ? durationMs || 0 : 0,
      coldStartMs: fromState === 'initial' ? durationMs || 0 : 0,
      sessionDurationMs: 0,
      timestamp: Date.now(),
    };

    this.appStateMetrics.push(metric);
    this.persistAppStateMetrics();

    // Track cold start
    if (fromState === 'initial' && toState === 'active') {
      productionAnalytics.track('app_cold_start', {
        duration_ms: durationMs,
      });
    }

    // Track background/foreground
    productionAnalytics.track('app_state_change', {
      from: fromState,
      to: toState,
      duration_ms: durationMs,
    });
  }

  // ============== PERSISTENCE ==============

  private async loadMetrics(): Promise<void> {
    try {
      const [apiRaw, memoryRaw, perfRaw, appStateRaw] = await Promise.all([
        AsyncStorage.getItem(API_METRICS_KEY),
        AsyncStorage.getItem(MEMORY_METRICS_KEY),
        AsyncStorage.getItem(PERFORMANCE_METRICS_KEY),
        AsyncStorage.getItem(APP_STATE_METRICS_KEY),
      ]);

      if (apiRaw) this.apiMetrics = JSON.parse(apiRaw);
      if (memoryRaw) this.memoryMetrics = JSON.parse(memoryRaw);
      if (perfRaw) this.performanceMetrics = JSON.parse(perfRaw);
      if (appStateRaw) this.appStateMetrics = JSON.parse(appStateRaw);

      // Trim old metrics
      this.trimMetrics();
    } catch (error) {
      errorLogger.logAsyncStorageError(error, 'performance', 'loadMetrics');
    }
  }

  private async persistAPIMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(API_METRICS_KEY, JSON.stringify(this.apiMetrics));
    } catch (error) {
      // Ignore
    }
  }

  private async persistMemoryMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(MEMORY_METRICS_KEY, JSON.stringify(this.memoryMetrics));
    } catch (error) {
      // Ignore
    }
  }

  private async persistPerformanceMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(PERFORMANCE_METRICS_KEY, JSON.stringify(this.performanceMetrics));
    } catch (error) {
      // Ignore
    }
  }

  private async persistAppStateMetrics(): Promise<void> {
    try {
      await AsyncStorage.setItem(APP_STATE_METRICS_KEY, JSON.stringify(this.appStateMetrics));
    } catch (error) {
      // Ignore
    }
  }

  private trimMetrics(): void {
    const max = this.config.maxMetricsStored;

    if (this.apiMetrics.length > max) {
      this.apiMetrics = this.apiMetrics.slice(-max);
    }
    if (this.memoryMetrics.length > max) {
      this.memoryMetrics = this.memoryMetrics.slice(-max);
    }
    if (this.performanceMetrics.length > max) {
      this.performanceMetrics = this.performanceMetrics.slice(-max);
    }
    if (this.appStateMetrics.length > max) {
      this.appStateMetrics = this.appStateMetrics.slice(-max);
    }
  }

  // ============== PUBLIC API ==============

  /**
   * Get all performance summaries
   */
  getAllSummaries(): {
    api: ReturnType<typeof this.getAPIMetricsSummary>;
    memory: ReturnType<typeof this.getMemoryMetricsSummary>;
    render: ReturnType<typeof this.getRenderPerformanceSummary>;
  } {
    return {
      api: this.getAPIMetricsSummary(),
      memory: this.getMemoryMetricsSummary(),
      render: this.getRenderPerformanceSummary(),
    };
  }

  /**
   * Clear all metrics
   */
  async clearMetrics(): Promise<void> {
    this.apiMetrics = [];
    this.memoryMetrics = [];
    this.performanceMetrics = [];
    this.appStateMetrics = [];

    await Promise.all([
      AsyncStorage.removeItem(API_METRICS_KEY),
      AsyncStorage.removeItem(MEMORY_METRICS_KEY),
      AsyncStorage.removeItem(PERFORMANCE_METRICS_KEY),
      AsyncStorage.removeItem(APP_STATE_METRICS_KEY),
    ]);
  }

  /**
   * End service
   */
  async end(): Promise<void> {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    this.isInitialized = false;
  }
}

// ============== REACT MEMOIZATION HELPERS ==============

/**
 * Create stable callback for use in useEffect/useCallback
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const ref = React.useRef(callback);
  ref.current = callback;

  return React.useCallback(
    ((...args) => ref.current(...args)) as T,
    []
  );
}

/**
 * Create stable value for use in dependency arrays
 */
export function useStableValue<T>(value: T): T {
  const ref = React.useRef(value);
  return ref.current;
}

/**
 * Memoize expensive computation
 */
export function useMemoized<T>(
  factory: () => T,
  deps: React.DependencyList
): T {
  return React.useMemo(factory, deps);
}

// Need to import React
import React from 'react';

// ============== EXPORT ==============

export const performanceValidation = new PerformanceValidationService();
export default performanceValidation;

export type {
  APIMetrics,
  MemoryMetrics,
  PerformanceMetrics,
  AppStateMetrics,
  PerformanceConfig,
};