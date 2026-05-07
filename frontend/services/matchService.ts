import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import type { MatchRecord, MatchSuggestionRecord } from './types';

export async function fetchMatches(): Promise<MatchRecord[]> {
  const [received, sent] = await Promise.all([fetchReceivedMatches(), fetchSentMatches()]);
  return [...received, ...sent];
}

export async function fetchMatchSuggestions(limit: number = 10): Promise<MatchSuggestionRecord[]> {
  return getCachedOrFetch(`match:suggestions:${limit}`, 30 * 1000, async () => {
    const response = await api.get('/match/suggestions/explained', { params: { limit } });
    return getApiData<MatchSuggestionRecord[]>(response) || [];
  });
}

export async function fetchReceivedMatches(): Promise<MatchRecord[]> {
  const response = await api.get('/match/received');
  return getApiData<MatchRecord[]>(response) || [];
}

export async function fetchSentMatches(): Promise<MatchRecord[]> {
  const response = await api.get('/match/sent');
  return getApiData<MatchRecord[]>(response) || [];
}

export async function sendMatchRequest(targetUserId: number): Promise<MatchRecord> {
  const response = await api.post('/match/request', { target_user_id: targetUserId });
  await invalidateCacheByPrefixes(['match:', 'discover:people', 'chat:conversations']);
  return getApiData<MatchRecord>(response);
}

export async function acceptMatchRequest(matchId: number): Promise<MatchRecord> {
  const response = await api.post(`/match/${matchId}/accept`);
  await invalidateCacheByPrefixes(['match:', 'chat:conversations', 'notifications']);
  return getApiData<MatchRecord>(response);
}

export async function rejectMatchRequest(matchId: number): Promise<MatchRecord> {
  const response = await api.post(`/match/${matchId}/reject`);
  await invalidateCacheByPrefixes(['match:', 'notifications']);
  return getApiData<MatchRecord>(response);
}
