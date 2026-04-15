import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { COLORS } from '../theme/colors';

interface StatusViewProps {
  type: 'loading' | 'empty' | 'error';
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export default function StatusView({
  type,
  title,
  message,
  retryLabel = 'Retry',
  onRetry,
}: StatusViewProps) {
  if (type === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        <Text style={styles.message}>{message || 'Loading...'}</Text>
      </View>
    );
  }

  const iconName = type === 'error' ? 'warning-outline' : 'folder-open-outline';
  const iconColor = type === 'error' ? COLORS.WARNING : COLORS.TEXT_MUTED;

  return (
    <View style={styles.container}>
      <Ionicons name={iconName} size={48} color={iconColor} />
      <Text style={styles.title}>{title || (type === 'error' ? 'Something went wrong' : 'Nothing here yet')}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {type === 'error' && onRetry ? (
        <TouchableOpacity style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>{retryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  title: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    minWidth: 120,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
  },
  buttonText: {
    color: COLORS.WHITE,
    fontSize: 14,
    fontWeight: '700',
  },
});
