import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { fetchConversations } from '../services/chatService';
import { errorLogger } from '../services/errorLogger';
import { getUserInitials, type ChatMessageRecord, type ConversationSummary } from '../services/types';
import { COLORS } from '../theme/colors';

function formatConversationTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const now = Date.now();
    const diffMinutes = Math.max(1, Math.round((now - date.getTime()) / (1000 * 60)));
    if (diffMinutes < 60) {
      return `${diffMinutes}m`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h`;
    }

    return `${Math.round(diffHours / 24)}d`;
  } catch {
    return null;
  }
}

function upsertConversationFromMessage(
  conversations: ConversationSummary[] | null | undefined,
  currentUserId: number | null | undefined,
  message: ChatMessageRecord | null | undefined
): ConversationSummary[] {
  if (!currentUserId || !message || !message?.id) {
    return conversations || [];
  }

  const nextConversations = [...(conversations || [])];
  const conversationId = message?.conversationId || message?.conversation_id?.toString?.() || '';
  if (!conversationId) {
    return nextConversations;
  }

  const index = nextConversations.findIndex((item) => item?.id === conversationId);
  const otherUser = message?.sender?.id === currentUserId ? message?.recipient : message?.sender;

  if (index >= 0) {
    const existing = nextConversations[index];
    const updated: ConversationSummary = {
      ...existing,
      participant: existing.participant || otherUser,
      title: existing.title || otherUser?.email || 'Conversation',
      lastMessage: message?.content,
      lastMessageAt: message?.created_at,
      unreadCount:
        message?.sender?.id === currentUserId ? existing.unreadCount : (existing.unreadCount || 0) + 1,
    };

    nextConversations.splice(index, 1);
    nextConversations.unshift(updated);
    return nextConversations;
  }

  return [
    {
      id: conversationId,
      type: 'direct',
      title: otherUser?.profile?.name?.trim() || otherUser?.email || 'Conversation',
      participant: otherUser,
      lastMessage: message?.content,
      lastMessageAt: message?.created_at,
      unreadCount: message?.sender?.id === currentUserId ? 0 : 1,
    },
    ...nextConversations,
  ];
}

export default function ChatListScreen() {
  const navigation = useNavigation<any>();
  const { lastForegroundAt } = useAppRuntime();
  const { user } = useAuth();
  const { subscribe } = useRealtime();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const lastForegroundSyncRef = React.useRef(lastForegroundAt);

  const loadConversations = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user?.id) {
        setConversations([]);
        setLoading(false);
        return;
      }

      if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorMessage(null);

      try {
        const convo = await fetchConversations(user);
        setConversations(Array.isArray(convo) ? convo : []);
      } catch (error) {
        errorLogger.logError(error, { source: 'ChatListScreen', context: { action: 'loadConversations', mode } });
        setErrorMessage(extractErrorMessage(error, 'Unable to load conversations'));
      } finally {
        if (mode === 'refresh') {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      void loadConversations();
    }, [loadConversations])
  );

  React.useEffect(() => {
    if (lastForegroundAt === lastForegroundSyncRef.current) {
      return;
    }

    lastForegroundSyncRef.current = lastForegroundAt;
    void loadConversations();
  }, [lastForegroundAt, loadConversations]);

  React.useEffect(() => {
    if (!user?.id) {
      return;
    }

    return subscribe((event) => {
      if (!event?.type) {
        return;
      }

      try {
        if (event.type === 'chat.message.created' && event.data) {
          setConversations((previous) =>
            upsertConversationFromMessage(previous, user.id, event.data as ChatMessageRecord)
          );
        }

        if (event.type === 'chat.read' && event.data) {
          const conversationId =
            (event.data as { conversationId?: string; conversation_id?: string })?.conversationId ||
            (event.data as { conversationId?: string; conversation_id?: string })?.conversation_id;

          if (!conversationId) {
            return;
          }

          setConversations((previous) =>
            (previous || []).map((item) =>
              item?.id === conversationId ? { ...item, unreadCount: 0 } : item
            )
          );
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'ChatListScreen', context: { action: 'realtimeEvent', eventType: event.type } });
      }
    });
  }, [subscribe, user]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return conversations;
    }

    return conversations.filter((item) => {
      const haystack = `${item.title} ${item.lastMessage || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [conversations, query]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerIcon} onPress={() => navigateToPath(APP_PATHS.SCREEN_SETTINGS)}>
            <Ionicons name="hardware-chip-outline" size={21} color={COLORS.PRIMARY_PURPLE} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon} onPress={() => navigateToPath(APP_PATHS.TAB_CONNECT)}>
            <Ionicons name="create-outline" size={21} color={COLORS.TEXT_PRIMARY} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={COLORS.TEXT_MUTED} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search messages..."
          placeholderTextColor={COLORS.TEXT_MUTED}
          style={styles.searchInput}
        />
      </View>

      <TouchableOpacity
        style={styles.aiCard}
        activeOpacity={0.92}
        onPress={() =>
          navigation.navigate('AventaroAI', {
            initialPrompt: 'Plan my next trip using my travel history, saved places, and current budget.',
          })
        }
      >
        <View style={styles.aiIconWrap}>
          <Ionicons name="sparkles-outline" size={21} color={COLORS.WHITE} />
        </View>
        <View style={styles.aiText}>
          <Text style={styles.aiTitle}>Aventaro AI</Text>
          <Text style={styles.aiSubtitle}>Plan your perfect trip · Always available</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.PRIMARY_PURPLE} />
      </TouchableOpacity>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Messages unavailable</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadConversations()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadConversations('refresh')}
              tintColor={COLORS.PRIMARY_PURPLE}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.92}
              style={styles.row}
              onPress={() =>
                navigation.navigate('Conversation', {
                  conversationId: item.id,
                  participant: item.participant,
                })
              }
            >
              <View style={styles.avatarWrap}>
                <Text style={styles.avatarText}>{getUserInitials(item.participant)}</Text>
                <View style={styles.onlineDot} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text numberOfLines={1} style={styles.rowSubtitle}>
                  {item.lastMessage || 'No messages yet'}
                </Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTime}>{formatConversationTime(item.lastMessageAt) || 'Now'}</Text>
                {item.unreadCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.errorTitle}>No messages yet</Text>
              <Text style={styles.errorText}>Accepted connections and trip chats will appear here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: '#F5F0FF',
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 16,
  },
  aiCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    backgroundColor: '#F1EAFE',
    paddingHorizontal: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  aiIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiText: {
    flex: 1,
    gap: 2,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  aiSubtitle: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  retryButton: {
    minWidth: 120,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  listContent: {
    paddingBottom: 26,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2EEFB',
  },
  avatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F2ECFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  onlineDot: {
    position: 'absolute',
    right: 1,
    bottom: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2ED26E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  rowSubtitle: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 8,
  },
  rowTime: {
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
});
