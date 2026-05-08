import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  isDeviceRegisteredForRemoteMessages,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  requestPermission,
  setBackgroundMessageHandler,
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import api from './api';
import { handleIncomingUrl } from './deepLinks';
import { errorLogger } from './errorLogger';
import { productionAnalytics } from './productionAnalyticsService';

export type NotificationType =
  | 'booking'
  | 'chat'
  | 'chat_message'
  | 'expense'
  | 'match'
  | 'match_accept'
  | 'match_request'
  | 'message'
  | 'payment'
  | 'profile'
  | 'promotional'
  | 'social'
  | 'system'
  | 'trip'
  | 'trip_approval'
  | 'trip_invite'
  | 'trip_join'
  | 'trip_reminder'
  | 'trip_update'
  | 'verification';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'provisional';

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'high' | 'normal' | 'low';
  ttl?: number;
  category?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  types: Record<string, boolean>;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  doNotDisturb: boolean;
}

export interface DeviceToken {
  token: string;
  platform: 'ios' | 'android';
  appVersion: string;
  registeredAt: string;
  lastUsedAt: string;
}

export interface NotificationAction {
  id: string;
  title: string;
  icon?: string;
  foreground?: boolean;
}

const DEVICE_TOKEN_KEY = 'push:deviceToken';
const NOTIFICATION_SETTINGS_KEY = 'push:notificationSettings';
const PENDING_NOTIFICATIONS_KEY = 'push:pendingNotifications';
const NOTIFICATION_PERMISSION_KEY = 'push:permissionStatus';
const PENDING_NOTIFICATION_OPEN_KEY = 'push:pendingNotificationOpen';

let backgroundHandlerRegistered = false;
const firebaseMessaging = getMessaging();

function isPermissionEnabled(status: PermissionStatus) {
  return status === 'granted' || status === 'provisional';
}

function normalizePlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function getAndroidApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : Number(Platform.Version || 0);
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mapIosPermissionStatus(status: number): PermissionStatus {
  if (status === AuthorizationStatus.AUTHORIZED) {
    return 'granted';
  }
  if (status === AuthorizationStatus.PROVISIONAL) {
    return 'provisional';
  }
  if (status === AuthorizationStatus.DENIED) {
    return 'denied';
  }
  return 'undetermined';
}

class FirebasePushService {
  private deviceToken: string | null = null;
  private permissionStatus: PermissionStatus = 'undetermined';
  private isInitialized = false;
  private notificationListeners: Set<(payload: NotificationPayload) => void> = new Set();
  private appStateSubscription: { remove: () => void } | null = null;
  private foregroundUnsubscribe: (() => void) | null = null;
  private openedAppUnsubscribe: (() => void) | null = null;
  private tokenRefreshUnsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.restoreDeviceToken();
    await this.checkPermissionStatus();
    await this.ensureRemoteMessagesRegistered();
    this.setupAppStateListener();
    this.setupMessagingListeners();
    this.isInitialized = true;

    if (isPermissionEnabled(this.permissionStatus)) {
      await this.syncTokenWithBackend();
    }
  }

  async requestPermission(): Promise<PermissionStatus> {
    try {
      let nextStatus: PermissionStatus;

      if (Platform.OS === 'ios') {
        await this.ensureRemoteMessagesRegistered();
        const authorizationStatus = await requestPermission(firebaseMessaging, { provisional: true });
        nextStatus = mapIosPermissionStatus(authorizationStatus);
      } else if (getAndroidApiLevel() >= 33) {
        const alreadyGranted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (alreadyGranted) {
          nextStatus = 'granted';
        } else {
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          nextStatus =
            result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
        }
      } else {
        nextStatus = 'granted';
      }

      this.permissionStatus = nextStatus;
      await this.persistPermissionStatus(nextStatus);

      if (isPermissionEnabled(nextStatus)) {
        await this.syncTokenWithBackend();
      }

      return nextStatus;
    } catch (error) {
      errorLogger.logError(error, { source: 'PushPermission' });
      this.permissionStatus = 'denied';
      await this.persistPermissionStatus('denied');
      return 'denied';
    }
  }

  async checkPermissionStatus(): Promise<PermissionStatus> {
    try {
      if (Platform.OS === 'ios') {
        const status = await hasPermission(firebaseMessaging);
        this.permissionStatus = mapIosPermissionStatus(status);
      } else if (getAndroidApiLevel() >= 33) {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        this.permissionStatus = granted ? 'granted' : 'undetermined';
      } else {
        this.permissionStatus = 'granted';
      }

      await this.persistPermissionStatus(this.permissionStatus);
      return this.permissionStatus;
    } catch (error) {
      errorLogger.logError(error, { source: 'PushPermission', context: { action: 'check' } });

      try {
        const stored = await AsyncStorage.getItem(NOTIFICATION_PERMISSION_KEY);
        if (stored) {
          this.permissionStatus = stored as PermissionStatus;
        }
      } catch (storageError) {
        errorLogger.logAsyncStorageError(
          storageError,
          NOTIFICATION_PERMISSION_KEY,
          'checkPermissionStatus',
        );
      }

      return this.permissionStatus;
    }
  }

  async getToken(): Promise<string | null> {
    try {
      await this.ensureRemoteMessagesRegistered();
      const token = await getToken(firebaseMessaging);
      if (!token) {
        return null;
      }

      this.deviceToken = token;
      await this.persistDeviceToken(token);
      return token;
    } catch (error) {
      errorLogger.logError(error, { source: 'PushToken', context: { action: 'getToken' } });
      return this.deviceToken;
    }
  }

  async syncTokenWithBackend(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }

    await this.registerTokenToBackend(token);
    return token;
  }

  handleForegroundNotification(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): NotificationPayload {
    const payload = this.toNotificationPayload(remoteMessage);
    productionAnalytics.trackNotificationReceived(payload.id);
    this.notifyListeners(payload);
    return payload;
  }

  async handleNotificationTap(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): Promise<boolean> {
    const payload = this.toNotificationPayload(remoteMessage);
    productionAnalytics.trackNotificationOpen(payload.id);
    return this.routeNotificationPayload(payload);
  }

  handleNotificationAction(
    action: NotificationAction,
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): void {
    if (action.id === 'view' || action.id === 'reply') {
      void this.handleNotificationTap(remoteMessage);
    }
  }

  async handleBackgroundRemoteMessage(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): Promise<void> {
    const payload = this.toNotificationPayload(remoteMessage);
    await this.storeBackgroundNotification(payload);
  }

  async drainPendingNotificationNavigation(): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(PENDING_NOTIFICATION_OPEN_KEY);
      if (!raw) {
        return false;
      }

      const payload = JSON.parse(raw) as NotificationPayload;
      const handled = await this.routeNotificationPayload(payload);
      if (handled) {
        await AsyncStorage.removeItem(PENDING_NOTIFICATION_OPEN_KEY);
      }
      return handled;
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        PENDING_NOTIFICATION_OPEN_KEY,
        'drainPendingNotificationNavigation',
      );
      return false;
    }
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    try {
      const raw = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
      if (raw) {
        return JSON.parse(raw) as NotificationSettings;
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        NOTIFICATION_SETTINGS_KEY,
        'getNotificationSettings',
      );
    }

    return {
      enabled: true,
      types: {
        booking: true,
        chat: true,
        chat_message: true,
        expense: true,
        match: true,
        match_accept: true,
        match_request: true,
        message: true,
        payment: true,
        profile: true,
        promotional: false,
        social: true,
        system: true,
        trip: true,
        trip_approval: true,
        trip_invite: true,
        trip_join: true,
        trip_reminder: true,
        trip_update: true,
        verification: true,
      },
      quietHours: {
        enabled: false,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      },
      doNotDisturb: false,
    };
  }

  async updateNotificationSettings(
    settings: Partial<NotificationSettings>,
  ): Promise<void> {
    try {
      const current = await this.getNotificationSettings();
      const updated = { ...current, ...settings };
      await AsyncStorage.setItem(
        NOTIFICATION_SETTINGS_KEY,
        JSON.stringify(updated),
      );
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        NOTIFICATION_SETTINGS_KEY,
        'updateNotificationSettings',
      );
    }
  }

  async setTypeEnabled(type: NotificationType, enabled: boolean): Promise<void> {
    const settings = await this.getNotificationSettings();
    settings.types[type] = enabled;
    await this.updateNotificationSettings(settings);
  }

  subscribe(listener: (payload: NotificationPayload) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  getDeviceToken(): string | null {
    return this.deviceToken;
  }

  getPermissionStatus(): PermissionStatus {
    return this.permissionStatus;
  }

  isEnabled(): boolean {
    return isPermissionEnabled(this.permissionStatus);
  }

  async unregister(): Promise<void> {
    try {
      if (this.deviceToken) {
        await api.delete('/notifications/devices/unregister', {
          data: { token: this.deviceToken },
        });
      }
    } catch (error) {
      errorLogger.logApiError(error as Error, 'unregisterPush');
    }

    try {
      await deleteToken(firebaseMessaging);
    } catch (error) {
      errorLogger.logError(error, {
        source: 'PushToken',
        context: { action: 'deleteToken' },
      });
    }

    try {
      await AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
    } catch (error) {
      errorLogger.logAsyncStorageError(error, DEVICE_TOKEN_KEY, 'unregister');
    }

    this.deviceToken = null;
  }

  async end(): Promise<void> {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;

    this.foregroundUnsubscribe?.();
    this.foregroundUnsubscribe = null;

    this.openedAppUnsubscribe?.();
    this.openedAppUnsubscribe = null;

    this.tokenRefreshUnsubscribe?.();
    this.tokenRefreshUnsubscribe = null;

    this.notificationListeners.clear();
    this.isInitialized = false;
  }

  private setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void this.processBackgroundNotifications();
        void this.drainPendingNotificationNavigation();
      }
    });
  }

  private setupMessagingListeners() {
    this.foregroundUnsubscribe = onMessage(firebaseMessaging, async (remoteMessage) => {
      this.handleForegroundNotification(remoteMessage);
    });

    this.openedAppUnsubscribe = onNotificationOpenedApp(
      firebaseMessaging,
      async (remoteMessage) => {
        await this.handleNotificationTap(remoteMessage);
      },
    );

    this.tokenRefreshUnsubscribe = onTokenRefresh(firebaseMessaging, async (token) => {
      this.deviceToken = token;
      await this.persistDeviceToken(token);
      await this.registerTokenToBackend(token);
    });

    void getInitialNotification(firebaseMessaging)
      .then(async (remoteMessage) => {
        if (remoteMessage) {
          await this.handleNotificationTap(remoteMessage);
        }
      })
      .catch((error) => {
        errorLogger.logError(error, {
          source: 'PushNotification',
          context: { action: 'getInitialNotification' },
        });
      });
  }

  private async ensureRemoteMessagesRegistered(): Promise<void> {
    if (Platform.OS !== 'ios') {
      return;
    }

    try {
      if (!isDeviceRegisteredForRemoteMessages(firebaseMessaging)) {
        await registerDeviceForRemoteMessages(firebaseMessaging);
      }
    } catch (error) {
      errorLogger.logError(error, {
        source: 'PushNotification',
        context: { action: 'registerDeviceForRemoteMessages' },
      });
    }
  }

  private async registerTokenToBackend(token: string): Promise<void> {
    try {
      await api.post('/notifications/devices/register', {
        token,
        platform: normalizePlatform(),
      });

      productionAnalytics.trackPushTokenRegistered();
    } catch (error) {
      errorLogger.logApiError(error as Error, 'registerPushToken');
    }
  }

  private async persistPermissionStatus(status: PermissionStatus): Promise<void> {
    try {
      await AsyncStorage.setItem(NOTIFICATION_PERMISSION_KEY, status);
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        NOTIFICATION_PERMISSION_KEY,
        'persistPermissionStatus',
      );
    }
  }

  private async persistDeviceToken(token: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const tokenData: DeviceToken = {
        token,
        platform: normalizePlatform(),
        appVersion: '1.0.0',
        registeredAt: timestamp,
        lastUsedAt: timestamp,
      };
      await AsyncStorage.setItem(DEVICE_TOKEN_KEY, JSON.stringify(tokenData));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, DEVICE_TOKEN_KEY, 'persistDeviceToken');
    }
  }

  private async restoreDeviceToken(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
      if (!raw) {
        return;
      }

      const tokenData = JSON.parse(raw) as DeviceToken;
      this.deviceToken = tokenData.token;
      tokenData.lastUsedAt = new Date().toISOString();
      await AsyncStorage.setItem(DEVICE_TOKEN_KEY, JSON.stringify(tokenData));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, DEVICE_TOKEN_KEY, 'restoreDeviceToken');
    }
  }

  private toNotificationPayload(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): NotificationPayload {
    const data = { ...(remoteMessage.data || {}) };
    const notificationId =
      data.notification_id ||
      data.notificationId ||
      remoteMessage.messageId ||
      `notif_${Date.now()}`;

    return {
      id: String(notificationId),
      type: this.parseNotificationType(getStringValue(data.type)),
      title:
        remoteMessage.notification?.title ||
        getStringValue(data.title) ||
        'Aventaro',
      body: remoteMessage.notification?.body || getStringValue(data.body) || '',
      data: {
        ...data,
        notification_id: data.notification_id || data.notificationId || notificationId,
        notificationId: data.notification_id || data.notificationId || notificationId,
        entity_id: data.entity_id || data.entityId || null,
        entity_type: data.entity_type || data.entityType || null,
        deep_link: data.deep_link || data.deepLink || null,
      },
      priority:
        getStringValue(data.priority) === 'high' || getStringValue(data.priority) === 'low'
          ? (getStringValue(data.priority) as 'high' | 'low')
          : 'normal',
      ttl: data.ttl ? Number(data.ttl) : undefined,
      category: getStringValue(data.category),
    };
  }

  private parseNotificationType(type?: string): NotificationType {
    const normalized = (type || '').trim().toLowerCase();
    const knownTypes = new Set<NotificationType>([
      'booking',
      'chat',
      'chat_message',
      'expense',
      'match',
      'match_accept',
      'match_request',
      'message',
      'payment',
      'profile',
      'promotional',
      'social',
      'system',
      'trip',
      'trip_approval',
      'trip_invite',
      'trip_join',
      'trip_reminder',
      'trip_update',
      'verification',
    ]);

    return knownTypes.has(normalized as NotificationType)
      ? (normalized as NotificationType)
      : 'system';
  }

  private notifyListeners(payload: NotificationPayload) {
    this.notificationListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        errorLogger.logError(error, { source: 'NotificationListener' });
      }
    });
  }

  private async storeBackgroundNotification(
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(PENDING_NOTIFICATIONS_KEY);
      const queue = raw ? (JSON.parse(raw) as NotificationPayload[]) : [];
      queue.push(payload);
      await AsyncStorage.setItem(PENDING_NOTIFICATIONS_KEY, JSON.stringify(queue));
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        PENDING_NOTIFICATIONS_KEY,
        'storeBackgroundNotification',
      );
    }
  }

  private async processBackgroundNotifications(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(PENDING_NOTIFICATIONS_KEY);
      if (!raw) {
        return;
      }

      const queue = JSON.parse(raw) as NotificationPayload[];
      queue.forEach((payload) => this.notifyListeners(payload));
      await AsyncStorage.removeItem(PENDING_NOTIFICATIONS_KEY);
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        PENDING_NOTIFICATIONS_KEY,
        'processBackgroundNotifications',
      );
    }
  }

  private buildFallbackDeepLink(data?: Record<string, any>): string | null {
    if (!data) {
      return null;
    }

    if (data.deep_link || data.deepLink) {
      return String(data.deep_link || data.deepLink);
    }

    if (data.conversation_id || data.conversationId) {
      return `aventaro://chat/conversation?conversationId=${
        data.conversation_id || data.conversationId
      }`;
    }

    if (data.trip_id || data.tripId) {
      return `aventaro://trips/${data.trip_id || data.tripId}`;
    }

    if (data.entity_type && data.entity_id) {
      return `aventaro://${data.entity_type}/${data.entity_id}`;
    }

    if (data.entityType && data.entityId) {
      return `aventaro://${data.entityType}/${data.entityId}`;
    }

    return null;
  }

  private async routeNotificationPayload(
    payload: NotificationPayload,
  ): Promise<boolean> {
    const deepLink = this.buildFallbackDeepLink(payload.data);
    if (!deepLink) {
      return false;
    }

    const handled = await handleIncomingUrl(deepLink);
    if (handled) {
      await AsyncStorage.removeItem(PENDING_NOTIFICATION_OPEN_KEY).catch(() => {});
      return true;
    }

    try {
      await AsyncStorage.setItem(
        PENDING_NOTIFICATION_OPEN_KEY,
        JSON.stringify({ ...payload, data: { ...payload.data, deep_link: deepLink } }),
      );
    } catch (error) {
      errorLogger.logAsyncStorageError(
        error,
        PENDING_NOTIFICATION_OPEN_KEY,
        'routeNotificationPayload',
      );
    }

    return false;
  }
}

export const firebasePushService = new FirebasePushService();

export function registerFirebaseBackgroundHandler(): void {
  if (backgroundHandlerRegistered) {
    return;
  }

  setBackgroundMessageHandler(firebaseMessaging, async (remoteMessage) => {
    await firebasePushService.handleBackgroundRemoteMessage(remoteMessage);
  });

  backgroundHandlerRegistered = true;
}

export default firebasePushService;
