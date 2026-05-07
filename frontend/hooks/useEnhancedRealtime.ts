/**
 * Enhanced Realtime System
 * 
 * Features:
 * - Typing indicators
 * - Read receipts
 * - Online status
 * - Message delivery status
 * - Enhanced event types
 */

import { realtimeService, type RealtimeEvent } from './realtimeService';
import { useAuth } from '../contexts/AuthContext';
import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { errorLogger } from '../services/errorLogger';
import { useCallback, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

// Event types for enhanced realtime
export type EnhancedRealtimeEvent = 
  | { type: 'typing_start'; data: { conversationId: string; userId: number } }
  | { type: 'typing_stop'; data: { conversationId: string; userId: number } }
  | { type: 'message_read'; data: { conversationId: string; messageIds: number[]; readBy: number } }
  | { type: 'message_delivered'; data: { conversationId: string; messageId: number } }
  | { type: 'user_online'; data: { userId: number } }
  | { type: 'user_offline'; data: { userId: number } }
  | { type: 'match_new'; data: { matchId: number; userId: number } }
  | { type: 'trip_update'; data: { tripId: number; action: string } }
  | RealtimeEvent;

interface TypingStatus {
  [conversationId: string]: {
    userId: number;
    userName: string;
    startedAt: number;
  } | null;
}

interface ReadReceipts {
  [conversationId: string]: {
    messageIds: number[];
    readBy: number;
    readAt: number;
  };
}

interface OnlineUsers {
  [userId: number]: boolean;
}

interface EnhancedRealtimeValue {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  typingStatus: TypingStatus;
  readReceipts: ReadReceipts;
  onlineUsers: OnlineUsers;
  subscribe: (listener: (event: EnhancedRealtimeEvent) => void) => () => void;
  sendTypingStart: (conversationId: string) => void;
  sendTypingStop: (conversationId: string) => void;
  sendMessageRead: (conversationId: string, messageIds: number[]) => void;
  joinTripRoom: (tripId: number | null | undefined) => void;
  leaveTripRoom: (tripId: number | null | undefined) => void;
}

export function useEnhancedRealtime(): EnhancedRealtimeValue {
  const { token } = useAuth();
  const { isForeground, isOnline } = useAppRuntime();
  const [connectionStatus, setConnectionStatus] = useState<realtimeService.getStatus extends () => infer S ? S : never>(realtimeService.getStatus());
  const [typingStatus, setTypingStatus] = useState<TypingStatus>({});
  const [readReceipts, setReadReceipts] = useState<ReadReceipts>({});
  const [onlineUsers, setOnlineUsers] = useState<OnlineUsers>({});

  // Subscribe to status changes
  useEffect(() => {
    return realtimeService.subscribeToStatus((status) => {
      setConnectionStatus(status as any);
    });
  }, []);

  // Connect/disconnect based on auth and app state
  useEffect(() => {
    if (!token) {
      realtimeService.disconnect();
      return;
    }

    void (async () => {
      try {
        await realtimeService.connect(token);
      } catch (error) {
        errorLogger.logError(error, { source: 'EnhancedRealtime', action: 'connect' });
      }
    })();

    return () => {
      realtimeService.disconnect();
    };
  }, [token]);

  // Handle network changes
  useEffect(() => {
    void realtimeService.setNetworkAvailable(isOnline);
  }, [isOnline]);

  // Handle app state changes
  useEffect(() => {
    if (!token) return;

    void (async () => {
      try {
        if (isForeground && isOnline) {
          await realtimeService.resume();
        } else {
          realtimeService.suspend();
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'EnhancedRealtime', action: 'appState' });
      }
    });
  }, [isForeground, isOnline, token]);

  // Subscribe to realtime events
  const subscribe = useCallback((listener: (event: EnhancedRealtimeEvent) => void) => {
    return realtimeService.subscribe((event: RealtimeEvent) => {
      // Handle typing events
      if (event.type === 'typing_start' || event.type === 'typing') {
        const data = event.data as any;
        setTypingStatus(prev => ({
          ...prev,
          [data.conversationId]: {
            userId: data.userId,
            userName: data.userName || 'User',
            startedAt: Date.now(),
          },
        }));
        
        // Auto-clear typing after 5 seconds
        setTimeout(() => {
          setTypingStatus(prev => ({
            ...prev,
            [data.conversationId]: null,
          }));
        }, 5000);
      }

      if (event.type === 'typing_stop') {
        const data = event.data as any;
        setTypingStatus(prev => ({
          ...prev,
          [data.conversationId]: null,
        }));
      }

      // Handle read receipts
      if (event.type === 'message_read' || event.type === 'read') {
        const data = event.data as any;
        setReadReceipts(prev => ({
          ...prev,
          [data.conversationId]: {
            messageIds: data.messageIds,
            readBy: data.readBy,
            readAt: Date.now(),
          },
        }));
      }

      // Handle delivery status
      if (event.type === 'message_delivered' || event.type === 'delivered') {
        const data = event.data as any;
        setReadReceipts(prev => ({
          ...prev,
          [data.conversationId]: {
            ...prev[data.conversationId],
            messageIds: [...(prev[data.conversationId]?.messageIds || []), data.messageId],
            readBy: 0,
            readAt: Date.now(),
          },
        }));
      }

      // Handle online status
      if (event.type === 'user_online') {
        const data = event.data as any;
        setOnlineUsers(prev => ({
          ...prev,
          [data.userId]: true,
        }));
      }

      if (event.type === 'user_offline') {
        const data = event.data as any;
        setOnlineUsers(prev => ({
          ...prev,
          [data.userId]: false,
        }));
      }

      // Pass through to listener
      listener(event as EnhancedRealtimeEvent);
    });
  }, []);

  // Send typing start
  const sendTypingStart = useCallback((conversationId: string) => {
    realtimeService.sendCommand({
      action: 'typing',
      conversation_id: conversationId,
      typing: true,
    });
  }, []);

  // Send typing stop
  const sendTypingStop = useCallback((conversationId: string) => {
    realtimeService.sendCommand({
      action: 'typing',
      conversation_id: conversationId,
      typing: false,
    });
  }, []);

  // Send read receipt
  const sendMessageRead = useCallback((conversationId: string, messageIds: number[]) => {
    realtimeService.sendCommand({
      action: 'read',
      conversation_id: conversationId,
      message_ids: messageIds,
    });
  }, []);

  // Join trip room
  const joinTripRoom = useCallback((tripId: number | null | undefined) => {
    if (tripId) {
      realtimeService.joinTripRoom(tripId);
    }
  }, []);

  // Leave trip room
  const leaveTripRoom = useCallback((tripId: number | null | undefined) => {
    if (tripId) {
      realtimeService.sendCommand({ action: 'leave', room: `trip:${tripId}` });
    }
  }, []);

  return {
    connectionStatus,
    typingStatus,
    readReceipts,
    onlineUsers,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMessageRead,
    joinTripRoom,
    leaveTripRoom,
  };
}

export default useEnhancedRealtime;