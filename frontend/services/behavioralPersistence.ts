/**
 * Behavioral Data Persistence Service
 * 
 * Moves behavioral logic from frontend → backend:
 * - Store user swipe behavior
 * - Track preferences over time
 * - Adjust match ranking dynamically
 * - Sync behavioral profile via API
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { extractErrorMessage, getApiData } from './api';
import { errorLogger } from './errorLogger';

// ============== TYPES ==============

export interface SwipeBehavior {
  userId: number;
  totalSwipes: number;
  swipeRight: number;
  swipeLeft: number;
  swipeUp: number;
  matchRate: number;
  avgResponseTime: number;
  lastSwipeAt: string;
  updatedAt: string;
}

export interface PreferenceProfile {
  userId: number;
  // Travel preferences
  preferredDestinations: string[];
  preferredTravelStyles: string[];
  preferredBudgetMin: number;
  preferredBudgetMax: number;
  preferredTripDuration: { min: number; max: number };
  
  // User preferences
  preferredAgeRange: { min: number; max: number };
  preferredDistance: number;
  preferredInterests: string[];
  
  // Engagement patterns
  activeHours: number[];
  preferredSessionLength: number;
  notificationResponseRate: number;
  
  updatedAt: string;
}

export interface MatchRanking {
  userId: number;
  targetUserId: number;
  compatibilityScore: number;
  behavioralScore: number;
  preferenceScore: number;
  finalScore: number;
  factors: {
    travelCompatibility: number;
    interestOverlap: number;
    activityMatch: number;
    recencyScore: number;
  };
  updatedAt: string;
}

export interface BehavioralProfile {
  userId: number;
  swipeBehavior: SwipeBehavior;
  preferenceProfile: PreferenceProfile;
  matchRankings: MatchRanking[];
  engagementLevel: 'low' | 'medium' | 'high' | 'addicted';
  streakData: {
    currentStreak: number;
    bestStreak: number;
    lastActiveAt: string;
  };
  lastSyncedAt: string;
}

// ============== CONSTANTS ==============

const BEHAVIORAL_PROFILE_KEY = 'behavioral:profile';
const SWIPE_QUEUE_KEY = 'behavioral:swipeQueue';
const PREFERENCE_QUEUE_KEY = 'behavioral:preferenceQueue';
const SYNC_INTERVAL_MS = 60000; // 1 minute

// ============== MAIN SERVICE ==============

class BehavioralPersistenceService {
  private localProfile: BehavioralProfile | null = null;
  private isInitialized = false;
  private userId: number | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSwipes: any[] = [];
  private pendingPreferences: any[] = [];

  // ============== INITIALIZATION ==============

  async init(userId: number): Promise<void> {
    this.userId = userId;
    this.isInitialized = true;

    // Load local profile
    await this.loadLocalProfile();

    // Start sync timer
    this.startSyncTimer();

    console.log('[Behavioral] Persistence service initialized');
  }

  private startSyncTimer() {
    this.stopSyncTimer();
    this.syncTimer = setInterval(() => {
      this.syncWithBackend();
    }, SYNC_INTERVAL_MS);
  }

  private stopSyncTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ============== SWIPE BEHAVIOR ==============

  /**
   * Record a swipe action locally and queue for backend sync
   */
  async recordSwipe(
    direction: 'left' | 'right' | 'up',
    targetUserId: number,
    targetType: 'user' | 'trip',
    metadata?: Record<string, any>
  ): Promise<void> {
    const swipeRecord = {
      direction,
      target_user_id: targetUserId,
      target_type: targetType,
      metadata,
      timestamp: new Date().toISOString(),
    };

    // Add to pending queue
    this.pendingSwipes.push(swipeRecord);
    await this.persistSwipeQueue();

    // Update local profile
    this.updateLocalSwipeStats(direction);

    // Try immediate sync if online
    this.tryImmediateSync();
  }

  private updateLocalSwipeStats(direction: 'left' | 'right' | 'up') {
    if (!this.localProfile) {
      this.initLocalProfile();
    }

    const behavior = this.localProfile!.swipeBehavior;
    behavior.totalSwipes += 1;
    behavior.lastSwipeAt = new Date().toISOString();

    switch (direction) {
      case 'right':
        behavior.swipeRight += 1;
        break;
      case 'left':
        behavior.swipeLeft += 1;
        break;
      case 'up':
        behavior.swipeUp += 1;
        break;
    }

    // Update match rate
    if (behavior.totalSwipes > 0) {
      behavior.matchRate = behavior.swipeRight / behavior.totalSwipes;
    }

    this.persistLocalProfile();
  }

  /**
   * Get swipe behavior stats
   */
  getSwipeBehavior(): SwipeBehavior | null {
    return this.localProfile?.swipeBehavior || null;
  }

  // ============== PREFERENCE PROFILING ==============

  /**
   * Update preference from user actions
   */
  async updatePreference(
    preferenceType: string,
    value: any
  ): Promise<void> {
    if (!this.localProfile) {
      this.initLocalProfile();
    }

    const prefs = this.localProfile!.preferenceProfile;

    switch (preferenceType) {
      case 'destination':
        if (!prefs.preferredDestinations.includes(value)) {
          prefs.preferredDestinations.push(value);
        }
        break;
      case 'travel_style':
        if (!prefs.preferredTravelStyles.includes(value)) {
          prefs.preferredTravelStyles.push(value);
        }
        break;
      case 'budget':
        prefs.preferredBudgetMin = value.min;
        prefs.preferredBudgetMax = value.max;
        break;
      case 'age_range':
        prefs.preferredAgeRange = value;
        break;
      case 'interests':
        value.forEach((interest: string) => {
          if (!prefs.preferredInterests.includes(interest)) {
            prefs.preferredInterests.push(interest);
          }
        });
        break;
      case 'active_hours':
        if (!prefs.activeHours.includes(value)) {
          prefs.activeHours.push(value);
        }
        break;
    }

    prefs.updatedAt = new Date().toISOString();

    // Queue for sync
    this.pendingPreferences.push({
      type: preferenceType,
      value,
      timestamp: prefs.updatedAt,
    });
    await this.persistPreferenceQueue();

    this.persistLocalProfile();
  }

  /**
   * Get preference profile
   */
  getPreferenceProfile(): PreferenceProfile | null {
    return this.localProfile?.preferenceProfile || null;
  }

  // ============== MATCH RANKING ==============

  /**
   * Get or create match ranking for a target user
   */
  async getMatchRanking(targetUserId: number): Promise<MatchRanking> {
    // Check local cache first
    const cached = this.localProfile?.matchRankings.find(
      (r) => r.targetUserId === targetUserId
    );

    if (cached) {
      // Check if still fresh (within 5 minutes)
      const age = Date.now() - new Date(cached.updatedAt).getTime();
      if (age < 5 * 60 * 1000) {
        return cached;
      }
    }

    // Fetch from backend
    try {
      const response = await api.get(`/behavior/ranking/${targetUserId}`);
      const ranking = getApiData<MatchRanking>(response);

      // Update local cache
      if (this.localProfile) {
        const index = this.localProfile.matchRankings.findIndex(
          (r) => r.targetUserId === targetUserId
        );
        if (index >= 0) {
          this.localProfile.matchRankings[index] = ranking;
        } else {
          this.localProfile.matchRankings.push(ranking);
        }
        this.persistLocalProfile();
      }

      return ranking;
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'getMatchRanking');
      
      // Return cached or default
      return cached || this.createDefaultRanking(targetUserId);
    }
  }

  private createDefaultRanking(targetUserId: number): MatchRanking {
    return {
      userId: this.userId || 0,
      targetUserId,
      compatibilityScore: 0.5,
      behavioralScore: 0.5,
      preferenceScore: 0.5,
      finalScore: 0.5,
      factors: {
        travelCompatibility: 0.5,
        interestOverlap: 0.5,
        activityMatch: 0.5,
        recencyScore: 0.5,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Request batch rankings for multiple users
   */
  async getBatchRankings(targetUserIds: number[]): Promise<MatchRanking[]> {
    try {
      const response = await api.post('/behavior/ranking/batch', {
        target_user_ids: targetUserIds,
      });
      return getApiData<MatchRanking[]>(response) || [];
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'getBatchRankings');
      return targetUserIds.map((id) => this.createDefaultRanking(id));
    }
  }

  // ============== SYNC WITH BACKEND ==============

  private async syncWithBackend(): Promise<void> {
    if (!this.userId) return;

    try {
      // Sync swipe behavior
      if (this.pendingSwipes.length > 0) {
        await this.syncSwipeBehavior();
      }

      // Sync preferences
      if (this.pendingPreferences.length > 0) {
        await this.syncPreferences();
      }

      // Fetch latest profile from backend
      await this.fetchBackendProfile();

      console.log('[Behavioral] Synced with backend');
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'syncWithBackend');
    }
  }

  private async syncSwipeBehavior(): Promise<void> {
    const swipesToSync = [...this.pendingSwipes];
    
    try {
      await api.post('/behavior/swipes', {
        swipes: swipesToSync,
      });
      
      // Clear synced
      this.pendingSwipes = [];
      await this.persistSwipeQueue();
    } catch (error) {
      // Keep in queue for retry
      errorLogger.logAPIError(error as Error, 'syncSwipeBehavior');
    }
  }

  private async syncPreferences(): Promise<void> {
    const prefsToSync = [...this.pendingPreferences];
    
    try {
      await api.post('/behavior/preferences', {
        preferences: prefsToSync,
      });
      
      // Clear synced
      this.pendingPreferences = [];
      await this.persistPreferenceQueue();
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'syncPreferences');
    }
  }

  private async fetchBackendProfile(): Promise<void> {
    try {
      const response = await api.get('/behavior/profile');
      const profile = getApiData<BehavioralProfile>(response);
      
      if (profile) {
        // Merge with local (local takes precedence for pending data)
        this.localProfile = this.mergeProfiles(profile, this.localProfile);
        this.persistLocalProfile();
      }
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'fetchBackendProfile');
    }
  }

  private mergeProfiles(
    backend: BehavioralProfile,
    local: BehavioralProfile | null
  ): BehavioralProfile {
    if (!local) return backend;

    return {
      ...backend,
      swipeBehavior: local.swipeBehavior.totalSwipes > 0 
        ? local.swipeBehavior 
        : backend.swipeBehavior,
      preferenceProfile: local.preferenceProfile.preferredDestinations.length > 0
        ? local.preferenceProfile
        : backend.preferenceProfile,
      // Keep pending data
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private tryImmediateSync(): void {
    // Debounced - will be called by sync timer
  }

  // ============== LOCAL STORAGE ==============

  private initLocalProfile() {
    this.localProfile = {
      userId: this.userId || 0,
      swipeBehavior: {
        userId: this.userId || 0,
        totalSwipes: 0,
        swipeRight: 0,
        swipeLeft: 0,
        swipeUp: 0,
        matchRate: 0,
        avgResponseTime: 0,
        lastSwipeAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      preferenceProfile: {
        userId: this.userId || 0,
        preferredDestinations: [],
        preferredTravelStyles: [],
        preferredBudgetMin: 0,
        preferredBudgetMax: 10000,
        preferredTripDuration: { min: 3, max: 14 },
        preferredAgeRange: { min: 18, max: 50 },
        preferredDistance: 100,
        preferredInterests: [],
        activeHours: [],
        preferredSessionLength: 30,
        notificationResponseRate: 0,
        updatedAt: new Date().toISOString(),
      },
      matchRankings: [],
      engagementLevel: 'medium',
      streakData: {
        currentStreak: 0,
        bestStreak: 0,
        lastActiveAt: new Date().toISOString(),
      },
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private async loadLocalProfile(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(BEHAVIORAL_PROFILE_KEY);
      if (raw) {
        this.localProfile = JSON.parse(raw);
      } else {
        this.initLocalProfile();
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, BEHAVIORAL_PROFILE_KEY, 'loadLocalProfile');
      this.initLocalProfile();
    }
  }

  private async persistLocalProfile(): Promise<void> {
    try {
      await AsyncStorage.setItem(BEHAVIORAL_PROFILE_KEY, JSON.stringify(this.localProfile));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, BEHAVIORAL_PROFILE_KEY, 'persistLocalProfile');
    }
  }

  private async persistSwipeQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(SWIPE_QUEUE_KEY, JSON.stringify(this.pendingSwipes));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, SWIPE_QUEUE_KEY, 'persistSwipeQueue');
    }
  }

  private async persistPreferenceQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(PREFERENCE_QUEUE_KEY, JSON.stringify(this.pendingPreferences));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, PREFERENCE_QUEUE_KEY, 'persistPreferenceQueue');
    }
  }

  // ============== PUBLIC API ==============

  getProfile(): BehavioralProfile | null {
    return this.localProfile;
  }

  getEngagementLevel(): 'low' | 'medium' | 'high' | 'addicted' {
    return this.localProfile?.engagementLevel || 'medium';
  }

  async forceSync(): Promise<void> {
    await this.syncWithBackend();
  }

  async clearLocalData(): Promise<void> {
    this.localProfile = null;
    this.pendingSwipes = [];
    this.pendingPreferences = [];
    
    await Promise.all([
      AsyncStorage.removeItem(BEHAVIORAL_PROFILE_KEY),
      AsyncStorage.removeItem(SWIPE_QUEUE_KEY),
      AsyncStorage.removeItem(PREFERENCE_QUEUE_KEY),
    ]);
  }

  async end(): Promise<void> {
    this.stopSyncTimer();
    await this.syncWithBackend();
    this.isInitialized = false;
  }
}

// Export singleton
export const behavioralPersistence = new BehavioralPersistenceService();
export default behavioralPersistence;

// Export types
export type { SwipeBehavior, PreferenceProfile, MatchRanking, BehavioralProfile };