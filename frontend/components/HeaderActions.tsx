import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useRealtime } from '../contexts/RealtimeContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { fetchUnreadNotificationCount } from '../services/notificationService';
import { COLORS } from '../theme/colors';

interface HeaderActionsProps {
  showSettings?: boolean;
}

export default function HeaderActions({ showSettings = false }: HeaderActionsProps) {
  const [notificationCount, setNotificationCount] = useState(0);
  const { subscribe } = useRealtime();

  const refreshBadge = useCallback(async () => {
    try {
      setNotificationCount(await fetchUnreadNotificationCount());
    } catch {
      setNotificationCount(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshBadge();
    }, [refreshBadge])
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
        void refreshBadge();
      }
    });
  }, [refreshBadge, subscribe]);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open notifications"
        style={styles.iconButton}
        onPress={() => navigateToPath(APP_PATHS.SCREEN_NOTIFICATIONS)}
      >
        <Ionicons name="notifications-outline" size={21} color={COLORS.TEXT_PRIMARY} />
        {notificationCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{notificationCount > 9 ? '9+' : notificationCount}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      {showSettings ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={styles.iconButton}
          onPress={() => navigateToPath(APP_PATHS.SCREEN_SETTINGS)}
        >
          <Ionicons name="settings-outline" size={21} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
});
