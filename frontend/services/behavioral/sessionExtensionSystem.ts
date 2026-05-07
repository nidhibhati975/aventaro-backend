/**
 * Session Extension System
 * 
 * Behavioral Design: Keep users in app longer
 * 
 * Techniques:
 * 1. "Just one more swipe" prompts - End of feed triggers
 * 2. Auto-refresh feed - Continuous content loading
 * 3. Continuous scroll - Seamless infinite scroll
 * 4. Progress indicators - Show "how far" user has gone
 * 5. Micro-rewards - Small dopamine hits during session
 */

import { Vibration } from 'react-native';

export interface SessionMetrics {
  startTime: number;
  totalSwipes: number;
  matches: number;
  feedViews: number;
  timeSpent: number; // seconds
  sessionCount: number;
}

export interface ExtensionPrompt {
  id: string;
  type: PromptType;
  message: string;
  action?: string;
  triggerAfter: number; // swipes
  showProbability: number; // 0-1
}

export type PromptType = 
  | 'just_one_more'
  | 'match_streak'
  | 'feed_refresh'
  | 'discover_more'
  | 'achievement';

const DEFAULT_PROMPTS: ExtensionPrompt[] = [
  {
    id: 'just_one_more_10',
    type: 'just_one_more',
    message: 'Just one more swipe... 🔄',
    action: 'Keep swiping',
    triggerAfter: 10,
    showProbability: 0.8,
  },
  {
    id: 'just_one_more_25',
    type: 'just_one_more',
    message: '25 swipes! You\'re on fire 🔥',
    action: 'Continue',
    triggerAfter: 25,
    showProbability: 0.9,
  },
  {
    id: 'match_streak_3',
    type: 'match_streak',
    message: '3 matches in a row! 🎉',
    action: 'See matches',
    triggerAfter: 3,
    showProbability: 0.7,
  },
  {
    id: 'feed_refresh',
    type: 'feed_refresh',
    message: '✨ New profiles loaded',
    action: 'Continue',
    triggerAfter: 15,
    showProbability: 0.6,
  },
  {
    id: 'discover_more',
    type: 'discover_more',
    message: 'Discover more travelers →',
    action: 'Explore',
    triggerAfter: 20,
    showProbability: 0.5,
  },
];

export class SessionExtensionSystem {
  private metrics: SessionMetrics;
  private prompts: ExtensionPrompt[];
  private lastPromptTime: number = 0;
  private isActive: boolean = false;

  constructor() {
    this.metrics = this.initMetrics();
    this.prompts = [...DEFAULT_PROMPTS];
  }

  private initMetrics(): SessionMetrics {
    return {
      startTime: Date.now(),
      totalSwipes: 0,
      matches: 0,
      feedViews: 0,
      timeSpent: 0,
      sessionCount: 1,
    };
  }

  /**
   * Start tracking a new session
   */
  startSession(): void {
    this.isActive = true;
    this.metrics.startTime = Date.now();
    console.log('[Session] Session started');
  }

  /**
   * End current session
   */
  endSession(): SessionMetrics {
    this.isActive = false;
    this.metrics.timeSpent = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    console.log('[Session] Session ended:', this.metrics);
    return { ...this.metrics };
  }

  /**
   * Record a swipe (increases engagement)
   */
  recordSwipe(isMatch: boolean = false): void {
    this.metrics.totalSwipes++;
    if (isMatch) {
      this.metrics.matches++;
    }

    // Check for extension prompts
    this.checkPrompts();
  }

  /**
   * Record feed view (pagination)
   */
  recordFeedView(): void {
    this.metrics.feedViews++;
  }

  /**
   * Check if we should show an extension prompt
   */
  checkPrompts(): ExtensionPrompt | null {
    if (!this.isActive) return null;

    const { totalSwipes, matches } = this.metrics;
    const now = Date.now();

    // Don't show prompts too frequently (min 10 seconds between)
    if (now - this.lastPromptTime < 10000) return null;

    for (const prompt of this.prompts) {
      // Check trigger condition
      let shouldShow = false;

      if (prompt.type === 'just_one_more' || prompt.type === 'discover_more') {
        shouldShow = totalSwipes >= prompt.triggerAfter;
      } else if (prompt.type === 'match_streak') {
        // Show after X matches
        shouldShow = matches >= prompt.triggerAfter;
      } else if (prompt.type === 'feed_refresh') {
        shouldShow = this.metrics.feedViews >= prompt.triggerAfter;
      }

      // Check probability
      if (shouldShow && Math.random() < prompt.showProbability) {
        this.lastPromptTime = now;
        
        // Light haptic
        Vibration.vibrate(15);
        
        return prompt;
      }
    }

    return null;
  }

  /**
   * Get "just one more" message based on context
   */
  getJustOneMoreMessage(): string {
    const { totalSwipes, matches } = this.metrics;

    const messages = [
      'Just one more swipe... 🔄',
      'Almost there! →',
      'One more to unlock a surprise 🎁',
      `${10 - (totalSwipes % 10)} swipes until bonus`,
      'Your next match could be here! 💚',
    ];

    // Add match-specific messages
    if (matches > 0) {
      messages.push(
        `${matches} matches today! Keep going 🔥`,
        'Momentum is on your side! →',
      );
    }

    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Get session progress for UI
   */
  getSessionProgress(): {
    swipes: number;
    matches: number;
    timeSpent: string;
    level: string;
    nextMilestone: number;
  } {
    const timeSpent = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const minutes = Math.floor(timeSpent / 60);
    const seconds = timeSpent % 60;

    // Calculate engagement level
    let level = 'Casual';
    let nextMilestone = 10;

    if (this.metrics.totalSwipes >= 50) {
      level = 'Power User';
      nextMilestone = 100;
    } else if (this.metrics.totalSwipes >= 25) {
      level = 'Engaged';
      nextMilestone = 50;
    } else if (this.metrics.totalSwipes >= 10) {
      level = 'Active';
      nextMilestone = 25;
    }

    return {
      swipes: this.metrics.totalSwipes,
      matches: this.metrics.matches,
      timeSpent: `${minutes}:${seconds.toString().padStart(2, '0')}`,
      level,
      nextMilestone,
    };
  }

  /**
   * Auto-refresh trigger (for infinite scroll)
   */
  shouldAutoRefresh(): boolean {
    // Refresh after every 20 swipes
    return this.metrics.totalSwipes > 0 && 
           this.metrics.totalSwipes % 20 === 0;
  }

  /**
   * Get continuous scroll recommendation
   */
  getScrollRecommendation(): {
    shouldContinue: boolean;
    reason: string;
    nextContentType: 'people' | 'trips' | 'recommended';
  } {
    const { totalSwipes, feedViews } = this.metrics;

    // After 15 swipes, suggest switching content type
    if (totalSwipes >= 15 && totalSwipes % 15 === 0) {
      const types: ('people' | 'trips' | 'recommended')[] = ['people', 'trips', 'recommended'];
      const nextType = types[totalSwipes % 3];

      return {
        shouldContinue: true,
        reason: `Time to discover some ${nextType}!`,
        nextContentType: nextType,
      };
    }

    return {
      shouldContinue: true,
      reason: 'More profiles loading...',
      nextContentType: 'people',
    };
  }

  /**
   * Calculate session extension score (0-1)
   * Higher = more likely to continue
   */
  getExtensionScore(): number {
    const { totalSwipes, matches, timeSpent } = this.metrics;
    
    // Factors that increase extension likelihood
    let score = 0;

    // More swipes = more engaged
    score += Math.min(0.3, totalSwipes / 100);

    // More matches = more rewarding
    score += Math.min(0.3, (matches * 0.1));

    // Session duration (up to 30 minutes)
    const minutes = timeSpent / 60;
    score += Math.min(0.2, minutes / 60);

    // Recent activity (last 2 minutes)
    const recentActivity = totalSwipes > 5;
    if (recentActivity) score += 0.2;

    return Math.min(1, score);
  }

  /**
   * Reset for new session
   */
  reset(): void {
    this.metrics = this.initMetrics();
    this.metrics.sessionCount++;
    this.lastPromptTime = 0;
  }

  /**
   * Get current metrics
   */
  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }
}

// Session state for persistence
let sessionInstance: SessionExtensionSystem | null = null;

export const getSessionExtension = (): SessionExtensionSystem => {
  if (!sessionInstance) {
    sessionInstance = new SessionExtensionSystem();
  }
  return sessionInstance;
};

export default SessionExtensionSystem;