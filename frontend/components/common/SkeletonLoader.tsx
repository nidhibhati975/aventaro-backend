/**
 * Skeleton Loader Components
 * 
 * Provides shimmer loading states for:
 * - Discovery feed cards
 * - Chat messages
 * - Trip cards
 * - Profile sections
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { COLORS } from '../../theme/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 32;

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export function Skeleton({ 
  width = '100%', 
  height = 20, 
  borderRadius = 8,
  style 
}: SkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.7, 0.3],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius, opacity },
        style,
      ]}
    />
  );
}

// Discovery Card Skeleton
export function DiscoveryCardSkeleton() {
  return (
    <View style={styles.cardSkeleton}>
      <Skeleton height={SCREEN_HEIGHT * 0.45} borderRadius={20} />
      <View style={styles.cardContent}>
        <Skeleton width="60%" height={24} />
        <Skeleton width="40%" height={16} style={{ marginTop: 8 }} />
        <View style={styles.tagsRow}>
          <Skeleton width={80} height={24} borderRadius={12} />
          <Skeleton width={80} height={24} borderRadius={12} />
          <Skeleton width={80} height={24} borderRadius={12} />
        </View>
      </View>
    </View>
  );
}

// Trip Card Skeleton
export function TripCardSkeleton() {
  return (
    <View style={styles.tripCardSkeleton}>
      <Skeleton height={180} borderRadius={16} />
      <View style={styles.tripContent}>
        <Skeleton width="70%" height={20} />
        <Skeleton width="50%" height={14} style={{ marginTop: 6 }} />
        <View style={styles.tripMeta}>
          <Skeleton width={60} height={20} borderRadius={10} />
          <Skeleton width={80} height={20} borderRadius={10} />
        </View>
      </View>
    </View>
  );
}

// Chat Message Skeleton
export function MessageSkeleton({ isOwn = false }: { isOwn?: boolean }) {
  return (
    <View style={[styles.messageSkeleton, isOwn && styles.messageOwn]}>
      <Skeleton 
        width={Math.random() * 100 + 100} 
        height={40} 
        borderRadius={16}
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start' }}
      />
    </View>
  );
}

// Conversation List Skeleton
export function ConversationSkeleton() {
  return (
    <View style={styles.conversationSkeleton}>
      <Skeleton width={50} height={50} borderRadius={25} />
      <View style={styles.conversationContent}>
        <Skeleton width="50%" height={18} />
        <Skeleton width="80%" height={14} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

// Profile Section Skeleton
export function ProfileSectionSkeleton() {
  return (
    <View style={styles.profileSection}>
      <Skeleton width={120} height={120} borderRadius={60} />
      <Skeleton width="40%" height={24} style={{ marginTop: 16 }} />
      <Skeleton width="60%" height={16} style={{ marginTop: 8 }} />
      <View style={styles.statsRow}>
        <Skeleton width={60} height={30} borderRadius={8} />
        <Skeleton width={60} height={30} borderRadius={8} />
        <Skeleton width={60} height={30} borderRadius={8} />
      </View>
    </View>
  );
}

// Feed Skeleton (multiple cards)
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.feedSkeleton}>
      {Array.from({ length: count }, (_, i) => (
        <DiscoveryCardSkeleton key={i} />
      ))}
    </View>
  );
}

// List Skeleton
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.listSkeleton}>
      {Array.from({ length: count }, (_, i) => (
        <ConversationSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: COLORS.BORDER,
  },
  cardSkeleton: {
    width: CARD_WIDTH,
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: COLORS.SURFACE,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  tripCardSkeleton: {
    width: CARD_WIDTH,
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    overflow: 'hidden',
  },
  tripContent: {
    padding: 16,
  },
  tripMeta: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  messageSkeleton: {
    padding: 8,
    alignItems: 'flex-start',
  },
  messageOwn: {
    alignItems: 'flex-end',
  },
  conversationSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  conversationContent: {
    flex: 1,
    marginLeft: 12,
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 16,
  },
  feedSkeleton: {
    flex: 1,
    paddingTop: 8,
  },
  listSkeleton: {
    flex: 1,
  },
});

export default {
  Skeleton,
  DiscoveryCardSkeleton,
  TripCardSkeleton,
  MessageSkeleton,
  ConversationSkeleton,
  ProfileSectionSkeleton,
  FeedSkeleton,
  ListSkeleton,
};
