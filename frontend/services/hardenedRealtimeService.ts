/**
 * Hardened Real-Time Service
 * 
 * Production features:
 * - Event acknowledgment (ACK) system
 * - Message queue for missed events
 * - Reconnect logic with state sync
 * - Event ordering (timestamp/version based)
 * - Offline queue persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildWebsocketUrl, clearStoredAuthTokens } from './api';
import { invalidateCacheByPrefixes } from './cache';
import { errorLogger } from './errorLogger';

// ============== TYPES ==============

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
  timestamp?: number;
  version?: number;
}

// ACK System Types
export interface PendingAck {
  id: string;
  type: string;
  data: unknown;
  timestamp: number;
  retries: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface AckResponse {
  success: boolean;
  event_id?: string;
  error?: string;
  server_time?: number;
}

// Message Queue Types
export interface QueuedEvent {
  id: string;
  event: RealtimeEvent;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
  retries: number;
}

export interface EventOrder {
  event_id: string;
  timestamp: number;
  version: number;
}

// State Sync Types
export interface ClientState {
  lastProcessedEventId: number;
  lastProcessedTimestamp: number;
  joinedRooms: string[];
  pendingEvents: string[];
  serverVersion: number;
}

export interface StateSyncResponse {
  events: RealtimeEvent[];
  serverVersion: number;
  missedEventIds: number[];
}

// ============== CONSTANTS ==============

const ACK_TIMEOUT_MS = 10000;
const MAX_ACK_RETRIES = 3;
const MAX_QUEUE_SIZE = 100;
const MAX_PENDING_ACKS = 50;
const STATE_SYNC_INTERVAL_MS = 60000;
const MAX_RECONNECT_DELAY_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 20000;
const MAX_DEDUPE_KEYS = 500;

// Storage keys
const PENDING_ACKS_KEY = 'realtime:pendingAcks';
const EVENT_QUEUE_KEY = 'realtime:eventQueue';
const CLIENT_STATE_KEY = 'realtime:clientState';
const LAST_EVENT_ID_KEY = 'realtime:lastEventId';

// ============== UTILITIES ==============

function generateEventId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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

// ============== MAIN SERVICE ==============

class HardenedRealtimeService {
  // Socket & Connection
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private status: RealtimeConnectionStatus = 'idle';
  private manualDisconnect = false;
  private suspended = false;
  private networkAvailable = true;
  private reconnectAttempt = 0;
  private openingPromise: Promise<void> | null = null;
  private socketErrorPending = false;

  // Timers
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stateSyncTimer: ReturnType<typeof setInterval> | null = null;

  // ACK System
  private pendingAcks = new Map<string, PendingAck>();
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Message Queue
  private eventQueue: QueuedEvent[] = [];
  private isProcessingQueue = false;

  // Event Ordering
  private lastProcessedEventId = 0;
  private lastProcessedTimestamp = 0;
  private serverVersion = 0;
  private eventBuffer: RealtimeEvent[] = [];
  private isBuffering = false;

  // Deduplication
  private dedupeKeys: string[] = [];
  private dedupeSet = new Set<string>();

  // Listeners
  private listeners = new Set<(event: RealtimeEvent) => void>();
  private statusListeners = new Set<(status: RealtimeConnectionStatus) => void>();

  // Joined rooms tracking
  private joinedRooms = new Set<string>();

  // ============== PUBLIC API ==============

  getStatus() {
    return this.status;
  }

  getServerVersion() {
    return this.serverVersion;
  }

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToStatus(listener: (status: RealtimeConnectionStatus) => void) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // ============== CONNECTION MANAGEMENT ==============

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
    await this.restoreClientState();
  }

  disconnect() {
    this.manualDisconnect = true;
    this.token = null;
    this.suspended = false;
    this.joinedRooms.clear();
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.stopStateSync();
    this.clearAllAcks();
    this.clearEventQueue();
    
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
    this.stopStateSync();

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
    await this.syncState();
  }

  async setNetworkAvailable(isAvailable: boolean) {
    this.networkAvailable = isAvailable;

    if (!isAvailable) {
      this.clearReconnectTimer();
      this.stopHeartbeat();
      this.stopStateSync();

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

  // ============== ROOM MANAGEMENT ==============

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

  // ============== ACK SYSTEM ==============

  /**
   * Send an event that requires acknowledgment
   * Returns a promise that resolves when ACK is received
   */
  async sendWithAck<T = unknown>(
    eventType: string,
    data: unknown,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    const eventId = generateEventId();
    const timestamp = Date.now();

    // Check queue size
    if (this.eventQueue.length >= MAX_QUEUE_SIZE) {
      // Remove lowest priority event
      this.removeLowestPriorityEvent();
    }

    // Create pending ACK
    return new Promise((resolve, reject) => {
      const pendingAck: PendingAck = {
        id: eventId,
        type: eventType,
        data,
        timestamp,
        retries: 0,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Add to pending ACKs
      if (this.pendingAcks.size >= MAX_PENDING_ACKS) {
        reject(new Error('Too many pending ACKs'));
        return;
      }

      this.pendingAcks.set(eventId, pendingAck);

      // Set ACK timeout
      const ackTimer = setTimeout(() => {
        this.handleAckTimeout(eventId);
      }, ACK_TIMEOUT_MS);
      this.ackTimers.set(eventId, ackTimer);

      // Send the event
      const event: RealtimeEvent = {
        type: eventType,
        data,
        timestamp,
        version: this.serverVersion + 1,
      };

      this.sendCommand({
        action: 'publish',
        event_id: eventId,
        event_type: eventType,
        data,
        timestamp,
        version: event.version,
        priority,
      });
    });
  }

  private handleAckTimeout(eventId: string) {
    const pending = this.pendingAcks.get(eventId);
    if (!pending) return;

    pending.retries++;

    if (pending.retries >= MAX_ACK_RETRIES) {
      // Max retries reached, reject the promise
      pending.reject(new Error(`ACK timeout after ${MAX_ACK_RETRIES} retries`));
      this.pendingAcks.delete(eventId);
      errorLogger.logWebSocketError(
        new Error('ACK timeout'),
        'handleAckTimeout',
        { eventId, retries: pending.retries }
      );
    } else {
      // Retry the event
      const ackTimer = setTimeout(() => {
        this.handleAckTimeout(eventId);
      }, ACK_TIMEOUT_MS);
      this.ackTimers.set(eventId, ackTimer);

      // Resend
      this.sendCommand({
        action: 'publish',
        event_id: eventId,
        event_type: pending.type,
        data: pending.data,
        timestamp: pending.timestamp,
        version: this.serverVersion + 1,
        retry: true,
      });
    }
  }

  private handleAckResponse(response: AckResponse) {
    const pending = this.pendingAcks.get(response.event_id || '');
    if (!pending) return;

    // Clear timeout
    const timer = this.ackTimers.get(response.event_id || '');
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(response.event_id || '');
    }

    if (response.success) {
      pending.resolve(response);
    } else {
      pending.reject(new Error(response.error || 'ACK failed'));
    }

    this.pendingAcks.delete(response.event_id || '');
  }

  private clearAllAcks() {
    this.ackTimers.forEach((timer) => clearTimeout(timer));
    this.ackTimers.clear();
    this.pendingAcks.forEach((pending) => {
      pending.reject(new Error('Connection closed'));
    });
    this.pendingAcks.clear();
  }

  // ============== MESSAGE QUEUE ==============

  /**
   * Queue an event for delivery when connection is available
   */
  queueEvent(event: RealtimeEvent, priority: 'high' | 'normal' | 'low' = 'normal') {
    const queuedEvent: QueuedEvent = {
      id: generateEventId(),
      event,
      timestamp: Date.now(),
      priority,
      retries: 0,
    };

    // Add to queue based on priority
    if (priority === 'high') {
      this.eventQueue.unshift(queuedEvent);
    } else {
      this.eventQueue.push(queuedEvent);
    }

    // Persist queue to storage
    this.persistEventQueue();

    // Try to process if connected
    if (this.status === 'connected') {
      this.processEventQueue();
    }
  }

  private async processEventQueue() {
    if (this.isProcessingQueue || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.eventQueue.length > 0 && this.status === 'connected') {
      const queuedEvent = this.eventQueue.shift();
      if (!queuedEvent) break;

      try {
        this.sendCommand({
          action: 'publish',
          event_id: queuedEvent.id,
          event_type: queuedEvent.event.type,
          data: queuedEvent.event.data,
          timestamp: queuedEvent.timestamp,
          queued: true,
        });
      } catch (error) {
        // Re-queue failed event
        queuedEvent.retries++;
        if (queuedEvent.retries < 3) {
          this.eventQueue.push(queuedEvent);
        }
        errorLogger.logWebSocketError(error, 'processEventQueue');
      }
    }

    this.isProcessingQueue = false;
    this.persistEventQueue();
  }

  private removeLowestPriorityEvent() {
    // Remove lowest priority (low) first, then normal
    const lowIndex = this.eventQueue.findIndex((e) => e.priority === 'low');
    if (lowIndex !== -1) {
      this.eventQueue.splice(lowIndex, 1);
      return;
    }

    const normalIndex = this.eventQueue.findIndex((e) => e.priority === 'normal');
    if (normalIndex !== -1) {
      this.eventQueue.splice(normalIndex, 1);
      return;
    }

    // If all are high, remove oldest
    this.eventQueue.shift();
  }

  private async persistEventQueue() {
    try {
      await AsyncStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(this.eventQueue));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, EVENT_QUEUE_KEY, 'persistEventQueue');
    }
  }

  private async restoreEventQueue() {
    try {
      const raw = await AsyncStorage.getItem(EVENT_QUEUE_KEY);
      if (raw) {
        this.eventQueue = JSON.parse(raw);
        // Filter out old events (older than 24 hours)
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.eventQueue = this.eventQueue.filter((e) => e.timestamp > cutoff);
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, EVENT_QUEUE_KEY, 'restoreEventQueue');
      this.eventQueue = [];
    }
  }

  private clearEventQueue() {
    this.eventQueue = [];
    AsyncStorage.removeItem(EVENT_QUEUE_KEY).catch(() => {});
  }

  // ============== STATE SYNC ==============

  private async restoreClientState() {
    try {
      const raw = await AsyncStorage.getItem(CLIENT_STATE_KEY);
      if (raw) {
        const state: ClientState = JSON.parse(raw);
        this.lastProcessedEventId = state.lastProcessedEventId;
        this.lastProcessedTimestamp = state.lastProcessedTimestamp;
        this.serverVersion = state.serverVersion || 0;
        
        // Restore joined rooms
        state.joinedRooms?.forEach((room) => this.joinedRooms.add(room));
      }
    } catch (error) {
      errorLogger.logAsyncStorageError(error, CLIENT_STATE_KEY, 'restoreClientState');
    }
  }

  private async persistClientState() {
    try {
      const state: ClientState = {
        lastProcessedEventId: this.lastProcessedEventId,
        lastProcessedTimestamp: this.lastProcessedTimestamp,
        joinedRooms: Array.from(this.joinedRooms),
        pendingEvents: Array.from(this.pendingAcks.keys()),
        serverVersion: this.serverVersion,
      };
      await AsyncStorage.setItem(CLIENT_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      errorLogger.logAsyncStorageError(error, CLIENT_STATE_KEY, 'persistClientState');
    }
  }

  private async syncState() {
    if (this.status !== 'connected') return;

    try {
      // Request state sync from server
      this.sendCommand({
        action: 'sync',
        last_event_id: this.lastProcessedEventId,
        last_timestamp: this.lastProcessedTimestamp,
        server_version: this.serverVersion,
      });
    } catch (error) {
      errorLogger.logWebSocketError(error, 'syncState');
    }
  }

  private handleStateSyncResponse(response: StateSyncResponse) {
    // Update server version
    this.serverVersion = response.serverVersion;

    // Process missed events
    if (response.events && response.events.length > 0) {
      // Sort by timestamp/version to ensure ordering
      const sortedEvents = response.events.sort((a, b) => {
        const timeDiff = (a.timestamp || 0) - (b.timestamp || 0);
        if (timeDiff !== 0) return timeDiff;
        return (a.version || 0) - (b.version || 0);
      });

      // Process each event
      sortedEvents.forEach((event) => {
        this.processEvent(event);
      });
    }

    // Persist state
    this.persistClientState();
  }

  private startStateSync() {
    this.stopStateSync();
    this.stateSyncTimer = setInterval(() => {
      this.syncState();
    }, STATE_SYNC_INTERVAL_MS);
  }

  private stopStateSync() {
    if (this.stateSyncTimer) {
      clearInterval(this.stateSyncTimer);
      this.stateSyncTimer = null;
    }
  }

  // ============== EVENT PROCESSING ==============

  private processEvent(event: RealtimeEvent) {
    // Check for ACK response
    if (event.type === 'ack') {
      this.handleAckResponse(event.data as AckResponse);
      return;
    }

    // Check for state sync response
    if (event.type === 'state.sync') {
      this.handleStateSyncResponse(event.data as StateSyncResponse);
      return;
    }

    // Check ordering - buffer if we have a gap
    const eventId = (event.data as Record<string, unknown>)?.id as number;
    if (eventId && eventId > this.lastProcessedEventId + 1) {
      // Gap detected, buffer events
      this.eventBuffer.push(event);
      this.isBuffering = true;
      return;
    }

    // Process the event
    this.emitEvent(event);

    // Update last processed
    if (eventId) {
      this.lastProcessedEventId = eventId;
    }
    if (event.timestamp) {
      this.lastProcessedTimestamp = event.timestamp;
    }

    // Process buffered events
    if (this.isBuffering) {
      this.processEventBuffer();
    }

    // Persist state
    this.persistClientState();
  }

  private processEventBuffer() {
    // Sort buffer by timestamp/version
    this.eventBuffer.sort((a, b) => {
      const timeDiff = (a.timestamp || 0) - (b.timestamp || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.version || 0) - (b.version || 0);
    });

    // Process in order
    const toProcess: RealtimeEvent[] = [];
    for (const event of this.eventBuffer) {
      const eventId = (event.data as Record<string, unknown>)?.id as number;
      if (eventId === this.lastProcessedEventId + 1 || toProcess.length === 0) {
        toProcess.push(event);
      } else {
        break;
      }
    }

    // Remove processed from buffer
    this.eventBuffer = this.eventBuffer.slice(toProcess.length);

    // Emit processed events
    toProcess.forEach((event) => {
      this.emitEvent(event);
      const eventId = (event.data as Record<string, unknown>)?.id as number;
      if (eventId) {
        this.lastProcessedEventId = eventId;
      }
      if (event.timestamp) {
        this.lastProcessedTimestamp = event.timestamp;
      }
    });

    this.isBuffering = this.eventBuffer.length > 0;
  }

  private emitEvent(event: RealtimeEvent) {
    // Deduplication
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

    // Invalidate caches
    this.invalidateAffectedCaches(event);

    // Emit to listeners
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

  // ============== SOCKET MANAGEMENT ==============

  private async ensureSocketOpen() {
    if (!this.openingPromise) {
      this.openingPromise = this.openSocket().finally(() => {
        this.openingPromise = null;
      });
    }

    await this.openingPromise;
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

    const afterMessageId = this.lastProcessedEventId;
    const socket = new WebSocket(
      buildWebsocketUrl('/chat/ws', {
        token: this.token,
        after_message_id: afterMessageId > 0 ? afterMessageId : undefined,
        server_version: this.serverVersion,
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
      this.startStateSync();
      
      // Rejoin rooms
      this.joinedRooms.forEach((room) => {
        this.sendCommand({ action: 'join', room });
      });

      // Process queued events
      this.processEventQueue();
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
      this.stopStateSync();
      this.socket = null;
      this.socketErrorPending = false;

      if (event.code === 4401) {
        void clearStoredAuthTokens();
        this.emitEvent({ type: 'auth.expired' });
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
      const parsed = normalizeKeys(
        typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload
      );
      if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
        return;
      }

      const event: RealtimeEvent = {
        type: parsed.type,
        data: parsed.data,
        timestamp: parsed.timestamp as number | undefined,
        version: parsed.version as number | undefined,
      };

      this.processEvent(event);
    } catch (error) {
      errorLogger.logWebSocketError(error, 'handleIncomingMessage');
    }
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
      // Queue if not connected
      if (this.status !== 'connected' && this.status !== 'reconnecting') {
        try {
          const parsed = JSON.parse(payload);
          this.queueEvent(
            { type: parsed.event_type || 'unknown', data: parsed.data },
            parsed.priority || 'normal'
          );
        } catch {
          // Not a JSON command, ignore
        }
      }
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
}

export const hardenedRealtimeService = new HardenedRealtimeService();

// Export types
export type {
  PendingAck,
  AckResponse,
  QueuedEvent,
  EventOrder,
  ClientState,
  StateSyncResponse,
};