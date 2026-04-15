import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  ImageBackground,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { getSafeImageSource } from '../../services/media';
import { getUserDisplayName, type AppUser } from '../../services/types';
import { COLORS } from '../../theme/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.24;

export interface SwipePersonCard extends AppUser {
  heroMediaUrl?: string | null;
  compatibilityScore?: number | null;
}

interface PeopleSwipeDeckProps {
  items: SwipePersonCard[];
  pendingId?: number | null;
  onSkip: (user: SwipePersonCard) => void;
  onLike: (user: SwipePersonCard) => void;
  onViewProfile: (user: SwipePersonCard) => void;
}

function PeopleSwipeDeck({
  items,
  pendingId,
  onSkip,
  onLike,
  onViewProfile,
}: PeopleSwipeDeckProps) {
  const position = useRef(new Animated.ValueXY()).current;
  const current = items[0];
  const next = items[1];

  useEffect(() => {
    position.setValue({ x: 0, y: 0 });
  }, [current?.id, position]);

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const skipOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const nextCardScale = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [0.98, 0.94, 0.98],
    extrapolate: 'clamp',
  });

  const animateOut = useCallback(
    (
      direction: 'left' | 'right',
      user: SwipePersonCard,
      handler: (nextUser: SwipePersonCard) => void
    ) => {
      Animated.timing(position, {
        toValue: { x: direction === 'right' ? SCREEN_WIDTH + 80 : -SCREEN_WIDTH - 80, y: 0 },
        duration: 220,
        useNativeDriver: false,
      }).start(() => {
        position.setValue({ x: 0, y: 0 });
        handler(user);
      });
    },
    [position]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(current) && !pendingId,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Boolean(current) && !pendingId && Math.abs(gestureState.dx) > 8,
        onPanResponderMove: (_, gestureState) => {
          position.setValue({ x: gestureState.dx, y: gestureState.dy * 0.25 });
        },
        onPanResponderRelease: (_, gestureState) => {
          if (!current) {
            return;
          }

          if (gestureState.dx > SWIPE_THRESHOLD) {
            animateOut('right', current, onLike);
            return;
          }

          if (gestureState.dx < -SWIPE_THRESHOLD) {
            animateOut('left', current, onSkip);
            return;
          }

          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            friction: 6,
          }).start();
        },
      }),
    [current, onLike, onSkip, pendingId, position]
  );

  if (!current) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>You're caught up</Text>
        <Text style={styles.emptyText}>New travelers will land here as soon as they match your vibe.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {next ? (
        <Animated.View style={[styles.card, styles.nextCard, { transform: [{ scale: nextCardScale }] }]}>
          {(() => {
            const nextSource = getSafeImageSource(next.heroMediaUrl);
            const content = (
              <LinearGradient colors={['rgba(20,14,44,0.05)', 'rgba(20,14,44,0.78)']} style={styles.cardOverlay} />
            );

            return nextSource ? (
              <ImageBackground
                source={nextSource}
                style={styles.card}
                imageStyle={styles.cardImage}
              >
                {content}
              </ImageBackground>
            ) : (
              <View style={styles.card}>
                {content}
              </View>
            );
          })()}
        </Animated.View>
      ) : null}

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.card,
          {
            transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }],
          },
        ]}
      >
        {(() => {
          const currentSource = getSafeImageSource(current.heroMediaUrl);
          const content = (
            <LinearGradient colors={['rgba(20,14,44,0.04)', 'rgba(20,14,44,0.84)']} style={styles.cardOverlay}>
              <Animated.View style={[styles.swipeBadge, styles.swipeBadgeLike, { opacity: likeOpacity }]}>
                <Text style={styles.swipeBadgeText}>MATCH</Text>
              </Animated.View>
              <Animated.View style={[styles.swipeBadge, styles.swipeBadgeSkip, { opacity: skipOpacity }]}>
                <Text style={styles.swipeBadgeText}>SKIP</Text>
              </Animated.View>

              <View style={styles.cardFooter}>
                <View style={styles.metaRow}>
                  <Text style={styles.name}>
                    {getUserDisplayName(current)}
                    {typeof current.profile?.age === 'number' ? `, ${current.profile.age}` : ''}
                  </Text>
                  <View style={styles.compatibilityPill}>
                    <Ionicons name="sparkles" size={12} color={COLORS.GOLD_DEEP} />
                    <Text style={styles.compatibilityText}>
                      {typeof current.compatibilityScore === 'number' ? `${current.compatibilityScore}%` : 'Match'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.location}>{current.profile?.location || 'Traveler on the move'}</Text>
                <Text style={styles.bio} numberOfLines={3}>
                  {current.profile?.bio || 'Open to meaningful trips, shared budgets, and memorable routes.'}
                </Text>
                <View style={styles.interests}>
                  {(current.profile?.interests || []).slice(0, 4).map((interest) => (
                    <View key={interest} style={styles.interestChip}>
                      <Text style={styles.interestText}>{interest}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </LinearGradient>
          );

          return currentSource ? (
            <ImageBackground
              source={currentSource}
              style={styles.card}
              imageStyle={styles.cardImage}
            >
              {content}
            </ImageBackground>
          ) : (
            <View style={styles.card}>
              {content}
            </View>
          );
        })()}
      </Animated.View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.iconAction} onPress={() => animateOut('left', current, onSkip)}>
          <Ionicons name="close" size={28} color={COLORS.DANGER} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.centerAction} onPress={() => onViewProfile(current)}>
          <Ionicons name="person-outline" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconAction, styles.iconActionPrimary]}
          disabled={pendingId === current.id}
          onPress={() => animateOut('right', current, onLike)}
        >
          <Ionicons name="heart" size={24} color={COLORS.WHITE} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default memo(PeopleSwipeDeck);

const styles = StyleSheet.create({
  wrap: {
    minHeight: 510,
    gap: 18,
  },
  card: {
    height: 510,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  cardImage: {
    borderRadius: 28,
  },
  nextCard: {
    position: 'absolute',
    top: 16,
    left: 14,
    right: 14,
    zIndex: 0,
    opacity: 0.72,
  },
  cardOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 22,
  },
  swipeBadge: {
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    transform: [{ rotate: '-10deg' }],
  },
  swipeBadgeLike: {
    borderColor: '#44E6A5',
  },
  swipeBadgeSkip: {
    borderColor: COLORS.DANGER,
  },
  swipeBadgeText: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.WHITE,
    letterSpacing: 1.2,
  },
  cardFooter: {
    gap: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.WHITE,
  },
  compatibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.GOLD_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  compatibilityText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.GOLD_DEEP,
  },
  location: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.84)',
  },
  bio: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.WHITE,
  },
  interests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  interestText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  iconAction: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.SHADOW,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  centerAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.GOLD_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionPrimary: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  emptyCard: {
    minHeight: 340,
    borderRadius: 28,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
});
