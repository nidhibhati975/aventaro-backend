/**
 * Error Recovery System
 * 
 * Features:
 * - Global error boundary
 * - Retry UI for failed APIs
 * - Graceful fallback states
 * - Network loss handling
 * - Recovery callbacks
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { COLORS } from '../theme/colors';

// ============== TYPES ==============

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onRetry?: () => void;
  level?: 'page' | 'component';
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export interface FallbackProps {
  error: Error;
  resetError: () => void;
  retry?: () => void;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface NetworkState {
  isOnline: boolean;
  wasOnline: boolean;
  lastOnlineAt: number | null;
}

// ============== DEFAULT CONFIG ==============

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

// ============== ERROR BOUNDARY ==============

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Call onError callback
    this.props.onError?.(error, errorInfo);

    // Log to error service
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error!}
          resetError={this.resetError}
          retry={this.props.onRetry}
        />
      );
    }

    return this.props.children;
  }
}

// ============== ERROR FALLBACK COMPONENT ==============

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  retry?: () => void;
}

function ErrorFallback({ error, resetError, retry }: ErrorFallbackProps) {
  const [isRetrying, setIsRetrying] = React.useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retry?.();
      resetError();
    } catch {
      // Error will be caught by boundary again
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <View style={styles.fallbackContainer}>
      <View style={styles.fallbackIcon}>
        <Text style={styles.fallbackIconText}>⚠️</Text>
      </View>
      
      <Text style={styles.fallbackTitle}>Something went wrong</Text>
      <Text style={styles.fallbackMessage}>
        {error.message || 'An unexpected error occurred'}
      </Text>

      <View style={styles.fallbackActions}>
        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={resetError}
        >
          <Text style={styles.fallbackButtonText}>Go Back</Text>
        </TouchableOpacity>

        {retry && (
          <TouchableOpacity
            style={[styles.fallbackButton, styles.fallbackButtonPrimary]}
            onPress={handleRetry}
            disabled={isRetrying}
          >
            <Text style={styles.fallbackButtonText}>
              {isRetrying ? 'Retrying...' : 'Try Again'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ============== API RETRY HOOK ==============

function useApiRetry<T>(
  apiCall: () => Promise<T>,
  config: Partial<RetryConfig> = {}
) {
  const [isRetrying, setIsRetrying] = React.useState(false);
  const [retryCount, setRetryCount] = React.useState(0);
  const [lastError, setLastError] = React.useState<Error | null>(null);

  const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  const execute = React.useCallback(async (): Promise<T> => {
    setIsRetrying(true);
    setLastError(null);

    let lastError: Error | null = null;
    let delay = mergedConfig.initialDelayMs;

    for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
      try {
        const result = await apiCall();
        setIsRetrying(false);
        setRetryCount(0);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < mergedConfig.maxRetries) {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * mergedConfig.backoffMultiplier, mergedConfig.maxDelayMs);
          setRetryCount(attempt + 1);
        }
      }
    }

    setIsRetrying(false);
    setLastError(lastError);
    throw lastError;
  }, [apiCall, mergedConfig, retryCount]);

  const reset = React.useCallback(() => {
    setRetryCount(0);
    setLastError(null);
    setIsRetrying(false);
  }, []);

  return {
    execute,
    isRetrying,
    retryCount,
    lastError,
    reset,
    canRetry: retryCount < mergedConfig.maxRetries,
  };
}

// ============== RETRY UI COMPONENT ==============

interface RetryUIProps {
  isRetrying: boolean;
  retryCount: number;
  maxRetries: number;
  error?: Error | null;
  onRetry: () => void;
  onGiveUp?: () => void;
  message?: string;
}

export function RetryUI({
  isRetrying,
  retryCount,
  maxRetries,
  error,
  onRetry,
  onGiveUp,
  message = 'Something went wrong',
}: RetryUIProps) {
  const progress = retryCount / maxRetries;

  return (
    <View style={styles.retryContainer}>
      <View style={styles.retryContent}>
        {isRetrying ? (
          <>
            <View style={styles.retrySpinner}>
              <Text style={styles.retrySpinnerText}>⏳</Text>
            </View>
            <Text style={styles.retryTitle}>Retrying...</Text>
            <Text style={styles.retryMessage}>
              Attempt {retryCount} of {maxRetries}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.retryIcon}>⚠️</Text>
            <Text style={styles.retryTitle}>{message}</Text>
            {error && (
              <Text style={styles.retryError} numberOfLines={2}>
                {error.message}
              </Text>
            )}
            <Text style={styles.retryMessage}>
              Failed {retryCount} of {maxRetries} attempts
            </Text>
          </>
        )}

        {/* Progress bar */}
        <View style={styles.retryProgress}>
          <View style={[styles.retryProgressFill, { width: `${progress * 100}%` }]} />
        </View>

        {/* Actions */}
        <View style={styles.retryActions}>
          {isRetrying ? (
            <TouchableOpacity
              style={[styles.retryButton, styles.retryButtonDisabled]}
              disabled
            >
              <Text style={styles.retryButtonText}>Please wait...</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.retryButton, styles.retryButtonPrimary]}
                onPress={onRetry}
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>

              {onGiveUp && retryCount >= maxRetries && (
                <TouchableOpacity
                  style={[styles.retryButton, styles.retryButtonSecondary]}
                  onPress={onGiveUp}
                >
                  <Text style={styles.retryButtonTextSecondary}>Go Back</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ============== NETWORK STATE HOOK ==============

function useNetworkState() {
  const [networkState, setNetworkState] = React.useState<NetworkState>({
    isOnline: true,
    wasOnline: true,
    lastOnlineAt: Date.now(),
  });

  React.useEffect(() => {
    // In production, use NetInfo or similar
    // For now, simulate network state
    
    const handleOnline = () => {
      setNetworkState((prev) => ({
        isOnline: true,
        wasOnline: prev.isOnline,
        lastOnlineAt: prev.isOnline ? prev.lastOnlineAt : Date.now(),
      }));
    };

    const handleOffline = () => {
      setNetworkState((prev) => ({
        isOnline: false,
        wasOnline: prev.isOnline,
        lastOnlineAt: prev.lastOnlineAt,
      }));
    };

    // Setup listeners (would use NetInfo in production)
    // NetInfo.addEventListener('connectionChange', ...)

    return () => {
      // Cleanup
    };
  }, []);

  return networkState;
}

// ============== NETWORK LOSS HANDLER ==============

interface NetworkLossHandlerProps {
  children: ReactNode;
  onNetworkLost?: () => void;
  onNetworkRestored?: () => void;
  fallback?: ReactNode;
}

function NetworkLossHandler({
  children,
  onNetworkLost,
  onNetworkRestored,
  fallback,
}: NetworkLossHandlerProps) {
  const networkState = useNetworkState();
  const [showOfflineBanner, setShowOfflineBanner] = React.useState(false);

  React.useEffect(() => {
    if (!networkState.isOnline && networkState.wasOnline) {
      // Network lost
      setShowOfflineBanner(true);
      onNetworkLost?.();
    } else if (networkState.isOnline && !networkState.wasOnline) {
      // Network restored
      setShowOfflineBanner(false);
      onNetworkRestored?.();
    }
  }, [networkState.isOnline, networkState.wasOnline]);

  if (!networkState.isOnline) {
    if (fallback) {
      return fallback;
    }

    return (
      <>
        {showOfflineBanner && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>
              📡 You're offline. Some features may be unavailable.
            </Text>
          </View>
        )}
        {children}
      </>
    );
  }

  return <>{children}</>;
}

// ============== GRACEFUL FALLBACK COMPONENT ==============

interface GracefulFallbackProps {
  isLoading?: boolean;
  isEmpty?: boolean;
  isError?: boolean;
  error?: Error | null;
  loadingMessage?: string;
  emptyMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function GracefulFallback({
  isLoading = false,
  isEmpty = false,
  isError = false,
  error,
  loadingMessage = 'Loading...',
  emptyMessage = 'No data available',
  errorMessage = 'Something went wrong',
  onRetry,
  children,
}: GracefulFallbackProps) {
  if (isLoading) {
    return (
      <View style={styles.gracefulContainer}>
        <View style={styles.gracefulSpinner}>
          <Text style={styles.gracefulSpinnerText}>⏳</Text>
        </View>
        <Text style={styles.gracefulMessage}>{loadingMessage}</Text>
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.gracefulContainer}>
        <Text style={styles.gracefulIcon}>📭</Text>
        <Text style={styles.gracefulMessage}>{emptyMessage}</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <RetryUI
        isRetrying={false}
        retryCount={0}
        maxRetries={3}
        error={error}
        onRetry={onRetry || (() => {})}
        message={errorMessage}
      />
    );
  }

  return <>{children}</>;
}

// ============== STYLES ==============

const styles = StyleSheet.create({
  // Error Fallback
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.BACKGROUND,
  },
  fallbackIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.WARNING_YELLOW + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  fallbackIconText: {
    fontSize: 40,
  },
  fallbackTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
    textAlign: 'center',
  },
  fallbackMessage: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
    marginBottom: 24,
  },
  fallbackActions: {
    flexDirection: 'row',
    gap: 12,
  },
  fallbackButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  fallbackButtonPrimary: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  fallbackButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },

  // Retry UI
  retryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.BACKGROUND,
  },
  retryContent: {
    alignItems: 'center',
    width: '100%',
  },
  retrySpinner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  retrySpinnerText: {
    fontSize: 30,
  },
  retryIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  retryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
    textAlign: 'center',
  },
  retryMessage: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryError: {
    fontSize: 12,
    color: COLORS.ERROR_RED,
    marginBottom: 12,
    textAlign: 'center',
  },
  retryProgress: {
    width: '100%',
    height: 4,
    backgroundColor: COLORS.BORDER,
    borderRadius: 2,
    marginBottom: 20,
    overflow: 'hidden',
  },
  retryProgressFill: {
    height: '100%',
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderRadius: 2,
  },
  retryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 120,
    alignItems: 'center',
  },
  retryButtonPrimary: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  retryButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  retryButtonDisabled: {
    backgroundColor: COLORS.BORDER,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  retryButtonTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
  },

  // Offline Banner
  offlineBanner: {
    backgroundColor: COLORS.WARNING_YELLOW,
    padding: 12,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '500',
  },

  // Graceful Fallback
  gracefulContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gracefulSpinner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  gracefulSpinnerText: {
    fontSize: 24,
  },
  gracefulIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  gracefulMessage: {
    fontSize: 16,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
  },
});

// ============== EXPORTS ==============

export { ErrorBoundary, useApiRetry, RetryUI, useNetworkState, NetworkLossHandler, GracefulFallback };
export type { ErrorBoundaryProps, ErrorBoundaryState, FallbackProps, RetryConfig, RetryUIProps, NetworkState, GracefulFallbackProps };