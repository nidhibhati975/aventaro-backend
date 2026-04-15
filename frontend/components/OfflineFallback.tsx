import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { COLORS } from '../theme/colors';

export default function OfflineFallback() {
  const { isOnline, checkingNetwork, refreshNetworkState } = useAppRuntime();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isOnline) {
      setDismissed(false);
    }
  }, [isOnline]);

  if (isOnline || dismissed) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.overlayWrap}>
      <View style={styles.card}>
        <Text style={styles.title}>No Internet Connection</Text>
        <Text style={styles.subtitle}>
          You can keep browsing cached content or retry when your connection is back.
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.retryButton]}
            onPress={() => void refreshNetworkState()}
            disabled={checkingNetwork}
          >
            {checkingNetwork ? (
              <ActivityIndicator size="small" color={COLORS.WHITE} />
            ) : (
              <Text style={styles.retryText}>Retry</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.dismissButton]}
            onPress={() => setDismissed(true)}
          >
            <Text style={styles.dismissText}>Continue Offline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
    zIndex: 9999,
  },
  card: {
    backgroundColor: COLORS.TEXT_PRIMARY,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    color: COLORS.WHITE,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: COLORS.ACCENT_PURPLE,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  dismissButton: {
    backgroundColor: COLORS.SECONDARY_PURPLE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  retryText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '700',
  },
  dismissText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '600',
  },
});
