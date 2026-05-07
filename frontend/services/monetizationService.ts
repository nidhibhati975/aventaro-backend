/**
 * Monetization Service
 * 
 * Frontend service for:
 * - Subscription management
 * - Boost purchases
 * - Rewards/coins system
 * - Payment integration
 */

import api, { getApiData } from './api';

const productionAnalytics = {
  track: (_event: string, _properties?: Record<string, unknown>) => undefined,
};

// ============== TYPES ==============

export interface Plan {
  plan_type: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  features: string[];
}

export interface SubscriptionStatus {
  subscription: {
    user_id: number;
    plan_type: string;
    status: string;
    current_period_end: string | null;
    is_premium: boolean;
  };
  plan: Plan;
}

export interface Boost {
  boost_type: string;
  name: string;
  price: number;
  duration_minutes: number;
  description: string;
  max_per_day?: number;
  max_per_week?: number;
}

export interface ActiveBoost {
  id: number;
  boost_type: string;
  config: Boost;
  expires_at: string;
  remaining_minutes: number;
}

export interface BoostPurchase {
  purchase_id: number;
  boost_type: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RewardBalance {
  coins: number;
  lifetime_coins: number;
  updated_at: string;
}

export interface RewardAction {
  action_type: string;
  coins: number;
  max_per_day: number;
  description: string;
}

export interface RewardClaimResult {
  success: boolean;
  coins_earned?: number;
  new_balance?: number;
  action?: string;
  error?: string;
}

export interface Transaction {
  id: number;
  transaction_type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

export interface FeatureLimit {
  feature: string;
  limit: number;
  current_usage: number;
  remaining: number;
  is_unlimited: boolean;
  upgrade_required: boolean;
}

export interface UpgradePrompt {
  show_upgrade: boolean;
  feature: string;
  message: string;
  plans: { type: string; price: number }[];
}

// ============== SERVICE ==============

class MonetizationService {
  // ============== PLANS ==============

  /**
   * Get all available subscription plans
   */
  async getPlans(): Promise<Plan[]> {
    try {
      const response = await api.get('/monetization/plans');
      return getApiData<Plan[]>(response) || [];
    } catch (error) {
      console.error('[Monetization] Failed to get plans:', error);
      return [];
    }
  }

  /**
   * Get current user's subscription status
   */
  async getSubscriptionStatus(): Promise<SubscriptionStatus | null> {
    try {
      const response = await api.get('/monetization/subscription/status');
      return getApiData<SubscriptionStatus>(response);
    } catch (error) {
      console.error('[Monetization] Failed to get subscription status:', error);
      return null;
    }
  }

  /**
   * Get price for a specific plan
   */
  async getPlanPrice(planType: string, billingCycle: string = 'monthly'): Promise<{
    plan_type: string;
    billing_cycle: string;
    price: number;
    currency: string;
  } | null> {
    try {
      const response = await api.get(`/monetization/subscription/price/${planType}?billing_cycle=${billingCycle}`);
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to get plan price:', error);
      return null;
    }
  }

  // ============== BOOSTS ==============

  /**
   * Get all available boosts
   */
  async getBoosts(): Promise<Boost[]> {
    try {
      const response = await api.get('/monetization/boosts');
      return getApiData<Boost[]>(response) || [];
    } catch (error) {
      console.error('[Monetization] Failed to get boosts:', error);
      return [];
    }
  }

  /**
   * Get user's active boosts
   */
  async getActiveBoosts(): Promise<ActiveBoost[]> {
    try {
      const response = await api.get('/monetization/boosts/active');
      return getApiData<ActiveBoost[]>(response) || [];
    } catch (error) {
      console.error('[Monetization] Failed to get active boosts:', error);
      return [];
    }
  }

  /**
   * Purchase a boost (coins or razorpay)
   */
  async purchaseBoost(boostType: string, useCoins: boolean = false): Promise<BoostPurchase | null> {
    try {
      const response = await api.post('/monetization/boosts/purchase', {
        boost_type: boostType,
        use_coins: useCoins,
      });
      const result = getApiData<BoostPurchase>(response);
      
      // Track purchase
      productionAnalytics.track('boost_purchased', {
        boost_type: boostType,
        use_coins: useCoins,
        amount: result?.amount,
      });
      
      return result;
    } catch (error) {
      console.error('[Monetization] Failed to purchase boost:', error);
      return null;
    }
  }

  /**
   * Create Razorpay order for boost
   */
  async createBoostOrder(boostType: string, amount?: number): Promise<{
    order_id: string;
    amount: number;
    currency: string;
    checkout_url: string | null;
  } | null> {
    try {
      const response = await api.post('/monetization/boosts/create-order', {
        boost_type: boostType,
        amount,
      });
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to create boost order:', error);
      return null;
    }
  }

  /**
   * Verify Razorpay payment and activate boost
   */
  async verifyBoostPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    boostType?: string
  ): Promise<{ success: boolean; message: string; boost_id: number | null }> {
    try {
      const response = await api.post('/monetization/boosts/verify', {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
        boost_type: boostType,
      });
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to verify payment:', error);
      return { success: false, message: 'Payment verification failed', boost_id: null };
    }
  }

  /**
   * Activate an existing boost
   */
  async activateBoost(boostType: string): Promise<{ boost_id: number; boost_type: string; expires_at: string } | null> {
    try {
      const response = await api.post(`/monetization/boosts/activate/${boostType}`);
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to activate boost:', error);
      return null;
    }
  }

  // ============== REWARDS ==============

  /**
   * Get user's coin balance
   */
  async getRewardBalance(): Promise<RewardBalance | null> {
    try {
      const response = await api.get('/monetization/rewards/balance');
      return getApiData<RewardBalance>(response);
    } catch (error) {
      console.error('[Monetization] Failed to get balance:', error);
      return null;
    }
  }

  /**
   * Get all available reward actions
   */
  async getRewardActions(): Promise<RewardAction[]> {
    try {
      const response = await api.get('/monetization/rewards/actions');
      return getApiData<RewardAction[]>(response) || [];
    } catch (error) {
      console.error('[Monetization] Failed to get reward actions:', error);
      return [];
    }
  }

  /**
   * Claim reward for an action
   */
  async claimReward(actionType: string): Promise<RewardClaimResult> {
    try {
      const response = await api.post('/monetization/rewards/claim', {
        action_type: actionType,
      });
      const result = getApiData<RewardClaimResult>(response);
      
      if (result?.success) {
        productionAnalytics.track('reward_claimed', {
          action_type: actionType,
          coins: result.coins_earned,
        });
      }
      
      return result || { success: false, error: 'Failed to claim reward' };
    } catch (error) {
      console.error('[Monetization] Failed to claim reward:', error);
      return { success: false, error: 'Failed to claim reward' };
    }
  }

  /**
   * Spend coins
   */
  async spendCoins(amount: number, description?: string): Promise<Transaction | null> {
    try {
      const response = await api.post('/monetization/rewards/spend', {
        amount,
        description,
      });
      const result = getApiData<Transaction>(response);
      
      if (result) {
        productionAnalytics.track('coins_spent', {
          amount,
          description,
        });
      }
      
      return result;
    } catch (error) {
      console.error('[Monetization] Failed to spend coins:', error);
      return null;
    }
  }

  /**
   * Get transaction history
   */
  async getTransactions(limit: number = 50): Promise<Transaction[]> {
    try {
      const response = await api.get(`/monetization/rewards/transactions?limit=${limit}`);
      return getApiData<Transaction[]>(response) || [];
    } catch (error) {
      console.error('[Monetization] Failed to get transactions:', error);
      return [];
    }
  }

  /**
   * Convert coins to rupees or vice versa
   */
  async convertCoins(coins?: number, rupees?: number): Promise<{ coins: number; rupees: number } | null> {
    try {
      const response = await api.post('/monetization/rewards/convert', {
        coins,
        rupees,
      });
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to convert:', error);
      return null;
    }
  }

  // ============== FEATURE LIMITS ==============

  /**
   * Check user's feature limits
   */
  async checkFeatureLimits(): Promise<Record<string, FeatureLimit> | null> {
    try {
      const response = await api.get('/monetization/limits/check');
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to check limits:', error);
      return null;
    }
  }

  /**
   * Trigger upgrade prompt
   */
  async triggerUpgradePrompt(feature: string): Promise<UpgradePrompt | null> {
    try {
      const response = await api.post(`/monetization/limits/upgrade-prompt?feature=${feature}`);
      return getApiData(response);
    } catch (error) {
      console.error('[Monetization] Failed to trigger upgrade prompt:', error);
      return null;
    }
  }

  // ============== HELPERS ==============

  /**
   * Check if user can use a feature
   */
  async canUseFeature(feature: string): Promise<boolean> {
    const limits = await this.checkFeatureLimits();
    if (!limits) return true;
    
    const limit = limits[feature];
    if (!limit) return true;
    
    if (limit.is_unlimited) return true;
    if (limit.upgrade_required) return false;
    return limit.remaining > 0;
  }

  /**
   * Get upgrade prompt if needed
   */
  async getUpgradePromptIfNeeded(feature: string): Promise<UpgradePrompt | null> {
    const canUse = await this.canUseFeature(feature);
    if (canUse) return null;
    
    return this.triggerUpgradePrompt(feature);
  }
}

// Export singleton
export const monetizationService = new MonetizationService();
export default monetizationService;

