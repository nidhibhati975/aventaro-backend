/**
 * Phase 4 Production Components & Hooks
 * 
 * Export all production-ready components and hooks for Phase 4:
 * - Enhanced Swipe System
 * - Performance Optimization
 * - Analytics & Monitoring
 * - Push Notifications
 * - Viral Loop
 * - Common UI Components
 */

// ============== SWIPE COMPONENTS ==============
export { default as SwipeCardEnhanced } from './swipe/SwipeCardEnhanced';
export { default as SwipeDeckEnhanced } from './swipe/SwipeDeckEnhanced';
export { default as SwipeCard } from './swipe/SwipeCard';
export { default as SwipeDeck } from './swipe/SwipeDeck';
export { default as MatchAnimation } from './swipe/MatchAnimation';
export type { SwipeDirection } from './swipe/SwipeCardEnhanced';

// ============== COMMON COMPONENTS ==============
export { 
  Skeleton,
  DiscoveryCardSkeleton,
  TripCardSkeleton,
  MessageSkeleton,
  ConversationSkeleton,
  ProfileSectionSkeleton,
  FeedSkeleton,
  ListSkeleton,
} from './common/SkeletonLoader';

export { default as PullToRefresh, CustomPullToRefresh } from './common/PullToRefresh';

export { 
  default as InfiniteScroll, 
  useInfiniteScroll 
} from './common/InfiniteScroll';

// ============== HOOKS ==============

// Behavioral Engagement
export { 
  default as useBehavioralEngagement,
  getSwipeEngine,
  getFeedRankingEngine,
  getDopamineLoop,
  getNotificationIntelligence,
  getFOMOSystem,
  getSessionExtensionSystem,
  getViralLoopEnhancement,
} from '../hooks/useBehavioralEngagement';

// Enhanced Realtime
export { 
  default as useEnhancedRealtime,
  RealtimeEvents,
} from '../hooks/useEnhancedRealtime';

// Chat
export { 
  default as useChat,
  MessageStatus,
} from '../hooks/useChat';

// Performance
export { 
  usePerformance,
  useCachedAPI,
  usePerformanceMonitor,
  useAppState,
  useMemoryManagement,
} from '../hooks/usePerformance';
export { cache, deduplicator, perfMonitor } from '../hooks/usePerformance';
export type { CacheConfig, PerformanceMetrics } from '../hooks/usePerformance';

// Analytics
export { 
  useAnalyticsDashboard,
  useRealtimeMetrics,
  useEngagementTracker,
  AnalyticsContext,
} from '../hooks/useAnalytics';
export type { 
  AnalyticsEvent, 
  EngagementLevel, 
  DashboardData, 
  RealtimeMetrics 
} from '../hooks/useAnalytics';

// Push Notifications
export { 
  usePushNotifications,
  useIntelligentNotifications,
  NotificationTemplates,
} from '../hooks/usePushNotifications';
export type { 
  NotificationType, 
  NotificationPayload, 
  PermissionStatus 
} from '../hooks/usePushNotifications';

// Viral Loop
export { 
  useViralLoop,
  useDeepLink,
  ShareTemplates,
} from '../hooks/useViralLoop';
export type { 
  ReferralData, 
  ShareMoment, 
  RewardTier 
} from '../hooks/useViralLoop';

// ============== SERVICES ==============

// Behavioral Services
export { 
  feedRankingEngine,
  swipeBehaviorEngine,
  dopamineLoopSystem,
  notificationIntelligence,
  fomoSystem,
  sessionExtensionSystem,
  viralLoopEnhancement,
} from '../services/behavioral';

// Analytics Services
export { analyticsService } from '../services/analyticsService';
export { streakService } from '../services/streakService';
export { referralService } from '../services/referralService';

// ============== UTILITY TYPES ==============

// User types
export interface AppUser {
  id: number;
  email: string;
  profile?: {
    name?: string;
    age?: number;
    location?: string;
    travel_style?: string;
    bio?: string;
    interests?: string[];
    photos?: string[];
  };
}

// Trip types
export interface Trip {
  id: number;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  description?: string;
  cover_image?: string;
  spots_total: number;
  spots_filled: number;
  participants: number[];
  creator_id: number;
  status: 'draft' | 'open' | 'full' | 'completed' | 'cancelled';
}

// Message types
export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  read_at?: string;
}

// ============== CONSTANTS ==============

export const SWIPE_THRESHOLD = 0.25;
export const SUPER_LIKE_THRESHOLD = 0.25;
export const VELOCITY_THRESHOLD = 500;
export const STACK_SIZE = 3;
export const LOAD_MORE_THRESHOLD = 200;
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const CACHE_MAX_SIZE = 50;

// ============== DEFAULT EXPORT ==============

export default {
  // Components
  SwipeCardEnhanced,
  SwipeDeckEnhanced,
  SwipeCard,
  SwipeDeck,
  MatchAnimation,
  PullToRefresh,
  InfiniteScroll,
  
  // Hooks
  useBehavioralEngagement,
  useEnhancedRealtime,
  useChat,
  usePerformance,
  useAnalyticsDashboard,
  usePushNotifications,
  useViralLoop,
  
  // Services
  feedRankingEngine,
  swipeBehaviorEngine,
  dopamineLoopSystem,
  notificationIntelligence,
  fomoSystem,
  sessionExtensionSystem,
  viralLoopEnhancement,
  analyticsService,
  streakService,
  referralService,
};