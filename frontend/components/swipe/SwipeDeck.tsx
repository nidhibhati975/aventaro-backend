import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { COLORS } from '../../theme/colors';
import SwipeCard, { SwipeDirection } from './SwipeCard';
import type { AppUser } from '../../services/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SwipeDeckProps {
  users: AppUser[];
  onSwipeLeft: (user: AppUser) => void;
  onSwipeRight: (user: AppUser) => void;
  onSwipeUp: (user: AppUser) => void;
  onLoadMore?: () => void;
  isLoading?: boolean;
  hasMore?: boolean;
}

export default function SwipeDeck({
  users,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onLoadMore,
  isLoading = false,
  hasMore = true,
}: SwipeDeckProps) {
  const [cardStack, setCardStack] = useState<AppUser[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (users.length > 0) {
      setCardStack(users.slice(0, 3));
      setCurrentIndex(0);
    } else {
      setCardStack([]);
      setCurrentIndex(0);
    }
  }, [users]);

  const handleSwipe = useCallback(
    (direction: SwipeDirection) => {
      const currentUser = cardStack[0];
      if (!currentUser) {
        return;
      }

      const newStack = cardStack.slice(1);
      const nextIndex = currentIndex + 1;
      if (nextIndex < users.length && !newStack.includes(users[nextIndex])) {
        newStack.push(users[nextIndex]);
      }

      setCardStack(newStack);
      setCurrentIndex(nextIndex);

      if (direction === 'left') {
        onSwipeLeft(currentUser);
      } else if (direction === 'right') {
        onSwipeRight(currentUser);
      } else if (direction === 'up') {
        onSwipeUp(currentUser);
      }

      if (newStack.length < 2 && hasMore && onLoadMore) {
        onLoadMore();
      }
    },
    [cardStack, currentIndex, hasMore, onLoadMore, onSwipeLeft, onSwipeRight, onSwipeUp, users]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        <Text style={styles.loadingText}>Finding travelers...</Text>
      </View>
    );
  }

  if (cardStack.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="sparkles-outline" size={52} color={COLORS.PRIMARY_PURPLE} />
        <Text style={styles.emptyTitle}>No more profiles</Text>
        <Text style={styles.emptySubtitle}>Check back later for new travelers.</Text>
        {hasMore && onLoadMore ? (
          <TouchableOpacity style={styles.refreshButton} onPress={onLoadMore}>
            <Text style={styles.refreshText}>Refresh Suggestions</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cardContainer}>
        {cardStack
          .map((user, index) => (
            <SwipeCard key={`${user.id}-${index}`} user={user} onSwipe={handleSwipe} isFirst={index === 0} />
          ))
          .reverse()}
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={() => handleSwipe('left')}>
          <View style={[styles.buttonInner, styles.passButton]}>
            <Ionicons name="close" size={28} color={COLORS.ERROR_RED} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => handleSwipe('up')}>
          <View style={[styles.buttonInner, styles.superLikeButton]}>
            <Ionicons name="arrow-up" size={24} color={COLORS.ACCENT_CORAL} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => handleSwipe('right')}>
          <View style={[styles.buttonInner, styles.likeButton]}>
            <Ionicons name="heart" size={24} color={COLORS.SUCCESS_GREEN} />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.hintContainer}>
        <Text style={styles.hintText}>Swipe left to pass | Swipe right to like | Swipe up to inspect profile</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: SCREEN_WIDTH,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.TEXT_MUTED,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderRadius: 24,
  },
  refreshText: {
    color: COLORS.WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 20,
  },
  actionButton: {
    width: 64,
    height: 64,
  },
  buttonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  passButton: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 2,
    borderColor: COLORS.ERROR_RED,
  },
  likeButton: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 2,
    borderColor: COLORS.SUCCESS_GREEN,
  },
  superLikeButton: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 2,
    borderColor: COLORS.ACCENT_CORAL,
  },
  hintContainer: {
    paddingBottom: 16,
  },
  hintText: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
  },
});

