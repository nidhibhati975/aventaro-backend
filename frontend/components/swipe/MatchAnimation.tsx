import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions, Image } from 'react-native';
import { COLORS } from '../../theme/colors';
import type { AppUser } from '../../services/types';

const { width, height } = Dimensions.get('window');

interface MatchAnimationProps {
  currentUser: AppUser;
  matchedUser: AppUser;
  onSendMessage: () => void;
  onKeepSwiping: () => void;
  visible: boolean;
}

export default function MatchAnimation({
  currentUser,
  matchedUser,
  onSendMessage,
  onKeepSwiping,
  visible,
}: MatchAnimationProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const buttonScaleAnim = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      buttonScaleAnim.setValue(0);
      confettiAnim.setValue(0);

      // Sequence animation
      Animated.sequence([
        // Initial scale up
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        // Fade in text
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        // Button scale up
        Animated.spring(buttonScaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();

      // Confetti loop
      Animated.loop(
        Animated.timing(confettiAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();
    }
  }, [visible]);

  if (!visible) return null;

  const currentUserInitial = currentUser.profile?.name?.charAt(0).toUpperCase() || '?';
  const matchedUserInitial = matchedUser.profile?.name?.charAt(0).toUpperCase() || '?';

  return (
    <View style={styles.overlay}>
      {/* Confetti Background */}
      <View style={styles.confettiContainer}>
        {['🎉', '🎊', '✨', '💫', '🌟', '💖'].map((emoji, index) => (
          <Animated.View
            key={index}
            style={[
              styles.confetti,
              {
                left: `${15 + (index * 14)}%`,
                top: confettiAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['-10%', '110%'],
                }),
                transform: [
                  {
                    rotate: confettiAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', `${360 + index * 60}deg`],
                    }),
                  },
                ],
                opacity: confettiAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [1, 1, 0],
                }),
              },
            ]}
          >
            <Text style={styles.confettiEmoji}>{emoji}</Text>
          </Animated.View>
        ))}
      </View>

      {/* Main Content */}
      <Animated.View
        style={[
          styles.content,
          {
            transform: [{ scale: scaleAnim }],
            opacity: fadeAnim,
          },
        ]}
      >
        <Text style={styles.matchTitle}>It's a Match! 🎉</Text>
        <Text style={styles.matchSubtitle}>
          You and {matchedUser.profile?.name || 'this traveler'} want to travel together
        </Text>

        {/* Avatar Merge Animation */}
        <View style={styles.avatarsContainer}>
          <View style={styles.avatarWrapper}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{currentUserInitial}</Text>
            </View>
          </View>
          
          <View style={styles.heartContainer}>
            <Text style={styles.heartEmoji}>💚</Text>
          </View>
          
          <View style={styles.avatarWrapper}>
            <View style={[styles.avatar, styles.avatarMatched]}>
              <Text style={styles.avatarText}>{matchedUserInitial}</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
          <TouchableOpacity style={styles.sendMessageButton} onPress={onSendMessage}>
            <Text style={styles.sendMessageText}>Send Message</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.keepSwipingButton} onPress={onKeepSwiping}>
            <Text style={styles.keepSwipingText}>Keep Swiping</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  confettiContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  confetti: {
    position: 'absolute',
  },
  confettiEmoji: {
    fontSize: 24,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  matchTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textShadowColor: COLORS.ACCENT_CORAL,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  matchSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 32,
  },
  avatarsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
  },
  avatarWrapper: {
    transform: [{ scale: 0.85 }],
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  avatarMatched: {
    backgroundColor: COLORS.ACCENT_CORAL,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
  },
  heartContainer: {
    marginHorizontal: -10,
    zIndex: 1,
    transform: [{ scale: 1.2 }],
  },
  heartEmoji: {
    fontSize: 40,
  },
  sendMessageButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    marginBottom: 12,
    width: width - 80,
    alignItems: 'center',
  },
  sendMessageText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  keepSwipingButton: {
    paddingHorizontal: 48,
    paddingVertical: 12,
  },
  keepSwipingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '500',
  },
});