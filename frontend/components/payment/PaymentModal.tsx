import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import api, { extractErrorMessage } from '../../services/api';
import { COLORS } from '../../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  bookingId: string;
  amount: number;
  currency?: string;
  onPaymentSuccess: (transactionId: string) => void;
}

type PaymentMethod = 'razorpay' | 'stripe' | 'upi' | 'paypal';

interface UpiState {
  qr_image: string;
  expires_at: string;
  transaction_id: string;
}

export default function PaymentModal({
  visible,
  onClose,
  bookingId,
  amount,
  currency = 'INR',
  onPaymentSuccess,
}: Props) {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollingUpi, setPollingUpi] = useState(false);
  const [upiState, setUpiState] = useState<UpiState | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const paymentMethods = [
    { id: 'upi', name: 'UPI QR Code', icon: 'qr-code', color: COLORS.PRIMARY_PURPLE, supported: true },
    { id: 'paypal', name: 'PayPal', icon: 'logo-paypal', color: COLORS.SECONDARY_PURPLE, supported: true },
    { id: 'razorpay', name: 'Razorpay (SDK)', icon: 'card', color: COLORS.ACCENT_PURPLE, supported: false },
    { id: 'stripe', name: 'Stripe (SDK)', icon: 'globe', color: COLORS.PRIMARY_PURPLE, supported: false },
  ];

  useEffect(() => {
    return () => stopUpiPolling();
  }, []);

  useEffect(() => {
    if (!visible) {
      stopUpiPolling();
      setUpiState(null);
      setSelectedMethod(null);
    }
  }, [visible]);

  const stopUpiPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setPollingUpi(false);
  };

  const checkUpiStatus = async (transactionId: string) => {
    try {
      const response = await api.get(`/payment/upi/status/${transactionId}`);
      const status = String(response.data?.status || '').toLowerCase();
      const bookingStatus = String(response.data?.booking_status || '').toLowerCase();
      if (['success', 'completed'].includes(status) || bookingStatus === 'confirmed') {
        stopUpiPolling();
        onPaymentSuccess(transactionId);
        onClose();
        return;
      }
      if (['failed', 'refunded'].includes(status)) {
        stopUpiPolling();
        Alert.alert('Payment Failed', 'UPI payment failed or was refunded. Please try again.');
      }
    } catch {
      // Silent during polling; user can retry manually.
    }
  };

  const startUpiPolling = (transactionId: string) => {
    stopUpiPolling();
    setPollingUpi(true);
    void checkUpiStatus(transactionId);
    pollingIntervalRef.current = setInterval(() => {
      void checkUpiStatus(transactionId);
    }, 5000);
  };

  const initiatePayment = async () => {
    if (!selectedMethod) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }
    const selected = paymentMethods.find((method) => method.id === selectedMethod);
    if (!selected?.supported) {
      Alert.alert('SDK Required', 'This payment method requires native SDK integration in the app build.');
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = `${bookingId}_${Date.now()}`;
      
      const response = await api.post('/payment/create', {
        booking_id: bookingId,
        amount,
        currency,
        provider: selectedMethod,
        method: selectedMethod === 'upi' ? 'upi' : selectedMethod,
        idempotency_key: idempotencyKey,
      });

      const transactionId = response.data.transaction_id;
      if (!transactionId) {
        throw new Error('Missing transaction ID from payment response');
      }

      if (selectedMethod === 'upi' && response.data.qr_image) {
        setUpiState({
          qr_image: response.data.qr_image,
          expires_at: response.data.expires_at,
          transaction_id: transactionId,
        });
        startUpiPolling(transactionId);
      } else if (selectedMethod === 'paypal') {
        const approvalUrl = response.data.approval_url;
        if (!approvalUrl) {
          throw new Error('Missing PayPal approval URL');
        }

        await Linking.openURL(approvalUrl);
        const captureResponse = await api.post(`/payment/paypal/capture/${transactionId}`);
        if (captureResponse.data?.status === 'verified' || captureResponse.data?.booking_status === 'confirmed') {
          onPaymentSuccess(transactionId);
          onClose();
          return;
        }
        Alert.alert(
          'PayPal Pending',
          'Capture is pending. If payment was completed, it will be confirmed via webhook shortly.'
        );
      }
    } catch (error: any) {
      Alert.alert('Error', extractErrorMessage(error, 'Payment initiation failed'));
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (upiState) {
      return (
        <View style={styles.qrContainer}>
          <Text style={styles.qrTitle}>Scan QR Code to Pay</Text>
          <Image
            source={{ uri: `data:image/png;base64,${upiState.qr_image}` }}
            style={styles.qrImage}
          />
          <Text style={styles.qrAmount}>{currency} {amount.toLocaleString()}</Text>
          <Text style={styles.qrExpiry}>Expires in 15 minutes</Text>
          {pollingUpi ? (
            <View style={styles.pollingContainer}>
              <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
              <Text style={styles.pollingText}>Waiting for payment confirmation...</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.checkStatusButton}
            onPress={() => {
              if (upiState?.transaction_id) {
                void checkUpiStatus(upiState.transaction_id);
              }
            }}
          >
            <Text style={styles.checkStatusText}>Check Status</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              stopUpiPolling();
              setUpiState(null);
            }}
          >
            <Text style={styles.backButtonText}>Choose Another Method</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <>
        <Text style={styles.title}>Select Payment Method</Text>
        <Text style={styles.amountText}>
          Total: {currency} {amount.toLocaleString()}
        </Text>

        <View style={styles.methodsContainer}>
          {paymentMethods.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodCard,
                !method.supported && styles.methodCardDisabled,
                selectedMethod === method.id && styles.methodCardSelected,
              ]}
              onPress={() => setSelectedMethod(method.id as PaymentMethod)}
            >
              <View style={[styles.methodIcon, { backgroundColor: `${method.color}20` }]}>
                <Ionicons name={method.icon as any} size={24} color={method.color} />
              </View>
              <View style={styles.methodTextContainer}>
                <Text style={styles.methodName}>{method.name}</Text>
                {!method.supported ? <Text style={styles.methodHint}>Native SDK not enabled in this build</Text> : null}
              </View>
              {selectedMethod === method.id && (
                <Ionicons name="checkmark-circle" size={24} color={COLORS.PRIMARY_PURPLE} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.payButton, !selectedMethod && styles.payButtonDisabled]}
          onPress={initiatePayment}
          disabled={!selectedMethod || loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.WHITE} />
          ) : (
            <Text style={styles.payButtonText}>Pay {currency} {amount.toLocaleString()}</Text>
          )}
        </TouchableOpacity>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.closeButton} onPress={() => { stopUpiPolling(); onClose(); }}>
            <Ionicons name="close" size={24} color={COLORS.TEXT_SECONDARY} />
          </TouchableOpacity>
          {renderContent()}
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
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  amountText: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
    marginBottom: 24,
  },
  methodsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
  },
  methodCardSelected: {
    borderColor: COLORS.PRIMARY_PURPLE,
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  methodCardDisabled: {
    opacity: 0.6,
  },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  methodTextContainer: {
    flex: 1,
  },
  methodName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  methodHint: {
    marginTop: 2,
    fontSize: 11,
    color: COLORS.TEXT_MUTED,
  },
  payButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  payButtonDisabled: {
    backgroundColor: COLORS.BORDER,
  },
  payButtonText: {
    color: COLORS.WHITE,
    fontSize: 18,
    fontWeight: '700',
  },
  qrContainer: {
    alignItems: 'center',
    paddingTop: 16,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 24,
  },
  qrImage: {
    width: 200,
    height: 200,
    marginBottom: 16,
  },
  qrAmount: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
    marginBottom: 8,
  },
  qrExpiry: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 24,
  },
  pollingContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  pollingText: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  checkStatusButton: {
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  checkStatusText: {
    color: COLORS.PRIMARY_PURPLE,
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '600',
  },
});


