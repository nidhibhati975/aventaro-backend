/**
 * Production-Grade Chat Service
 * 
 * Features:
 * - Message pagination (load older messages)
 * - Retry failed messages (queue system)
 * - Offline support (local cache)
 * - Media messages (image upload + preview)
 * - Typing indicator optimization (debounce)
 * - Message status tracking
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { extractErrorMessage, getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import { getUserDisplayName, type AppUser, type ChatMessageRecord, type ConversationSummary } from './types';
import { errorLogger } from './errorLogger';

// ============== TYPES ==============

export interface MediaAttachment {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  mime_type: string;
  size: number;
}

interface PresignedMediaUpload extends MediaAttachment {
  uploadId?: string;
  upload_id?: string;
  upload_url?: string;
  uploadUrl?: string;
  upload_method?: string;
  uploadMethod?: string;
  upload_headers?: Record<string, string>;
  uploadHeaders?: Record<string, string>;
}

export interface ChatMessage extends Omit<ChatMessageRecord, 'message_status' | 'messageStatus'> {
  message_status?: 'sent' | 'delivered' | 'read' | 'sending';
  messageStatus?: 'sent' | 'delivered' | 'read' | 'sending';
  localId?: string;
  // Extended properties
  retryCount?: number;
  isSending?: boolean;
  isFailed?: boolean;
  media?: MediaAttachment[];
  reactions?: Record<string, string[]>;
  replyTo?: number;
}

export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SendMessageOptions {
  recipientUserId: number;
  content: string;
  media?: MediaAttachment[];
  replyTo?: number;
  priority?: 'high' | 'normal' | 'low';
}

export interface TypingIndicator {
  conversationId: string;
  userId: number;
  isTyping: boolean;
  timestamp: number;
}

// ============== CONSTANTS ==============

const CHAT_CACHE_TTL_MS = 15 * 1000;
const MESSAGES_PER_PAGE = 30;
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 2000;
const TYPING_DEBOUNCE_MS = 300;
const TYPING_TIMEOUT_MS = 5000;

// Storage keys
const PENDING_MESSAGES_KEY = 'chat:pendingMessages';
const OFFLINE_MESSAGES_KEY = 'chat:offlineMessages';
const DRAFT_MESSAGE_KEY = 'chat:draft:';

// ============== UTILITIES ==============

function buildConversationId(firstUserId: number, secondUserId: number): string {
  return [firstUserId, secondUserId].sort((a, b) => a - b).join(':');
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============== MESSAGE PAGINATION ==============

/**
 * Fetch messages with pagination
 */
export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit: number = MESSAGES_PER_PAGE
): Promise<MessagePage> {
  try {
    const params = new URLSearchParams();
    if (cursor) {
      params.append('cursor', cursor);
    }
    params.append('limit', String(limit));

    const cacheKey = `chat:messages:${conversationId}:${cursor || 'initial'}`;
    
    return getCachedOrFetch(cacheKey, CHAT_CACHE_TTL_MS, async () => {
      const response = await api.get(`/chat/${conversationId}?${params.toString()}`);
      const data = getApiData<any>(response);
      
      const messages = (data.messages || []).map((msg: any) => transformToChatMessage(msg));
      
      return {
        messages,
        nextCursor: data.next_cursor || data.nextCursor || null,
        hasMore: Boolean(data.has_more || data.hasMore || data.next_cursor || data.nextCursor),
      };
    });
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to load messages'));
  }
}

/**
 * Fetch older messages (for infinite scroll up)
 */
export async function fetchOlderMessages(
  conversationId: string,
  beforeMessageId: number
): Promise<MessagePage> {
  return fetchMessages(conversationId, `before:${beforeMessageId}`);
}

/**
 * Fetch newer messages (for real-time sync)
 */
export async function fetchNewerMessages(
  conversationId: string,
  afterMessageId: number
): Promise<MessagePage> {
  return fetchMessages(conversationId, `after:${afterMessageId}`);
}

// ============== MESSAGE SENDING WITH RETRY ==============

interface PendingMessage {
  id: string;
  localId: string;
  recipientUserId: number;
  content: string;
  media?: MediaAttachment[];
  replyTo?: number;
  timestamp: number;
  retryCount: number;
  status: 'pending' | 'sending' | 'failed';
}

/**
 * Send a message with automatic retry
 */
export async function sendMessageWithRetry(
  options: SendMessageOptions
): Promise<ChatMessage> {
  const { recipientUserId, content, media, replyTo, priority = 'normal' } = options;
  
  const localId = generateMessageId();
  const timestamp = Date.now();
  
  // Create optimistic message
  const optimisticMessage: ChatMessage = {
    id: 0, // Will be updated when server responds
    localId,
    conversation_id: buildConversationId(0, recipientUserId),
    content,
    created_at: new Date(timestamp).toISOString(),
    message_status: 'sending',
    sender: { id: 0, email: '' }, // Will be updated
    recipient: { id: recipientUserId, email: '' },
    isSending: true,
    retryCount: 0,
    media,
    replyTo,
  };

  // Add to pending queue
  await addToPendingQueue({
    id: localId,
    localId,
    recipientUserId,
    content,
    media,
    replyTo,
    timestamp,
    retryCount: 0,
    status: 'pending',
  });

  // Try to send
  return sendWithRetry(optimisticMessage, priority);
}

async function sendWithRetry(
  message: ChatMessage,
  priority: 'high' | 'normal' | 'low',
  retryCount: number = 0
): Promise<ChatMessage> {
  try {
    // Update status to sending
    await updatePendingStatus(message.localId || message.id.toString(), 'sending');

    const response = await api.post('/chat/send', {
      recipient_user_id: message.recipient.id,
      content: message.content,
      media: message.media?.map((m) => m.id),
      reply_to: message.replyTo,
      local_id: message.localId || message.id.toString(),
    });

    const sentMessage = getApiData<ChatMessageRecord>(response);
    
    // Success - remove from pending queue
    await removeFromPendingQueue(message.localId || message.id.toString());
    await invalidateCacheByPrefixes(['chat:conversations', 'match:']);

    return {
      ...sentMessage,
      isSending: false,
      isFailed: false,
    };
  } catch (error) {
    errorLogger.logApiError(error, 'sendMessageWithRetry', {
      context: {
        recipientUserId: message.recipient.id,
        retryCount,
      },
    });

    // Increment retry count
    const newRetryCount = retryCount + 1;

    if (newRetryCount >= MAX_RETRY_COUNT) {
      // Max retries reached - mark as failed
      await updatePendingStatus(message.localId || message.id.toString(), 'failed');
      
      return {
        ...message,
        isSending: false,
        isFailed: true,
        retryCount: newRetryCount,
      };
    }

    // Wait before retry
    await new Promise<void>((resolve) => setTimeout(() => resolve(), RETRY_DELAY_MS * newRetryCount));

    // Retry
    return sendWithRetry(message, priority, newRetryCount);
  }
}

/**
 * Retry a failed message
 */
export async function retryFailedMessage(messageId: string): Promise<ChatMessage> {
  const pending = await getPendingMessage(messageId);
  if (!pending) {
    throw new Error('Message not found in pending queue');
  }

  return sendWithRetry(
    {
      id: 0,
      localId: pending.localId,
      conversation_id: buildConversationId(0, pending.recipientUserId),
      content: pending.content,
      created_at: new Date(pending.timestamp).toISOString(),
      message_status: 'sending',
      sender: { id: 0, email: '' },
      recipient: { id: pending.recipientUserId, email: '' },
      isSending: true,
      retryCount: pending.retryCount,
      media: pending.media,
      replyTo: pending.replyTo,
    },
    'normal',
    pending.retryCount
  );
}

/**
 * Cancel a pending message
 */
export async function cancelPendingMessage(messageId: string): Promise<void> {
  await removeFromPendingQueue(messageId);
}

// ============== PENDING QUEUE MANAGEMENT ==============

async function addToPendingQueue(message: PendingMessage): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESSAGES_KEY);
    const queue: PendingMessage[] = raw ? JSON.parse(raw) : [];
    queue.push(message);
    await AsyncStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(queue));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, PENDING_MESSAGES_KEY, 'addToPendingQueue');
  }
}

async function updatePendingStatus(
  messageId: string,
  status: 'pending' | 'sending' | 'failed'
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESSAGES_KEY);
    if (!raw) return;
    
    const queue: PendingMessage[] = JSON.parse(raw);
    const index = queue.findIndex((m) => m.localId === messageId);
    
    if (index !== -1) {
      queue[index].status = status;
      if (status === 'failed') {
        queue[index].retryCount += 1;
      }
      await AsyncStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, PENDING_MESSAGES_KEY, 'updatePendingStatus');
  }
}

async function removeFromPendingQueue(messageId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESSAGES_KEY);
    if (!raw) return;
    
    const queue: PendingMessage[] = JSON.parse(raw);
    const filtered = queue.filter((m) => m.localId !== messageId);
    await AsyncStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(filtered));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, PENDING_MESSAGES_KEY, 'removeFromPendingQueue');
  }
}

async function getPendingMessage(messageId: string): Promise<PendingMessage | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESSAGES_KEY);
    if (!raw) return null;
    
    const queue: PendingMessage[] = JSON.parse(raw);
    return queue.find((m) => m.localId === messageId) || null;
  } catch (error) {
    errorLogger.logAsyncStorageError(error, PENDING_MESSAGES_KEY, 'getPendingMessage');
    return null;
  }
}

/**
 * Get all pending messages
 */
export async function getAllPendingMessages(): Promise<PendingMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESSAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    errorLogger.logAsyncStorageError(error, PENDING_MESSAGES_KEY, 'getAllPendingMessages');
    return [];
  }
}

/**
 * Retry all failed messages
 */
export async function retryAllFailedMessages(): Promise<void> {
  const pending = await getAllPendingMessages();
  const failed = pending.filter((m) => m.status === 'failed');
  
  for (const message of failed) {
    try {
      await retryFailedMessage(message.localId);
    } catch (error) {
      errorLogger.logApiError(error, 'retryAllFailedMessages', { context: { messageId: message.localId } });
    }
  }
}

// ============== OFFLINE SUPPORT ==============

/**
 * Store message for offline sending
 */
export async function storeOfflineMessage(
  conversationId: string,
  content: string
): Promise<void> {
  try {
    const key = `${OFFLINE_MESSAGES_KEY}${conversationId}`;
    const raw = await AsyncStorage.getItem(key);
    const messages: string[] = raw ? JSON.parse(raw) : [];
    messages.push(content);
    await AsyncStorage.setItem(key, JSON.stringify(messages));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, OFFLINE_MESSAGES_KEY, 'storeOfflineMessage');
  }
}

/**
 * Get offline messages for a conversation
 */
export async function getOfflineMessages(conversationId: string): Promise<string[]> {
  try {
    const key = `${OFFLINE_MESSAGES_KEY}${conversationId}`;
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    errorLogger.logAsyncStorageError(error, OFFLINE_MESSAGES_KEY, 'getOfflineMessages');
    return [];
  }
}

/**
 * Clear offline messages after sending
 */
export async function clearOfflineMessages(conversationId: string): Promise<void> {
  try {
    const key = `${OFFLINE_MESSAGES_KEY}${conversationId}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, OFFLINE_MESSAGES_KEY, 'clearOfflineMessages');
  }
}

/**
 * Send all offline messages when back online
 */
export async function sendOfflineMessages(
  conversationId: string,
  recipientUserId: number
): Promise<ChatMessage[]> {
  const offlineMessages = await getOfflineMessages(conversationId);
  const results: ChatMessage[] = [];

  for (const content of offlineMessages) {
    try {
      const message = await sendMessageWithRetry({
        recipientUserId,
        content,
      });
      results.push(message);
    } catch (error) {
      errorLogger.logApiError(error, 'sendOfflineMessages', { context: { content } });
    }
  }

  await clearOfflineMessages(conversationId);
  return results;
}

// ============== DRAFT MESSAGES ==============

/**
 * Save draft message
 */
export async function saveDraft(conversationId: string, content: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${DRAFT_MESSAGE_KEY}${conversationId}`, content);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, DRAFT_MESSAGE_KEY, 'saveDraft');
  }
}

/**
 * Get draft message
 */
export async function getDraft(conversationId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(`${DRAFT_MESSAGE_KEY}${conversationId}`)) || '';
  } catch (error) {
    errorLogger.logAsyncStorageError(error, DRAFT_MESSAGE_KEY, 'getDraft');
    return '';
  }
}

/**
 * Clear draft message
 */
export async function clearDraft(conversationId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${DRAFT_MESSAGE_KEY}${conversationId}`);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, DRAFT_MESSAGE_KEY, 'clearDraft');
  }
}

// ============== MEDIA MESSAGES ==============

/**
 * Upload media attachment
 */
export async function uploadMedia(
  uri: string,
  type: 'image' | 'video' | 'audio',
  onProgress?: (progress: number) => void
): Promise<MediaAttachment> {
  try {
    if (type === 'audio') {
      throw new Error('Audio upload is not supported for chat media');
    }
    const filename = uri.split('/').pop() || 'media';
    const mimeType = type === 'image' ? 'image/jpeg' : 'video/mp4';
    const blob = await fetch(uri).then((response) => response.blob());
    const createResponse = await api.post('/chat/media/upload', {
      filename,
      mime_type: mimeType,
      size: blob.size,
      type,
    });

    const upload = getApiData<PresignedMediaUpload>(createResponse);
    const uploadUrl = upload.uploadUrl || upload.upload_url;
    const uploadHeaders = upload.uploadHeaders || upload.upload_headers || {};
    if (!uploadUrl) {
      throw new Error('Server did not return a presigned upload URL');
    }

    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', uploadUrl);
      Object.entries(uploadHeaders).forEach(([key, value]) => {
        request.setRequestHeader(key, value);
      });
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${request.status}`));
        }
      };
      request.onerror = () => reject(new Error('Upload failed'));
      request.send(blob);
    });

    const uploadId = upload.uploadId || upload.upload_id || upload.id;
    const completeResponse = await api.post(`/chat/media/upload/${uploadId}/complete`, {});
    return getApiData<MediaAttachment>(completeResponse);
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to upload media'));
  }
}

/**
 * Get media upload progress
 */
export async function getMediaUploadProgress(uploadId: string): Promise<number> {
  try {
    const response = await api.get(`/chat/media/upload/${uploadId}/progress`);
    const payload = getApiData<any>(response);
    if (typeof payload === 'number') {
      return payload;
    }
    return Number(payload?.progress || 0);
  } catch {
    return 0;
  }
}

// ============== TYPING INDICATOR ==============

let typingTimeout: ReturnType<typeof setTimeout> | null = null;
let lastTypingSent = 0;

/**
 * Send typing indicator (debounced)
 */
export function sendTypingIndicator(
  conversationId: string,
  isTyping: boolean
): void {
  const now = Date.now();
  
  // Debounce
  if (now - lastTypingSent < TYPING_DEBOUNCE_MS) {
    return;
  }
  
  lastTypingSent = now;

  // Clear existing timeout
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }

  // Send typing start/stop via WebSocket
  // This would be handled by the realtime service
  if (isTyping) {
    // Auto-stop after timeout
    typingTimeout = setTimeout(() => {
      // Would send typing stopped event
    }, TYPING_TIMEOUT_MS);
  }
}

/**
 * Clear typing indicator timeout
 */
export function clearTypingIndicator(): void {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
}

// ============== MESSAGE STATUS ==============

/**
 * Update message status (sent, delivered, read)
 */
export async function updateMessageStatus(
  conversationId: string,
  messageId: number,
  status: 'sent' | 'delivered' | 'read'
): Promise<void> {
  try {
    await api.post(`/chat/${conversationId}/message/${messageId}/status`, {
      status,
    });
  } catch (error) {
      errorLogger.logApiError(error, 'updateMessageStatus', { context: { messageId, status } });
  }
}

/**
 * Mark message as read
 */
export async function markMessageRead(
  conversationId: string,
  messageId: number
): Promise<void> {
  await updateMessageStatus(conversationId, messageId, 'read');
  await invalidateCacheByPrefixes([`chat:messages:${conversationId}`, 'chat:conversations']);
}

// ============== CONVERSATIONS ==============

export async function fetchConversations(_currentUser?: AppUser): Promise<ConversationSummary[]> {
  try {
    return getCachedOrFetch('chat:conversations', CHAT_CACHE_TTL_MS, async () => {
      const response = await api.get('/chat/conversations');
      const items = getApiData<any[]>(response) || [];

      return items.map((item) => ({
        id: String(item.id),
        type: item.conversationType || item.conversation_type || 'direct',
        title: getUserDisplayName(item.participant),
        participant: item.participant,
        lastMessage: item.lastMessage || item.last_message || null,
        lastMessageAt: item.lastMessageAt || item.last_message_at || null,
        unreadCount: Number(item.unreadCount || item.unread_count || 0),
      }));
    });
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to load conversations'));
  }
}

export async function markConversationRead(conversationId: string): Promise<void> {
  try {
    await api.post(`/chat/${conversationId}/read`);
    await invalidateCacheByPrefixes([`chat:messages:${conversationId}`, 'chat:conversations', 'notifications']);
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to mark conversation as read'));
  }
}

// ============== UTILITY FUNCTIONS ==============

function transformToChatMessage(msg: any): ChatMessage {
  return {
    id: msg.id,
    conversation_id: msg.conversationId || msg.conversation_id,
    content: msg.content,
    created_at: msg.createdAt || msg.created_at,
    message_status: msg.messageStatus || msg.message_status || 'sent',
    read_at: msg.readAt || msg.read_at,
    sender: msg.sender,
    recipient: msg.recipient,
    media: msg.media,
    reactions: msg.reactions,
    replyTo: msg.replyTo || msg.reply_to,
  };
}

/**
 * Get message by ID (from cache or API)
 */
export async function getMessageById(
  conversationId: string,
  messageId: number
): Promise<ChatMessage | null> {
  try {
    const response = await api.get(`/chat/${conversationId}/message/${messageId}`);
    return transformToChatMessage(getApiData<any>(response));
  } catch {
    return null;
  }
}

/**
 * Delete message
 */
export async function deleteMessage(
  conversationId: string,
  messageId: number
): Promise<void> {
  try {
    await api.delete(`/chat/${conversationId}/message/${messageId}`);
    await invalidateCacheByPrefixes([`chat:messages:${conversationId}`]);
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to delete message'));
  }
}

/**
 * Edit message
 */
export async function editMessage(
  conversationId: string,
  messageId: number,
  newContent: string
): Promise<ChatMessage> {
  try {
    const response = await api.put(`/chat/${conversationId}/message/${messageId}`, {
      content: newContent,
    });
    await invalidateCacheByPrefixes([`chat:messages:${conversationId}`]);
    return transformToChatMessage(getApiData<any>(response));
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to edit message'));
  }
}

// Export types
export type { PendingMessage };
