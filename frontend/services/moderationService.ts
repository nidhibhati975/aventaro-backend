import api, { getApiData } from './api';
import { invalidateCacheByPrefixes } from './cache';
import type { BlockedUserRecord, ModerationCaseRecord, ReportRecord } from './types';

export interface CreateReportPayload {
  target_type: 'post' | 'user';
  target_id: number;
  reason: string;
}

export async function createReport(payload: CreateReportPayload): Promise<ReportRecord> {
  const response = await api.post('/report', payload);
  await invalidateCacheByPrefixes(['moderation:']);
  return getApiData<ReportRecord>(response);
}

export async function fetchMyReports(): Promise<ReportRecord[]> {
  const response = await api.get('/reports/mine');
  return getApiData<ReportRecord[]>(response) || [];
}

export async function blockUser(userId: number): Promise<void> {
  await api.post(`/block/${userId}`);
  await invalidateCacheByPrefixes(['moderation:', 'discover:people', 'discover:trips']);
}

export async function unblockUser(userId: number): Promise<void> {
  await api.delete(`/block/${userId}`);
  await invalidateCacheByPrefixes(['moderation:', 'discover:people', 'discover:trips']);
}

export async function fetchBlockedUsers(): Promise<BlockedUserRecord[]> {
  const response = await api.get('/blocks');
  return getApiData<BlockedUserRecord[]>(response) || [];
}

export async function fetchModerationCases(): Promise<ModerationCaseRecord[]> {
  const response = await api.get('/admin/moderation/cases');
  return getApiData<ModerationCaseRecord[]>(response) || [];
}

export async function resolveModerationCase(caseId: number, action: string): Promise<ModerationCaseRecord> {
  const response = await api.post(`/admin/moderation/${caseId}/resolve`, { action });
  return getApiData<ModerationCaseRecord>(response);
}
