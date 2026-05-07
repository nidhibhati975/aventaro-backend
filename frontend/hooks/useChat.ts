/**
 * Enhanced Chat Hook
 * 
 * Features:
 * - Real-time message delivery
 * - Typing indicators
 * - Read receipts
 * - Online status
 * - Optimistic updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnhancedRealtime } from './useEnhancedRealtime';
import { 
  fetchMessages, 
  sendMessage, 
  fetchConversations, 
  markConversationRead,
  buildConversationId,
} from '../services/chatService';
import { type AppUser, type ChatMessageRecord, type ConversationSummary } from '../services/types';
import { invalidateCacheByPrefixes } from '../services/cache';

interface UseChatOptions {
  conversationId?: string;
  recipientId?: number;
}

interface UseChatReturn {
  // Messages
  messages: ChatMessageRecord[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  refreshMessages: () => Promise<void>;
  
  // Conversations
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  refreshConversations: () => Promise<void>;
  
  // Real-time features
  isTyping: boolean;
  typingPartner: { userId: number; userName: string } | null;
  isPartnerOnline: boolean;
  sendTyping: () => void;
  sendStopTyping: () => void;
  
  // Read receipts
  unreadCount: number;
  markAsRead: () => Promise<void>;
  
  // Message status
  getMessageStatus: (message: ChatMessageRecord) => 'sending' | 'sent' | 'delivered' | 'read';
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const { conversationId, recipientId } = options;
  const { user } = useAuth();
  const { 
    typingStatus, 
    readReceipts, 
    onlineUsers,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMessageRead,
  } = useEnhancedRealtime();

  // Messages state
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set());

  // Conversations state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Typing state
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build conversation ID if not provided
  const resolvedConversationId = conversationId || (recipientId && user?.id 
    ? buildConversationId(user.id, recipientId) 
    : null);

  // Fetch messages
  const loadMessages = useCallback(async () => {
    if (!resolvedConversationId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await fetchMessages(resolvedConversationId);
      setMessages(data);
      
      // Mark as read after loading
      if (data.length > 0) {
        const unreadIds = data
          .filter(m => m.sender.id !== user?.id && m.messageStatus !== 'read')
          .map(m => m.id);
        
        if (unreadIds.length > 0) {
          await sendMessageRead(resolvedConversationId, unreadIds);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [resolvedConversationId, user?.id, sendMessageRead]);

  // Send message with optimistic update
  const handleSendMessage = useCallback(async (content: string) => {
    if (!recipientId || !content.trim()) return;

    // Create optimistic message
    const tempId = Date.now();
    const optimisticMessage: ChatMessageRecord = {
      id: tempId,
      conversation_id: resolvedConversationId || '',
      content: content.trim(),
      created_at: new Date().toISOString(),
      messageStatus: 'sent',
      sender: user!,
      recipient: { id: recipientId } as AppUser,
    };

    // Add optimistically
    setMessages(prev => [...prev, optimisticMessage]);
    setSendingIds(prev => new Set(prev).add(tempId));

    try {
      const sentMessage = await sendMessage(recipientId, content.trim());
      
      // Replace optimistic message with real one
      setMessages(prev => 
        prev.map(m => m.id === tempId ? sentMessage : m)
      );
      setSendingIds(prev => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
      
      // Invalidate cache
      await invalidateCacheByPrefixes(['chat:']);
    } catch (err) {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setSendingIds(prev => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
      setError(err instanceof Error ? err.message : 'Failed to send message');
    }
  }, [recipientId, resolvedConversationId, user]);

  // Refresh messages
  const refreshMessages = useCallback(async () => {
    await loadMessages();
  }, [loadMessages]);

  // Fetch conversations
  const loadConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const data = await fetchConversations(user);
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setConversationsLoading(false);
    }
  }, [user]);

  // Typing handlers
  const handleTyping = useCallback(() => {
    if (!resolvedConversationId || isTyping) return;
    
    setIsTyping(true);
    sendTypingStart(resolvedConversationId);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      sendTypingStop(resolvedConversationId);
    }, 3000);
  }, [resolvedConversationId, isTyping, sendTypingStart, sendTypingStop]);

  const handleStopTyping = useCallback(() => {
    if (!resolvedConversationId) return;
    
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    sendTypingStop(resolvedConversationId);
  }, [resolvedConversationId, sendTypingStop]);

  // Mark as read
  const handleMarkAsRead = useCallback(async () => {
    if (!resolvedConversationId) return;
    
    const unreadMessages = messages.filter(
      m => m.sender.id !== user?.id && m.messageStatus !== 'read'
    );
    
    if (unreadMessages.length > 0) {
      await sendMessageRead(
        resolvedConversationId, 
        unreadMessages.map(m => m.id)
      );
    }
  }, [resolvedConversationId, messages, user?.id, sendMessageRead]);

  // Get message status
  const getMessageStatus = useCallback((message: ChatMessageRecord): 'sending' | 'sent' | 'delivered' | 'read' => {
    if (sendingIds.has(message.id)) return 'sending';
    return message.messageStatus || 'sent';
  }, [sendingIds]);

  // Subscribe to realtime events
  useEffect(() => {
    if (!resolvedConversationId) return;

    const unsubscribe = subscribe((event) => {
      // New message received
      if (event.type === 'message' || event.type === 'new_message') {
        const data = event.data as any;
        if (data.conversationId === resolvedConversationId) {
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === data.message.id)) {
              return prev;
            }
            return [...prev, data.message];
          });
        }
      }
    });

    return unsubscribe;
  }, [resolvedConversationId, subscribe]);

  // Load messages on mount
  useEffect(() => {
    if (resolvedConversationId) {
      loadMessages();
    }
  }, [resolvedConversationId]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Get typing partner status
  const typingPartner = resolvedConversationId 
    ? typingStatus[resolvedConversationId] 
    : null;

  // Get partner online status
  const partnerId = recipientId;
  const isPartnerOnline = partnerId ? onlineUsers[partnerId] || false : false;

  // Calculate unread count
  const unreadCount = messages.filter(
    m => m.sender.id !== user?.id && m.messageStatus !== 'read'
  ).length;

  return {
    // Messages
    messages,
    loading,
    error,
    sendMessage: handleSendMessage,
    refreshMessages: loadMessages,
    
    // Conversations
    conversations,
    conversationsLoading,
    refreshConversations: loadConversations,
    
    // Real-time features
    isTyping,
    typingPartner,
    isPartnerOnline,
    sendTyping: handleTyping,
    sendStopTyping: handleStopTyping,
    
    // Read receipts
    unreadCount,
    markAsRead: handleMarkAsRead,
    
    // Message status
    getMessageStatus,
  };
}

export default useChat;