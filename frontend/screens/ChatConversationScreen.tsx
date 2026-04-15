import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import StatusView from '../components/StatusView';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { extractErrorMessage } from '../services/api';
import { errorLogger } from '../services/errorLogger';
import { safeParseString } from '../services/navigationSafety';
import {
  fetchMessages,
  markConversationRead,
  sendMessage,
} from '../services/chatService';
import { getUserDisplayName, type AppUser, type ChatMessageRecord } from '../services/types';
import { COLORS } from '../theme/colors';

function formatDay(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown date';
  }
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return 'Unknown date';
  }
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return '--:--';
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--:--';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function mergeMessages(
  current: ChatMessageRecord[],
  incoming: ChatMessageRecord | ChatMessageRecord[]
): ChatMessageRecord[] {
  const items = Array.isArray(incoming) ? incoming : [incoming];
  const map = new Map<number, ChatMessageRecord>();

  (current || []).forEach((message) => {
    if (message?.id) {
      map.set(message.id, message);
    }
  });

  items.forEach((message) => {
    if (message?.id) {
      map.set(message.id, message);
    }
  });

  return Array.from(map.values())
    .sort((left, right) => {
      const leftTime = left?.created_at ? Date.parse(left.created_at) : 0;
      const rightTime = right?.created_at ? Date.parse(right.created_at) : 0;
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      return safeLeft - safeRight;
    })
    .filter((msg) => msg && msg.id);
}

function resolveParticipantFromMessages(
  messages: ChatMessageRecord[],
  currentUserId?: number | null
): AppUser | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (const message of messages) {
    if (message?.sender?.id && message.sender.id !== currentUserId) {
      return message.sender;
    }
    if (message?.recipient?.id && message.recipient.id !== currentUserId) {
      return message.recipient;
    }
  }
  return null;
}

export default function ChatConversationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { subscribe, connectionStatus } = useRealtime();
  const conversationId = safeParseString(route.params?.conversationId, '');
  const routeParticipant = (route.params?.participant || null) as AppUser | null;
  const flatListRef = useRef<FlatList<ChatMessageRecord>>(null);
  const isNearBottomRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);

  const recipientId = useMemo(() => {
    if (routeParticipant?.id && typeof routeParticipant.id === 'number') {
      return routeParticipant.id;
    }

    try {
      const ids = conversationId
        .split(':')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);

      return ids.find((id) => id !== user?.id) || null;
    } catch {
      return null;
    }
  }, [conversationId, routeParticipant?.id, user?.id]);

  const participant = useMemo(
    () => routeParticipant || resolveParticipantFromMessages(messages, user?.id),
    [messages, routeParticipant, user?.id]
  );

  const scrollToBottom = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToEnd({ animated });
      } catch (error) {
        errorLogger.logError(error, { source: 'ChatConversationScreen', context: { action: 'scrollToBottom' } });
      }
    });
  }, []);

  const loadMessages = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!conversationId || conversationId.trim() === '') {
        setErrorMessage('Conversation ID is missing.');
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
        const nextMessages = await fetchMessages(conversationId);
        setMessages(Array.isArray(nextMessages) ? nextMessages : []);
        await markConversationRead(conversationId);
        if (mode === 'initial' || mode === 'refresh') {
          scrollToBottom(false);
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'ChatConversationScreen', context: { action: 'loadMessages', mode } });
        setErrorMessage(extractErrorMessage(error, 'Unable to load messages'));
        setMessages([]);
      } finally {
        if (mode === 'refresh') {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [conversationId, scrollToBottom]
  );

  useFocusEffect(
    useCallback(() => {
      void loadMessages();
      return undefined;
    }, [loadMessages])
  );

  React.useEffect(() => {
    if (!conversationId || !user) {
      return;
    }

    return subscribe((event) => {
      if (event.type === 'chat.message.created' && event.data) {
        const message = event.data as ChatMessageRecord;
        const eventConversationId = message?.conversationId || message?.conversation_id;
        if (!eventConversationId || String(eventConversationId) !== conversationId) {
          return;
        }

        setMessages((previous) => mergeMessages(previous, message));
        if (isNearBottomRef.current) {
          scrollToBottom(true);
        }

        if (message.sender?.id && message.sender.id !== user.id) {
          void markConversationRead(conversationId);
        }
      }

      if (event.type === 'chat.read' && event.data) {
        const payload = event.data as {
          conversationId?: string;
          conversation_id?: string;
          userId?: number;
          user_id?: number;
          readAt?: string | null;
          read_at?: string | null;
        };

        const eventConversationId = payload.conversationId || payload.conversation_id;
        const readerId = payload.userId || payload.user_id;

        if (!eventConversationId || eventConversationId !== conversationId || readerId === user.id) {
          return;
        }

        setMessages((previous) =>
          previous.map((message) =>
            message.sender.id === user.id
              ? {
                  ...message,
                  message_status: 'read',
                  messageStatus: 'read',
                  read_at: payload.readAt || payload.read_at || message.read_at || null,
                  readAt: payload.readAt || payload.read_at || message.readAt || null,
                }
              : message
          )
        );
      }
    });
  }, [conversationId, scrollToBottom, subscribe, user]);

  const handleSend = async () => {
    if (!recipientId || !draft.trim()) {
      return;
    }

    try {
      setSending(true);
      const createdMessage = await sendMessage(recipientId, draft.trim());
      setDraft('');
      setMessages((previous) => mergeMessages(previous, createdMessage));
      scrollToBottom(true);
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to send message'));
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item, index }: { item: ChatMessageRecord; index: number }) => {
    const previous = messages[index - 1];
    const isMine = item.sender?.id === user?.id;
    const showDayDivider = !previous || formatDay(previous.created_at) !== formatDay(item.created_at);
    const statusLabel =
      (item.messageStatus || item.message_status || 'sent').replace(/^./, (value) =>
        value.toUpperCase()
      );

    return (
      <View>
        {showDayDivider ? (
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>{formatDay(item.created_at)}</Text>
          </View>
        ) : null}

        <View style={[styles.messageWrap, isMine ? styles.messageWrapMine : styles.messageWrapTheirs]}>
          <View style={[styles.messageBubble, isMine ? styles.messageBubbleMine : styles.messageBubbleTheirs]}>
            <Text style={[styles.messageText, isMine && styles.messageTextMine]}>{item.content}</Text>
            <View style={styles.messageMetaRow}>
              <Text style={[styles.messageTime, isMine && styles.messageTimeMine]}>
                {formatTime(item.created_at)}
              </Text>
              {isMine ? (
                <Text style={[styles.messageStatus, isMine && styles.messageStatusMine]}>{statusLabel}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{getUserDisplayName(participant)}</Text>
          <Text style={styles.headerSubtitle}>
            {connectionStatus === 'connected' ? 'Live now' : connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Offline'}
          </Text>
        </View>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <StatusView type="loading" message="Loading messages..." />
      ) : errorMessage ? (
        <StatusView
          type="error"
          title="Conversation unavailable"
          message={errorMessage}
          onRetry={() => void loadMessages()}
        />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (isNearBottomRef.current) {
                scrollToBottom(false);
              }
            }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const distanceFromBottom =
                contentSize.height - (contentOffset.y + layoutMeasurement.height);
              isNearBottomRef.current = distanceFromBottom < 96;
            }}
            scrollEventThrottle={16}
            refreshing={refreshing}
            onRefresh={() => void loadMessages('refresh')}
            ListEmptyComponent={
              <StatusView
                type="empty"
                title="No messages yet"
                message="Start the conversation. New messages will appear here instantly."
              />
            }
          />

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message..."
              placeholderTextColor={COLORS.TEXT_MUTED}
              multiline
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => void handleSend()}
              disabled={sending || !recipientId}
            >
              {sending ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <Ionicons name="send" size={18} color={COLORS.WHITE} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 12,
    gap: 6,
  },
  dayDivider: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dayDividerText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.TEXT_MUTED,
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  messageWrap: {
    marginBottom: 6,
  },
  messageWrapMine: {
    alignItems: 'flex-end',
  },
  messageWrapTheirs: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  messageBubbleMine: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderBottomRightRadius: 4,
  },
  messageBubbleTheirs: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.TEXT_PRIMARY,
  },
  messageTextMine: {
    color: COLORS.WHITE,
  },
  messageMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  messageTime: {
    fontSize: 11,
    color: COLORS.TEXT_MUTED,
  },
  messageTimeMine: {
    color: COLORS.ACCENT_PURPLE,
  },
  messageStatus: {
    fontSize: 11,
    color: COLORS.TEXT_MUTED,
  },
  messageStatusMine: {
    color: COLORS.ACCENT_PURPLE,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.TEXT_PRIMARY,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
