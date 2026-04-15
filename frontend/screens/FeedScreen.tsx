import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { errorLogger } from '../services/errorLogger';
import { getSafeImageSource, getSafeMediaUrl } from '../services/media';
import {
  fetchPostsFeed,
  fetchReelsFeed,
  fetchStoriesFeed,
  likePost,
  unlikePost,
} from '../services/socialService';
import {
  getUserDisplayName,
  getUserHandle,
  getUserInitials,
  type SocialPost,
  type StoryGroup,
} from '../services/types';
import { COLORS } from '../theme/colors';

type FeedTab = 'feed' | 'reels';

function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return 'Now';
  }

  try {
    const current = Date.now();
    const date = new Date(value).getTime();
    if (Number.isNaN(date)) {
      return 'Now';
    }

    const diffMinutes = Math.max(1, Math.round((current - date) / (1000 * 60)));
    if (diffMinutes < 60) {
      return `${diffMinutes}m`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h`;
    }

    return `${Math.round(diffHours / 24)}d`;
  } catch {
    return 'Now';
  }
}

function getStoryCover(group: StoryGroup | null | undefined) {
  const stories = Array.isArray(group?.stories) ? group.stories : [];
  return stories.map((story) => getSafeMediaUrl(story?.media_url)).find(Boolean) || null;
}

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<FeedTab>('feed');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [reels, setReels] = useState<SocialPost[]>([]);
  const [pendingLikeId, setPendingLikeId] = useState<number | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const [storiesResult, postsResult, reelsResult] = await Promise.allSettled([
      fetchStoriesFeed(12),
      fetchPostsFeed({ limit: 18, offset: 0 }),
      fetchReelsFeed({ limit: 8, offset: 0 }),
    ]);

    if (storiesResult.status === 'fulfilled') {
      setStories(Array.isArray(storiesResult.value?.items) ? storiesResult.value.items : []);
    } else {
      setStories([]);
      errorLogger.logError(storiesResult.reason, { source: 'FeedScreen', context: { action: 'fetchStories' } });
    }

    if (postsResult.status === 'fulfilled') {
      setPosts(Array.isArray(postsResult.value?.items) ? postsResult.value.items : []);
    } else {
      setPosts([]);
      errorLogger.logError(postsResult.reason, { source: 'FeedScreen', context: { action: 'fetchPosts' } });
    }

    if (reelsResult.status === 'fulfilled') {
      setReels(Array.isArray(reelsResult.value?.items) ? reelsResult.value.items : []);
    } else {
      setReels([]);
      errorLogger.logError(reelsResult.reason, { source: 'FeedScreen', context: { action: 'fetchReels' } });
    }

    if (
      storiesResult.status === 'rejected' &&
      postsResult.status === 'rejected' &&
      reelsResult.status === 'rejected'
    ) {
      setErrorMessage(extractErrorMessage(postsResult.reason, 'Unable to load social feed'));
    }

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadFeed();
    }, [loadFeed])
  );

  const trendingLabel = useMemo(() => {
    const tags = [...posts, ...reels]
      .flatMap((item) => (Array.isArray(item?.hashtags) ? item.hashtags : []))
      .filter(Boolean);

    if (tags.length === 0) {
      return '#AventaroTripChallenge is trending';
    }

    return `${tags[0]} is trending`;
  }, [posts, reels]);

  const handleToggleLike = async (post: SocialPost) => {
    try {
      setPendingLikeId(post.id);
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                liked_by_current_user: !item.liked_by_current_user,
                likes_count: item.likes_count + (item.liked_by_current_user ? -1 : 1),
              }
            : item
        )
      );

      if (post.liked_by_current_user) {
        await unlikePost(post.id);
      } else {
        await likePost(post.id);
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'FeedScreen', context: { action: 'toggleLike', postId: post.id } });
      await loadFeed();
    } finally {
      setPendingLikeId(null);
    }
  };

  const storyPreview = stories.slice(0, 6);
  const feedPosts = posts.filter((item) => item?.media_type === 'image').slice(0, 8);
  const reelPosts = reels.slice(0, 5);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.tabRow}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setTab('feed')}
            style={[styles.topTab, tab === 'feed' && styles.topTabActive]}
          >
            <Text style={[styles.topTabText, tab === 'feed' && styles.topTabTextActive]}>Feed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setTab('reels')}
            style={[styles.topTab, tab === 'reels' && styles.topTabActive]}
          >
            <Text style={[styles.topTabText, tab === 'reels' && styles.topTabTextActive]}>Reels</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.iconButton} onPress={() => navigateToPath(APP_PATHS.SCREEN_REELS)}>
          <Ionicons name="camera-outline" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Feed unavailable</Text>
          <Text style={styles.errorMessage}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadFeed()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : tab === 'feed' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.feedContent}>
          {storyPreview.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
              {storyPreview.map((group, index) => {
                const cover = getStoryCover(group);
                return (
                  <TouchableOpacity
                    key={`${group.user_id}_${index}`}
                    activeOpacity={0.9}
                    style={styles.storyItem}
                    onPress={() => navigation.navigate('StoryViewer', { groups: stories, initialGroupIndex: index })}
                  >
                    <View style={[styles.storyRing, group.has_unseen && styles.storyRingActive]}>
                      {cover ? (
                        <Image source={{ uri: cover }} style={styles.storyImage} />
                      ) : (
                        <View style={styles.storyFallback}>
                          <Text style={styles.storyFallbackText}>{getUserInitials(group.user)}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.storyLabel} numberOfLines={1}>
                      {index === 0 ? 'Your Story' : getUserDisplayName(group.user).split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={styles.trendingBanner}>
            <Ionicons name="trending-up-outline" size={15} color={COLORS.PRIMARY_PURPLE} />
            <Text style={styles.trendingText}>{trendingLabel}</Text>
          </View>

          {feedPosts.map((post) => {
            const postMediaSource = getSafeImageSource(post.media_url);

            return (
              <View key={post.id} style={styles.postCard}>
              <View style={styles.postHeader}>
                <View style={styles.postUserRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{getUserInitials(post.user)}</Text>
                  </View>
                  <View style={styles.postMeta}>
                    <Text style={styles.postName}>{getUserDisplayName(post.user)}</Text>
                    <Text style={styles.postLocation}>
                      <Ionicons name="location-outline" size={12} color={COLORS.TEXT_MUTED} /> {post.location || 'Aventaro'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.postTime}>{formatRelativeTime(post.created_at)}</Text>
              </View>

              {postMediaSource ? (
                <ImageBackground
                  source={postMediaSource}
                  style={styles.postMedia}
                  imageStyle={styles.postMediaImage}
                />
              ) : (
                <View style={styles.postMediaFallback}>
                  <Ionicons name="image-outline" size={28} color={COLORS.TEXT_MUTED} />
                  <Text style={styles.mediaFallbackText}>Photo unavailable</Text>
                </View>
              )}

              <View style={styles.actionRow}>
                <View style={styles.actionLeft}>
                  <TouchableOpacity
                    disabled={pendingLikeId === post.id}
                    onPress={() => void handleToggleLike(post)}
                    style={styles.actionButton}
                  >
                    <Ionicons
                      name={post.liked_by_current_user ? 'heart' : 'heart-outline'}
                      size={23}
                      color={post.liked_by_current_user ? '#F05A73' : COLORS.TEXT_PRIMARY}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="chatbubble-outline" size={22} color={COLORS.TEXT_PRIMARY} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="paper-plane-outline" size={22} color={COLORS.TEXT_PRIMARY} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.actionButton}>
                  <Ionicons name="bookmark-outline" size={22} color={COLORS.TEXT_PRIMARY} />
                </TouchableOpacity>
              </View>

              <View style={styles.captionWrap}>
                <Text style={styles.captionMeta}>{post.likes_count.toLocaleString()} likes</Text>
                <Text style={styles.captionText}>
                  <Text style={styles.captionAuthor}>{getUserHandle(post.user)} </Text>
                  {post.caption || 'Live moments from Aventaro travelers.'}
                </Text>
              </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.feedContent}>
          {reelPosts.map((post) => {
            const reelMediaSource = getSafeImageSource(post.media_url);

            return (
              <TouchableOpacity
              key={post.id}
              activeOpacity={0.92}
              style={styles.reelCard}
              onPress={() => navigation.navigate('Reels', { initialPostId: post.id })}
            >
              <View style={styles.reelHeader}>
                <View style={styles.postUserRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{getUserInitials(post.user)}</Text>
                  </View>
                  <View style={styles.postMeta}>
                    <Text style={styles.postName}>{getUserDisplayName(post.user)}</Text>
                    <Text style={styles.postLocation}>
                      <Ionicons name="location-outline" size={12} color={COLORS.TEXT_MUTED} /> {post.location || 'Aventaro'}
                    </Text>
                  </View>
                </View>
                <View style={styles.reelBadge}>
                  <Ionicons name="film-outline" size={12} color={COLORS.WHITE} />
                  <Text style={styles.reelBadgeText}>Reel</Text>
                </View>
              </View>

              {reelMediaSource ? (
                <ImageBackground
                  source={reelMediaSource}
                  style={styles.reelMedia}
                  imageStyle={styles.reelMediaImage}
                >
                  <View style={styles.playButton}>
                    <Ionicons name="play" size={34} color={COLORS.WHITE} />
                  </View>
                </ImageBackground>
              ) : (
                <View style={[styles.reelMedia, styles.reelMediaFallback]}>
                  <Ionicons name="film-outline" size={34} color={COLORS.TEXT_MUTED} />
                  <Text style={styles.mediaFallbackText}>Reel preview unavailable</Text>
                </View>
              )}

              <View style={styles.actionRow}>
                <View style={styles.actionLeft}>
                  <View style={styles.actionMetric}>
                    <Ionicons name="heart-outline" size={22} color={COLORS.TEXT_PRIMARY} />
                    <Text style={styles.metricText}>{post.likes_count.toLocaleString()}</Text>
                  </View>
                  <View style={styles.actionMetric}>
                    <Ionicons name="chatbubble-outline" size={21} color={COLORS.TEXT_PRIMARY} />
                    <Text style={styles.metricText}>{post.comments_count}</Text>
                  </View>
                  <View style={styles.actionMetric}>
                    <Ionicons name="paper-plane-outline" size={21} color={COLORS.TEXT_PRIMARY} />
                  </View>
                </View>
                <Ionicons name="bookmark-outline" size={22} color={COLORS.TEXT_PRIMARY} />
              </View>

              <Text style={styles.captionText}>
                <Text style={styles.captionAuthor}>{getUserHandle(post.user)} </Text>
                {post.caption || 'Open the reel to keep watching.'}
              </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECFA',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  topTab: {
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  topTabActive: {
    borderBottomColor: COLORS.PRIMARY_PURPLE,
  },
  topTabText: {
    fontSize: 18,
    color: COLORS.TEXT_MUTED,
    fontWeight: '500',
  },
  topTabTextActive: {
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '700',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  errorMessage: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  retryButton: {
    minWidth: 128,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  feedContent: {
    paddingBottom: 28,
  },
  storyRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 10,
  },
  storyItem: {
    width: 64,
    alignItems: 'center',
    gap: 8,
  },
  storyRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.6,
    borderColor: '#DFD5FF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  storyRingActive: {
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  storyImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  storyFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F4EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyFallbackText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  storyLabel: {
    width: '100%',
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.TEXT_PRIMARY,
  },
  trendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F4EEFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  trendingText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  postCard: {
    marginBottom: 20,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  postUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1EBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  postMeta: {
    gap: 2,
  },
  postName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  postLocation: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  postTime: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  postMedia: {
    height: 420,
    backgroundColor: '#EEE8FF',
  },
  postMediaFallback: {
    height: 420,
    backgroundColor: '#EEE8FF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  postMediaImage: {
    resizeMode: 'cover',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricText: {
    fontSize: 16,
    color: COLORS.TEXT_PRIMARY,
  },
  captionWrap: {
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  captionMeta: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  captionText: {
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.TEXT_PRIMARY,
    paddingHorizontal: 16,
  },
  captionAuthor: {
    fontWeight: '700',
  },
  reelCard: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  reelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  reelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reelBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  reelMedia: {
    height: 520,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCCFFF',
  },
  reelMediaFallback: {
    gap: 10,
  },
  reelMediaImage: {
    resizeMode: 'cover',
  },
  mediaFallbackText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_MUTED,
  },
  playButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(108,59,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
