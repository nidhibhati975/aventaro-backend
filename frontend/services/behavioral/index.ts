/**
 * Behavioral Design Services Index
 * 
 * All engagement, retention, and dopamine loop systems
 * designed to convert users into power users
 */

export { FeedRankingEngine, createRankingEngine } from './feedRankingEngine';
export type { RankingConfig, RankedItem } from './feedRankingEngine';

export { SwipeBehaviorEngine, getSwipeEngine, resetSwipeEngine } from './swipeBehaviorEngine';
export type { SwipeConfig, SwipeResult, SwipeSession } from './swipeBehaviorEngine';

export { DopamineLoopSystem, getDopamineLoop, DOPAMINE_TRIGGERS } from './dopamineLoopSystem';
export type { DopamineTrigger, DopamineState } from './dopamineLoopSystem';

export { NotificationIntelligence, getNotificationIntelligence, NOTIFICATION_TEMPLATES } from './notificationIntelligence';
export type { NotificationTrigger, TriggerType, NotificationSchedule, NotificationStats } from './notificationIntelligence';

export { FOMOSystem, getFOMOSystem, FOMO_MESSAGES } from './fomoSystem';
export type { FOMOData, FOMOType, FOMOConfig } from './fomoSystem';

export { SessionExtensionSystem, getSessionExtension } from './sessionExtensionSystem';
export type { SessionMetrics, ExtensionPrompt, PromptType } from './sessionExtensionSystem';

export { ViralLoopEnhancement, getViralLoop } from './viralLoopEnhancement';
export type { ViralReward, ReferralStatus, ShareMoment } from './viralLoopEnhancement';