import type { NotificationRecord } from './types';
import api, { getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';

function buildNotificationTitle(type?: string) {
  switch (type) {
    case 'chat_message':
    case 'chat':
      return 'New message';
    case 'match_request':
    case 'match_accept':
    case 'match':
      return 'Match update';
    case 'trip_join':
    case 'trip_approval':
    case 'trip':
      return 'Trip update';
    case 'payment_success':
    case 'payment':
      return 'Payment update';
    case 'new_follower':
    case 'profile':
      return 'Profile update';
    default:
      return 'Notification';
  }
}

export async function fetchNotifications(): Promise<NotificationRecord[]> {
  return getCachedOrFetch('notifications:list', 15 * 1000, async () => {
    const response = await api.get('/notifications');
    return (getApiData<any[]>(response) || []).map((item: any) => ({
      id: Number(item.id),
      title: buildNotificationTitle(item.type),
      body: String(item.message || ''),
      created_at: String(item.createdAt || item.created_at || ''),
      is_read: Boolean(item.isRead ?? item.is_read),
      type: item.type,
      entity_id: item.entityId ?? item.entity_id ?? null,
    }));
  });
}

export async function markNotificationsRead(notificationIds: number[]): Promise<void> {
  if (notificationIds.length === 0) {
    return;
  }
  await api.post('/notifications/mark-read', { notification_ids: notificationIds });
  await invalidateCacheByPrefixes(['notifications']);
}

export async function markNotificationRead(notificationId: number): Promise<void> {
  await markNotificationsRead([notificationId]);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const notifications = await fetchNotifications();
  return notifications.filter((item) => !item.is_read).length;
}
