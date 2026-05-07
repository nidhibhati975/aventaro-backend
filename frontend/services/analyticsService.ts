import api from './api';

export interface AnalyticsEvent {
  event_type: string;
  timestamp: string;
  properties?: Record<string, any>;
}

class AnalyticsService {
  private events: AnalyticsEvent[] = [];
  private isInitialized = false;
  private sessionStartTime: number = 0;
  private screenStartTime: Record<string, number> = {};

  // Initialize analytics session
  init() {
    this.isInitialized = true;
    this.sessionStartTime = Date.now();
    console.log('[Analytics] Session started');
  }

  // Track screen views
  trackScreenView(screenName: string, properties?: Record<string, any>) {
    const now = Date.now();
    const duration = this.screenStartTime[screenName]
      ? now - this.screenStartTime[screenName]
      : undefined;

    this.screenStartTime[screenName] = now;

    this.track('screen_view', {
      screen_name: screenName,
      duration,
      ...properties,
    });
  }

  // Track swipe actions
  trackSwipe(direction: 'left' | 'right' | 'up', targetType: 'user' | 'trip', targetId: number) {
    this.track(`swipe_${direction}`, {
      target_type: targetType,
      target_id: targetId,
    });
  }

  // Track match events
  trackMatchSent(targetUserId: number) {
    this.track('match_sent', { target_user_id: targetUserId });
  }

  trackMatchReceived(matchId: number) {
    this.track('match_received', { match_id: matchId });
  }

  trackMatchAccepted(matchId: number) {
    this.track('match_accepted', { match_id: matchId });
  }

  trackChatStarted(matchId: number) {
    this.track('chat_started', { match_id: matchId });
  }

  // Track trip events
  trackTripView(tripId: number) {
    this.track('trip_view', { trip_id: tripId });
  }

  trackTripJoinRequest(tripId: number) {
    this.track('trip_join_request', { trip_id: tripId });
  }

  trackTripCreated(tripId: number) {
    this.track('trip_created', { trip_id: tripId });
  }

  // Track retention events
  trackDailyLogin(streak: number) {
    this.track('daily_login', { streak });
  }

  trackNotificationOpen(notificationId: number | string) {
    this.track('notification_open', { notification_id: notificationId });
  }

  // Track session events
  trackSessionStart() {
    this.sessionStartTime = Date.now();
    this.track('session_start');
  }

  trackSessionEnd() {
    const duration = Date.now() - this.sessionStartTime;
    this.track('session_end', { duration });
    this.flush(); // Send all pending events
  }

  // Core tracking method
  private track(eventType: string, properties?: Record<string, any>) {
    if (!this.isInitialized) {
      this.init();
    }

    const event: AnalyticsEvent = {
      event_type: eventType,
      timestamp: new Date().toISOString(),
      properties,
    };

    this.events.push(event);
    console.log(`[Analytics] Tracked: ${eventType}`, properties);

    // Auto-flush every 10 events
    if (this.events.length >= 10) {
      this.flush();
    }
  }

  // Send events to backend
  async flush() {
    if (this.events.length === 0) return;

    const eventsToSend = [...this.events];
    this.events = [];

    try {
      await api.post('/analytics/events', { events: eventsToSend });
      console.log(`[Analytics] Flushed ${eventsToSend.length} events`);
    } catch (error) {
      // Re-add events on failure
      this.events = [...eventsToSend, ...this.events];
      console.error('[Analytics] Failed to flush events:', error);
    }
  }

  // Get current session duration
  getSessionDuration(): number {
    return Date.now() - this.sessionStartTime;
  }

  // Get pending events count
  getPendingEventsCount(): number {
    return this.events.length;
  }
}

export const analytics = new AnalyticsService();
export default analytics;