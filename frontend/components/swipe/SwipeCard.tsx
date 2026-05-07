import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  TouchableOpacity,
  Image,
} from 'react-native';
import { COLORS } from '../../theme/colors';
import type { AppUser } from '../../services/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const SUPER_LIKE_THRESHOLD = SCREEN_HEIGHT * 0.3;

export type SwipeDirection = 'left' | 'right' | 'up' | 'none';

interface SwipeCardProps {
  user: AppUser;
  onSwipe: (direction: SwipeDirection) => void;
  onSwipeStart?: () => void;
  isFirst?: boolean;
}

export default function SwipeCard({ user, onSwipe, onSwipeStart, isFirst = true }: SwipeCardProps) {
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [isSwiping, setIsSwiping] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        setIsSwiping(true);
        onSwipeStart?.();
        position.extractOffset();
      },
      onPanResponderMove: (_, gestureState) => {
        position.setValue({ x: gestureState.dx, y: gestureState.dy });
      },
      onPanResponderRelease: (_, gestureState) => {
        setIsSwiping(false);
        position.flattenOffset();

        const { dx, dy } = gestureState;

        // Determine swipe direction
        if (dy < -SUPER_LIKE_THRESHOLD) {
          // Super like (swipe up)
          animateOut('up', () => onSwipe('up'));
        } else if (dx > SWIPE_THRESHOLD) {
          // Like (swipe right)
          animateOut('right', () => onSwipe('right'));
        } else if (dx < -SWIPE_THRESHOLD) {
          // Pass (swipe left)
          animateOut('left', () => onSwipe('left'));
        } else {
          // Return to center
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const animateOut = (direction: 'left' | 'right' | 'up', callback: () => void) => {
    const targetX = direction === 'right' ? SCREEN_WIDTH * 1.5 : direction === 'left' ? -SCREEN_WIDTH * 1.5 : 0;
    const targetY = direction === 'up' ? -SCREEN_HEIGHT : 0;

    Animated.timing(position, {
      toValue: { x: targetX, y: targetY },
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      callback();
    });
  };

  // Rotation interpolation
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });

  // Opacity for like/pass indicators
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
          ],
        },
      ]}
      {...panResponder.panHandlers}
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
          <Animated.View style={[styles.indicator, styles.superLikeIndicator, { opacity: superLikeOpacity }]}>
            <Text style={styles.indicatorText}>SUPER</Text>
          </Animated.View>
        </>
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
    height: SCREEN_HEIGHT * 0.65,
    backgroundColor: COLORS.SURFACE,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
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
    fontSize: 80,
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
    fontSize: 24,
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
    top: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 3,
    zIndex: 10,
  },
  likeIndicator: {
    right: 20,
    borderColor: COLORS.SUCCESS_GREEN,
    transform: [{ rotate: '15deg' }],
  },
  passIndicator: {
    left: 20,
    borderColor: COLORS.ERROR_RED,
    transform: [{ rotate: '-15deg' }],
  },
  superLikeIndicator: {
    top: 60,
    alignSelf: 'center',
    borderColor: COLORS.ACCENT_CORAL,
  },
  indicatorText: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
});
