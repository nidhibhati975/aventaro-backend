import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import ReelFeedItem from '../components/reels/ReelFeedItem';
import StatusView from '../components/StatusView';
import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { extractErrorMessage } from '../services/api';
import { errorLogger } from '../services/errorLogger';
import { safeParseNumber } from '../services/navigationSafety';
import {
  fetchReelsFeed,
  likePost,
  recordReelWatch,
  unlikePost,
} from '../services/socialService';
import type { FeedPage, SocialPost } from '../services/types';
import { COLORS } from '../theme/colors';

const PAGE_HEIGHT_FALLBACK = 760;

export default function ReelsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { isForeground, isOnline } = useAppRuntime();
  const initialPostId = safeParseNumber(route.params?.initialPostId, 0) || null;
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedPage<SocialPost> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(PAGE_HEIGHT_FALLBACK);
  const [loadingMore, setLoadingMore] = useState(false);
  const watchRef = useRef<Record<number, { currentTime: number; duration: number }>>({});
  const submittedRef = useRef<Record<number, number>>({});

  const loadReels = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const nextFeed = await fetchReelsFeed({ limit: 12, offset: 0 });
      
      if (!nextFeed || !Array.isArray(nextFeed?.items)) {
        throw new Error('Invalid feed response');
      }

      setFeed(nextFeed);
      if (initialPostId && nextFeed.items.length > 0) {
        const foundIndex = nextFeed.items.findIndex((item) => item?.id === initialPostId);
        if (foundIndex >= 0) {
          setActiveIndex(foundIndex);
        }
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'ReelsScreen', context: { action: 'loadReels' } });
      setErrorMessage(extractErrorMessage(error, 'Unable to load reels'));
      setFeed(null);
    } finally {
      setLoading(false);
    }
  }, [initialPostId]);

  useFocusEffect(
    useCallback(() => {
      if (isFocused) {
        void loadReels();
      }
    }, [loadReels, isFocused])
  );

  const submitWatch = useCallback(async (postId: number | null | undefined) => {
    if (!postId) {
      return;
    }

    try {
      const watchState = watchRef.current[postId];
      if (!watchState || watchState.currentTime <= 0) {
        return;
      }

      const previousSubmittedTime = submittedRef.current[postId] || 0;
      if (watchState.currentTime <= previousSubmittedTime) {
        return;
      }

      submittedRef.current[postId] = watchState.currentTime;
      await recordReelWatch(postId, watchState.currentTime, watchState.duration);
    } catch (error) {
      errorLogger.logError(error, { source: 'ReelsScreen', context: { action: 'submitWatch', postId } });
      // Silent persistence failure - don't crash the viewer
    }
  }, []);

  const handleMomentumEnd = useCallback(
    async (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      try {
        const nextIndex = Math.round(event.nativeEvent.contentOffset.y / viewportHeight);
        const previous = feed?.items?.[activeIndex];
        
        if (previous?.id) {
          await submitWatch(previous.id);
        }

        setActiveIndex(Math.max(0, Math.min(nextIndex, (feed?.items?.length || 0) - 1)));

        if (
          feed?.next_cursor &&
          !loadingMore &&
          nextIndex >= Math.max(0, (feed?.items?.length || 0) - 3)
        ) {
          try {
            setLoadingMore(true);
            const nextPage = await fetchReelsFeed({ limit: 12, cursor: feed.next_cursor });
            
            if (!nextPage || !Array.isArray(nextPage?.items)) {
              throw new Error('Invalid pagination response');
            }

            setFeed((previousFeed) => {
              if (!previousFeed) {
                return nextPage;
              }

              const prevItems = previousFeed.items || [];
              const newItems = nextPage.items || [];
              const mergedItems = [...prevItems, ...newItems].filter(
                (item, index, array) => item?.id && array.findIndex((entry) => entry?.id === item.id) === index
              );

              return {
                ...nextPage,
                items: mergedItems,
                total: nextPage.total || previousFeed.total,
              };
            });
          } catch (error) {
            errorLogger.logError(error, { source: 'ReelsScreen', context: { action: 'pagination' } });
            setLoadingMore(false);
          }
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'ReelsScreen', context: { action: 'handleMomentumEnd' } });
      } finally {
        setLoadingMore(false);
      }
    },
    [activeIndex, feed?.items, feed?.next_cursor, loadingMore, submitWatch, viewportHeight]
  );

  const handleToggleLike = useCallback(
    async (post: SocialPost | null | undefined) => {
      if (!post?.id) {
        return;
      }

      try {
        const previousFeed = feed;
        if (!previousFeed?.items) {
          return;
        }

        const optimistic = previousFeed.items.map((item) =>
          item?.id !== post.id
            ? item
            : {
                ...item,
                liked_by_current_user: !item?.liked_by_current_user,
                likes_count: (item?.likes_count || 0) + (item?.liked_by_current_user ? -1 : 1),
              }
        );
        setFeed({ ...previousFeed, items: optimistic });

        try {
          const updated = post.liked_by_current_user ? await unlikePost(post.id) : await likePost(post.id);
          
          if (!updated?.id) {
            throw new Error('Invalid response from like/unlike');
          }

          setFeed((currentFeed) =>
            currentFeed
              ? {
                  ...currentFeed,
                  items: (currentFeed.items || []).map((item) => (item?.id === updated.id ? updated : item)),
                }
              : currentFeed
          );
        } catch (likeError) {
          errorLogger.logError(likeError, { source: 'ReelsScreen', context: { action: 'toggleLike', postId: post.id } });
          setFeed(previousFeed);
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'ReelsScreen', context: { action: 'handleToggleLike' } });
      }
    },
    [feed]
  );

  const reelItems = useMemo(() => feed?.items || [], [feed?.items]);
  const reachedEnd = !feed?.next_cursor;
  const shouldPlayActiveReel = isFocused && isForeground && isOnline;

  const renderReel = useCallback(
    ({ item, index }: { item: SocialPost; index: number }) => (
      <View style={{ height: viewportHeight }}>
        <ReelFeedItem
          post={item}
          active={shouldPlayActiveReel && index === activeIndex}
          onToggleLike={handleToggleLike}
          onProgress={(postId, currentTime, duration) => {
            watchRef.current[postId] = { currentTime, duration };
          }}
        />
      </View>
    ),
    [activeIndex, handleToggleLike, shouldPlayActiveReel, viewportHeight]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusView type="loading" message="Loading reels..." />
      </SafeAreaView>
    );
  }

  if (errorMessage || reelItems.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={22} color={COLORS.WHITE} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reels</Text>
          <View style={styles.headerButton} />
        </View>
        <StatusView
          type="error"
          title="Reels unavailable"
          message={errorMessage || 'No reels yet'}
          onRetry={() => void loadReels()}
        />
      </SafeAreaView>
    );
  }

  return (
    <View
      style={styles.container}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <SafeAreaView edges={['top']} style={styles.floatingHeader}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={22} color={COLORS.WHITE} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reels</Text>
          <View style={styles.headerButton} />
        </View>
      </SafeAreaView>

      <FlatList
        data={reelItems}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderReel}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        removeClippedSubviews
        onMomentumScrollEnd={(event) => void handleMomentumEnd(event)}
        getItemLayout={(_, index) => ({
          length: viewportHeight,
          offset: viewportHeight * index,
          index,
        })}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerState}>
              <ActivityIndicator size="small" color={COLORS.WHITE} />
            </View>
          ) : reachedEnd ? (
            <View style={styles.footerState}>
              <Text style={styles.footerText}>End of reels</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05030A',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  footerState: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    textTransform: 'uppercase',
  },
});
