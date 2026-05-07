/**
 * Viral Loop Hook
 * 
 * Features:
 * - Referral code generation
 * - Share moments
 * - Reward tracking
 * - Deep link handling
 * - Social sharing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Share, Linking, Platform } from 'react-native';
import { viralLoopEnhancement } from '../services/behavioral/viralLoopEnhancement';
import { analyticsService } from '../services/analyticsService';

// Referral data
export interface ReferralData {
  code: string;
  totalReferrals: number;
  successfulReferrals: number;
  rewardsEarned: number;
  rewardLevel: number;
  nextRewardAt: number;
  shareUrl: string;
}

// Share moment data
export interface ShareMoment {
  id: string;
  type: 'match' | 'streak' | 'trip' | 'achievement';
  title: string;
  description: string;
  imageUrl?: string;
  deepLink: string;
  createdAt: Date;
}

// Reward tiers
export interface RewardTier {
  level: number;
  referralsRequired: number;
  reward: string;
  rewardValue: number;
}

// Hook for viral features
export function useViralLoop() {
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [shareMoments, setShareMoments] = useState<ShareMoment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const viralEngine = useRef(viralLoopEnhancement);

  // Load referral data
  const loadReferralData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await viralEngine.current.getReferralData();
      setReferralData(data);
    } catch (error) {
      console.error('Failed to load referral data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Generate referral code
  const generateReferralCode = useCallback(async (): Promise<string> => {
    const code = await viralEngine.current.generateReferralCode();
    return code;
  }, []);

  // Share referral link
  const shareReferralLink = useCallback(async (message?: string) => {
    if (!referralData) {
      await loadReferralData();
    }

    const defaultMessage = `Join me on Aventaro - the social travel app! Use my referral code ${referralData?.code} to get bonus points. Download: ${referralData?.shareUrl}`;

    try {
      const result = await Share.share({
        message: message || defaultMessage,
        title: 'Invite Friends',
        url: referralData?.shareUrl,
      });

      // Track share
      analyticsService.trackEvent('share', {
        type: 'referral',
        platform: Platform.OS,
      });

      return result;
    } catch (error) {
      console.error('Failed to share:', error);
      throw error;
    }
  }, [referralData, loadReferralData]);

  // Create share moment
  const createShareMoment = useCallback(async (
    type: ShareMoment['type'],
    data: Record<string, any>
  ): Promise<ShareMoment> => {
    const moment = await viralEngine.current.createShareMoment(type, data);
    setShareMoments(prev => [moment, ...prev]);
    
    // Track creation
    analyticsService.trackEvent('share', {
      type,
      momentId: moment.id,
    });

    return moment;
  }, []);

  // Share a moment
  const shareMoment = useCallback(async (moment: ShareMoment, message?: string) => {
    try {
      const result = await Share.share({
        message: message || `${moment.title}\n\n${moment.description}\n\n${moment.deepLink}`,
        title: moment.title,
        url: moment.imageUrl,
      });

      analyticsService.trackEvent('share', {
        type: moment.type,
        momentId: moment.id,
        platform: Platform.OS,
      });

      return result;
    } catch (error) {
      console.error('Failed to share moment:', error);
      throw error;
    }
  }, []);

  // Get reward status
  const getRewardStatus = useCallback(async () => {
    return viralEngine.current.getRewardStatus();
  }, []);

  // Claim reward
  const claimReward = useCallback(async (level: number): Promise<boolean> => {
    const success = await viralEngine.current.claimReward(level);
    if (success) {
      await loadReferralData();
    }
    return success;
  }, [loadReferralData]);

  // Handle deep link
  const handleDeepLink = useCallback((url: string) => {
    // Parse the deep link
    const parsed = viralEngine.current.parseDeepLink(url);
    
    if (parsed) {
      // Track referral click
      analyticsService.trackEvent('referral_click', {
        referrerId: parsed.referrerId,
        campaign: parsed.campaign,
      });

      return parsed;
    }
    return null;
  }, []);

  // Get shareable achievements
  const getShareableAchievements = useCallback(async () => {
    return viralEngine.current.getShareableAchievements();
  }, []);

  // Initial load
  useEffect(() => {
    loadReferralData();
  }, [loadReferralData]);

  return {
    referralData,
    shareMoments,
    isLoading,
    generateReferralCode,
    shareReferralLink,
    createShareMoment,
    shareMoment,
    getRewardStatus,
    claimReward,
    handleDeepLink,
    getShareableAchievements,
    loadReferralData,
  };
}

// Hook for deep link handling
export function useDeepLink() {
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  const [isHandling, setIsHandling] = useState(false);

  // Handle incoming deep link
  const handleDeepLink = useCallback((url: string) => {
    setIsHandling(true);
    setPendingDeepLink(url);
    
    // Parse URL
    const parsed = parseDeepLink(url);
    
    setIsHandling(false);
    return parsed;
  }, []);

  // Clear pending deep link
  const clearDeepLink = useCallback(() => {
    setPendingDeepLink(null);
  }, []);

  // Get initial URL (app was launched from link)
  const getInitialURL = useCallback(async (): Promise<string | null> => {
    // In production, get from Linking API
    const initialURL = await Linking.getInitialURL();
    return initialURL;
  }, []);

  // Add listener for future links
  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  return {
    pendingDeepLink,
    isHandling,
    handleDeepLink,
    clearDeepLink,
    getInitialURL,
  };
}

// Helper to parse deep links
function parseDeepLink(url: string): { screen: string; params: Record<string, any> } | null {
  try {
    // Format: aventaro://screen?param=value
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '');
    const params = Object.fromEntries(parsed.searchParams);

    // Map to screen
    switch (path) {
      case 'referral':
        return { screen: 'Referral', params };
      case 'trip':
        return { screen: 'TripDetail', params: { tripId: params.id } };
      case 'profile':
        return { screen: 'Profile', params: { userId: params.id } };
      case 'chat':
        return { screen: 'Chat', params: { conversationId: params.id } };
      case 'match':
        return { screen: 'Match', params: { userId: params.id } };
      default:
        return { screen: 'Home', params };
    }
  } catch (error) {
    console.error('Failed to parse deep link:', error);
    return null;
  }
}

// Share templates
export const ShareTemplates = {
  referral: (code: string, bonus: number) => ({
    title: 'Join me on Aventaro!',
    message: `Use my referral code ${code} to get ${bonus} bonus points when you sign up! Download: https://aventaro.app/ref/${code}`,
  }),

  match: (partnerName: string) => ({
    title: 'We matched! 💕',
    message: `I just matched with ${partnerName} on Aventaro! Join me and find your travel buddy. https://aventaro.app/`,
  }),

  streak: (days: number) => ({
    title: `${days} day streak! 🔥`,
    message: `I'm on a ${days} day streak on Aventaro! Join me and let's keep the fire going. https://aventaro.app/`,
  }),

  trip: (tripName: string, destination: string) => ({
    title: `Join my trip to ${destination}!`,
    message: `I'm planning a trip to ${destination} - "${tripName}" on Aventaro. Join me! https://aventaro.app/trip/`,
  }),

  achievement: (achievement: string) => ({
    title: `I earned: ${achievement} 🏆`,
    message: `Just achieved "${achievement}" on Aventaro! Join me on this journey. https://aventaro.app/`,
  }),
};

export default {
  useViralLoop,
  useDeepLink,
  ShareTemplates,
};