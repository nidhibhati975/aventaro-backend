/**
 * Analytics Dashboard Hook
 * 
 * Tracks and displays:
 * - User engagement metrics
 * - Session analytics
 * - Feature usage
 * - Performance metrics
 * - Retention data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dimensions } from 'react-native';
import { analyticsService } from '../services/analyticsService';
import { streakService } from '../services/streakService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Analytics event types
export type AnalyticsEvent =
  | 'screen_view'
  | 'swipe_action'
  | 'match'
  | 'message_sent'
  | 'message_received'
  | 'trip_view'
  | 'trip_join'
  | 'profile_view'
  | 'search'
  | 'share'
  | 'notification_open'
  | 'purchase';

// Engagement levels
export type EngagementLevel = 'low' | 'medium' | 'high' | 'addicted';

// Dashboard data structure
export interface DashboardData {
  // Overview
  totalSessions: number;
  totalSwipes: number;
  totalMatches: number;
  totalMessages: number;
  totalTrips: number;
  
  // Engagement
  engagementLevel: EngagementLevel;
  dailyAverage: number;
  weeklyGrowth: number;
  streakDays: number;
  bestStreak: number;
  
  // Time metrics
  avgSessionDuration: number;
  lastActive: Date;
  peakHours: number[];
  
  // Funnel
  swipeToMatch: number;
  matchToMessage: number;
  messageToTrip: number;
  
  // Performance
  avgResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
}

// Real-time metrics
export interface RealtimeMetrics {
  activeUsers: number;
  currentSwipes: number;
  currentMatches: number;
  messagesThisHour: number;
}

// Hook for analytics dashboard
export function useAnalyticsDashboard() {
  const [data, setData] = useState<DashboardData>({
    totalSessions: 0,
    totalSwipes: 0,
    totalMatches: 0,
    totalMessages: 0,
    totalTrips: 0,
    engagementLevel: 'low',
    dailyAverage: 0,
    weeklyGrowth: 0,
    streakDays: 0,
    bestStreak: 0,
    avgSessionDuration: 0,
    lastActive: new Date(),
    peakHours: [],
    swipeToMatch: 0,
    matchToMessage: 0,
    messageToTrip: 0,
    avgResponseTime: 0,
    cacheHitRate: 0,
    errorRate: 0,
  });

  const [realtime, setRealtime] = useState<RealtimeMetrics>({
    activeUsers: 0,
    currentSwipes: 0,
    currentMatches: 0,
    messagesThisHour: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('week');
  const analyticsRef = useRef(analyticsService);

  // Load analytics data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [analytics, streak] = await Promise.all([
        analyticsRef.current.getSessionStats(),
        streakService.getStreak(),
      ]);

      // Calculate engagement level
      const engagementScore = calculateEngagementScore(analytics);
      const engagementLevel = getEngagementLevel(engagementScore);

      // Calculate funnels
      const swipeToMatch = analytics.totalSwipes > 0 
        ? (analytics.matches / analytics.totalSwipes) * 100 
        : 0;
      const matchToMessage = analytics.matches > 0 
        ? (analytics.messagesSent / analytics.matches) * 100 
        : 0;

      setData({
        totalSessions: analytics.totalSessions,
        totalSwipes: analytics.totalSwipes,
        totalMatches: analytics.matches,
        totalMessages: analytics.messagesSent,
        totalTrips: analytics.tripsJoined,
        engagementLevel,
        dailyAverage: analytics.dailyAverage,
        weeklyGrowth: analytics.weeklyGrowth,
        streakDays: streak.currentStreak,
        bestStreak: streak.bestStreak,
        avgSessionDuration: analytics.avgSessionDuration,
        lastActive: analytics.lastActive,
        peakHours: analytics.peakHours,
        swipeToMatch,
        matchToMessage,
        messageToTrip: 0, // Would need trip data
        avgResponseTime: 0, // From performance monitor
        cacheHitRate: 0,
        errorRate: 0,
      });
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Track an event
  const trackEvent = useCallback(async (
    event: AnalyticsEvent,
    properties?: Record<string, any>
  ) => {
    await analyticsRef.current.trackEvent(event, properties);
  }, []);

  // Refresh data
  const refresh = useCallback(() => {
    loadData();
  }, [loadData]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  return {
    data,
    realtime,
    isLoading,
    timeRange,
    setTimeRange,
    trackEvent,
    refresh,
  };
}

// Hook for real-time metrics
export function useRealtimeMetrics() {
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    activeUsers: 0,
    currentSwipes: 0,
    currentMatches: 0,
    messagesThisHour: 0,
  });

  useEffect(() => {
    // Simulate real-time updates
    const interval = setInterval(() => {
      setMetrics({
        activeUsers: Math.floor(Math.random() * 1000) + 500,
        currentSwipes: Math.floor(Math.random() * 50),
        currentMatches: Math.floor(Math.random() * 5),
        messagesThisHour: Math.floor(Math.random() * 100),
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return metrics;
}

// Hook for engagement tracking
export function useEngagementTracker() {
  const [engagementLevel, setEngagementLevel] = useState<EngagementLevel>('low');
  const [score, setScore] = useState(0);
  const sessionStart = useRef(Date.now());

  const calculateScore = useCallback(() => {
    const sessionDuration = Date.now() - sessionStart.current;
    const durationMinutes = sessionDuration / 60000;
    
    // Score based on session length and actions
    const newScore = Math.min(100, durationMinutes * 2);
    setScore(newScore);
    setEngagementLevel(getEngagementLevel(newScore));
  }, []);

  useEffect(() => {
    const interval = setInterval(calculateScore, 10000);
    return () => clearInterval(interval);
  }, [calculateScore]);

  return { engagementLevel, score };
}

// Helper functions
function calculateEngagementScore(stats: any): number {
  const { totalSwipes, matches, messagesSent, avgSessionDuration } = stats;
  
  // Weighted scoring
  const swipeScore = Math.min(30, totalSwipes / 10);
  const matchScore = Math.min(20, matches * 2);
  const messageScore = Math.min(30, messagesSent / 5);
  const durationScore = Math.min(20, avgSessionDuration / 60);
  
  return swipeScore + matchScore + messageScore + durationScore;
}

function getEngagementLevel(score: number): EngagementLevel {
  if (score >= 80) return 'addicted';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// Export analytics context
export const AnalyticsContext = {
  trackScreenView: (screen: string) => {
    analyticsService.trackEvent('screen_view', { screen });
  },
  trackSwipe: (direction: 'left' | 'right' | 'up', userId: number) => {
    analyticsService.trackEvent('swipe_action', { direction, userId });
  },
  trackMatch: (userId: number) => {
    analyticsService.trackEvent('match', { userId });
  },
  trackMessage: (conversationId: number, isSent: boolean) => {
    analyticsService.trackEvent(
      isSent ? 'message_sent' : 'message_received',
      { conversationId }
    );
  },
  trackTripView: (tripId: number) => {
    analyticsService.trackEvent('trip_view', { tripId });
  },
  trackTripJoin: (tripId: number) => {
    analyticsService.trackEvent('trip_join', { tripId });
  },
  trackNotificationOpen: (notificationId: string) => {
    analyticsService.trackEvent('notification_open', { notificationId });
  },
};

export default {
  useAnalyticsDashboard,
  useRealtimeMetrics,
  useEngagementTracker,
  AnalyticsContext,
};