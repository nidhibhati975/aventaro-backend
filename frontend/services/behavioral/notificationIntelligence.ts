/**
 * Notification Intelligence System
 * 
 * Behavioral Design: Smart notification triggers for maximum engagement
 * 
 * Trigger Categories:
 * 1. Inactivity Triggers - 6h/24h without app open
 * 2. High Activity Triggers - Boost when user is engaged
 * 3. Missed Opportunities - Someone viewed but no action
 * 4. Social Proof - Friends are active
 * 
 * Timing Optimization:
 * - Morning (7-9 AM): Daily summary, new matches
 * - Evening (6-8 PM): New matches, trip activity
 * - Night (8-10 PM): Chat reminders, social proof
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface NotificationTrigger {
  id: string;
  type: TriggerType;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
  delay?: number; // Send after X ms
  schedule?: NotificationSchedule;
}

export type TriggerType = 
  | 'inactivity_6h'
  | 'inactivity_24h'
  | 'high_activity'
  | 'missed_view'
  | 'missed_match'
  | 'social_proof'
  | 'streak_warning'
  | 'trip_urgency'
  | 'new_match'
  | 'new_message'
  | 'trip_suggestion';

export interface NotificationSchedule {
  preferredTime?: string; // "HH:MM"
  bestDays?: number[]; // [0-6] Sunday-Saturday
  timezone?: string;
}

export interface NotificationStats {
  sent: number;
  opened: number;
  clicked: number;
  dismissed: number;
}

const TRIGGER_STORAGE_KEY = 'notification:triggers';
const STATS_STORAGE_KEY = 'notification:stats';
const LAST_SENT_KEY = 'notification:lastSent';

export class NotificationIntelligence {
  private lastActiveTime: number = 0;
  private lastNotificationTime: number = 0;
  private triggerHistory: string[] = [];
  private stats: NotificationStats = { sent: 0, opened: 0, clicked: 0, dismissed: 0 };

  constructor() {
    this.loadState();
  }

  private async loadState() {
    try {
      const lastActive = await AsyncStorage.getItem('user:lastActive');
      this.lastActiveTime = lastActive ? parseInt(lastActive) : Date.now();
      
      const statsJson = await AsyncStorage.getItem(STATS_STORAGE_KEY);
      if (statsJson) {
        this.stats = JSON.parse(statsJson);
      }
    } catch (e) {
      console.error('Failed to load notification state:', e);
    }
  }

  private async saveState() {
    try {
      await AsyncStorage.setItem('user:lastActive', Date.now().toString());
      await AsyncStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(this.stats));
    } catch (e) {
      console.error('Failed to save notification state:', e);
    }
  }

  /**
   * Record user activity (call on app open/foreground)
   */
  recordActivity(): void {
    this.lastActiveTime = Date.now();
    this.saveState();
  }

  /**
   * Check which triggers should fire based on current state
   */
  checkTriggers(): NotificationTrigger[] {
    const triggers: NotificationTrigger[] = [];
    const now = Date.now();
    const hoursSinceActive = (now - this.lastActiveTime) / (1000 * 60 * 60);

    // Inactivity triggers
    if (hoursSinceActive >= 6 && hoursSinceActive < 24) {
      triggers.push(this.createInactivityTrigger('6h'));
    }

    if (hoursSinceActive >= 24) {
      triggers.push(this.createInactivityTrigger('24h'));
    }

    // Check for missed opportunities
    const missedTriggers = this.checkMissedOpportunities();
    triggers.push(...missedTriggers);

    // Streak warning (if streak at risk)
    triggers.push(...this.checkStreakWarning());

    // Trip urgency
    triggers.push(...this.checkTripUrgency());

    return triggers;
  }

  /**
   * Create inactivity-based trigger
   */
  private createInactivityTrigger(hours: '6h' | '24h'): NotificationTrigger {
    const templates = {
      '6h': {
        type: 'inactivity_6h' as TriggerType,
        title: '👋 Missed you!',
        body: 'New travelers joined while you were away',
        priority: 'medium' as const,
      },
      '24h': {
        type: 'inactivity_24h' as TriggerType,
        title: '🔥 Your streak is at risk!',
        body: "Don't lose your {streak} day streak - come back today",
        priority: 'high' as const,
      },
    };

    return {
      id: `inactivity_${hours}_${Date.now()}`,
      ...templates[hours],
      data: { hours, lastActive: this.lastActiveTime },
    };
  }

  /**
   * Check for missed opportunities (views without matches)
   */
  private checkMissedOpportunities(): NotificationTrigger[] {
    const triggers: NotificationTrigger[] = [];

    // Simulated: In real app, this would check actual view data
    if (Math.random() < 0.3) {
      triggers.push({
        id: `missed_view_${Date.now()}`,
        type: 'missed_view',
        title: '👀 3 people viewed your profile',
        body: 'They might want to travel with you!',
        priority: 'high',
        data: { viewCount: 3 },
      });
    }

    return triggers;
  }

  /**
   * Check if streak is at risk
   */
  private checkStreakWarning(): NotificationTrigger[] {
    const triggers: NotificationTrigger[] = [];
    const now = Date.now();
    const today = now - (now % (24 * 60 * 60 * 1000));
    
    // If last active was yesterday and it's now past 9 AM
    if (this.lastActiveTime < today && now > today + 9 * 60 * 60 * 1000) {
      triggers.push({
        id: `streak_warning_${Date.now()}`,
        type: 'streak_warning',
        title: '🔥 Streak Alert!',
        body: 'Log in now to save your streak',
        priority: 'high',
      });
    }

    return triggers;
  }

  /**
   * Check for urgent trips
   */
  private checkTripUrgency(): NotificationTrigger[] {
    const triggers: NotificationTrigger[] = [];

    // Random chance for trip urgency (simulated)
    if (Math.random() < 0.1) {
      triggers.push({
        id: `trip_urgency_${Date.now()}`,
        type: 'trip_urgency',
        title: '🎯 Trip spots filling fast!',
        body: 'Only 2 spots left on "Paris Adventure"',
        priority: 'medium',
        data: { tripId: 123, spotsLeft: 2 },
      });
    }

    return triggers;
  }

  /**
   * Get optimal send time based on user's history
   */
  getOptimalSendTime(): string {
    const hour = new Date().getHours();
    
    // Default optimal times
    if (hour >= 7 && hour <= 9) return '07:30'; // Morning
    if (hour >= 18 && hour <= 20) return '18:30'; // Evening
    if (hour >= 20 && hour <= 22) return '20:00'; // Night
    
    // Default to evening
    return '18:30';
  }

  /**
   * Determine if we should send notification (rate limiting)
   */
  shouldSendNotification(): boolean {
    const now = Date.now();
    const hoursSinceLastNotification = (now - this.lastNotificationTime) / (1000 * 60 * 60);
    
    // Minimum 4 hours between notifications
    return hoursSinceLastNotification >= 4;
  }

  /**
   * Record notification sent
   */
  recordSent(triggerId: string): void {
    this.lastNotificationTime = Date.now();
    this.triggerHistory.push(triggerId);
    this.stats.sent++;
    this.saveState();
  }

  /**
   * Record notification opened
   */
  recordOpened(): void {
    this.stats.opened++;
    this.saveState();
  }

  /**
   * Record notification clicked
   */
  recordClicked(): void {
    this.stats.clicked++;
    this.saveState();
  }

  /**
   * Record notification dismissed
   */
  recordDismissed(): void {
    this.stats.dismissed++;
    this.saveState();
  }

  /**
   * Get notification stats
   */
  getStats(): NotificationStats {
    return { ...this.stats };
  }

  /**
   * Get open rate
   */
  getOpenRate(): number {
    if (this.stats.sent === 0) return 0;
    return this.stats.opened / this.stats.sent;
  }

  /**
   * Get click rate
   */
  getClickRate(): number {
    if (this.stats.opened === 0) return 0;
    return this.stats.clicked / this.stats.opened;
  }

  /**
   * Schedule notification for optimal time
   */
  scheduleNotification(trigger: NotificationTrigger): void {
    const optimalTime = this.getOptimalSendTime();
    const [hours, minutes] = optimalTime.split(':').map(Number);
    
    const now = new Date();
    let scheduledTime = new Date(now);
    scheduledTime.setHours(hours, minutes, 0, 0);
    
    // If time has passed today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    trigger.schedule = {
      preferredTime: optimalTime,
    };

    // In real implementation, this would use push notification scheduling
    console.log(`[Notification] Scheduled for ${scheduledTime.toISOString()}`);
  }

  /**
   * Get social proof trigger
   */
  getSocialProofTrigger(): NotificationTrigger {
    const friends = Math.floor(Math.random() * 5) + 1;
    
    return {
      id: `social_proof_${Date.now()}`,
      type: 'social_proof',
      title: '👥 Your travel buddies are online!',
      body: `${friends} people you matched with are active now`,
      priority: 'medium',
      data: { activeFriends: friends },
    };
  }

  /**
   * Get high activity boost trigger
   */
  getHighActivityTrigger(): NotificationTrigger {
    return {
      id: `high_activity_${Date.now()}`,
      type: 'high_activity',
      title: '🔥 You\'re on fire!',
      body: 'Keep going - 5 more swipes for a guaranteed match',
      priority: 'low',
    };
  }
}

// Pre-defined trigger templates
export const NOTIFICATION_TEMPLATES: Record<TriggerType, Omit<NotificationTrigger, 'id'>> = {
  inactivity_6h: {
    type: 'inactivity_6h',
    title: '👋 Come back!',
    body: 'New matches waiting for you',
    priority: 'medium',
  },
  inactivity_24h: {
    type: 'inactivity_24h',
    title: '🔥 Streak at risk!',
    body: "Don't lose your progress",
    priority: 'high',
  },
  high_activity: {
    type: 'high_activity',
    title: '🔥 On fire!',
    body: 'Keep swiping for more matches',
    priority: 'low',
  },
  missed_view: {
    type: 'missed_view',
    title: '👀 People viewed you',
    body: 'See who wants to travel with you',
    priority: 'high',
  },
  missed_match: {
    type: 'missed_match',
    title: '💚 It\'s a match!',
    body: 'You and {name} liked each other',
    priority: 'high',
  },
  social_proof: {
    type: 'social_proof',
    title: '👥 Friends are traveling',
    body: 'Join your travel buddies',
    priority: 'medium',
  },
  streak_warning: {
    type: 'streak_warning',
    title: '🔥 Save your streak!',
    body: 'Log in to keep your {streak} day streak',
    priority: 'high',
  },
  trip_urgency: {
    type: 'trip_urgency',
    title: '🎯 Spots filling fast!',
    body: 'Only {spots} spots left on {trip}',
    priority: 'medium',
  },
  new_match: {
    type: 'new_match',
    title: '💚 New match!',
    body: 'You and {name} want to travel together',
    priority: 'high',
  },
  new_message: {
    type: 'new_message',
    title: '💬 New message',
    body: '{name} sent you a message',
    priority: 'high',
  },
  trip_suggestion: {
    type: 'trip_suggestion',
    title: '🗺️ Perfect trip for you!',
    body: '{trip} matches your interests',
    priority: 'medium',
  },
};

// Singleton
let notificationInstance: NotificationIntelligence | null = null;

export const getNotificationIntelligence = (): NotificationIntelligence => {
  if (!notificationInstance) {
    notificationInstance = new NotificationIntelligence();
  }
  return notificationInstance;
};

export default NotificationIntelligence;