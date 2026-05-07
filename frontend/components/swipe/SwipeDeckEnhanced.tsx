/**
 * Enhanced Swipe Deck
 * 
 * Features:
 * - Card stack with depth effect
 * - Undo functionality
 * - Infinite loading
 * - Match animation trigger
 * - Session tracking
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { COLORS } from '../../theme/colors';
import SwipeCardEnhanced, { SwipeDirection } from './SwipeCardEnhanced';
import MatchAnimation from './MatchAnimation';
import type { AppUser } from '../../services/types';
import { getSwipeEngine } from '../../services/behavioral';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STACK_SIZE = 3;

interface SwipeDeckEnhancedProps {
  users: AppUser[];
  onSwipeLeft: (user: AppUser) => void;
  onSwipeRight: (user: AppUser) => void;
  onSwipeUp: (user: AppUser) => void;
  onLoadMore?: () => void;
  onMatch?: (user: AppUser) => void;
  isLoading?: boolean;
  hasMore?: boolean;
}

export default function SwipeDeckEnhanced({
  users,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onLoadMore,
  onMatch,
  isLoading = false,
  hasMore = true,
}: SwipeDeckEnhancedProps) {
  const [cardStack, setCardStack] = useState<AppUser[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showMatchAnimation, setShowMatchAnimation] = useState(false);
  const [matchedUser, setMatchedUser] = useState<AppUser | null>(null);
  const [undoStack, setUndoStack] = useState<AppUser[]>([]);
  const [showUndo, setShowUndo] = useState(false);

  const swipeEngine = useRef(getSwipeEngine());
  const streakAnim = useRef(new Animated.Value(1)).current;

  // Initialize card stack
  useEffect(() => {
    if (users.length > 0) {
      const initialStack = users.slice(0, STACK_SIZE);
      setCardStack(initialStack);
      setCurrentIndex(0);
      setUndoStack([]);
      setShowUndo(false);
    }
  }, [users]);

  // Streak animation
  useEffect(() => {
    const insights = swipeEngine.current.getBehavioralInsights();
    if (insights.isOnFire) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(streakAnim, {
            toValue: 1.1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(streakAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, []);

  const handleSwipe = useCallback((direction: SwipeDirection, velocity: number) => {
    if (direction === 'none') return;
    const currentUser = cardStack[0];
    if (!currentUser) return;

    // Process through behavior engine
    const result = swipeEngine.current.processSwipe(direction, currentUser, 0.4);

    // Add to undo stack
    setUndoStack(prev => [...prev, currentUser]);
    setShowUndo(true);

    // Remove current card
    const newStack = cardStack.slice(1);
    
    // Add next card from users array
    const nextIndex = currentIndex + 1;
    if (nextIndex < users.length) {
      const nextUser = users[nextIndex + STACK_SIZE - 1];
      if (nextUser && !newStack.includes(nextUser)) {
        newStack.push(nextUser);
      }
    }

    setCardStack(newStack);
    setCurrentIndex(nextIndex);

    // Handle match
    if (result.isMatch) {
      setMatchedUser(currentUser);
      setShowMatchAnimation(true);
      onMatch?.(currentUser);
    }

    // Trigger callbacks
    switch (direction) {
      case 'left':
        onSwipeLeft(currentUser);
        break;
      case 'right':
        onSwipeRight(currentUser);
        break;
      case 'up':
        onSwipeUp(currentUser);
        break;
    }

    // Load more when running low
    if (newStack.length < 2 && hasMore && onLoadMore) {
      onLoadMore();
    }
  }, [cardStack, currentIndex, users, hasMore, onSwipeLeft, onSwipeRight, onSwipeUp, onMatch, onLoadMore]);

  // Undo last swipe
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;

    const lastUser = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    
    setUndoStack(newUndoStack);
    setShowUndo(newUndoStack.length > 0);

    // Add back to stack at front
    setCardStack(prev => [lastUser, ...prev.slice(0, STACK_SIZE - 1)]);
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, [undoStack]);

  // Action button handlers
  const handlePass = () => handleSwipe('left', 500);
  const handleLike = () => handleSwipe('right', 500);
  const handleSuperLike = () => handleSwipe('up', 500);

  // Close match animation
  const handleCloseMatch = () => {
    setShowMatchAnimation(false);
    setMatchedUser(null);
  };

  // Go to chat after match
  const handleSendMessage = () => {
    setShowMatchAnimation(false);
    // Navigate to chat - would be handled by parent component
  };

  // Get session stats for UI
  const stats = swipeEngine.current.getSessionStats();
  const insights = swipeEngine.current.getBehavioralInsights();

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
        <Text style={styles.emptyIcon}>🔍</Text>
        <Text style={styles.emptyTitle}>No more profiles</Text>
        <Text style={styles.emptySubtitle}>
          You've seen everyone! Check back later
        </Text>
        {hasMore && onLoadMore && (
          <TouchableOpacity style={styles.refreshButton} onPress={onLoadMore}>
            <Text style={styles.refreshText}>Load More</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Streak indicator */}
      {insights.shouldShowStreakBonus && (
        <Animated.View style={[styles.streakBanner, { transform: [{ scale: streakAnim }] }]}>
          <Text style={styles.streakText}>{insights.streakMessage}</Text>
        </Animated.View>
      )}

      {/* Card Stack */}
      <View style={styles.cardContainer}>
        {cardStack.map((user, index) => (
          <SwipeCardEnhanced
            key={`${user.id}-${index}`}
            user={user}
            onSwipe={handleSwipe}
            isFirst={index === 0}
            stackPosition={index}
            showUndo={showUndo && index === 0}
            onUndo={handleUndo}
          />
        )).reverse()}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity 
          style={[styles.actionButton, !showUndo && styles.actionButtonDisabled]} 
          onPress={handleUndo}
          disabled={!showUndo}
        >
          <View style={[styles.buttonInner, styles.undoButton]}>
            <Text style={styles.buttonIcon}>↩</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handlePass}>
          <View style={[styles.buttonInner, styles.passButton]}>
            <Text style={styles.buttonIcon}>✕</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleSuperLike}>
          <View style={[styles.buttonInner, styles.superLikeButton]}>
            <Text style={styles.buttonIcon}>★</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
          <View style={[styles.buttonInner, styles.likeButton]}>
            <Text style={styles.buttonIcon}>♥</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <Text style={styles.statsText}>
          {stats.totalSwipes} swipes • {Math.round(stats.matchRate * 100)}% match rate
        </Text>
      </View>

      {/* Match Animation */}
      {showMatchAnimation && matchedUser && (
        <MatchAnimation
          currentUser={{ id: 0, email: '' }} // Would come from auth
          matchedUser={matchedUser}
          onSendMessage={handleSendMessage}
          onKeepSwiping={handleCloseMatch}
          visible={showMatchAnimation}
        />
      )}
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
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderRadius: 24,
  },
  refreshText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  streakBanner: {
    backgroundColor: COLORS.WARNING_YELLOW + '20',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 8,
  },
  streakText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.WARNING_YELLOW,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  actionButton: {
    width: 56,
    height: 56,
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  buttonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  undoButton: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 2,
    borderColor: COLORS.WARNING_YELLOW,
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
  buttonIcon: {
    fontSize: 24,
    fontWeight: '600',
  },
  statsContainer: {
    paddingBottom: 16,
  },
  statsText: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
});
