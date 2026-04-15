import api, { getApiData } from './api';
import { getCachedOrFetch } from './cache';
import type { AiAssistantResponse, AiChatHistoryMessage, AiPlannerRequest, TripPlanResult } from './types';

const AI_CACHE_TTL_MS = 60 * 60 * 1000;

export type TripPlannerInput = AiPlannerRequest;

function buildTripPlanCacheKey(input: TripPlannerInput) {
  return `ai:trip:${JSON.stringify(input)}`;
}

export async function generateTripPlan(input: TripPlannerInput): Promise<TripPlanResult> {
  return getCachedOrFetch(buildTripPlanCacheKey(input), AI_CACHE_TTL_MS, async () => {
    const response = await api.post('/ai/trip/plan', input);
    return getApiData<TripPlanResult>(response);
  });
}

export interface AiChatRequestPayload {
  message: string;
  history?: AiChatHistoryMessage[];
  planner_context?: TripPlannerInput | null;
}

export async function askAventaroAi(payload: AiChatRequestPayload): Promise<AiAssistantResponse> {
  const response = await api.post('/ai/chat', payload);
  return getApiData<AiAssistantResponse>(response);
}
