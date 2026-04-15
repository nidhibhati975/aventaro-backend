import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Video from 'react-native-video';

import { errorLogger } from '../../services/errorLogger';
import { getSafeMediaUrl } from '../../services/media';
import { getUserDisplayName, type SocialPost } from '../../services/types';
import { COLORS } from '../../theme/colors';

interface ReelFeedItemProps {
  post: SocialPost;
  active: boolean;
  onToggleLike: (post: SocialPost) => void;
  onProgress: (postId: number, currentTime: number, duration: number) => void;
}

function ReelFeedItem({
  post,
  active,
  onToggleLike,
  onProgress,
}: ReelFeedItemProps) {
  const lastTapRef = useRef(0);
  const [hasMediaError, setHasMediaError] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(true);

  useEffect(() => {
    setHasMediaError(false);
    setLoadingVideo(true);
  }, [post.id]);

  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 260) {
      onToggleLike(post);
    }
    lastTapRef.current = now;
  }, [onToggleLike, post]);

  const handleToggleLike = useCallback(() => {
    onToggleLike(post);
  }, [onToggleLike, post]);

  const handleShare = useCallback(() => {
    void Share.share({
      message: `${getUserDisplayName(post.user)} - ${post.caption || 'Travel reel'}`,
    });
  }, [post.caption, post.user]);

  const handleProgress = useCallback(
    (event: { currentTime?: number; seekableDuration?: number }) => {
      onProgress(post.id, event.currentTime || 0, event.seekableDuration || 0);
    },
    [onProgress, post.id]
  );

  const hashtags = Array.isArray(post?.hashtags) ? post.hashtags : [];
  const mediaUrl = getSafeMediaUrl(post.media_url);

  return (
    <Pressable style={styles.container} onPress={handleDoubleTap}>
      {!hasMediaError && mediaUrl ? (
        <Video
          source={{ uri: mediaUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          repeat
          paused={!active}
          playInBackground={false}
          playWhenInactive={false}
          progressUpdateInterval={500}
          onProgress={handleProgress}
          onLoadStart={() => setLoadingVideo(true)}
          onLoad={() => setLoadingVideo(false)}
          onError={(error) => {
            setLoadingVideo(false);
            setHasMediaError(true);
            errorLogger.logRenderError(error, 'ReelFeedItem.Video');
          }}
        />
      ) : (
        <View style={styles.mediaFallback} />
      )}

      <LinearGradient colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.72)']} style={styles.overlay}>
        {loadingVideo && !hasMediaError ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={COLORS.WHITE} />
          </View>
        ) : null}
        {hasMediaError ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="warning-outline" size={24} color={COLORS.WHITE} />
            <Text style={styles.errorText}>Video unavailable</Text>
          </View>
        ) : null}
        <View style={styles.sideRail}>
          <TouchableOpacity style={styles.sideAction} onPress={handleToggleLike}>
            <Ionicons
              name={post.liked_by_current_user ? 'heart' : 'heart-outline'}
              size={28}
              color={post.liked_by_current_user ? '#FF4D88' : COLORS.WHITE}
            />
            <Text style={styles.sideLabel}>{post.likes_count}</Text>
          </TouchableOpacity>
          <View style={styles.sideAction}>
            <Ionicons name="chatbubble-outline" size={28} color={COLORS.WHITE} />
            <Text style={styles.sideLabel}>{post.comments_count}</Text>
          </View>
          <TouchableOpacity style={styles.sideAction} onPress={handleShare}>
            <Ionicons name="paper-plane-outline" size={28} color={COLORS.WHITE} />
            <Text style={styles.sideLabel}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomBlock}>
          <Text style={styles.username}>{getUserDisplayName(post.user)}</Text>
          <Text style={styles.caption} numberOfLines={3}>
            {post.caption || 'Travel moments from the Aventaro community'}
          </Text>
          <Text style={styles.meta}>
            {post.location || 'On the road'} - {hashtags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export default memo(ReelFeedItem);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08050F',
    justifyContent: 'flex-end',
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingBottom: 34,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorOverlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 120,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  mediaFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#120C2A',
  },
  sideRail: {
    position: 'absolute',
    right: 16,
    bottom: 126,
    alignItems: 'center',
    gap: 18,
  },
  sideAction: {
    alignItems: 'center',
    gap: 6,
  },
  sideLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  bottomBlock: {
    paddingRight: 84,
    gap: 8,
  },
  username: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.WHITE,
  },
  meta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.82)',
  },
});
