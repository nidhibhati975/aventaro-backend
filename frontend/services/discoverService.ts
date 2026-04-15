import api, { getApiData } from './api';
import { getCachedOrFetch } from './cache';
import type { AppUser, TripRecord } from './types';

const DISCOVER_CACHE_TTL_MS = 30 * 1000;

export async function fetchPeopleDiscover(limit: number = 20): Promise<AppUser[]> {
  return getCachedOrFetch(`discover:people:${limit}`, DISCOVER_CACHE_TTL_MS, async () => {
    const response = await api.get('/discover/people', { params: { limit } });
    return getApiData<AppUser[]>(response) || [];
  });
}

export async function fetchTripDiscover(limit: number = 20): Promise<TripRecord[]> {
  return getCachedOrFetch(`discover:trips:${limit}`, DISCOVER_CACHE_TTL_MS, async () => {
    const response = await api.get('/discover/trips', { params: { limit } });
    return getApiData<TripRecord[]>(response) || [];
  });
}
