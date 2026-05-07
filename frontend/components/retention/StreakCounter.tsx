import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../../theme/colors';

interface StreakCounterProps {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  showDetails?: boolean;
}

const MILESTONES = [
  { days: 7, reward: 'Profile Boost' },
  { days: 14, reward: 'Free Premium Week' },
  { days: 30, reward: 'Exclusive Badge' },
  { days: 60, reward: 'Travel Discount' },
  { days: 100, reward: 'Lifetime Premium' },
];

export default function StreakCounter({
  currentStreak,
  longestStreak,
  lastActiveDate,
  showDetails = true,
}: StreakCounterProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fireAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse animation for active streak
    if (currentStreak > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Fire shake animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(fireAnim, {
            toValue: 1.05,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(fireAnim, {
            toValue: 0.95,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(fireAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [currentStreak]);

  const getNextMilestone = () => {
    return MILESTONES.find((m) => m.days > currentStreak);
  };

  const nextMilestone = getNextMilestone();
  const progressToNext = nextMilestone
    ? ((currentStreak % nextMilestone.days) / nextMilestone.days) * 100
    : 100;

  const isStreakActive = () => {
    const today = new Date().toISOString().split('T')[0];
    return lastActiveDate === today;
  };

  return (
    <View style={styles.container}>
      {/* Main Streak Display */}
      <View style={styles.streakRow}>
        <Animated.View
          style={[
            styles.fireContainer,
            { transform: [{ scale: fireAnim }] },
          ]}
        >
          <Text style={styles.fireEmoji}>
            {currentStreak > 0 ? '🔥' : '💤'}
          </Text>
        </Animated.View>

        <View style={styles.streakInfo}>
          <Animated.Text
            style={[
              styles.streakNumber,
              { transform: [{ scale: pulseAnim }] },
            ]}
          >
            {currentStreak}
          </Animated.Text>
          <Text style={styles.streakLabel}>day streak</Text>
        </View>

        {currentStreak > 0 && !isStreakActive() && (
          <View style={styles.warningBadge}>
            <Text style={styles.warningText}>Log in today!</Text>
          </View>
        )}
      </View>

      {showDetails && (
        <>
          {/* Progress to Next Milestone */}
          {nextMilestone && (
            <View style={styles.milestoneContainer}>
              <View style={styles.milestoneHeader}>
                <Text style={styles.milestoneLabel}>
                  Next: {nextMilestone.reward}
                </Text>
                <Text style={styles.milestoneDays}>
                  {nextMilestone.days - currentStreak} days left
                </Text>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progressToNext}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Milestones Reached */}
          <View style={styles.milestonesRow}>
            {MILESTONES.map((milestone) => (
              <View
                key={milestone.days}
                style={[
                  styles.milestoneDot,
                  currentStreak >= milestone.days && styles.milestoneReached,
                ]}
              >
                <Text style={styles.milestoneDotText}>{milestone.days}</Text>
              </View>
            ))}
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{longestStreak}</Text>
              <Text style={styles.statLabel}>Best Streak</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fireContainer: {
    marginRight: 12,
  },
  fireEmoji: {
    fontSize: 40,
  },
  streakInfo: {
    flex: 1,
  },
  streakNumber: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.WARNING_YELLOW,
  },
  streakLabel: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  warningBadge: {
    backgroundColor: COLORS.WARNING_YELLOW + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  warningText: {
    fontSize: 12,
    color: COLORS.WARNING_YELLOW,
    fontWeight: '600',
  },
  milestoneContainer: {
    marginTop: 16,
  },
  milestoneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  milestoneLabel: {
    fontSize: 14,
    color: COLORS.TEXT_PRIMARY,
    fontWeight: '500',
  },
  milestoneDays: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.BORDER,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.WARNING_YELLOW,
    borderRadius: 3,
  },
  milestonesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  milestoneDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  milestoneReached: {
    backgroundColor: COLORS.WARNING_YELLOW,
  },
  milestoneDotText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.TEXT_MUTED,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
});