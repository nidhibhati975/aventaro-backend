/**
 * FOMO (Fear Of Missing Out) System
 * 
 * Behavioral Design: Create urgency to drive engagement
 * 
 * FOMO Triggers:
 * 1. "People joining fast" - Social proof of popularity
 * 2. "Only X spots left" - Scarcity
 * 3. "Trending trips" - Fear of missing trending content
 * 4. "Time-limited" - Expiring opportunities
 * 5. "X people looking at this" - Real-time interest
 */

import type { TripRecord } from '../types';

export interface FOMOData {
  type: FOMOType;
  message: string;
  urgency: 'low' | 'medium' | 'high';
  action?: string;
  expiry?: number; // Unix timestamp
}

export type FOMOType = 
  | 'spots_remaining'
  | 'people_joining'
  | 'trending'
  | 'time_limited'
  | 'social_proof'
  | 'expiring_soon';

export interface FOMOConfig {
  spotsThresholdLow: number;    // Show "only X left" below this
  spotsThresholdMedium: number;  // Show "few spots" below this
  trendingAge: number;          // Hours before trip is "trending"
  timeLimitHours: number;       // Hours until "expiring soon"
}

const DEFAULT_CONFIG: FOMOConfig = {
  spotsThresholdLow: 2,
  spotsThresholdMedium: 5,
  trendingAge: 6,
  timeLimitHours: 48,
};

export class FOMOSystem {
  private config: FOMOConfig;

  constructor(config: Partial<FOMOConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate FOMO data for a trip
   */
  getTripFOMO(trip: TripRecord): FOMOData[] {
    const fomoData: FOMOData[] = [];

    // 1. Spots remaining
    if (trip.capacity && trip.approved_member_count !== undefined) {
      const spotsLeft = trip.capacity - trip.approved_member_count;
      
      if (spotsLeft <= this.config.spotsThresholdLow) {
        fomoData.push({
          type: 'spots_remaining',
          message: `🔥 Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left!`,
          urgency: 'high',
          action: 'Join now',
        });
      } else if (spotsLeft <= this.config.spotsThresholdMedium) {
        fomoData.push({
          type: 'spots_remaining',
          message: `🎯 Only ${spotsLeft} spots remaining`,
          urgency: 'medium',
          action: 'Reserve your spot',
        });
      }
    }

    // 2. People joining (simulated - would come from backend)
    const joiningCount = this.simulateJoiningCount();
    if (joiningCount > 0) {
      fomoData.push({
        type: 'people_joining',
        message: `👥 ${joiningCount} people joined this week`,
        urgency: 'medium',
      });
    }

    // 3. Trending (based on recent activity)
    if (this.isTrending(trip)) {
      fomoData.push({
        type: 'trending',
        message: '🔥 Trending in your area',
        urgency: 'medium',
      });
    }

    // 4. Time-limited (trip starting soon)
    if (trip.start_date) {
      const daysUntil = this.getDaysUntil(trip.start_date);
      
      if (daysUntil <= 7) {
        fomoData.push({
          type: 'expiring_soon',
          message: `⏰ Trip starts in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
          urgency: 'high',
          action: 'Book now',
          expiry: new Date(trip.start_date).getTime(),
        });
      } else if (daysUntil <= 14) {
        fomoData.push({
          type: 'time_limited',
          message: `🗓️ ${daysUntil} days until departure`,
          urgency: 'medium',
        });
      }
    }

    // 5. Social proof
    if (trip.approved_member_count && trip.approved_member_count >= 5) {
      fomoData.push({
        type: 'social_proof',
        message: `✅ ${trip.approved_member_count} travelers approved`,
        urgency: 'low',
      });
    }

    return fomoData;
  }

  /**
   * Get highest urgency FOMO for display
   */
  getPrimaryFOMO(trip: TripRecord): FOMOData | null {
    const fomoList = this.getTripFOMO(trip);
    
    if (fomoList.length === 0) return null;

    // Priority: high > medium > low
    const priority = { high: 0, medium: 1, low: 2 };
    fomoList.sort((a, b) => priority[a.urgency] - priority[b.urgency]);

    return fomoList[0];
  }

  /**
   * Check if trip is trending
   */
  private isTrending(trip: TripRecord): boolean {
    // In real implementation, check trip activity in last X hours
    // For now, simulate based on member count
    return (trip.approved_member_count || 0) >= 3;
  }

  /**
   * Simulate joining count (would come from backend)
   */
  private simulateJoiningCount(): number {
    return Math.floor(Math.random() * 8);
  }

  /**
   * Get days until date
   */
  private getDaysUntil(dateStr: string): number {
    const date = new Date(dateStr);
    const now = new Date();
    return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Generate FOMO for discovery feed
   */
  getFeedFOMO(): FOMOData {
    const types: FOMOData[] = [
      {
        type: 'trending',
        message: '🔥 12 trips trending now',
        urgency: 'medium',
      },
      {
        type: 'social_proof',
        message: '👥 48 people matched today',
        urgency: 'low',
      },
      {
        type: 'time_limited',
        message: '⏰ 5 trips ending soon',
        urgency: 'medium',
      },
    ];

    return types[Math.floor(Math.random() * types.length)];
  }

  /**
   * Get urgency color
   */
  getUrgencyColor(urgency: 'low' | 'medium' | 'high'): string {
    const colors = {
      low: '#4CAF50',      // Green
      medium: '#FF9800',   // Orange
      high: '#F44336',     // Red
    };
    return colors[urgency];
  }

  /**
   * Get urgency icon
   */
  getUrgencyIcon(urgency: 'low' | 'medium' | 'high'): string {
    const icons = {
      low: '✓',
      medium: '⚡',
      high: '🔥',
    };
    return icons[urgency];
  }
}

// Pre-built FOMO messages for different scenarios
export const FOMO_MESSAGES = {
  spotsLeft: (count: number): string => {
    if (count === 1) return '🔥 Only 1 spot left!';
    if (count <= 3) return `🔥 Only ${count} spots left!`;
    return `🎯 ${count} spots remaining`;
  },

  peopleViewing: (count: number): string => {
    if (count === 1) return '👀 1 person is viewing';
    return `👀 ${count} people are viewing`;
  },

  trending: (): string => '🔥 Trending in your area',
  
  expiringSoon: (days: number): string => {
    if (days === 1) return '⏰ Expires tomorrow!';
    return `⏰ Expires in ${days} days`;
  },

  joinedRecently: (count: number): string => {
    if (count === 1) return '👤 1 joined recently';
    return `👥 ${count} joined recently`;
  },

  matchUrgency: (): string => '💚 Someone wants to travel with you!',
};

// Singleton
let fomoInstance: FOMOSystem | null = null;

export const getFOMOSystem = (config?: Partial<FOMOConfig>): FOMOSystem => {
  if (!fomoInstance) {
    fomoInstance = new FOMOSystem(config);
  }
  return fomoInstance;
};

export default FOMOSystem;
