import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import type { AppUser, TripActivityPage, TripRecord } from './types';

export interface CreateTripPayload {
  title: string;
  location: string;
  capacity: number;
}

export async function fetchTrips(): Promise<TripRecord[]> {
  return getCachedOrFetch('trips:all', 30 * 1000, async () => {
    const response = await api.get('/trip');
    return getApiData<TripRecord[]>(response) || [];
  });
}

export async function fetchTripById(tripId: number): Promise<TripRecord> {
  const response = await api.get(`/trip/${tripId}`);
  return getApiData<TripRecord>(response);
}

export async function fetchTripActivity(
  tripId: number,
  limit: number = 20,
  cursor?: string | null
): Promise<TripActivityPage> {
  const cacheKey = `trips:activity:${tripId}:${limit}:${cursor || 'none'}`;

  return getCachedOrFetch(cacheKey, 15 * 1000, async () => {
    const response = await api.get(`/trip/${tripId}/activity`, {
      params: {
        limit,
        ...(cursor ? { cursor } : {}),
      },
    });

    return getApiData<TripActivityPage>(response) || { items: [], next_cursor: null };
  });
}

export async function fetchMyTrips(currentUserId: number): Promise<TripRecord[]> {
  const trips = await fetchTrips();
  return trips.filter(
    (trip) =>
      trip?.owner?.id === currentUserId ||
      trip?.current_user_status === 'approved' ||
      trip?.current_user_status === 'pending'
  );
}

export async function fetchDiscoverTrips(currentUserId: number): Promise<TripRecord[]> {
  const trips = await fetchTrips();
  return trips.filter((trip) => trip?.owner?.id !== currentUserId);
}

export async function createTrip(payload: CreateTripPayload): Promise<TripRecord> {
  const response = await api.post('/trip/create', payload);
  await invalidateCacheByPrefixes(['trips:', 'discover:trips']);
  return getApiData<TripRecord>(response);
}

export async function joinTrip(tripId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/join`);
  await invalidateCacheByPrefixes(['trips:', 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export async function approveTripMember(tripId: number, userId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/approve`, { user_id: userId });
  await invalidateCacheByPrefixes(['trips:', 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export function canApproveTripMembers(trip: TripRecord, currentUser: AppUser | null): boolean {
  return Boolean(currentUser && trip?.owner?.id === currentUser.id);
}
