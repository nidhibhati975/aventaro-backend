import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useRealtime } from '../contexts/RealtimeContext';
import { extractErrorMessage } from '../services/api';
import { fetchNotifications, markNotificationRead, markNotificationsRead } from '../services/notificationService';
import type { NotificationRecord } from '../services/types';
import { COLORS } from '../theme/colors';

function formatRelativeTime(value: string | null | undefined) {
  if (!value) {
    return 'Now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Now';
  }

  const diffMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / (1000 * 60)));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function getNotificationVisual(type: string | undefined) {
  switch (type) {
    case 'match_request':
    case 'match_accept':
    case 'match':
      return {
        icon: 'people-outline',
        backgroundColor: '#F5EEFF',
        iconColor: COLORS.PRIMARY_PURPLE,
        title: 'New Connection Request',
      };
    case 'chat_message':
    case 'chat':
      return {
        icon: 'chatbubble-outline',
        backgroundColor: '#EEF4FF',
        iconColor: '#5B82FF',
        title: 'New Message',
      };
    case 'payment':
    case 'payment_success':
      return {
        icon: 'card-outline',
        backgroundColor: '#FFF1F4',
        iconColor: '#E86A84',
        title: 'Payment Update',
      };
    case 'trip_join':
    case 'trip_approval':
    case 'trip':
      return {
        icon: 'calendar-outline',
        backgroundColor: '#F2FFF4',
        iconColor: '#29A95C',
        title: 'Trip Reminder',
      };
    case 'profile':
    case 'new_follower':
      return {
        icon: 'sparkles-outline',
        backgroundColor: '#F6F1FF',
        iconColor: COLORS.PRIMARY_PURPLE,
        title: 'Profile Update',
      };
    default:
      return {
        icon: 'notifications-outline',
        backgroundColor: '#F6F1FF',
        iconColor: COLORS.PRIMARY_PURPLE,
        title: 'Notification',
      };
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { subscribe } = useRealtime();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const unreadIds = useMemo(
    () => notifications.filter((item) => !item.is_read).map((item) => item.id),
    [notifications]
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const items = await fetchNotifications();
      setNotifications(Array.isArray(items) ? items : []);
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to load notifications'));
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications();
    }, [loadNotifications])
  );

  React.useEffect(() => {
    return subscribe((event) => {
      if (
        event.type === 'chat.message.created' ||
        event.type === 'chat.message' ||
        event.type === 'trip.joined' ||
        event.type === 'trip.left' ||
        event.type === 'expense.created' ||
        event.type === 'expense.settled' ||
        event.type === 'notification.created'
      ) {
        void loadNotifications();
      }
    });
  }, [loadNotifications, subscribe]);

  const routeNotification = async (item: NotificationRecord) => {
    if (!item.is_read) {
      try {
        await markNotificationRead(item.id);
        setNotifications((current) =>
          current.map((notification) =>
            notification.id === item.id ? { ...notification, is_read: true } : notification
          )
        );
      } catch {
        // Ignore mark-read failures, navigation should still continue.
      }
    }

    if ((item.type === 'chat' || item.type === 'chat_message') && item.entity_id) {
      navigation.navigate('Conversation', { conversationId: String(item.entity_id) });
      return;
    }

    if ((item.type === 'trip' || item.type === 'trip_join' || item.type === 'trip_approval') && item.entity_id) {
      navigation.navigate('TripDetails', { tripId: Number(item.entity_id) });
      return;
    }

    if (item.type === 'payment' || item.type === 'payment_success') {
      navigation.navigate('Payments');
      return;
    }

    if (
      (item.type === 'match' ||
        item.type === 'match_request' ||
        item.type === 'match_accept' ||
        item.type === 'profile' ||
        item.type === 'new_follower') &&
      item.entity_id
    ) {
      navigation.navigate('PublicProfile', { userId: Number(item.entity_id) });
    }
  };

  const handleMarkAllRead = async () => {
    if (!unreadIds.length) {
      return;
    }

    try {
      await markNotificationsRead(unreadIds);
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to mark notifications as read'));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={() => void handleMarkAllRead()} disabled={!unreadIds.length} style={styles.headerAction}>
          <Text style={[styles.headerActionText, !unreadIds.length && styles.headerActionTextDisabled]}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Notifications unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadNotifications()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : notifications.length ? (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const visual = getNotificationVisual(item.type);

            return (
              <TouchableOpacity
                activeOpacity={0.92}
                style={[styles.notificationCard, !item.is_read && styles.notificationCardUnread]}
                onPress={() => void routeNotification(item)}
              >
                <View style={[styles.iconWrap, { backgroundColor: visual.backgroundColor }]}>
                  <Ionicons name={visual.icon} size={20} color={visual.iconColor} />
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.notificationTitle}>{visual.title}</Text>
                  <Text style={styles.notificationBody}>{item.body}</Text>
                  <Text style={styles.notificationTime}>{formatRelativeTime(item.created_at)}</Text>
                </View>
                {!item.is_read ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyText}>Live trip, chat, match, and payment updates will appear here.</Text>
        </View>
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
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerAction: {
    minWidth: 72,
    alignItems: 'flex-end',
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  headerActionTextDisabled: {
    color: COLORS.TEXT_MUTED,
  },
  listContent: {
    paddingBottom: 24,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3EEFF',
    backgroundColor: '#FFFFFF',
  },
  notificationCardUnread: {
    backgroundColor: '#F5F1FF',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  notificationBody: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
  },
  notificationTime: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 18,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
});
