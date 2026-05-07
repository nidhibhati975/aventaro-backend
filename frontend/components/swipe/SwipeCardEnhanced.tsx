/**
 * Enhanced Swipe Card Component
 * 
 * Features:
 * - 60fps smooth gestures
 * - Card stacking with depth effect
 * - Swipe velocity detection
 * - Super-like animation
 * - Undo swipe feature
 * - Haptic feedback
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  TouchableOpacity,
  Vibration,
} from 'react-native';
import { COLORS } from '../../theme/colors';
import type { AppUser } from '../../services/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const SUPER_LIKE_THRESHOLD = SCREEN_HEIGHT * 0.25;
const VELOCITY_THRESHOLD = 500;

export type SwipeDirection = 'left' | 'right' | 'up' | 'none';

interface SwipeCardProps {
  user: AppUser;
  onSwipe: (direction: SwipeDirection, velocity: number) => void;
  isFirst: boolean;
  stackPosition?: number;
  showUndo?: boolean;
  onUndo?: () => void;
}

export default function SwipeCard({
  user,
  onSwipe,
  isFirst,
  stackPosition = 0,
  showUndo = false,
  onUndo,
}: SwipeCardProps) {
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [isSwiping, setIsSwiping] = useState(false);

  // Scale based on stack position (depth effect)
  const scale = 1 - stackPosition * 0.05;
  const translateY = stackPosition * 8;
  const opacity = 1 - stackPosition * 0.15;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isFirst,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return isFirst && (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5);
      },
      onPanResponderGrant: () => {
        setIsSwiping(true);
        position.extractOffset();
      },
      onPanResponderMove: (_, gestureState) => {
        position.setValue({ x: gestureState.dx, y: gestureState.dy });
      },
      onPanResponderRelease: (_, gestureState) => {
        setIsSwiping(false);
        position.flattenOffset();

        const { dx, dy } = gestureState;
        const velocity = Math.sqrt(dx * dx + dy * dy);

        // Determine direction based on swipe or velocity
        let direction: SwipeDirection = 'none';

        if (dy < -SUPER_LIKE_THRESHOLD || (dy < -100 && velocity > VELOCITY_THRESHOLD)) {
          direction = 'up';
        } else if (dx > SWIPE_THRESHOLD || (dx > 100 && velocity > VELOCITY_THRESHOLD)) {
          direction = 'right';
        } else if (dx < -SWIPE_THRESHOLD || (dx < -100 && velocity > VELOCITY_THRESHOLD)) {
          direction = 'left';
        }

        if (direction !== 'none') {
          animateOut(direction, velocity, () => onSwipe(direction, velocity));
        } else {
          // Return to center with spring animation
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
            friction: 6,
            tension: 40,
          }).start();
        }
      },
    })
  ).current;

  const animateOut = (
    direction: 'left' | 'right' | 'up', 
    velocity: number,
    callback: () => void
  ) => {
    const targetX = direction === 'right' ? SCREEN_WIDTH * 1.5 : direction === 'left' ? -SCREEN_WIDTH * 1.5 : 0;
    const targetY = direction === 'up' ? -SCREEN_HEIGHT : 0;
    
    // Use velocity to determine animation speed
    const duration = Math.max(200, Math.min(400, 60000 / velocity));

    // Haptic feedback
    if (direction === 'right') {
      Vibration.vibrate(20);
    } else if (direction === 'up') {
      Vibration.vibrate([0, 30, 50, 30]);
    }

    Animated.timing(position, {
      toValue: { x: targetX, y: targetY },
      duration,
      useNativeDriver: true,
    }).start(() => callback());
  };

  // Interpolations for animations
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-15deg', '0deg', '15deg'],
    extrapolate: 'clamp',
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const passOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const superLikeOpacity = position.y.interpolate({
    inputRange: [-SUPER_LIKE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const { profile } = user;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          transform: [
            { translateX: position.x },
            { translateY: position.y },
            { rotate },
            { scale },
            { translateY: -translateY },
          ],
          opacity,
          zIndex: 100 - stackPosition,
        },
      ]}
      {...(isFirst ? panResponder.panHandlers : {})}
    >
      {/* Profile Image */}
      <View style={styles.imageContainer}>
        {profile?.name ? (
          <View style={styles.placeholderImage}>
            <Text style={styles.placeholderText}>
              {profile.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        ) : (
          <View style={styles.placeholderImage}>
            <Text style={styles.placeholderText}>👤</Text>
          </View>
        )}
      </View>

      {/* User Info */}
      <View style={styles.infoContainer}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>
            {profile?.name || 'Traveler'}
            {profile?.age && `, ${profile.age}`}
          </Text>
        </View>
        {profile?.location && (
          <Text style={styles.location}>📍 {profile.location}</Text>
        )}
        {profile?.travel_style && (
          <Text style={styles.travelStyle}>
            {getTravelStyleEmoji(profile.travel_style)} {profile.travel_style}
          </Text>
        )}
        {profile?.bio && (
          <Text style={styles.bio} numberOfLines={2}>
            {profile.bio}
          </Text>
        )}
        {profile?.interests && profile.interests.length > 0 && (
          <View style={styles.interestsContainer}>
            {profile.interests.slice(0, 3).map((interest, index) => (
              <View key={index} style={styles.interestTag}>
                <Text style={styles.interestText}>{interest}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Swipe Indicators */}
      {isFirst && (
        <>
          <Animated.View style={[styles.indicator, styles.likeIndicator, { opacity: likeOpacity }]}>
            <Text style={styles.indicatorText}>LIKE</Text>
          </Animated.View>
          <Animated.View style={[styles.indicator, styles.passIndicator, { opacity: passOpacity }]}>
            <Text style={styles.indicatorText}>PASS</Text>
          </Animated.View>
          <Animated.View style={[styles.superLikeIndicator, { opacity: superLikeOpacity }]}>
            <Text style={styles.superLikeText}>SUPER ★</Text>
          </Animated.View>
        </>
      )}

      {/* Undo Button */}
      {showUndo && isFirst && (
        <TouchableOpacity style={styles.undoButton} onPress={onUndo}>
          <Text style={styles.undoText}>↩ Undo</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

function getTravelStyleEmoji(style: string): string {
  const styleMap: Record<string, string> = {
    adventure: '🧗',
    luxury: '💎',
    budget: '🎒',
    cultural: '🏛️',
    relaxation: '🏖️',
    foodie: '🍽️',
  };
  return styleMap[style] || '✈️';
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: SCREEN_WIDTH - 32,
    height: SCREEN_HEIGHT * 0.6,
    backgroundColor: COLORS.SURFACE,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  imageContainer: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  placeholderImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
  },
  placeholderText: {
    fontSize: 100,
    color: COLORS.PRIMARY_PURPLE,
  },
  infoContainer: {
    padding: 20,
    backgroundColor: COLORS.SURFACE,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  location: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginBottom: 4,
  },
  travelStyle: {
    fontSize: 14,
    color: COLORS.PRIMARY_PURPLE,
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: 20,
    marginBottom: 12,
  },
  interestsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestTag: {
    backgroundColor: COLORS.PRIMARY_PURPLE + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  interestText: {
    fontSize: 12,
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '500',
  },
  indicator: {
    position: 'absolute',
    top: 50,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 4,
    zIndex: 10,
  },
  likeIndicator: {
    right: 20,
    borderColor: COLORS.SUCCESS_GREEN,
    transform: [{ rotate: '20deg' }],
    backgroundColor: COLORS.SUCCESS_GREEN + '20',
  },
  passIndicator: {
    left: 20,
    borderColor: COLORS.ERROR_RED,
    transform: [{ rotate: '-20deg' }],
    backgroundColor: COLORS.ERROR_RED + '20',
  },
  indicatorText: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.TEXT_PRIMARY,
  },
  superLikeIndicator: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    backgroundColor: COLORS.ACCENT_CORAL + '30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: COLORS.ACCENT_CORAL,
  },
  superLikeText: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.ACCENT_CORAL,
  },
  undoButton: {
    position: 'absolute',
    top: 120,
    left: 20,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    zIndex: 20,
  },
  undoText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
  },
});
