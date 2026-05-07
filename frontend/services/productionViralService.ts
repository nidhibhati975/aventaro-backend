/**
 * Production Viral System Service
 * 
 * Real implementation:
 * - Deep linking (invite links)
 * - Referral attribution (who invited whom)
 * - Reward validation from backend
 * - Prevent fraud (duplicate invites)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Linking } from 'react-native';
import api, { extractErrorMessage, getApiData } from './api';
import { errorLogger } from './errorLogger';
import { productionAnalytics } from './productionAnalyticsService';

// ============== TYPES ==============

export interface ReferralCode {
  code: string;
  userId: number;
  createdAt: string;
  usageCount: number;
  rewardTier: number;
  isActive: boolean;
}

export interface Referral {
  id: number;
  referrerId: number;
  refereeId: number;
  referralCode: string;
  status: 'pending' | 'completed' | 'rewarded' | 'rejected' | 'fraudulent';
  rewardedAt?: string;
  rewardAmount?: number;
  createdAt: string;
}

export interface ReferralStats {
  totalReferrals: number;
  successfulReferrals: number;
  pendingReferrals: number;
  totalRewards: number;
  currentTier: number;
  nextTierAt: number;
  referralCode: string;
}

export interface RewardTier {
  tier: number;
  referralsRequired: number;
  rewardName: string;
  rewardValue: number;
  rewardType: 'points' | 'premium' | 'credits';
}

export interface DeepLinkData {
  type: 'referral' | 'trip' | 'profile' | 'chat' | 'promotion';
  referrerId?: number;
  referralCode?: string;
  tripId?: number;
  userId?: number;
  conversationId?: string;
  promotionId?: string;
  params?: Record<string, any>;
}

// ============== CONSTANTS ==============

const REFERRAL_CODE_KEY = 'viral:referralCode';
const REFERRAL_DATA_KEY = 'viral:referralData';
const DEEP_LINK_QUEUE_KEY = 'viral:deepLinkQueue';
const PENDING_REWARDS_KEY = 'viral:pendingRewards';

const REWARD_TIERS: RewardTier[] = [
  { tier: 1, referralsRequired: 3, rewardName: 'Welcome Bonus', rewardValue: 100, rewardType: 'points' },
  { tier: 2, referralsRequired: 5, rewardName: 'Silver Explorer', rewardValue: 250, rewardType: 'points' },
  { tier: 3, referralsRequired: 10, rewardName: 'Gold Traveler', rewardValue: 500, rewardType: 'points' },
  { tier: 4, referralsRequired: 20, rewardName: 'Platinum Adventurer', rewardValue: 1000, rewardType: 'points' },
  { tier: 5, referralsRequired: 50, rewardName: 'Diamond Voyager', rewardValue: 2500, rewardType: 'premium' },
];

// ============== MAIN SERVICE ==============

class ProductionViralService {
  private referralCode: string | null = null;
  private referralStats: ReferralStats | null = null;
  private isInitialized = false;
  private userId: number | null = null;
  private pendingDeepLinks: DeepLinkData[] = [];

  // ============== INITIALIZATION ==============

  async init(userId: number): Promise<void> {
    this.userId = userId;
    this.isInitialized = true;

    // Load local data
    await this.loadLocalData();

    // Fetch latest from backend
    await this.syncWithBackend();

    // Setup deep link handling
    this.setupDeepLinkListener();

    console.log('[Viral] Service initialized');
  }

  private setupDeepLinkListener() {
    // Listen for incoming deep links
    Linking.addEventListener('url', (event) => {
      if (event.url) {
        this.handleIncomingDeepLink(event.url);
      }
    });
  }

  // ============== REFERRAL CODE MANAGEMENT ==============

  /**
   * Get or generate referral code
   */
  async getReferralCode(): Promise<string> {
    if (this.referralCode) {
      return this.referralCode;
    }

    // Try to get from backend
    try {
      const response = await api.get('/referral/code');
      const data = getApiData<{ code: string }>(response);
      
      this.referralCode = data.code;
      await this.persistReferralCode(data.code);
      
      return data.code;
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'getReferralCode');
      
      // Generate local fallback
      this.referralCode = this.generateLocalReferralCode();
      return this.referralCode;
    }
  }

  private generateLocalReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Generate shareable referral link
   */
  async getReferralLink(customMessage?: string): Promise<string> {
    const code = await this.getReferralCode();
    const baseUrl = 'https://aventaro.app';
    
    // Build URL with params
    const params = new URLSearchParams({
      ref: code,
      ...(customMessage && { msg: customMessage }),
    });

    return `${baseUrl}/invite?${params.toString()}`;
  }

  /**
   * Share referral via native share
   */
  async shareReferral(options?: {
    message?: string;
    title?: string;
  }): Promise<boolean> {
    try {
      const link = await this.getReferralLink(options?.message);
      const message = options?.message || 
        `Join me on Aventaro! Use my referral code to get bonus points: ${this.referralCode}`;
      
      // Use React Native Share
      const { Share } = require('react-native');
      
      const result = await Share.share({
        message: `${message}\n\n${link}`,
        title: options?.title || 'Invite Friends',
        url: link,
      });

      // Track share
      productionAnalytics.trackShare('referral', this.referralCode || '');

      return result.action === Share.sharedAction;
    } catch (error) {
      errorLogger.logError(error, { source: 'shareReferral' });
      return false;
    }
  }

  // ============== REFERRAL ATTRIBUTION ==============

  /**
   * Process incoming referral (called when user signs up with code)
   */
  async processReferral(referralCode: string): Promise<Referral> {
    try {
      const response = await api.post('/referral/track', {
        referral_code: referralCode,
      });
      
      const referral = getApiData<Referral>(response);
      
      // Track event
      productionAnalytics.trackReferralUsed(referral.referrerId);

      return referral;
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'processReferral');
      throw new Error(extractErrorMessage(error, 'Failed to process referral'));
    }
  }

  /**
   * Validate referral code before use
   */
  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    referrerId?: number;
    rewardAvailable?: boolean;
    error?: string;
  }> {
    try {
      const response = await api.post('/referral/validate', {
        code,
      });
      
      return getApiData<any>(response);
    } catch (error) {
      // Check for known error codes
      const errorMsg = extractErrorMessage(error, 'Invalid referral code');
      
      return {
        valid: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Check if user was referred (for onboarding)
   */
  async checkReferralStatus(): Promise<{
    wasReferred: boolean;
    referrerId?: number;
    referralCode?: string;
  }> {
    try {
      const response = await api.get('/referral/status');
      return getApiData<any>(response);
    } catch {
      return { wasReferred: false };
    }
  }

  // ============== REWARD MANAGEMENT ==============

  /**
   * Get referral statistics
   */
  async getReferralStats(): Promise<ReferralStats> {
    if (this.referralStats) {
      return this.referralStats;
    }

    await this.syncWithBackend();
    return this.referralStats!;
  }

  /**
   * Get reward tiers
   */
  getRewardTiers(): RewardTier[] {
    return REWARD_TIERS;
  }

  /**
   * Get current tier info
   */
  getCurrentTier(): RewardTier | null {
    if (!this.referralStats) return null;
    
    return REWARD_TIERS.find((t) => t.tier === this.referralStats!.currentTier) || null;
  }

  /**
   * Get next tier info
   */
  getNextTier(): RewardTier | null {
    if (!this.referralStats) return null;
    
    const nextTier = this.referralStats.currentTier + 1;
    return REWARD_TIERS.find((t) => t.tier === nextTier) || null;
  }

  /**
   * Claim reward for tier
   */
  async claimReward(tier: number): Promise<{
    success: boolean;
    reward?: RewardTier;
    error?: string;
  }> {
    try {
      const response = await api.post('/referral/claim', {
        tier,
      });
      
      const result = getApiData<any>(response);
      
      if (result.success) {
        // Update local stats
        await this.syncWithBackend();
        
        return {
          success: true,
          reward: REWARD_TIERS.find((t) => t.tier === tier),
        };
      }
      
      return {
        success: false,
        error: result.error || 'Failed to claim reward',
      };
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'claimReward');
      return {
        success: false,
        error: extractErrorMessage(error, 'Failed to claim reward'),
      };
    }
  }

  /**
   * Check pending rewards
   */
  async checkPendingRewards(): Promise<RewardTier[]> {
    try {
      const response = await api.get('/referral/pending-rewards');
      return getApiData<RewardTier[]>(response) || [];
    } catch {
      return [];
    }
  }

  // ============== FRAUD PREVENTION ==============

  /**
   * Check for duplicate/fraudulent referral
   */
  async checkFraudPrevention(
    refereeId: number,
    referrerId: number,
    referralCode: string
  ): Promise<{
    isValid: boolean;
    reason?: string;
  }> {
    try {
      const response = await api.post('/referral/fraud-check', {
        referee_id: refereeId,
        referrer_id: referrerId,
        referral_code: referralCode,
      });
      
      return getApiData<any>(response);
    } catch {
      // Default to valid if check fails
      return { isValid: true };
    }
  }

  /**
   * Report suspicious activity
   */
  async reportSuspiciousActivity(
    type: 'duplicate' | 'self_referral' | 'fake_account' | 'other',
    details: Record<string, any>
  ): Promise<void> {
    try {
      await api.post('/referral/report', {
        type,
        details,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'reportSuspiciousActivity');
    }
  }

  // ============== DEEP LINK HANDLING ==============

  /**
   * Handle incoming deep link
   */
  async handleIncomingDeepLink(url: string): Promise<DeepLinkData | null> {
    try {
      const parsed = this.parseDeepLink(url);
      
      if (!parsed) {
        return null;
      }

      // Queue for processing
      this.pendingDeepLinks.push(parsed);
      await this.persistDeepLinkQueue();

      // Track deep link
      productionAnalytics.track('deep_link', {
        type: parsed.type,
        referrer_id: parsed.referrerId,
        trip_id: parsed.tripId,
      });

      // If referral, process it
      if (parsed.type === 'referral' && parsed.referrerId && parsed.referralCode) {
        await this.processReferral(parsed.referralCode);
      }

      return parsed;
    } catch (error) {
      errorLogger.logError(error, { source: 'handleIncomingDeepLink', url });
      return null;
    }
  }

  /**
   * Parse deep link URL
   */
  private parseDeepLink(url: string): DeepLinkData | null {
    try {
      // Handle different URL formats
      // 1. https://aventaro.app/invite?ref=CODE
      // 2. https://aventaro.app/trip/123
      // 3. aventaro://referral?ref=CODE
      
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname.replace(/^\/+/, '');
      const params = Object.fromEntries(parsedUrl.searchParams);

      // Check for referral
      if (params.ref || path.includes('invite') || path.includes('referral')) {
        return {
          type: 'referral',
          referrerId: params.referrer_id ? parseInt(params.referrer_id) : undefined,
          referralCode: params.ref || params.referral_code,
        };
      }

      // Check for trip
      if (path.includes('trip')) {
        const tripId = path.match(/\/(\d+)/)?.[1] || params.trip_id;
        return {
          type: 'trip',
          tripId: tripId ? parseInt(tripId) : undefined,
          params,
        };
      }

      // Check for profile
      if (path.includes('profile') || path.includes('user')) {
        const userId = path.match(/\/(\d+)/)?.[1] || params.user_id;
        return {
          type: 'profile',
          userId: userId ? parseInt(userId) : undefined,
          params,
        };
      }

      // Check for chat
      if (path.includes('chat')) {
        return {
          type: 'chat',
          conversationId: params.conversation_id,
          params,
        };
      }

      // Check for promotion
      if (path.includes('promo') || path.includes('offer')) {
        return {
          type: 'promotion',
          promotionId: params.promotion_id || params.id,
          params,
        };
      }

      return null;
    } catch (error) {
      errorLogger.logError(error, { source: 'parseDeepLink', url });
      return null;
    }
  }

  /**
   * Get pending deep links
   */
  async getPendingDeepLinks(): Promise<DeepLinkData[]> {
    if (this.pendingDeepLinks.length > 0) {
      return this.pendingDeepLinks;
    }

    try {
      const raw = await AsyncStorage.getItem(DEEP_LINK_QUEUE_KEY);
      if (raw) {
        this.pendingDeepLinks = JSON.parse(raw);
      }
    } catch {
      // Ignore
    }

    return this.pendingDeepLinks;
  }

  /**
   * Clear processed deep links
   */
  async clearProcessedDeepLinks(): Promise<void> {
    this.pendingDeepLinks = [];
    await AsyncStorage.removeItem(DEEP_LINK_QUEUE_KEY).catch(() => {});
  }

  // ============== SYNC WITH BACKEND ==============

  private async syncWithBackend(): Promise<void> {
    if (!this.userId) return;

    try {
      const response = await api.get('/referral/stats');
      this.referralStats = getApiData<ReferralStats>(response);
      
      await this.persistReferralData(this.referralStats);
    } catch (error) {
      errorLogger.logAPIError(error as Error, 'syncWithBackend');
    }
  }

  // ============== LOCAL STORAGE ==============

  private async loadLocalData(): Promise<void> {
    try {
      // Load referral code
      const codeRaw = await AsyncStorage.getItem(REFERRAL_CODE_KEY);
      if (codeRaw) {
        this.referralCode = codeRaw;
      }

      // Load referral data
      const dataRaw = await AsyncStorage.getItem(REFERRAL_DATA_KEY);
      if (dataRaw) {
        this.referralStats = JSON.parse(dataRaw);
      }

      // Load pending deep links
      const linkRaw = await AsyncStorage.getItem(DEEP_LINK_QUEUE_KEY);
      if (linkRaw) {
        this.pendingDeepLinks = JSON.parse(linkRaw);
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, REFERRAL_CODE_KEY, 'loadLocalData');
    }
  }

  private async persistReferralCode(code: string): Promise<void> {
    try {
      await AsyncStorage.setItem(REFERRAL_CODE_KEY, code);
    } catch (error) {
      errorLogger.logAsyncStorageError(error, REFERRAL_CODE_KEY, 'persistReferralCode');
    }
  }

  private async persistReferralData(data: ReferralStats): Promise<void> {
    try {
      await AsyncStorage.setItem(REFERRAL_DATA_KEY, JSON.stringify(data));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, REFERRAL_DATA_KEY, 'persistReferralData');
    }
  }

  private async persistDeepLinkQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(DEEP_LINK_QUEUE_KEY, JSON.stringify(this.pendingDeepLinks));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, DEEP_LINK_QUEUE_KEY, 'persistDeepLinkQueue');
    }
  }

  // ============== PUBLIC API ==============

  getShareUrl(): string {
    return `https://aventaro.app/invite?ref=${this.referralCode || ''}`;
  }

  async refreshStats(): Promise<void> {
    await this.syncWithBackend();
  }

  async clearLocalData(): Promise<void> {
    this.referralCode = null;
    this.referralStats = null;
    this.pendingDeepLinks = [];

    await Promise.all([
      AsyncStorage.removeItem(REFERRAL_CODE_KEY),
      AsyncStorage.removeItem(REFERRAL_DATA_KEY),
      AsyncStorage.removeItem(DEEP_LINK_QUEUE_KEY),
    ]);
  }

  async end(): Promise<void> {
    this.isInitialized = false;
  }
}

// Export singleton
export const productionViralService = new ProductionViralService();
export default productionViralService;

// Export types
export type { ReferralCode, Referral, ReferralStats, RewardTier, DeepLinkData };