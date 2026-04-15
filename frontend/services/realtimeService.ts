import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildWebsocketUrl, clearStoredAuthTokens } from './api';
import { invalidateCacheByPrefixes } from './cache';
import { errorLogger } from './errorLogger';

export type RealtimeConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface RealtimeEvent<T = unknown> {
  type: string;
  data?: T;
}

type RealtimeListener = (event: RealtimeEvent) => void;
type StatusListener = (status: RealtimeConnectionStatus) => void;

const LAST_MESSAGE_ID_KEY = 'realtime:lastMessageId';
const HEARTBEAT_INTERVAL_MS = 20000;
const MAX_RECONNECT_DELAY_MS = 15000;
const MAX_DEDUPE_KEYS = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function camelizeKey(value: string): string {
  return value.replace(/[_-]([a-z0-9])/gi, (_, character: string) => character.toUpperCase());
}

function normalizeKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeys(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, rawValue]) => {
    const nextValue = normalizeKeys(rawValue);
    normalized[key] = nextValue;

    const camelKey = camelizeKey(key);
    if (camelKey !== key && !Object.prototype.hasOwnProperty.call(normalized, camelKey)) {
      normalized[camelKey] = nextValue;
    }
  });

  return normalized as T;
}

class RealtimeService {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private manualDisconnect = false;
  private status: RealtimeConnectionStatus = 'idle';
  private listeners = new Set<RealtimeListener>();
  private statusListeners = new Set<StatusListener>();
  private joinedRooms = new Set<string>();
  private dedupeKeys: string[] = [];
  private dedupeSet = new Set<string>();
  private suspended = false;
  private networkAvailable = true;
  private openingPromise: Promise<void> | null = null;
  private socketErrorPending = false;

  getStatus() {
    return this.status;
  }

  subscribe(listener: RealtimeListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async connect(token: string) {
    this.manualDisconnect = false;
    this.token = token;

    if (!this.canMaintainConnection()) {
      this.setStatus('disconnected');
      return;
    }

    if (
      this.token === token &&
      this.socket &&
      this.status !== 'disconnected' &&
      this.status !== 'error'
    ) {
      return;
    }

    await this.ensureSocketOpen();
  }

  disconnect() {
    this.manualDisconnect = true;
    this.token = null;
    this.suspended = false;
    this.joinedRooms.clear();
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  suspend() {
    this.suspended = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    } else {
      this.setStatus('disconnected');
    }
  }

  async resume() {
    if (!this.token) {
      return;
    }

    this.manualDisconnect = false;
    this.suspended = false;

    if (!this.canMaintainConnection()) {
      this.setStatus('disconnected');
      return;
    }

    if (this.socket && this.status !== 'disconnected' && this.status !== 'error') {
      return;
    }

    await this.ensureSocketOpen();
  }

  async setNetworkAvailable(isAvailable: boolean) {
    this.networkAvailable = isAvailable;

    if (!isAvailable) {
      this.clearReconnectTimer();
      this.stopHeartbeat();

      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }

      this.setStatus('disconnected');
      return;
    }

    if (!this.suspended) {
      await this.resume();
    }
  }

  private async ensureSocketOpen() {
    if (!this.openingPromise) {
      this.openingPromise = this.openSocket().finally(() => {
        this.openingPromise = null;
      });
    }

    await this.openingPromise;
  }

  joinTripRoom(tripId: number) {
    const room = `trip:${tripId}`;
    this.joinedRooms.add(room);
    this.sendCommand({ action: 'join', room });
  }

  leaveTripRoom(tripId: number) {
    const room = `trip:${tripId}`;
    this.joinedRooms.delete(room);
    this.sendCommand({ action: 'leave', room });
  }

  private async openSocket() {
    if (!this.canMaintainConnection()) {
      this.setStatus('disconnected');
      return;
    }

    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const afterMessageId = await this.getLastMessageId();
    const socket = new WebSocket(
      buildWebsocketUrl('/chat/ws', {
        token: this.token,
        after_message_id: afterMessageId > 0 ? afterMessageId : undefined,
      })
    );

    this.socket = socket;
    this.socketErrorPending = false;
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      this.joinedRooms.forEach((room) => {
        this.sendCommand({ action: 'join', room });
      });
    };

    socket.onmessage = (event) => {
      void this.handleIncomingMessage(event.data);
    };

    socket.onerror = (event) => {
      if (this.socket === socket) {
        this.socketErrorPending = true;
      }
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.stopHeartbeat();
      this.socket = null;
      this.socketErrorPending = false;

      if (event.code === 4401) {
        void clearStoredAuthTokens();
        this.emit({ type: 'auth.expired' });
        this.setStatus('disconnected');
        return;
      }

      if (event.code === 4400) {
        this.setStatus('disconnected');
        return;
      }

      if (this.manualDisconnect) {
        this.setStatus('disconnected');
        return;
      }

      if (!this.canMaintainConnection()) {
        this.setStatus('disconnected');
        return;
      }

      this.scheduleReconnect();
    };
  }

  private async handleIncomingMessage(rawPayload: unknown) {
    try {
      const parsed = normalizeKeys(typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload);
      if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
        return;
      }

      const event: RealtimeEvent = {
        type: parsed.type,
        data: parsed.data,
      };

      const dedupeKey = this.buildDedupeKey(event);
      if (dedupeKey && this.dedupeSet.has(dedupeKey)) {
        return;
      }

      if (dedupeKey) {
        this.dedupeSet.add(dedupeKey);
        this.dedupeKeys.push(dedupeKey);
        if (this.dedupeKeys.length > MAX_DEDUPE_KEYS) {
          const oldestKey = this.dedupeKeys.shift();
          if (oldestKey) {
            this.dedupeSet.delete(oldestKey);
          }
        }
      }

      await this.persistLastMessageId(event);
      await this.invalidateAffectedCaches(event);
      this.emit(event);
    } catch (error) {
      errorLogger.logWebSocketError(error, 'handleIncomingMessage');
    }
  }

  private buildDedupeKey(event: RealtimeEvent): string | null {
    const data = isPlainObject(event.data) ? event.data : null;

    switch (event.type) {
      case 'chat.message.created':
      case 'chat.message':
        return data && typeof data.id === 'number' ? `${event.type}:${data.id}` : null;
      case 'chat.read':
        return data
          ? `${event.type}:${data.conversationId || data.conversation_id}:${data.userId || data.user_id}:${data.lastReadMessageId || data.last_read_message_id}`
          : null;
      case 'trip.joined':
      case 'trip.left':
        return data
          ? `${event.type}:${data.tripId || data.trip_id}:${isPlainObject(data.user) ? data.user.id : 'unknown'}`
          : null;
      case 'expense.created':
      case 'expense.settled':
        return data && typeof data.id === 'number' ? `${event.type}:${data.id}` : null;
      default:
        return null;
    }
  }

  private async persistLastMessageId(event: RealtimeEvent) {
    if (event.type !== 'chat.message.created' && event.type !== 'chat.message') {
      return;
    }

    const data = isPlainObject(event.data) ? event.data : null;
    const messageId = typeof data?.id === 'number' ? data.id : null;
    if (!messageId) {
      return;
    }

    const currentValue = await this.getLastMessageId();
    if (messageId > currentValue) {
      try {
        await AsyncStorage.setItem(LAST_MESSAGE_ID_KEY, String(messageId));
      } catch (error) {
        errorLogger.logAsyncStorageError(error, LAST_MESSAGE_ID_KEY, 'writeRealtimeMessageId');
      }
    }
  }

  private async getLastMessageId(): Promise<number> {
    try {
      const raw = await AsyncStorage.getItem(LAST_MESSAGE_ID_KEY);
      const parsed = raw ? Number(raw) : 0;
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }

      if (raw) {
        await AsyncStorage.removeItem(LAST_MESSAGE_ID_KEY);
      }
      return 0;
    } catch (error) {
      errorLogger.logAsyncStorageError(error, LAST_MESSAGE_ID_KEY, 'readRealtimeMessageId');
      return 0;
    }
  }

  private async invalidateAffectedCaches(event: RealtimeEvent) {
    switch (event.type) {
      case 'chat.message.created':
      case 'chat.message':
      case 'chat.read':
        await invalidateCacheByPrefixes(['chat:', 'notifications']);
        break;
      case 'trip.joined':
      case 'trip.left':
      case 'expense.created':
      case 'expense.settled':
        await invalidateCacheByPrefixes(['trips:', 'discover:trips', 'notifications']);
        break;
      case 'notification.created':
        await invalidateCacheByPrefixes(['notifications']);
        break;
      default:
        break;
    }
  }

  private emit(event: RealtimeEvent) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        errorLogger.logWebSocketError(error, 'emitListener', {
          context: { eventType: event.type },
        });
      }
    });
  }

  private setStatus(status: RealtimeConnectionStatus) {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        errorLogger.logWebSocketError(error, 'emitStatus', {
          context: { status },
        });
      }
    });
  }

  private scheduleReconnect() {
    if (!this.canMaintainConnection()) {
      this.setStatus('disconnected');
      return;
    }

    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      void this.ensureSocketOpen();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw('ping');
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendCommand(command: Record<string, unknown>) {
    this.sendRaw(JSON.stringify(command));
  }

  private sendRaw(payload: string) {
    if (!this.socket || this.status !== 'connected') {
      return;
    }

    try {
      this.socket.send(payload);
    } catch (error) {
      errorLogger.logWebSocketError(error, 'sendRaw');
    }
  }

  private canMaintainConnection() {
    return Boolean(this.token) && !this.manualDisconnect && !this.suspended && this.networkAvailable;
  }
}

export const realtimeService = new RealtimeService();
