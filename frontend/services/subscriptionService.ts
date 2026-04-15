import { Linking } from 'react-native';

import api, { getApiData } from './api';
import { invalidateCacheByPrefixes } from './cache';
import type { SubscriptionCheckoutSession, SubscriptionRecord } from './types';

const SUBSCRIPTION_SUCCESS_URL = 'https://aventaro.app/subscription/success';
const SUBSCRIPTION_CANCEL_URL = 'https://aventaro.app/subscription/cancel';

export async function fetchMySubscription(): Promise<SubscriptionRecord> {
  const response = await api.get('/subscription/me');
  return getApiData<SubscriptionRecord>(response);
}

export async function startSubscriptionUpgrade(priceId?: string | null): Promise<SubscriptionCheckoutSession> {
  const response = await api.post('/subscription/upgrade', {
    success_url: SUBSCRIPTION_SUCCESS_URL,
    cancel_url: SUBSCRIPTION_CANCEL_URL,
    ...(priceId ? { price_id: priceId } : {}),
  });
  await invalidateCacheByPrefixes(['subscription:me']);
  return getApiData<SubscriptionCheckoutSession>(response);
}

export async function openUpgradeCheckout(priceId?: string | null): Promise<SubscriptionCheckoutSession> {
  const session = await startSubscriptionUpgrade(priceId);
  await Linking.openURL(session.checkout_url);
  return session;
}

export async function cancelMySubscription(): Promise<SubscriptionRecord> {
  const response = await api.post('/subscription/cancel');
  await invalidateCacheByPrefixes(['subscription:me', 'profile:me']);
  return getApiData<SubscriptionRecord>(response);
}
