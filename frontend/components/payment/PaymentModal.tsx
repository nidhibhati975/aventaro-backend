import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { openBookingPaymentCheckout } from '../../services/bookingService';
import { extractErrorMessage } from '../../services/api';
import { COLORS } from '../../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  bookingId: string | number;
  amount: number;
  currency?: string;
  onPaymentSuccess: (transactionId: string) => void;
}

export default function PaymentModal({
  visible,
  onClose,
  bookingId,
  amount,
  currency = 'USD',
  onPaymentSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStartCheckout = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const session = await openBookingPaymentCheckout(Number(bookingId));
      onPaymentSuccess(session.payment_id);
      onClose();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to create Stripe Checkout session.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.TEXT_SECONDARY} />
          </TouchableOpacity>

          <Text style={styles.title}>Stripe Checkout</Text>
          <Text style={styles.amountText}>
            {currency} {amount.toFixed(2)}
          </Text>
          <Text style={styles.description}>
            Aventaro now routes booking payments through Stripe Checkout. You will finish payment in the browser, then return to the app.
          </Text>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <TouchableOpacity
            style={[styles.payButton, loading && styles.payButtonDisabled]}
            onPress={() => void handleStartCheckout()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.WHITE} />
            ) : (
              <>
                <Ionicons name="card-outline" size={18} color={COLORS.WHITE} />
                <Text style={styles.payButtonText}>Open Checkout</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.OVERLAY,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: COLORS.SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  closeButton: {
    alignSelf: 'flex-end',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  amountText: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  errorText: {
    fontSize: 13,
    color: COLORS.DANGER,
  },
  payButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  payButtonDisabled: {
    opacity: 0.7,
  },
  payButtonText: {
    color: COLORS.WHITE,
    fontSize: 16,
    fontWeight: '700',
  },
});
