/**
 * Dopamine Loop System
 * 
 * Behavioral Design: Create addictive engagement loops
 * 
 * The Core Loop:
 * 1. Open app → Quick reward (notification/view)
 * 2. Curiosity → "What's next?"
 * 3. Continue → Another reward
 * 4. Loop → Session extends
 * 
 * Features:
 * - Instant feedback animations
 * - Delayed rewards (anticipation)
 * - Surprise matches (variable rewards)
 * - Progress indicators
 */

import { Animated, Vibration, Platform } from 'react-native';
import { COLORS } from '../../theme/colors';

export interface DopamineTrigger {
  type: 'match' | 'view' | 'message' | 'streak' | 'milestone' | 'surprise';
  title: string;
  subtitle: string;
  icon: string;
  points: number;
  delay?: number; // Delayed reward in ms
  animation?: 'pulse' | 'bounce' | 'confetti' | 'shake';
}

export interface DopamineState {
  sessionPoints: number;
  level: number;
  nextLevelPoints: number;
  streakFireLevel: number; // 0-4 fire intensity
  recentTriggers: DopamineTrigger[];
}

const LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1500, 3000, 5000, 10000];
const FIRE_LEVELS = [0, 10, 25, 50, 100]; // Swipe streaks

export class DopamineLoopSystem {
  private state: DopamineState;
  private triggerQueue: DopamineTrigger[] = [];
  private isProcessing: boolean = false;

  constructor() {
    this.state = this.initState();
  }

  private initState(): DopamineState {
    return {
      sessionPoints: 0,
      level: 1,
      nextLevelPoints: LEVEL_THRESHOLDS[1],
      streakFireLevel: 0,
      recentTriggers: [],
    };
  }

  /**
   * Trigger an immediate dopamine hit
   * Called when something rewarding happens
   */
  triggerImmediate(trigger: Omit<DopamineTrigger, 'delay'>): DopamineTrigger {
    const fullTrigger: DopamineTrigger = {
      ...trigger,
      delay: 0,
    };

    this.addPoints(trigger.points);
    this.updateStreakFire();
    this.addRecentTrigger(fullTrigger);
    
    // Haptic feedback
    this.playHaptic(trigger.type);

    return fullTrigger;
  }

  /**
   * Trigger a delayed dopamine hit (anticipation)
   * Creates "something's coming" tension
   */
  triggerDelayed(trigger: Omit<DopamineTrigger, 'delay'>, delayMs: number): void {
    const fullTrigger: DopamineTrigger = {
      ...trigger,
      delay: delayMs,
    };

    this.triggerQueue.push(fullTrigger);

    // Process after delay
    setTimeout(() => {
      this.processDelayedTrigger(fullTrigger);
    }, delayMs);
  }

  private processDelayedTrigger(trigger: DopamineTrigger): void {
    this.addPoints(trigger.points);
    this.addRecentTrigger(trigger);
    this.playHaptic(trigger.type);
  }

  /**
   * Surprise trigger - random unexpected reward
   * Key to variable reward schedule (addictive)
   */
  triggerSurprise(): DopamineTrigger {
    const surprises: Omit<DopamineTrigger, 'delay'>[] = [
      { type: 'surprise', title: '🎁 Surprise!', subtitle: 'Free premium for 1 hour', icon: '🎁', points: 25 },
      { type: 'surprise', title: '⭐ Bonus Match!', subtitle: 'Someone super liked you', icon: '⭐', points: 30 },
      { type: 'surprise', title: '🔥 Hot Spot!', subtitle: '10 people viewed your profile', icon: '🔥', points: 20 },
      { type: 'surprise', title: '🎉 Milestone!', subtitle: 'You reached 100 swipes today', icon: '🎉', points: 15 },
    ];

    const surprise = surprises[Math.floor(Math.random() * surprises.length)];
    return this.triggerImmediate(surprise);
  }

  /**
   * Check if surprise should trigger (random chance)
   * Called periodically during session
   */
  maybeTriggerSurprise(chance: number = 0.05): DopamineTrigger | null {
    if (Math.random() < chance) {
      return this.triggerSurprise();
    }
    return null;
  }

  /**
   * Add points and check for level up
   */
  private addPoints(points: number): void {
    this.state.sessionPoints += points;
    
    // Check level up
    const newLevel = this.calculateLevel();
    if (newLevel > this.state.level) {
      this.state.level = newLevel;
      this.state.nextLevelPoints = LEVEL_THRESHOLDS[newLevel] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
      
      // Level up celebration
      this.triggerImmediate({
        type: 'milestone',
        title: `🎉 Level ${newLevel}!`,
        subtitle: 'New rewards unlocked!',
        icon: '🏆',
        points: 0,
        animation: 'confetti',
      });
    }
  }

  private calculateLevel(): number {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.state.sessionPoints >= LEVEL_THRESHOLDS[i]) {
        return i + 1;
      }
    }
    return 1;
  }

  /**
   * Update fire level based on streak
   */
  private updateStreakFire(): void {
    const { sessionPoints } = this.state;
    
    for (let i = FIRE_LEVELS.length - 1; i >= 0; i--) {
      if (sessionPoints >= FIRE_LEVELS[i]) {
        this.state.streakFireLevel = i;
        break;
      }
    }
  }

  private addRecentTrigger(trigger: DopamineTrigger): void {
    this.state.recentTriggers.unshift(trigger);
    // Keep only last 5
    if (this.state.recentTriggers.length > 5) {
      this.state.recentTriggers.pop();
    }
  }

  private playHaptic(type: DopamineTrigger['type']): void {
    const patterns: Record<string, number | number[]> = {
      match: [0, 50, 100, 50],
      view: 20,
      message: 30,
      streak: [0, 30, 50, 30],
      milestone: [0, 100, 200, 100],
      surprise: [0, 50, 100, 50, 100, 50],
    };

    const pattern = patterns[type] || 20;
    Vibration.vibrate(pattern);
  }

  /**
   * Get current dopamine state for UI
   */
  getState(): DopamineState {
    return { ...this.state };
  }

  /**
   * Get progress to next level
   */
  getLevelProgress(): { current: number; next: number; percentage: number } {
    const currentThreshold = LEVEL_THRESHOLDS[this.state.level - 1] || 0;
    const nextThreshold = this.state.nextLevelPoints;
    const progress = this.state.sessionPoints - currentThreshold;
    const needed = nextThreshold - currentThreshold;
    
    return {
      current: progress,
      next: needed,
      percentage: Math.min(100, (progress / needed) * 100),
    };
  }

  /**
   * Get fire emoji based on streak level
   */
  getFireEmoji(): string {
    const fireLevels = ['', '🔥', '🔥🔥', '🔥🔥🔥', '🔥🔥🔥🔥'];
    return fireLevels[this.state.streakFireLevel] || '';
  }

  /**
   * Reset for new session
   */
  reset(): void {
    this.state = this.initState();
    this.triggerQueue = [];
  }

  /**
   * Get session summary
   */
  getSessionSummary(): {
    totalPoints: number;
    level: number;
    triggers: number;
    fireLevel: number;
  } {
    return {
      totalPoints: this.state.sessionPoints,
      level: this.state.level,
      triggers: this.state.recentTriggers.length,
      fireLevel: this.state.streakFireLevel,
    };
  }
}

// Pre-defined trigger templates
export const DOPAMINE_TRIGGERS = {
  // Instant triggers
  newMatch: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'match',
    title: '💚 New Match!',
    subtitle: 'Start chatting now',
    icon: '💚',
    points: 10,
    animation: 'pulse',
  }),

  profileView: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'view',
    title: '👀 Someone viewed you',
    subtitle: 'Check who!',
    icon: '👀',
    points: 5,
    animation: 'bounce',
  }),

  tripView: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'view',
    title: '🗺️ Your trip is popular',
    subtitle: '5 people viewed it',
    icon: '🗺️',
    points: 5,
  }),

  newMessage: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'message',
    title: '💬 New message',
    subtitle: 'Tap to reply',
    icon: '💬',
    points: 8,
  }),

  streakMilestone: (streak: number): Omit<DopamineTrigger, 'delay'> => ({
    type: 'streak',
    title: `🔥 ${streak} day streak!`,
    subtitle: 'Keep it going!',
    icon: '🔥',
    points: 15,
    animation: 'shake',
  }),

  // Delayed triggers (anticipation)
  matchInProgress: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'match',
    title: '❤️ Someone liked you!',
    subtitle: 'Check who...',
    icon: '❤️',
    points: 0,
  }),

  tripInterest: (): Omit<DopamineTrigger, 'delay'> => ({
    type: 'view',
    title: '🎯 Trip match found',
    subtitle: 'Loading...',
    icon: '🎯',
    points: 0,
  }),
};

// Singleton
let dopamineInstance: DopamineLoopSystem | null = null;

export const getDopamineLoop = (): DopamineLoopSystem => {
  if (!dopamineInstance) {
    dopamineInstance = new DopamineLoopSystem();
  }
  return dopamineInstance;
};

export default DopamineLoopSystem;
