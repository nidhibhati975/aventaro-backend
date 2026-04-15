import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { APP_PATHS, navigateToPath } from '../navigation/router';
import { setPremiumRequiredHandler } from '../services/api';
import { COLORS } from '../theme/colors';

interface PaywallContextValue {
  openPaywall: (message?: string) => void;
  closePaywall: () => void;
}

const PaywallContext = createContext<PaywallContextValue>({
  openPaywall: () => undefined,
  closePaywall: () => undefined,
});

export function usePaywall() {
  return useContext(PaywallContext);
}

export function PaywallProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('Upgrade to access this feature');

  const openPaywall = (nextMessage?: string) => {
    setMessage(nextMessage || 'Upgrade to access this feature');
    setVisible(true);
  };

  const closePaywall = () => {
    setVisible(false);
  };

  useEffect(() => {
    setPremiumRequiredHandler(({ message: nextMessage }) => {
      openPaywall(nextMessage);
    });

    return () => setPremiumRequiredHandler(null);
  }, []);

  const value = useMemo(
    () => ({
      openPaywall,
      closePaywall,
    }),
    []
  );

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <Modal transparent animationType="fade" visible={visible} onRequestClose={closePaywall}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.iconWrap}>
              <Ionicons name="diamond-outline" size={30} color={COLORS.PRIMARY_PURPLE} />
            </View>
            <Text style={styles.title}>Premium Required</Text>
            <Text style={styles.body}>{message}</Text>
            <View style={styles.benefitList}>
              <Text style={styles.benefitText}>Unlimited matches, joins, and AI usage</Text>
              <Text style={styles.benefitText}>Profile and trip boosts</Text>
              <Text style={styles.benefitText}>Higher ranking across discovery</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                closePaywall();
                navigateToPath(APP_PATHS.SCREEN_PAYMENTS);
              }}
            >
              <Text style={styles.primaryButtonText}>Upgrade</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={closePaywall}>
              <Text style={styles.secondaryButtonText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </PaywallContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.OVERLAY,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    padding: 24,
    gap: 14,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  benefitList: {
    gap: 8,
  },
  benefitText: {
    fontSize: 13,
    color: COLORS.TEXT_PRIMARY,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
});
