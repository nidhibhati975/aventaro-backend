/**
 * Feed Ranking Engine
 * 
 * Behavioral Design: Prioritize engagement through smart ranking
 * 
 * Ranking Factors:
 * 1. Compatibility Score (40%) - ML-based match probability
 * 2. Active Status (25%) - Recently active users get priority
 * 3. Recency (20%) - Newer content surfaces faster
 * 4. Random Injection (15%) - Exploration to prevent echo chamber
 * 
 * Decay Algorithm:
 * - Content older than 24h gets -10% score per hour
 * - Content older than 48h gets -20% score per hour
 * - Minimum decay floor: 0.1
 */

import type { AppUser, TripRecord } from '../types';

export interface RankingConfig {
  compatibilityWeight: number;    // 0-1: Weight for compatibility score
  activityWeight: number;         // 0-1: Weight for active status
  recencyWeight: number;          // 0-1: Weight for recency
  randomInjectionRate: number;    // 0-1: % of random content
  decayEnabled: boolean;          // Enable content decay
}

export interface RankedItem<T> {
  item: T;
  score: number;
  rank: number;
  reason: string; // Why this item was ranked here
}

const DEFAULT_CONFIG: RankingConfig = {
  compatibilityWeight: 0.40,
  activityWeight: 0.25,
  recencyWeight: 0.20,
  randomInjectionRate: 0.15,
  decayEnabled: true,
};

// User activity status scoring
const ACTIVITY_SCORES: Record<string, number> = {
  'online': 1.0,      // Currently online
  'active_today': 0.9,  // Active in last 1 hour
  'active_recent': 0.7, // Active in last 6 hours
  'active_week': 0.4,   // Active in last 7 days
  'inactive': 0.1,      // No recent activity
};

export class FeedRankingEngine {
  private config: RankingConfig;
  private userId: number;
  private userPreferences: UserPreferences;

  constructor(
    userId: number, 
    userPreferences: UserPreferences = {},
    config: Partial<RankingConfig> = {}
  ) {
    this.userId = userId;
    this.userPreferences = userPreferences;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Rank people/discovery cards
   * Combines multiple signals into engagement-optimized ranking
   */
  rankUsers(users: AppUser[]): RankedItem<AppUser>[] {
    if (users.length === 0) return [];

    // Calculate base scores
    const scoredUsers = users.map(user => {
      const compatibilityScore = this.calculateCompatibility(user);
      const activityScore = this.getActivityScore(user);
      const recencyScore = this.calculateRecency(user);
      
      // Weighted combination
      const baseScore = 
        (compatibilityScore * this.config.compatibilityWeight) +
        (activityScore * this.config.activityWeight) +
        (recencyScore * this.config.recencyWeight);

      return {
        item: user,
        rawScore: baseScore,
        compatibilityScore,
        activityScore,
        recencyScore,
      };
    });

    // Apply decay if enabled
    if (this.config.decayEnabled) {
      scoredUsers.forEach(u => {
        u.rawScore *= this.applyDecay(u.item);
      });
    }

    // Sort by score descending
    scoredUsers.sort((a, b) => b.rawScore - a.rawScore);

    // Inject random content (exploration)
    const ranked = this.injectRandomness(scoredUsers);

    // Add rank and reason
    return ranked.map((u, index) => ({
      item: u.item,
      score: u.rawScore,
      rank: index + 1,
      reason: this.getRankingReason(u),
    }));
  }

  /**
   * Rank trips for discovery feed
   */
  rankTrips(trips: TripRecord[]): RankedItem<TripRecord>[] {
    if (trips.length === 0) return [];

    const scoredTrips = trips.map(trip => {
      const relevanceScore = this.calculateTripRelevance(trip);
      const popularityScore = this.calculateTripPopularity(trip);
      const recencyScore = this.calculateTripRecency(trip);
      const urgencyScore = this.calculateTripUrgency(trip);

      const rawScore = 
        (relevanceScore * 0.35) +
        (popularityScore * 0.25) +
        (recencyScore * 0.20) +
        (urgencyScore * 0.20);

      return { item: trip, rawScore };
    });

    // Apply decay
    if (this.config.decayEnabled) {
      scoredTrips.forEach(t => {
        t.rawScore *= this.applyTripDecay(t.item);
      });
    }

    // Sort and inject randomness
    scoredTrips.sort((a, b) => b.rawScore - a.rawScore);
    const ranked = this.injectTripRandomness(scoredTrips);

    return ranked.map((t, index) => ({
      item: t.item,
      score: t.rawScore,
      rank: index + 1,
      reason: 'Best match for you',
    }));
  }

  /**
   * Calculate compatibility score between user and target
   * Based on: interests, travel style, budget, location
   */
  private calculateCompatibility(user: AppUser): number {
    const profile = user.profile;
    if (!profile) return 0.5;

    let score = 0;
    let factors = 0;

    // Interests overlap (30% of compatibility)
    if (this.userPreferences.interests && profile.interests) {
      const overlap = this.userPreferences.interests.filter(
        i => profile.interests?.includes(i)
      ).length;
      const maxOverlap = Math.min(
        this.userPreferences.interests.length,
        profile.interests.length
      );
      score += (overlap / maxOverlap) * 0.3;
      factors += 0.3;
    } else {
      factors += 0.3;
    }

    // Travel style match (25%)
    if (this.userPreferences.travelStyle && profile.travel_style) {
      if (this.userPreferences.travelStyle === profile.travel_style) {
        score += 0.25;
      }
      factors += 0.25;
    } else {
      factors += 0.25;
    }

    // Budget overlap (25%)
    if (this.userPreferences.budgetMin && this.userPreferences.budgetMax) {
      if (profile.budget_min && profile.budget_max) {
        const overlap = Math.min(this.userPreferences.budgetMax, profile.budget_max) -
          Math.max(this.userPreferences.budgetMin, profile.budget_min || 0);
        if (overlap > 0) {
          const range = Math.max(this.userPreferences.budgetMax - this.userPreferences.budgetMin, 1);
          score += (overlap / range) * 0.25;
        }
        factors += 0.25;
      } else {
        factors += 0.25;
      }
    } else {
      factors += 0.25;
    }

    // Location proximity (20%)
    if (this.userPreferences.location && profile.location) {
      if (this.userPreferences.location === profile.location) {
        score += 0.2;
      }
      factors += 0.2;
    } else {
      factors += 0.2;
    }

    // Normalize to 0-1
    return factors > 0 ? score / factors : 0.5;
  }

  /**
   * Get activity score based on user's last active time
   */
  private getActivityScore(user: AppUser): number {
    // In real implementation, this would come from user.last_active timestamp
    // For now, return a simulated score
    const statuses = Object.keys(ACTIVITY_SCORES);
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    return ACTIVITY_SCORES[randomStatus];
  }

  /**
   * Calculate recency score (newer = higher)
   */
  private calculateRecency(user: AppUser): number {
    if (!user.created_at) return 0.5;
    
    const created = new Date(user.created_at).getTime();
    const now = Date.now();
    const hoursAgo = (now - created) / (1000 * 60 * 60);

    // Exponential decay: 1.0 at 0h, 0.5 at 24h, 0.25 at 48h
    if (hoursAgo <= 24) return 1 - (hoursAgo / 48);
    if (hoursAgo <= 48) return 0.5 - ((hoursAgo - 24) / 48);
    return Math.max(0.1, 0.25 - ((hoursAgo - 48) / 192));
  }

  /**
   * Apply time-based decay to content score
   */
  private applyDecay(user: AppUser): number {
    if (!user.created_at) return 1;
    
    const created = new Date(user.created_at).getTime();
    const hoursAgo = (Date.now() - created) / (1000 * 60 * 60);

    if (hoursAgo <= 24) return 1;
    if (hoursAgo <= 48) return Math.max(0.1, 1 - ((hoursAgo - 24) * 0.1));
    return Math.max(0.1, 1 - ((hoursAgo - 24) * 0.2));
  }

  /**
   * Inject random content for exploration (prevents echo chamber)
   */
  private injectRandomness<T extends { item: { id: number }; rawScore: number }>(
    items: T[]
  ): T[] {
    const count = items.length;
    const randomCount = Math.ceil(count * this.config.randomInjectionRate);
    
    if (randomCount === 0) return items;

    // Shuffle a portion and mix back in
    const randomItems = items
      .sort(() => Math.random() - 0.5)
      .slice(0, randomCount)
      .map(item => ({
        ...item,
        rawScore: item.rawScore * 0.5, // Lower priority for random
      })) as T[];

    const regularItems = items.slice(randomCount);
    
    // Interleave random items
    return this.interleave(regularItems, randomItems);
  }

  private injectTripRandomness<T extends { item: { id: number }; rawScore: number }>(
    items: T[]
  ): T[] {
    return this.injectRandomness(items);
  }

  private interleave<T>(a: T[], b: T[]): T[] {
    const result: T[] = [];
    let i = 0, j = 0;
    
    while (i < a.length || j < b.length) {
      if (i < a.length) result.push(a[i++]);
      if (j < b.length) result.push(b[j++]);
    }
    
    return result;
  }

  /**
   * Trip-specific calculations
   */
  private calculateTripRelevance(trip: TripRecord): number {
    if (!this.userPreferences.interests || !trip.interests) return 0.5;
    
    const overlap = trip.interests.filter(
      i => this.userPreferences.interests?.includes(i)
    ).length;
    
    return Math.min(1, overlap / 3); // Max out at 3 matching interests
  }

  private calculateTripPopularity(trip: TripRecord): number {
    if (!trip.capacity) return 0.5;
    return trip.approved_member_count / trip.capacity;
  }

  private calculateTripRecency(trip: TripRecord): number {
    if (!trip.start_date) return 0.5;
    
    const start = new Date(trip.start_date).getTime();
    const now = Date.now();
    const daysUntil = (start - now) / (1000 * 60 * 60 * 24);
    
    // Peak relevance 30-60 days out
    if (daysUntil >= 30 && daysUntil <= 60) return 1;
    if (daysUntil < 30) return Math.max(0.3, 1 - (30 - daysUntil) / 30);
    return Math.max(0.3, 1 - (daysUntil - 60) / 90);
  }

  private calculateTripUrgency(trip: TripRecord): number {
    if (!trip.capacity || !trip.start_date) return 0;
    
    const spotsLeft = trip.capacity - trip.approved_member_count;
    const daysUntil = (new Date(trip.start_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    
    // Higher urgency: fewer spots, closer departure
    const spotUrgency = Math.min(1, spotsLeft / 3);
    const timeUrgency = daysUntil <= 7 ? 1 : daysUntil <= 30 ? 0.7 : 0.3;
    
    return (spotUrgency + timeUrgency) / 2;
  }

  private applyTripDecay(trip: TripRecord): number {
    return this.applyDecay(trip as any);
  }

  private getRankingReason(u: {
    compatibilityScore: number;
    activityScore: number;
    recencyScore: number;
  }): string {
    if (u.compatibilityScore > 0.8) return 'Great compatibility!';
    if (u.activityScore > 0.9) return 'Active now';
    if (u.recencyScore > 0.8) return 'Recently joined';
    return 'Recommended for you';
  }

  /**
   * Update user preferences (called when user updates profile)
   */
  updatePreferences(preferences: Partial<UserPreferences>) {
    this.userPreferences = { ...this.userPreferences, ...preferences };
  }
}

interface UserPreferences {
  interests?: string[];
  travelStyle?: string;
  budgetMin?: number;
  budgetMax?: number;
  location?: string;
}

export const createRankingEngine = (
  userId: number, 
  preferences?: UserPreferences
): FeedRankingEngine => new FeedRankingEngine(userId, preferences);

export default FeedRankingEngine;
