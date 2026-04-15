import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { COLORS } from '../theme/colors';

export default function NetworkStatusBanner() {
  const { isOnline, checkingNetwork, refreshNetworkState } = useAppRuntime();

  if (isOnline) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>You are offline. Some actions may fail.</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => void refreshNetworkState()}>
        {checkingNetwork ? (
          <ActivityIndicator color={COLORS.WHITE} size="small" />
        ) : (
          <Text style={styles.retryText}>Retry</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.SECONDARY_PURPLE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  retryButton: {
    minWidth: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: {
    color: COLORS.WHITE,
    fontSize: 12,
    fontWeight: '700',
  },
});
