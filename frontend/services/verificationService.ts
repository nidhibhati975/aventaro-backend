import api, { getApiData } from './api';
import { invalidateCacheByPrefixes } from './cache';
import type { VerificationRequestRecord, VerificationStatusRecord } from './types';

export async function fetchVerificationStatus(): Promise<VerificationStatusRecord> {
  const response = await api.get('/verification/status');
  return getApiData<VerificationStatusRecord>(response);
}

export interface SubmitVerificationPayload {
  type: 'id' | 'selfie' | 'social';
  document_url?: string | null;
}

export async function submitVerification(
  payload: SubmitVerificationPayload
): Promise<VerificationRequestRecord> {
  const response = await api.post('/verification/submit', payload);
  await invalidateCacheByPrefixes(['profile:me']);
  return getApiData<VerificationRequestRecord>(response);
}
