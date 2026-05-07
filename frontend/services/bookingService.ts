import { Linking } from 'react-native';

import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import type {
  BookingDetailsRecord,
  BookingRecord,
  BookingReservationResponse,
  BookingSearchDetailsRecord,
  BookingSearchResultRecord,
  PaymentSessionResult,
} from './types';

const BOOKING_SUCCESS_URL = 'https://aventaro.app/booking/success';
const BOOKING_CANCEL_URL = 'https://aventaro.app/booking/cancel';

export interface BookingSearchPayload {
  result_type: 'hotel' | 'flight' | 'activity';
  location?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  guests?: number;
}

export async function searchBookings(payload: BookingSearchPayload): Promise<BookingSearchResultRecord[]> {
  const cacheKey = `booking:search:${JSON.stringify(payload)}`;
  return getCachedOrFetch(cacheKey, 30 * 1000, async () => {
    const response = await api.post('/booking/search', payload);
    return getApiData<BookingSearchResultRecord[]>(response) || [];
  });
}

export async function fetchBookingDetails(
  resultType: 'hotel' | 'flight' | 'activity',
  externalId: string
): Promise<BookingSearchDetailsRecord> {
  const cacheKey = `booking:details:${resultType}:${externalId}`;
  return getCachedOrFetch(cacheKey, 60 * 1000, async () => {
    const response = await api.get('/booking/details', {
      params: {
        result_type: resultType,
        external_id: externalId,
      },
    });
    return getApiData<BookingSearchDetailsRecord>(response);
  });
}

export interface CreateReservationPayload {
  result_type: 'hotel' | 'flight' | 'activity';
  external_id: string;
  guest_name: string;
  guest_email: string;
  payment_method?: string;
  trip_id?: number | null;
}

export async function createReservation(
  payload: CreateReservationPayload
): Promise<BookingReservationResponse> {
  const response = await api.post('/booking/reserve', {
    payment_method: payload.payment_method || 'card',
    ...payload,
  });
  await invalidateCacheByPrefixes(['booking:']);
  return getApiData<BookingReservationResponse>(response);
}

export async function fetchBookingHistory(
  limit: number = 20,
  offset: number = 0,
  status?: string | null
): Promise<BookingRecord[]> {
  const cacheKey = `booking:history:${limit}:${offset}:${status || 'all'}`;
  return getCachedOrFetch(cacheKey, 15 * 1000, async () => {
    const response = await api.get('/booking/history', {
      params: {
        limit,
        offset,
        ...(status ? { status } : {}),
      },
    });
    return getApiData<BookingRecord[]>(response) || [];
  });
}

export async function fetchBooking(bookingId: number): Promise<BookingDetailsRecord> {
  const response = await api.get(`/booking/${bookingId}`);
  return getApiData<BookingDetailsRecord>(response);
}

export async function confirmBooking(bookingId: number): Promise<BookingDetailsRecord> {
  const response = await api.post(`/booking/${bookingId}/confirm`);
  await invalidateCacheByPrefixes(['booking:']);
  return getApiData<BookingDetailsRecord>(response);
}

export async function cancelBooking(bookingId: number): Promise<BookingDetailsRecord> {
  const response = await api.post(`/booking/${bookingId}/cancel`);
  await invalidateCacheByPrefixes(['booking:']);
  return getApiData<BookingDetailsRecord>(response);
}

export async function refundBooking(bookingId: number, reason?: string | null): Promise<BookingDetailsRecord> {
  const response = await api.post(`/booking/${bookingId}/refund`, { reason: reason || null });
  await invalidateCacheByPrefixes(['booking:']);
  return getApiData<BookingDetailsRecord>(response);
}

export async function createBookingPayment(
  bookingId: number,
  idempotencyKey?: string
): Promise<PaymentSessionResult> {
  const response = await api.post(`/booking/${bookingId}/create-payment`, null, {
    params: {
      success_url: BOOKING_SUCCESS_URL,
      cancel_url: BOOKING_CANCEL_URL,
      idempotency_key: idempotencyKey || `booking_${bookingId}_${Date.now()}`,
    },
  });
  await invalidateCacheByPrefixes(['booking:']);
  return getApiData<PaymentSessionResult>(response);
}

export async function openBookingPaymentCheckout(
  bookingId: number,
  idempotencyKey?: string
): Promise<PaymentSessionResult> {
  const session = await createBookingPayment(bookingId, idempotencyKey);
  await Linking.openURL(session.checkout_url);
  return session;
}
