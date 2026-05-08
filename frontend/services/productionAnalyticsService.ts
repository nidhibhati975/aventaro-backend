/**
 * Production Analytics Pipeline
 * 
 * Features:
 * - Batch events before sending
 * - Retry failed events
 * - Event queue (local storage fallback)
 * - Session start/end events
 * - Retention metrics tracking
 * - Offline support
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import api, { extractErrorMessage } from './api';
import { errorLogger } from './errorLogger';

// ============== TYPES ==============

export interface AnalyticsEvent {
  id: string;
  event_type: string;
  timestamp: string;
  properties?: Record<string, any>;
  user_id?: number;
  session_id?: string;
  retry_count?: number;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  screenViews: number;
  eventsCount: number;
  errorsCount: number;
}

export interface RetentionMetrics {
  userId: number;
  date: string;
  sessionsCount: number;
  totalDuration: number;
  screensVisited: string[];
  actionsPerformed: Record<string, number>;
}

export interface AnalyticsConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxQueueSize: number;
}

// ============== CONSTANTS ==============

const DEFAULT_CONFIG: AnalyticsConfig = {
  batchSize: 20,
  flushIntervalMs: 30000, // 30 seconds
  maxRetries: 3,
  retryDelayMs: 5000,
  maxQueueSize: 1000,
};

// Storage keys
const ANALYTICS_QUEUE_KEY = 'analytics:eventQueue';
const ANALYTICS_SESSION_KEY = 'analytics:currentSession';
const ANALYTICS_RETENTION_KEY = 'analytics:retention';
const ANALYTICS_FAILED_KEY = 'analytics:failedEvents';

// ============== UTILITIES ==============

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============== MAIN SERVICE ==============

class ProductionAnalyticsService {
  private config: AnalyticsConfig;
  private eventQueue: AnalyticsEvent[] = [];
  private failedEvents: AnalyticsEvent[] = [];
  private isInitialized = false;
  private isFlushing = false;
  private currentSession: SessionMetrics | null = null;
  private screenStartTimes: Record<string, number> = {};
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private userId: number | null = null;

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============== INITIALIZATION ==============

  async init(userId: number): Promise<void> {
    if (this.isInitialized && this.userId === userId) {
      return;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.stopFlushTimer();

    this.userId = userId;
    this.isInitialized = true;

    // Restore any pending events from storage
    await this.restoreEventQueue();
    await this.restoreFailedEvents();

    // Start new session
    await this.startSession();

    // Start periodic flush
    this.startFlushTimer();

    // Listen for app state changes
    this.setupAppStateListener();

    console.log('[Analytics] Production pipeline initialized');
  }

  private setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        // Flush when going to background
        this.flush();
      } else if (nextState === 'active') {
        // Retry failed events when coming to foreground
        this.retryFailedEvents();
      }
    });
  }

  private startFlushTimer() {
    this.stopFlushTimer();
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  private stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ============== SESSION MANAGEMENT ==============

  private async startSession(): Promise<void> {
    this.currentSession = {
      sessionId: generateSessionId(),
      startTime: Date.now(),
      screenViews: 0,
      eventsCount: 0,
      errorsCount: 0,
    };

    // Track session start
    this.track('session_start', {
      session_id: this.currentSession.sessionId,
      previous_session_duration: await this.getLastSessionDuration(),
    });

    // Persist session
    this.persistSession();
  }

  private async endSession(): Promise<void> {
    if (!this.currentSession) return;

    const duration = Date.now() - this.currentSession.startTime;
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = duration;

    // Track session end
    this.track('session_end', {
      session_id: this.currentSession.sessionId,
      duration,
      screen_views: this.currentSession.screenViews,
      events_count: this.currentSession.eventsCount,
      errors_count: this.currentSession.errorsCount,
    });

    // Update retention metrics
    await this.updateRetentionMetrics(duration);

    // Clear session
    this.currentSession = null;
    await AsyncStorage.removeItem(ANALYTICS_SESSION_KEY);
  }

  private async getLastSessionDuration(): Promise<number | null> {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_RETENTION_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        return data.lastSessionDuration || null;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private async updateRetentionMetrics(duration: number): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_RETENTION_KEY);
      const today = new Date().toISOString().split('T')[0];
      
      let metrics: RetentionMetrics = raw ? JSON.parse(raw) : {
        userId: this.userId || 0,
        date: today,
        sessionsCount: 0,
        totalDuration: 0,
        screensVisited: [],
        actionsPerformed: {},
      };

      // Update for today
      if (metrics.date !== today) {
        // New day - reset but keep history
        metrics = {
          ...metrics,
          date: today,
          sessionsCount: 0,
          totalDuration: 0,
        };
      }

      metrics.sessionsCount += 1;
      metrics.totalDuration += duration;

      await AsyncStorage.setItem(ANALYTICS_RETENTION_KEY, JSON.stringify(metrics));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_RETENTION_KEY, 'updateRetentionMetrics');
    }
  }

  private async persistSession(): Promise<void> {
    if (!this.currentSession) return;
    try {
      await AsyncStorage.setItem(ANALYTICS_SESSION_KEY, JSON.stringify(this.currentSession));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_SESSION_KEY, 'persistSession');
    }
  }

  private async restoreSession(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_SESSION_KEY);
      if (raw) {
        const session: SessionMetrics = JSON.parse(raw);
        // Check if session was properly ended (not crashed)
        if (!session.endTime) {
          // Resume session
          this.currentSession = session;
          // Track session resume
          this.track('session_resume', {
            session_id: session.sessionId,
            gap: Date.now() - (session.endTime || session.startTime),
          });
        }
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_SESSION_KEY, 'restoreSession');
    }
  }

  // ============== EVENT TRACKING ==============

  track(eventType: string, properties?: Record<string, any>): void {
    if (!this.isInitialized) {
      if (__DEV__) {
        console.log('[Analytics] Not initialized, skipping event');
      }
      return;
    }

    const event: AnalyticsEvent = {
      id: generateEventId(),
      event_type: eventType,
      timestamp: new Date().toISOString(),
      properties,
      user_id: this.userId || undefined,
      session_id: this.currentSession?.sessionId,
    };

    // Add to queue
    this.eventQueue.push(event);

    // Update session metrics
    if (this.currentSession) {
      this.currentSession.eventsCount += 1;
    }

    // Persist queue periodically
    if (this.eventQueue.length >= 5) {
      this.persistEventQueue();
    }

    // Flush if batch size reached
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }

    console.log(`[Analytics] Tracked: ${eventType}`, properties);
  }

  trackError(error: Error, context?: Record<string, any>): void {
    this.track('error', {
      error_message: error.message,
      error_stack: error.stack,
      ...context,
    });

    if (this.currentSession) {
      this.currentSession.errorsCount += 1;
    }
  }

  // ============== SCREEN TRACKING ==============

  trackScreenView(screenName: string, properties?: Record<string, any>): void {
    const now = Date.now();
    const duration = this.screenStartTimes[screenName]
      ? now - this.screenStartTimes[screenName]
      : undefined;

    this.screenStartTimes[screenName] = now;

    this.track('screen_view', {
      screen_name: screenName,
      duration,
      ...properties,
    });

    if (this.currentSession) {
      this.currentSession.screenViews += 1;
    }
  }

  // ============== SPECIFIC EVENT TRACKERS ==============

  trackSwipe(direction: 'left' | 'right' | 'up', targetType: 'user' | 'trip', targetId: number): void {
    this.track(`swipe_${direction}`, {
      target_type: targetType,
      target_id: targetId,
    });
  }

  trackMatchSent(targetUserId: number): void {
    this.track('match_sent', { target_user_id: targetUserId });
  }

  trackMatchReceived(matchId: number): void {
    this.track('match_received', { match_id: matchId });
  }

  trackMatchAccepted(matchId: number): void {
    this.track('match_accepted', { match_id: matchId });
  }

  trackChatStarted(matchId: number): void {
    this.track('chat_started', { match_id: matchId });
  }

  trackMessageSent(conversationId: string): void {
    this.track('message_sent', { conversation_id: conversationId });
  }

  trackMessageReceived(messageId: number): void {
    this.track('message_received', { message_id: messageId });
  }

  trackTripView(tripId: number): void {
    this.track('trip_view', { trip_id: tripId });
  }

  trackTripJoinRequest(tripId: number): void {
    this.track('trip_join_request', { trip_id: tripId });
  }

  trackTripCreated(tripId: number): void {
    this.track('trip_created', { trip_id: tripId });
  }

  trackTripJoined(tripId: number): void {
    this.track('trip_joined', { trip_id: tripId });
  }

  trackDailyLogin(streak: number): void {
    this.track('daily_login', { streak });
  }

  trackNotificationOpen(notificationId: number | string): void {
    this.track('notification_open', { notification_id: notificationId });
  }

  trackNotificationReceived(notificationId: number | string): void {
    this.track('notification_received', { notification_id: notificationId });
  }

  trackPushTokenRegistered(): void {
    this.track('push_token_registered');
  }

  trackReferralUsed(referrerId: number): void {
    this.track('referral_used', { referrer_id: referrerId });
  }

  trackShare(type: string, contentId: string): void {
    this.track('share', { share_type: type, content_id: contentId });
  }

  // ============== FLUSH & RETRY ==============

  async flush(): Promise<void> {
    if (this.isFlushing || this.eventQueue.length === 0) {
      return;
    }

    this.isFlushing = true;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendEvents(eventsToSend);
      console.log(`[Analytics] Flushed ${eventsToSend.length} events`);
    } catch (error) {
      // Re-add events to queue
      this.eventQueue = [...eventsToSend, ...this.eventQueue];
      
      // Add to failed events for retry
      eventsToSend.forEach((event) => {
        event.retry_count = 0;
      });
      this.failedEvents = [...this.failedEvents, ...eventsToSend];
      
      errorLogger.logAPIError(error, 'analyticsFlush');
      console.error('[Analytics] Failed to flush events:', error);
    } finally {
      this.isFlushing = false;
      
      // Persist queues
      await this.persistEventQueue();
      await this.persistFailedEvents();
    }
  }

  private async sendEvents(events: AnalyticsEvent[]): Promise<void> {
    // Split into batches if too large
    const batches = this.chunkArray(events, this.config.batchSize);
    
    for (const batch of batches) {
      await api.post('/analytics/events', { events: batch });
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async retryFailedEvents(): Promise<void> {
    if (this.failedEvents.length === 0) return;

    const toRetry: AnalyticsEvent[] = [];
    const stillFailed: AnalyticsEvent[] = [];

    for (const event of this.failedEvents) {
      const retryCount = (event.retry_count || 0) + 1;
      
      if (retryCount <= this.config.maxRetries) {
        event.retry_count = retryCount;
        toRetry.push(event);
      } else {
        // Max retries reached, drop event
        console.warn(`[Analytics] Dropping event after ${retryCount} retries: ${event.event_type}`);
      }
    }

    if (toRetry.length > 0) {
      try {
        await this.sendEvents(toRetry);
        // Remove successfully sent from failed
        this.failedEvents = stillFailed;
        console.log(`[Analytics] Retried ${toRetry.length} events`);
      } catch (error) {
        // Keep in failed queue
        this.failedEvents = [...toRetry, ...stillFailed];
      }
    }

    await this.persistFailedEvents();
  }

  // ============== PERSISTENCE ==============

  private async persistEventQueue(): Promise<void> {
    try {
      // Trim if too large
      let queue = this.eventQueue;
      if (queue.length > this.config.maxQueueSize) {
        queue = queue.slice(-this.config.maxQueueSize);
      }
      
      await AsyncStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_QUEUE_KEY, 'persistEventQueue');
    }
  }

  private async restoreEventQueue(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY);
      if (raw) {
        this.eventQueue = JSON.parse(raw);
        // Filter out old events (older than 24 hours)
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.eventQueue = this.eventQueue.filter((e) => {
          const eventTime = new Date(e.timestamp).getTime();
          return eventTime > cutoff;
        });
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_QUEUE_KEY, 'restoreEventQueue');
      this.eventQueue = [];
    }
  }

  private async persistFailedEvents(): Promise<void> {
    try {
      await AsyncStorage.setItem(ANALYTICS_FAILED_KEY, JSON.stringify(this.failedEvents));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_FAILED_KEY, 'persistFailedEvents');
    }
  }

  private async restoreFailedEvents(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_FAILED_KEY);
      if (raw) {
        this.failedEvents = JSON.parse(raw);
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, ANALYTICS_FAILED_KEY, 'restoreFailedEvents');
      this.failedEvents = [];
    }
  }

  // ============== PUBLIC API ==============

  getSessionDuration(): number {
    return this.currentSession ? Date.now() - this.currentSession.startTime : 0;
  }

  getPendingEventsCount(): number {
    return this.eventQueue.length;
  }

  getFailedEventsCount(): number {
    return this.failedEvents.length;
  }

  async clearAll(): Promise<void> {
    this.eventQueue = [];
    this.failedEvents = [];
    await Promise.all([
      AsyncStorage.removeItem(ANALYTICS_QUEUE_KEY),
      AsyncStorage.removeItem(ANALYTICS_FAILED_KEY),
    ]);
  }

  async end(): Promise<void> {
    await this.endSession();
    await this.flush();
    this.stopFlushTimer();
    
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    
    this.isInitialized = false;
    console.log('[Analytics] Service ended');
  }
}

// Export singleton
export const productionAnalytics = new ProductionAnalyticsService();
export default productionAnalytics;

// Also export as analytics for compatibility
export const analytics = productionAnalytics;
