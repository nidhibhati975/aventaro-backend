/**
 * useBehavioralEngagement Hook
 * 
 * Integrates all behavioral systems into a single hook
 * for easy use in React components
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  FeedRankingEngine,
  SwipeBehaviorEngine,
  DopamineLoopSystem,
  NotificationIntelligence,
  FOMOSystem,
  SessionExtensionSystem,
  ViralLoopEnhancement,
} from '../services/behavioral';
import type { AppUser, TripRecord } from './types';

interface BehavioralEngagementConfig {
  userId: number;
  userPreferences?: {
    interests?: string[];
    travelStyle?: string;
    budgetMin?: number;
    budgetMax?: number;
    location?: string;
  };
}

interface EngagementState {
  // Feed
  rankedUsers: AppUser[];
  rankedTrips: TripRecord[];
  isRanking: boolean;
  
  // Swipe
  swipeSession: {
    totalSwipes: number;
    matches: number;
    currentStreak: number;
    isOnFire: boolean;
  };
  
  // Dopamine
  dopamine: {
    sessionPoints: number;
    level: number;
    levelProgress: number;
    fireEmoji: string;
  };
  
  // FOMO
  activeFOMO: string | null;
  
  // Session
  sessionProgress: {
    swipes: number;
    timeSpent: string;
    level: string;
  };
  
  // Viral
  referralStatus: {
    code: string;
    totalReferrals: number;
    nextReward: string | null;
    progress: number;
  } | null;
}

export function useBehavioralEngagement(config: BehavioralEngagementConfig) {
  const [state, setState] = useState<EngagementState>({
    rankedUsers: [],
    rankedTrips: [],
    isRanking: false,
    swipeSession: {
      totalSwipes: 0,
      matches: 0,
      currentStreak: 0,
      isOnFire: false,
    },
    dopamine: {
      sessionPoints: 0,
      level: 1,
      levelProgress: 0,
      fireEmoji: '',
    },
    activeFOMO: null,
    sessionProgress: {
      swipes: 0,
      timeSpent: '0:00',
      level: 'Casual',
    },
    referralStatus: null,
  });

  // Initialize systems
  const rankingEngine = useRef(
    new FeedRankingEngine(config.userId, config.userPreferences)
  );
  const swipeEngine = useRef(new SwipeBehaviorEngine());
  const dopamine = useRef(DopamineLoopSystem.getDopamineLoop());
  const notifications = useRef(NotificationIntelligence.getNotificationIntelligence());
  const fomo = useRef(new FOMOSystem());
  const session = useRef(SessionExtensionSystem.getSessionExtension());
  const viral = useRef(ViralLoopEnhancement.getViralLoop());

  // App state tracking
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // User returned to app
        session.current.startSession();
        notifications.current.recordActivity();
        
        // Check for triggers
        const triggers = notifications.current.checkTriggers();
        if (triggers.length > 0) {
          console.log('[Behavioral] Notification triggers:', triggers);
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        // User left app
        session.current.endSession();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // Session progress updater
  useEffect(() => {
    const interval = setInterval(() => {
      const progress = session.current.getSessionProgress();
      const dopamineState = dopamine.current.getState();
      const levelProgress = dopamine.current.getLevelProgress();

      setState(prev => ({
        ...prev,
        sessionProgress: progress,
        dopamine: {
          sessionPoints: dopamineState.sessionPoints,
          level: dopamineState.level,
          levelProgress: levelProgress.percentage,
          fireEmoji: dopamine.current.getFireEmoji(),
        },
      }));
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  /**
   * Rank users for discovery feed
   */
  const rankUsers = useCallback((users: AppUser[]) => {
    setState(prev => ({ ...prev, isRanking: true }));
    
    const ranked = rankingEngine.current.rankUsers(users);
    
    setState(prev => ({
      ...prev,
      rankedUsers: ranked.map(r => r.item),
      isRanking: false,
    }));
    
    return ranked;
  }, []);

  /**
   * Rank trips for discovery feed
   */
  const rankTrips = useCallback((trips: TripRecord[]) => {
    const ranked = rankingEngine.current.rankTrips(trips);
    
    setState(prev => ({
      ...prev,
      rankedTrips: ranked.map(r => r.item),
    }));
    
    return ranked;
  }, []);

  /**
   * Process a swipe with behavioral optimization
   */
  const processSwipe = useCallback((
    direction: 'left' | 'right' | 'up',
    user: AppUser,
    baseMatchProbability: number = 0.3
  ) => {
    // Process through swipe engine
    const result = swipeEngine.current.processSwipe(direction, user, baseMatchProbability);
    
    // Update session
    session.current.recordSwipe(result.isMatch);
    
    // Trigger dopamine if match
    if (result.isMatch) {
      dopamine.current.triggerImmediate(DOPAMINE_TRIGGERS.newMatch());
    } else if (result.isNearMatch) {
      // Near match creates anticipation
      dopamine.current.triggerDelayed(
        DOPAMINE_TRIGGERS.matchInProgress(),
        2000
      );
    }

    // Maybe trigger surprise
    dopamine.current.maybeTriggerSurprise(0.05);

    // Update state
    const insights = swipeEngine.current.getBehavioralInsights();
    const stats = swipeEngine.current.getSessionStats();

    setState(prev => ({
      ...prev,
      swipeSession: {
        totalSwipes: stats.totalSwipes,
        matches: stats.totalSwipes * stats.matchRate,
        currentStreak: insights.isOnFire ? stats.currentStreak : 0,
        isOnFire: insights.isOnFire,
      },
    }));

    return result;
  }, []);

  /**
   * Get FOMO data for a trip
   */
  const getTripFOMO = useCallback((trip: TripRecord) => {
    const fomoData = fomo.current.getTripFOMO(trip);
    const primary = fomo.current.getPrimaryFOMO(trip);
    
    if (primary) {
      setState(prev => ({ ...prev, activeFOMO: primary.message }));
    }
    
    return { all: fomoData, primary };
  }, []);

  /**
   * Get extension prompt if applicable
   */
  const getExtensionPrompt = useCallback(() => {
    return session.current.checkPrompts();
  }, []);

  /**
   * Create share moment
   */
  const createShareMoment = useCallback((
    type: 'match' | 'trip_join' | 'achievement' | 'streak',
    data: any
  ) => {
    return viral.current.createShareMoment(type, data);
  }, []);

  /**
   * Share to social
   */
  const shareMoment = useCallback(async (
    type: 'match' | 'trip_join' | 'achievement' | 'streak',
    data: any
  ) => {
    const moment = viral.current.createShareMoment(type, data);
    return viral.current.shareMoment(moment);
  }, []);

  /**
   * Get referral status
   */
  const loadReferralStatus = useCallback(async () => {
    const status = await viral.current.getReferralStatus();
    const progress = viral.current.getProgressToNextReward(status.totalReferrals);
    
    setState(prev => ({
      ...prev,
      referralStatus: {
        code: status.code,
        totalReferrals: status.totalReferrals,
        nextReward: status.nextReward?.name || null,
        progress: progress.percentage,
      },
    }));
  }, []);

  /**
   * Reset for new session
   */
  const resetSession = useCallback(() => {
    swipeEngine.current.resetSession();
    dopamine.current.reset();
    session.current.reset();
    
    setState(prev => ({
      ...prev,
      swipeSession: {
        totalSwipes: 0,
        matches: 0,
        currentStreak: 0,
        isOnFire: false,
      },
      dopamine: {
        sessionPoints: 0,
        level: 1,
        levelProgress: 0,
        fireEmoji: '',
      },
    }));
  }, []);

  return {
    // State
    state,
    
    // Actions
    rankUsers,
    rankTrips,
    processSwipe,
    getTripFOMO,
    getExtensionPrompt,
    createShareMoment,
    shareMoment,
    loadReferralStatus,
    resetSession,
    
    // Systems (for advanced usage)
    systems: {
      ranking: rankingEngine.current,
      swipe: swipeEngine.current,
      dopamine: dopamine.current,
      notifications: notifications.current,
      fomo: fomo.current,
      session: session.current,
      viral: viral.current,
    },
  };
}

export default useBehavioralEngagement;