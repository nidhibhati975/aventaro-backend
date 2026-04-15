import api, { extractErrorMessage, getApiData } from './api';
import { getCachedOrFetch, invalidateCacheByPrefixes } from './cache';
import { getUserDisplayName, type AppUser, type ChatMessageRecord, type ConversationSummary } from './types';

export function buildConversationId(firstUserId: number, secondUserId: number): string {
  return [firstUserId, secondUserId].sort((a, b) => a - b).join(':');
}

const CHAT_CACHE_TTL_MS = 15 * 1000;

export async function fetchMessages(conversationId: string): Promise<ChatMessageRecord[]> {
  try {
    return getCachedOrFetch(`chat:messages:${conversationId}`, CHAT_CACHE_TTL_MS, async () => {
      const response = await api.get(`/chat/${conversationId}`);
      return getApiData<ChatMessageRecord[]>(response) || [];
    });
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to load messages'));
  }
}

export async function sendMessage(recipientUserId: number, content: string): Promise<ChatMessageRecord> {
  try {
    const response = await api.post('/chat/send', {
      recipient_user_id: recipientUserId,
      content,
    });
    await invalidateCacheByPrefixes(['chat:conversations', 'match:']);
    return getApiData<ChatMessageRecord>(response);
  } catch (error) {
    throw new Error(extractErrorMessage(error, 'Unable to send message'));
  }
}

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
