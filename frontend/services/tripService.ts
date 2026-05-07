import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import type {
  AppUser,
  TripActivityPage,
  TripItineraryDayRecord,
  TripItineraryItem,
  TripPlaceRecord,
  TripPollRecord,
  TripRecord,
  TripWorkspaceRecord,
} from './types';

export interface CreateTripPayload {
  title: string;
  location: string;
  capacity: number;
  budget_min?: number | null;
  budget_max?: number | null;
  interests?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  visibility?: 'public' | 'private';
  status?: 'planned' | 'active' | 'completed';
  lifecycle_status?: 'draft' | 'planned' | 'active' | 'completed' | 'cancelled';
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

export async function fetchTripItinerary(tripId: number): Promise<TripItineraryItem[]> {
  const response = await api.get(`/trip/${tripId}/itinerary`);
  return getApiData<TripItineraryItem[]>(response) || [];
}

export async function fetchTripWorkspace(tripId: number): Promise<TripWorkspaceRecord> {
  const cacheKey = `trip:workspace:${tripId}`;
  return getCachedOrFetch(cacheKey, 10 * 1000, async () => {
    const response = await api.get(`/trip/${tripId}/workspace`);
    return (
      getApiData<TripWorkspaceRecord>(response) || {
        days: [],
        places: [],
        polls: [],
        unassigned_places: [],
        unassigned_polls: [],
      }
    );
  });
}

export interface CreateTripItineraryItemPayload {
  title: string;
  description?: string | null;
  item_date?: string | null;
  order_index?: number;
}

export async function createTripItineraryItem(
  tripId: number,
  payload: CreateTripItineraryItemPayload
): Promise<TripItineraryItem> {
  const response = await api.post(`/trip/${tripId}/itinerary`, payload);
  return getApiData<TripItineraryItem>(response);
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

export interface UpdateTripMetaPayload {
  start_date?: string | null;
  end_date?: string | null;
  visibility?: 'public' | 'private' | null;
  lifecycle_status?: 'draft' | 'planned' | 'active' | 'completed' | 'cancelled' | null;
}

export async function updateTripMeta(tripId: number, payload: UpdateTripMetaPayload): Promise<TripRecord> {
  const response = await api.put(`/trip/${tripId}/meta`, payload);
  await invalidateCacheByPrefixes(['trips:', `trip:workspace:${tripId}`, 'discover:trips']);
  return getApiData<TripRecord>(response);
}

export async function joinTrip(tripId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/join`);
  await invalidateCacheByPrefixes(['trips:', `trip:workspace:${tripId}`, 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export async function leaveTrip(tripId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/leave`);
  await invalidateCacheByPrefixes(['trips:', `trip:workspace:${tripId}`, 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export async function approveTripMember(tripId: number, userId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/approve`, { user_id: userId });
  await invalidateCacheByPrefixes(['trips:', `trip:workspace:${tripId}`, 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export async function rejectTripMember(tripId: number, userId: number): Promise<TripRecord> {
  const response = await api.post(`/trip/${tripId}/reject`, { user_id: userId });
  await invalidateCacheByPrefixes(['trips:', `trip:workspace:${tripId}`, 'discover:trips', 'notifications']);
  return getApiData<TripRecord>(response);
}

export interface CreateTripItineraryDayPayload {
  day_date: string;
  title?: string | null;
  notes?: string | null;
}

export async function createTripItineraryDay(
  tripId: number,
  payload: CreateTripItineraryDayPayload
): Promise<TripItineraryDayRecord> {
  const response = await api.post(`/trip/${tripId}/itinerary/day`, payload);
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
  return getApiData<TripItineraryDayRecord>(response);
}

export interface CreateTripPlacePayload {
  day_id?: number | null;
  name: string;
  address?: string | null;
  notes?: string | null;
  external_place_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  order_index?: number;
}

export async function createTripPlace(tripId: number, payload: CreateTripPlacePayload): Promise<TripPlaceRecord> {
  const response = await api.post(`/trip/${tripId}/place`, payload);
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
  return getApiData<TripPlaceRecord>(response);
}

export async function updateTripPlace(
  tripId: number,
  placeId: number,
  payload: Partial<CreateTripPlacePayload>
): Promise<TripPlaceRecord> {
  const response = await api.put(`/trip/${tripId}/place/${placeId}`, payload);
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
  return getApiData<TripPlaceRecord>(response);
}

export async function deleteTripPlace(tripId: number, placeId: number): Promise<void> {
  await api.delete(`/trip/${tripId}/place/${placeId}`);
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
}

export interface CreateTripPollPayload {
  day_id?: number | null;
  question: string;
  options: string[];
  closes_at?: string | null;
}

export async function createTripPoll(tripId: number, payload: CreateTripPollPayload): Promise<TripPollRecord> {
  const response = await api.post(`/trip/${tripId}/poll`, payload);
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
  return getApiData<TripPollRecord>(response);
}

export async function voteTripPoll(
  tripId: number,
  pollId: number,
  optionIndex: number
): Promise<TripPollRecord> {
  const response = await api.post(`/trip/${tripId}/vote`, { poll_id: pollId, option_index: optionIndex });
  await invalidateCacheByPrefixes([`trip:workspace:${tripId}`]);
  return getApiData<TripPollRecord>(response);
}

export function canApproveTripMembers(trip: TripRecord, currentUser: AppUser | null): boolean {
  return Boolean(currentUser && trip?.owner?.id === currentUser.id);
}
