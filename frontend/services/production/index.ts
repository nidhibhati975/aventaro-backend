/**
 * Production Services Index
 * 
 * Exports all production-ready services for Phase 4.5:
 * - Hardened Real-Time System
 * - Production Chat Service
 * - Production Analytics Pipeline
 * - Firebase Push Notifications
 * - Behavioral Data Persistence
 * - Production Viral System
 * - Error Recovery Components
 */

// ============== REAL-TIME ==============
export { 
  hardenedRealtimeService,
  type RealtimeConnectionStatus,
  type RealtimeEvent,
  type PendingAck,
  type AckResponse,
  type QueuedEvent,
  type ClientState,
  type StateSyncResponse,
} from './hardenedRealtimeService';

// ============== CHAT ==============
export {
  fetchMessages,
  fetchOlderMessages,
  fetchNewerMessages,
  sendMessageWithRetry,
  retryFailedMessage,
  cancelPendingMessage,
  getAllPendingMessages,
  retryAllFailedMessages,
  storeOfflineMessage,
  getOfflineMessages,
  clearOfflineMessages,
  sendOfflineMessages,
  saveDraft,
  getDraft,
  clearDraft,
  uploadMedia,
  sendTypingIndicator,
  clearTypingIndicator,
  updateMessageStatus,
  markMessageRead,
  fetchConversations,
  markConversationRead,
  getMessageById,
  deleteMessage,
  editMessage,
  type MediaAttachment,
  type ChatMessage,
  type MessagePage,
  type SendMessageOptions,
  type TypingIndicator,
  type PendingMessage,
} from './productionChatService';

// ============== ANALYTICS ==============
export {
  productionAnalytics,
  analytics,
  type AnalyticsEvent,
  type SessionMetrics,
  type RetentionMetrics,
  type AnalyticsConfig,
} from './productionAnalyticsService';

// ============== PUSH NOTIFICATIONS ==============
export {
  firebasePushService,
  type NotificationType,
  type PermissionStatus,
  type NotificationPayload,
  type NotificationSettings,
  type DeviceToken,
  type NotificationAction,
} from './firebasePushService';

// ============== BEHAVIORAL PERSISTENCE ==============
export {
  behavioralPersistence,
  type SwipeBehavior,
  type PreferenceProfile,
  type MatchRanking,
  type BehavioralProfile,
} from './behavioralPersistence';

// ============== VIRAL ==============
export {
  productionViralService,
  type ReferralCode,
  type Referral,
  type ReferralStats,
  type RewardTier,
  type DeepLinkData,
} from './productionViralService';

// ============== ERROR RECOVERY ==============
export {
  ErrorBoundary,
  RetryUI,
  NetworkLossHandler,
  GracefulFallback,
  useApiRetry,
  useNetworkState,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
  type FallbackProps,
  type RetryConfig,
  type RetryUIProps,
  type NetworkState,
  type GracefulFallbackProps,
} from './error/ErrorRecovery';

// ============== RE-EXPORTS FROM EXISTING ==============
export { errorLogger } from './errorLogger';
export { realtimeService } from './realtimeService';
export { chatService } from './chatService';
export { analytics as defaultAnalytics } from './analyticsService';

// ============== DEFAULT EXPORT ==============

export default {
  // Real-time
  hardenedRealtimeService,
  
  // Chat
  fetchMessages,
  sendMessageWithRetry,
  fetchConversations,
  
  // Analytics
  productionAnalytics,
  
  // Push
  firebasePushService,
  
  // Behavioral
  behavioralPersistence,
  
  // Viral
  productionViralService,
  
  // Error Recovery
  ErrorBoundary,
  RetryUI,
  NetworkLossHandler,
  GracefulFallback,
};