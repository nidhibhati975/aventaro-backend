import api, { getApiData } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_active_date: string;
  next_milestone: number;
  next_milestone_reward: string;
}

const STREAK_STORAGE_KEY = 'user:streak';

class StreakService {
  private cachedStreak: StreakData | null = null;

  // Get current streak data
  async getStreak(): Promise<StreakData> {
    // Try cache first
    const cached = await this.getCachedStreak();
    if (cached) {
      // Check if cache is still valid (within 1 hour)
      const cacheAge = Date.now() - (cached._cachedAt || 0);
      if (cacheAge < 60 * 60 * 1000) {
        return cached;
      }
    }

    // Fetch from API
    try {
      const response = await api.get('/user/streak');
      const streakData = getApiData<StreakData>(response);
      await this.cacheStreak(streakData);
      return streakData;
    } catch (error) {
      // Return cached or default on error
      return cached || this.getDefaultStreak();
    }
  }

  // Record daily activity (call on app open)
  async recordActivity(): Promise<StreakData> {
    const response = await api.post('/user/streak/activity');
    const streakData = getApiData<StreakData>(response);
    await this.cacheStreak(streakData);
    return streakData;
  }

  // Check if streak is at risk (not logged in today)
  isStreakAtRisk(streak: StreakData): boolean {
    const today = new Date().toISOString().split('T')[0];
    return streak.last_active_date !== today && streak.current_streak > 0;
  }

  // Get streak status message
  getStreakMessage(streak: StreakData): string {
    const today = new Date().toISOString().split('T')[0];
    
    if (streak.last_active_date === today) {
      return `🔥 ${streak.current_streak} day streak! Keep it up!`;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (streak.last_active_date === yesterdayStr) {
      return `Don't lose your ${streak.current_streak} day streak! Log in today.`;
    }
    
    if (streak.current_streak === 0) {
      return 'Start your streak today!';
    }
    
    return `Your ${streak.current_streak} day streak ended. Start a new one!`;
  }

  // Private methods
  private async getCachedStreak(): Promise<StreakData | null> {
    try {
      const stored = await AsyncStorage.getItem(STREAK_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Remove cache timestamp before returning
        const { _cachedAt, ...streak } = parsed;
        return streak;
      }
    } catch (error) {
      console.error('Failed to get cached streak:', error);
    }
    return null;
  }

  private async cacheStreak(streak: StreakData): Promise<void> {
    try {
      const toStore = { ...streak, _cachedAt: Date.now() };
      await AsyncStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(toStore));
      this.cachedStreak = streak;
    } catch (error) {
      console.error('Failed to cache streak:', error);
    }
  }

  private getDefaultStreak(): StreakData {
    return {
      current_streak: 0,
      longest_streak: 0,
      last_active_date: '',
      next_milestone: 7,
      next_milestone_reward: 'Profile Boost',
    };
  }
}

export const streakService = new StreakService();
export default streakService;