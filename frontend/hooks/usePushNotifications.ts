import { useCallback, useEffect, useRef, useState } from 'react';

import analytics from '../services/analyticsService';
import { getNotificationIntelligence } from '../services/behavioral/notificationIntelligence';
import firebasePushService, {
  type NotificationPayload as FirebaseNotificationPayload,
  type NotificationType,
  type PermissionStatus,
} from '../services/firebasePushService';

export type { NotificationType, PermissionStatus };

export interface NotificationPayload extends FirebaseNotificationPayload {
  scheduledTime?: Date;
}

export function usePushNotifications() {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const notificationIntel = useRef(getNotificationIntelligence());

  const syncState = useCallback(async () => {
    await firebasePushService.init();
    const nextPermissionStatus = await firebasePushService.checkPermissionStatus();
    setPermissionStatus(nextPermissionStatus);
    setDeviceToken(firebasePushService.getDeviceToken());
    return nextPermissionStatus;
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    setIsLoading(true);
    try {
      await firebasePushService.init();
      const status = await firebasePushService.requestPermission();
      setPermissionStatus(status);
      setDeviceToken(firebasePushService.getDeviceToken());
      return status;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
    return syncState();
  }, [syncState]);

  const handleNotification = useCallback((notification: FirebaseNotificationPayload) => {
    analytics.trackNotificationOpen(notification.id);
    notificationIntel.current.recordOpened();
    return notification;
  }, []);

  const handleNotificationTap = useCallback(async () => {
    return firebasePushService.drainPendingNotificationNavigation();
  }, []);

  const scheduleNotification = useCallback(async (payload: NotificationPayload) => {
    const shouldSend = notificationIntel.current.shouldSendNotification();
    if (!shouldSend) {
      return null;
    }

    return payload.id || `notif_${Date.now()}`;
  }, []);

  const cancelNotification = useCallback((_notificationId: string) => {
    return;
  }, []);

  const cancelAllNotifications = useCallback(() => {
    return;
  }, []);

  const getSettings = useCallback(async () => {
    return firebasePushService.getNotificationSettings();
  }, []);

  const updateSettings = useCallback(async (settings: any) => {
    await firebasePushService.updateNotificationSettings(settings);
  }, []);

  useEffect(() => {
    void syncState();
  }, [syncState]);

  useEffect(() => {
    return firebasePushService.subscribe((payload) => {
      handleNotification(payload);
    });
  }, [handleNotification]);

  return {
    permissionStatus,
    deviceToken,
    isLoading,
    requestPermission,
    checkPermission,
    handleNotification,
    handleNotificationTap,
    scheduleNotification,
    cancelNotification,
    cancelAllNotifications,
    getSettings,
    updateSettings,
  };
}

export function useIntelligentNotifications() {
  const [nextScheduledNotification] = useState<NotificationPayload | null>(null);
  const notificationIntel = useRef(getNotificationIntelligence());

  const getOptimalSendTime = useCallback(async (_type: NotificationType): Promise<Date> => {
    const [hours, minutes] = notificationIntel.current
      .getOptimalSendTime()
      .split(':')
      .map((value) => Number(value));
    const scheduledAt = new Date();
    scheduledAt.setHours(hours || 0, minutes || 0, 0, 0);
    return scheduledAt;
  }, []);

  const shouldSend = useCallback(async (_type: NotificationType): Promise<boolean> => {
    return notificationIntel.current.shouldSendNotification();
  }, []);

  const getSuggestions = useCallback(async () => {
    return notificationIntel.current.checkTriggers();
  }, []);

  const scheduleBasedOnActivity = useCallback(async (userId: number) => {
    const suggestions = notificationIntel.current.checkTriggers();
    return suggestions
      .map((suggestion) => ({
        id: `notif_${Date.now()}_${userId}`,
        type: 'system' as NotificationType,
        title: suggestion.title,
        body: suggestion.body,
        scheduledTime: new Date(),
        priority: suggestion.priority === 'low' ? 'low' : suggestion.priority === 'high' ? 'high' : 'normal',
      }));
  }, []);

  return {
    nextScheduledNotification,
    getOptimalSendTime,
    shouldSend,
    getSuggestions,
    scheduleBasedOnActivity,
  };
}

export const NotificationTemplates = {
  match: (userName: string): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'match',
    title: "It's a match",
    body: `You and ${userName} liked each other. Start the conversation.`,
    priority: 'high',
  }),

  newMessage: (senderName: string, preview: string): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'chat_message',
    title: `New message from ${senderName}`,
    body: preview.length > 50 ? `${preview.substring(0, 50)}...` : preview,
    priority: 'high',
  }),

  tripReminder: (tripName: string, timeUntil: string): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'trip_reminder',
    title: `${tripName} starts ${timeUntil}`,
    body: "Don't forget to prepare.",
    priority: 'normal',
  }),

  streakWarning: (days: number): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'system',
    title: `${days} day streak at risk`,
    body: 'Open Aventaro to keep your streak alive.',
    priority: 'high',
  }),

  fomo: (tripName: string, spotsLeft: number): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'trip_update',
    title: `Only ${spotsLeft} spots left`,
    body: `${tripName} is filling up fast.`,
    priority: 'high',
  }),

  social: (activity: string): NotificationPayload => ({
    id: `notif_${Date.now()}`,
    type: 'social',
    title: 'Someone interacted with you',
    body: activity,
    priority: 'normal',
  }),
};

export default {
  usePushNotifications,
  useIntelligentNotifications,
  NotificationTemplates,
};
