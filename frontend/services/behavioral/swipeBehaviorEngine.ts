/**
 * Swipe Behavior Engine
 * 
 * Behavioral Design: Optimize for engagement through smart swipe mechanics
 * 
 * Key Features:
 * 1. Match Probability Control - Adjusts showing "almost matches" to increase swipes
 * 2. Near-Match Illusion - Shows users who are "almost" a match to encourage more swiping
 * 3. Swipe Streak Multiplier - Rewards consecutive swipes with better matches
 * 4. Variable Reward Schedule - Unpredictable match timing increases engagement
 */

import { Animated, Vibration } from 'react-native';
import type { AppUser } from '../types';

export interface SwipeConfig {
  nearMatchThreshold: number;    // 0-1: How close to a match before showing (0.7 = 70%)
  nearMatchFrequency: number;    // 0-1: How often to show near-matches (0.3 = 30%)
  streakMultiplierStart: number; // Swipes needed to activate multiplier
  maxStreakMultiplier: number;   // Maximum streak bonus
  showMatchProbability: boolean; // Debug: show match % on cards
}

const DEFAULT_CONFIG: SwipeConfig = {
  nearMatchThreshold: 0.65,
  nearMatchFrequency: 0.25,
  streakMultiplierStart: 10,
  maxStreakMultiplier: 2.5,
  showMatchProbability: false,
};

export interface SwipeResult {
  direction: 'left' | 'right' | 'up';
  user: AppUser;
  isMatch: boolean;
  isNearMatch: boolean;
  matchProbability: number;
  streakCount: number;
  shouldVibrate: boolean;
  shouldShowAnimation: boolean;
}

export interface SwipeSession {
  totalSwipes: number;
  matches: number;
  nearMisses: number;
  currentStreak: number;
  bestStreak: number;
  startTime: number;
}

export class SwipeBehaviorEngine {
  private config: SwipeConfig;
  private session: SwipeSession;
  private lastSwipeTime: number = 0;
  private swipeHistory: SwipeResult[] = [];
  
  // Animation refs
  private hapticEnabled: boolean = true;

  constructor(config: Partial<SwipeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.session = this.initSession();
  }

  private initSession(): SwipeSession {
    return {
      totalSwipes: 0,
      matches: 0,
      nearMisses: 0,
      currentStreak: 0,
      bestStreak: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Process a swipe and determine outcomes
   * This is where the behavioral magic happens
   */
  processSwipe(
    direction: 'left' | 'right' | 'up',
    user: AppUser,
    baseMatchProbability: number
  ): SwipeResult {
    const now = Date.now();
    const timeSinceLastSwipe = now - this.lastSwipeTime;
    this.lastSwipeTime = now;

    // Update session stats
    this.session.totalSwipes++;

    // Calculate streak
    if (timeSinceLastSwipe < 3000) {
      // Fast swiping = streak continues
      this.session.currentStreak++;
    } else {
      // Too slow, reset streak
      this.session.currentStreak = 1;
    }

    // Update best streak
    if (this.session.currentStreak > this.session.bestStreak) {
      this.session.bestStreak = this.session.currentStreak;
    }

    // Calculate streak multiplier
    const streakMultiplier = this.calculateStreakMultiplier();

    // Adjust match probability based on behavioral factors
    const adjustedProbability = this.adjustMatchProbability(
      baseMatchProbability,
      streakMultiplier,
      direction
    );

    // Determine if it's a match (with variable reward)
    const isMatch = this.determineMatch(adjustedProbability);
    
    // Determine if it's a "near match" (for engagement)
    const isNearMatch = !isMatch && 
      adjustedProbability >= this.config.nearMatchThreshold &&
      Math.random() < this.config.nearMatchFrequency;

    if (isMatch) {
      this.session.matches++;
      Vibration.vibrate(50); // Haptic feedback
    } else if (isNearMatch) {
      this.session.nearMisses++;
      // Light haptic for near-miss
      if (this.hapticEnabled) {
        Vibration.vibrate(20);
      }
    }

    // Create result
    const result: SwipeResult = {
      direction,
      user,
      isMatch,
      isNearMatch,
      matchProbability: Math.round(adjustedProbability * 100),
      streakCount: this.session.currentStreak,
      shouldVibrate: isMatch || isNearMatch,
      shouldShowAnimation: isMatch,
    };

    this.swipeHistory.push(result);
    return result;
  }

  /**
   * Calculate streak multiplier for better matches
   * More swipes in sequence = higher chance of match
   */
  private calculateStreakMultiplier(): number {
    const { currentStreak } = this.session;
    const { streakMultiplierStart, maxStreakMultiplier } = this.config;

    if (currentStreak < streakMultiplierStart) {
      return 1;
    }

    // Exponential growth: 1.0 at 10, 1.5 at 20, 2.0 at 30, 2.5 at 40+
    const excessStreak = currentStreak - streakMultiplierStart;
    const multiplier = 1 + (excessStreak / 20) * (maxStreakMultiplier - 1);
    
    return Math.min(maxStreakMultiplier, multiplier);
  }

  /**
   * Adjust base match probability based on behavioral factors
   */
  private adjustMatchProbability(
    baseProbability: number,
    streakMultiplier: number,
    direction: 'left' | 'right' | 'up'
  ): number {
    let adjusted = baseProbability;

    // Super-likes get priority (3x probability boost)
    if (direction === 'up') {
      adjusted = Math.min(1, adjusted * 3);
    }

    // Apply streak multiplier
    adjusted *= streakMultiplier;

    // Variable reward: Random boost to keep it unpredictable
    // This creates the "might be a match" tension
    if (Math.random() < 0.15) {
      adjusted += 0.1;
    }

    // Near-match injection: Artificially boost some users
    if (Math.random() < this.config.nearMatchFrequency) {
      adjusted = this.config.nearMatchThreshold + (Math.random() * 0.1);
    }

    return Math.min(1, Math.max(0, adjusted));
  }

  /**
   * Determine if swipe results in a match
   * Uses variable reward schedule for addiction
   */
  private determineMatch(probability: number): boolean {
    // Variable ratio schedule: average matches but unpredictable timing
    // This is the key to addictive behavior
    const random = Math.random();
    return random < probability;
  }

  /**
   * Get the next card's "match probability" for display
   * This creates anticipation
   */
  getNextCardProbability(): number {
    // Show a probability that makes user want to swipe
    // High enough to be exciting, low enough to not always match
    const base = 0.3 + Math.random() * 0.4; // 30-70%
    
    // Boost based on streak
    const streakBoost = Math.min(0.2, this.session.currentStreak * 0.02);
    
    return Math.min(0.9, base + streakBoost);
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSwipes: number;
    matchRate: number;
    nearMissRate: number;
    currentStreak: number;
    bestStreak: number;
    sessionDuration: number;
  } {
    const { totalSwipes, matches, nearMisses, currentStreak, bestStreak, startTime } = this.session;
    
    return {
      totalSwipes,
      matchRate: totalSwipes > 0 ? matches / totalSwipes : 0,
      nearMissRate: totalSwipes > 0 ? nearMisses / totalSwipes : 0,
      currentStreak,
      bestStreak,
      sessionDuration: Date.now() - startTime,
    };
  }

  /**
   * Reset session (called when user leaves swipe screen)
   */
  resetSession(): SwipeSession {
    const oldSession = { ...this.session };
    this.session = this.initSession();
    this.swipeHistory = [];
    return oldSession;
  }

  /**
   * Get behavioral insights for UI
   */
  getBehavioralInsights(): {
    shouldShowStreakBonus: boolean;
    streakMessage: string;
    nextMatchProbability: number;
    isOnFire: boolean;
  } {
    const { currentStreak, bestStreak } = this.session;
    const shouldShowStreakBonus = currentStreak >= this.config.streakMultiplierStart;
    
    let streakMessage = '';
    if (currentStreak >= 30) {
      streakMessage = "🔥 ON FIRE! 2.5x match bonus active";
    } else if (currentStreak >= 20) {
      streakMessage = "🔥 Heating up! 2x match bonus";
    } else if (currentStreak >= 10) {
      streakMessage = "🔥 Streak bonus: 1.5x matches";
    } else {
      streakMessage = `${10 - currentStreak} more swipes for bonus`;
    }

    return {
      shouldShowStreakBonus,
      streakMessage,
      nextMatchProbability: this.getNextCardProbability(),
      isOnFire: currentStreak >= 20,
    };
  }

  /**
   * Enable/disable haptic feedback
   */
  setHaptic(enabled: boolean) {
    this.hapticEnabled = enabled;
  }
}

// Singleton instance
let swipeEngineInstance: SwipeBehaviorEngine | null = null;

export const getSwipeEngine = (config?: Partial<SwipeConfig>): SwipeBehaviorEngine => {
  if (!swipeEngineInstance) {
    swipeEngineInstance = new SwipeBehaviorEngine(config);
  }
  return swipeEngineInstance;
};

export const resetSwipeEngine = () => {
  swipeEngineInstance = null;
};

export default SwipeBehaviorEngine;
