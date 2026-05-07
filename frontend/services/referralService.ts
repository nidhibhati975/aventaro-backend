import api, { getApiData } from './api';

export interface ReferralData {
  referral_code: string;
  total_referrals: number;
  pending_referrals: number;
  rewards_earned: string[];
}

export interface ReferralReward {
  id: string;
  name: string;
  description: string;
  required_referrals: number;
  is_claimed: boolean;
}

class ReferralService {
  // Get user's referral code and stats
  async getReferralInfo(): Promise<ReferralData> {
    const response = await api.get('/user/referral');
    return getApiData<ReferralData>(response);
  }

  // Apply a referral code (when signing up)
  async applyReferralCode(code: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/user/referral/apply', { code });
    return getApiData(response);
  }

  // Get available rewards
  async getReferralRewards(): Promise<ReferralReward[]> {
    const response = await api.get('/user/referral/rewards');
    return getApiData<ReferralReward[]>(response) || [];
  }

  // Claim a reward
  async claimReward(rewardId: string): Promise<{ success: boolean; message: string }> {
    const response = await api.post('/user/referral/claim', { reward_id: rewardId });
    return getApiData(response);
  }

  // Generate shareable deep link
  generateDeepLink(referralCode: string): string {
    return `aventaro://invite/${referralCode}`;
  }

  // Generate share message for social
  generateShareMessage(referralCode: string): string {
    return `Join me on Aventaro! Use my referral code ${referralCode} to get started. Let's travel together! 🌍✈️`;
  }

  // Share to social platforms
  async shareToSocial(platform: 'instagram' | 'whatsapp' | 'sms' | 'email', referralCode: string) {
    const deepLink = this.generateDeepLink(referralCode);
    const message = this.generateShareMessage(referralCode);

    switch (platform) {
      case 'whatsapp':
        return `whatsapp://send?text=${encodeURIComponent(message + '\n' + deepLink)}`;
      case 'sms':
        return `sms:?body=${encodeURIComponent(message + '\n' + deepLink)}`;
      case 'email':
        return `mailto:?subject=Join me on Aventaro&body=${encodeURIComponent(message + '\n' + deepLink)}`;
      case 'instagram':
        // Instagram doesn't support direct sharing via URL scheme
        // Copy to clipboard for manual sharing
        return null;
      default:
        return null;
    }
  }
}

export const referralService = new ReferralService();
export default referralService;