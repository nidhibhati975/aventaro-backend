/**
 * Infinite Scroll Component
 * 
 * Features:
 * - Automatic load on scroll
 * - Loading indicator
 * - End of list detection
 * - Error handling with retry
 * - Pull to refresh integration
 */

import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { COLORS } from '../../theme/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const LOAD_MORE_THRESHOLD = 200; // Pixels from bottom to trigger load

interface InfiniteScrollProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  onLoadMore: () => Promise<void>;
  isLoading?: boolean;
  hasMore?: boolean;
  error?: string | null;
  onRetry?: () => void;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  initialNumToRender?: number;
  maxToRenderPerBatch?: number;
  windowSize?: number;
  removeClippedSubviews?: boolean;
}

export default function InfiniteScroll<T>({
  data,
  renderItem,
  keyExtractor,
  onLoadMore,
  isLoading = false,
  hasMore = true,
  error = null,
  onRetry,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  initialNumToRender = 10,
  maxToRenderPerBatch = 10,
  windowSize = 5,
  removeClippedSubviews = true,
}: InfiniteScrollProps<T>) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleEndReached = useCallback(async () => {
    if (!isLoadingMore && hasMore && !error) {
      setIsLoadingMore(true);
      try {
        await onLoadMore();
      } finally {
        if (isMounted.current) {
          setIsLoadingMore(false);
        }
      }
    }
  }, [isLoadingMore, hasMore, error, onLoadMore]);

  const renderFooter = () => {
    if (!hasMore) {
      return (
        <View style={styles.endContainer}>
          <Text style={styles.endText}>You've seen it all!</Text>
          <Text style={styles.endSubtext}>Check back later for more</Text>
        </View>
      );
    }

    if (isLoadingMore) {
      return (
        <View style={styles.loadingMore}>
          <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
          <Text style={styles.loadingText}>Loading more...</Text>
        </View>
      );
    }

    return null;
  };

  const renderError = () => {
    if (error && onRetry) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>Something went wrong</Text>
          <Text style={styles.errorSubtext}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  };

  const renderEmpty = () => {
    if (!isLoading && !error && ListEmptyComponent) {
      return ListEmptyComponent;
    }
    if (!isLoading && !error && !data.length) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptySubtitle}>Pull down to refresh</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={
        <>
          {renderFooter()}
          {ListFooterComponent}
        </>
      }
      ListEmptyComponent={
        <>
          {renderError()}
          {renderEmpty()}
        </>
      }
      initialNumToRender={initialNumToRender}
      maxToRenderPerBatch={maxToRenderPerBatch}
      windowSize={windowSize}
      removeClippedSubviews={removeClippedSubviews}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      getItemLayout={(_, index) => ({
        length: 200, // Approximate item height
        offset: 200 * index,
        index,
      })}
    />
  );
}

// Hook for infinite scroll logic
export function useInfiniteScroll<T>(
  fetchFn: (page: number) => Promise<T[]>,
  initialData: T[] = [],
  pageSize = 20
) {
  const [data, setData] = useState<T[]>(initialData);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchFn(1);
      setData(result);
      setPage(1);
      setHasMore(result.length >= pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, pageSize]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const result = await fetchFn(nextPage);
      setData(prev => [...prev, ...result]);
      setPage(nextPage);
      setHasMore(result.length >= pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchFn, page, hasMore, isLoadingMore, pageSize]);

  const refresh = useCallback(async () => {
    setPage(1);
    setData([]);
    setHasMore(true);
    await loadInitial();
  }, [loadInitial]);

  const reset = useCallback(() => {
    setData([]);
    setPage(1);
    setHasMore(true);
    setError(null);
  }, []);

  return {
    data,
    setData,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadInitial,
    loadMore,
    refresh,
    reset,
    page,
  };
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  endContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  endText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  endSubtext: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginTop: 4,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 40,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  errorSubtext: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderRadius: 24,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginTop: 8,
  },
});