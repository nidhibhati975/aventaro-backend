/**
 * Viral Loop Enhancement System
 * 
 * Behavioral Design: Maximize organic growth through psychology
 * 
 * Enhancement Areas:
 * 1. Referral Psychology - Social currency, not just rewards
 * 2. Reward Visibility - Show what's achievable
 * 3. Social Sharing Hooks - Capture moments worth sharing
 * 4. Invite Urgency - Limited-time referral bonuses
 * 5. Status Signaling - Show off referral rank
 */

import { Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ViralReward {
  id: string;
  name: string;
  description: string;
  requiredReferrals: number;
  icon: string;
  isPremium: boolean;
}

export interface ReferralStatus {
  code: string;
  totalReferrals: number;
  pendingReferrals: number;
  claimedRewards: string[];
  rank: number;
  nextReward: ViralReward | null;
}

export interface ShareMoment {
  type: 'match' | 'trip_join' | 'achievement' | 'streak';
  title: string;
  message: string;
  deepLink: string;
  shouldShare: boolean;
}

const VIRAL_REWARDS: ViralReward[] = [
  { id: 'boost_3', name: 'Profile Boost', description: 'Get 3x more views', requiredReferrals: 3, icon: '🚀', isPremium: false },
  { id: 'premium_1m', name: '1 Month Premium', description: 'Unlock all features', requiredReferrals: 5, icon: '⭐', isPremium: true },
  { id: 'credit_25', name: '$25 Travel Credit', description: 'Use on any booking', requiredReferrals: 10, icon: '💰', isPremium: false },
  { id: 'credit_50', name: '$50 Travel Credit', description: 'Double your credit', requiredReferrals: 20, icon: '💵', isPremium: false },
  { id: 'lifetime_premium', name: 'Lifetime Premium', description: 'Forever premium', requiredReferrals: 50, icon: '👑', isPremium: true },
];

export class ViralLoopEnhancement {
  private referralCode: string = '';
  private status: ReferralStatus | null = null;

  constructor() {
    this.loadStatus();
  }

  private async loadStatus() {
    try {
      const stored = await AsyncStorage.getItem('referral:status');
      if (stored) {
        this.status = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load referral status:', e);
    }
  }

  private async saveStatus() {
    try {
      if (this.status) {
        await AsyncStorage.setItem('referral:status', JSON.stringify(this.status));
      }
    } catch (e) {
      console.error('Failed to save referral status:', e);
    }
  }

  /**
   * Get user's referral status with progress
   */
  async getReferralStatus(): Promise<ReferralStatus> {
    if (this.status) return this.status;

    // Default status
    this.status = {
      code: this.generateReferralCode(),
      totalReferrals: 0,
      pendingReferrals: 0,
      claimedRewards: [],
      rank: 0,
      nextReward: VIRAL_REWARDS[0],
    };

    await this.saveStatus();
    return this.status;
  }

  /**
   * Generate a memorable referral code
   */
  private generateReferralCode(): string {
    const adjectives = ['Travel', 'Wander', 'Explore', 'Adventure', 'Journey'];
    const nouns = ['Soul', 'Seeker', 'Explorer', 'Nomad', 'Star'];
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    
    return `${adj}${noun}${num}`;
  }

  /**
   * Get available rewards with progress
   */
  getRewardsWithProgress(currentReferrals: number): Array<ViralReward & { progress: number; isNext: boolean }> {
    return VIRAL_REWARDS.map((reward, index) => {
      const isNext = reward.requiredReferrals > currentReferrals && 
        (index === 0 || VIRAL_REWARDS[index - 1].requiredReferrals <= currentReferrals);
      
      const progress = Math.min(1, currentReferrals / reward.requiredReferrals);

      return {
        ...reward,
        progress,
        isNext,
      };
    });
  }

  /**
   * Get the next achievable reward
   */
  getNextReward(currentReferrals: number): ViralReward | null {
    for (const reward of VIRAL_REWARDS) {
      if (reward.requiredReferrals > currentReferrals) {
        return reward;
      }
    }
    return null;
  }

  /**
   * Calculate progress to next reward
   */
  getProgressToNextReward(currentReferrals: number): { current: number; needed: number; percentage: number } {
    const next = this.getNextReward(currentReferrals);
    if (!next) {
      return { current: currentReferrals, needed: 0, percentage: 100 };
    }

    const previous = VIRAL_REWARDS.find(r => r.requiredReferrals < next.requiredReferrals);
    const previousCount = previous?.requiredReferrals || 0;
    
    const needed = next.requiredReferrals - currentReferrals;
    const range = next.requiredReferrals - previousCount;
    const progress = currentReferrals - previousCount;

    return {
      current: progress,
      needed,
      percentage: Math.min(100, (progress / range) * 100),
    };
  }

  /**
   * Create a shareable moment (match, trip, achievement)
   */
  createShareMoment(
    type: ShareMoment['type'],
    data: { userName?: string; tripName?: string; streak?: number; achievement?: string }
  ): ShareMoment {
    const moments: Record<ShareMoment['type'], ShareMoment> = {
      match: {
        type: 'match',
        title: '💚 We Matched!',
        message: `I just matched with ${data.userName || 'someone awesome'} on Aventaro! Let's travel together 🌍✈️`,
        deepLink: `aventaro://match/${data.userName}`,
        shouldShare: true,
      },
      trip_join: {
        type: 'trip_join',
        title: '🎉 Joined a Trip!',
        message: `Just joined "${data.tripName || 'an adventure'}" on Aventaro! Who's coming with me?`,
        deepLink: `aventaro://trip/${data.tripName}`,
        shouldShare: true,
      },
      achievement: {
        type: 'achievement',
        title: '🏆 Achievement Unlocked!',
        message: `I just earned "${data.achievement || 'a cool badge'}" on Aventaro! Join me on my travel journey 🌟`,
        deepLink: 'aventaro://profile/achievements',
        shouldShare: true,
      },
      streak: {
        type: 'streak',
        title: '🔥 Streak Alert!',
        message: `${data.streak || 7} day streak on Aventaro! Who's ready to travel? 🌍`,
        deepLink: 'aventaro://streak',
        shouldShare: true,
      },
    };

    return moments[type];
  }

  /**
   * Share a moment to social media
   */
  async shareMoment(moment: ShareMoment): Promise<boolean> {
    try {
      const result = await Share.share({
        message: `${moment.title}\n\n${moment.message}\n\nDownload Aventaro: https://aventaro.app`,
        title: moment.title,
      });

      return result.action === Share.sharedAction;
    } catch (e) {
      console.error('Failed to share:', e);
      return false;
    }
  }

  /**
   * Get referral link with UTM tracking
   */
  getReferralLink(platform?: string): string {
    const baseUrl = 'https://aventaro.app/invite';
    const code = this.referralCode || 'DEFAULT';
    
    const utmParams = new URLSearchParams({
      ref: code,
      source: platform || 'app',
    });

    return `${baseUrl}?${utmParams.toString()}`;
  }

  /**
   * Generate invite message for different platforms
   */
  getInviteMessage(platform: 'whatsapp' | 'sms' | 'email' | 'instagram'): string {
    const code = this.referralCode || 'YOURCODE';
    
    const messages = {
      whatsapp: `🌍 Join me on Aventaro - the app for finding travel buddies! Use my code ${code} for instant perks: https://aventaro.app/invite/${code}`,
      sms: `Join me on Aventaro! Use code ${code} to get started: https://aventaro.app/invite/${code} 🌍✈️`,
      email: `Hey!\n\nI've been using Aventaro to find travel buddies and it's amazing. Join me using my referral code "${code}" and we'll both get perks!\n\nDownload: https://aventaro.app/invite/${code}\n\nLet's travel together! 🌍`,
      instagram: `Travel buddies await! 🎒✈️ Use my link to join Aventaro: https://aventaro.app/invite/${code} #TravelMore`,
    };

    return messages[platform];
  }

  /**
   * Get social proof message for referral requests
   */
  getSocialProofMessage(): string {
    const messages = [
      '3 of my friends already joined!',
      'We\'re planning a trip - come with us!',
      'You\'ll love the matching system 🔥',
      'Best travel app I\'ve used!',
      'We need one more person for our trip!',
    ];

    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Calculate viral coefficient (k-factor)
   * k > 1 means exponential growth
   */
  calculateViralCoefficient(invitesSent: number, conversions: number): number {
    if (invitesSent === 0) return 0;
    return conversions / invitesSent;
  }

  /**
   * Get rank title based on referrals
   */
  getRankTitle(referrals: number): string {
    if (referrals >= 50) return 'Travel Ambassador 👑';
    if (referrals >= 20) return 'Explorer Elite ⭐';
    if (referrals >= 10) return 'Adventure Guide 🌍';
    if (referrals >= 5) return 'Travel Scout 🎯';
    if (referrals >= 1) return 'New Traveler 🚀';
    return 'Just Starting 👋';
  }

  /**
   * Show urgency for limited-time referral bonus
   */
  getUrgencyBonus(): { isActive: boolean; bonus: string; endsAt?: number } {
    // Simulate limited-time offers
    const isActive = Math.random() < 0.3;
    
    if (isActive) {
      const bonuses = [
        '2x referral credits this week!',
        'Bonus: Get $10 extra credit!',
        'Limited: Double rewards until Sunday!',
      ];
      
      return {
        isActive: true,
        bonus: bonuses[Math.floor(Math.random() * bonuses.length)],
        endsAt: Date.now() + 3 * 24 * 60 * 60 * 1000, // 3 days
      };
    }

    return { isActive: false, bonus: '' };
  }
}

// Singleton
let viralInstance: ViralLoopEnhancement | null = null;

export const getViralLoop = (): ViralLoopEnhancement => {
  if (!viralInstance) {
    viralInstance = new ViralLoopEnhancement();
  }
  return viralInstance;
};

export default ViralLoopEnhancement;