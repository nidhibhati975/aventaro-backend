/**
 * Payment Screen
 * 
 * Handle subscription and boost payments via Razorpay
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { monetizationService } from '../services/monetizationService';
import api, { getApiData } from '../services/api';

interface Props {
  navigation: any;
  route: {
    params: {
      planType?: string;
      billingCycle?: string;
      price?: number;
      boostType?: string;
    };
  };
}

export function PaymentScreen({ navigation, route }: Props) {
  const { planType, billingCycle, price, boostType } = route.params || {};
  
  const [loading, setLoading] = useState(false);
  const [orderCreated, setOrderCreated] = useState(false);

  const isSubscription = !!planType;
  const displayPrice = price || 0;

  const handlePayment = async () => {
    setLoading(true);
    try {
      if (isSubscription) {
        // For subscriptions, redirect to Stripe checkout
        // In production, you'd use the existing subscription API
        const response = await api.post('/subscription/upgrade', {
          success_url: 'aventaro://payment-success',
          cancel_url: 'aventero://payment-cancelled',
          price_id: planType === 'pro' ? 'pro_monthly' : 'elite_monthly',
        });
        
        const data = getApiData<{ checkout_url?: string; checkoutUrl?: string }>(response);
        const checkoutUrl = data?.checkout_url || data?.checkoutUrl;
        if (checkoutUrl) {
          await Linking.openURL(checkoutUrl);
        }
      } else if (boostType) {
        // For boosts, create Razorpay order
        const order = await monetizationService.createBoostOrder(boostType, displayPrice);
        
        if (order?.checkout_url) {
          await Linking.openURL(order.checkout_url);
        } else {
          Alert.alert(
            'Payment Link',
            `Order created: ${order?.order_id}\n\nAmount: ₹${displayPrice}\n\nIn production, this would open Razorpay checkout.`,
            [
              { text: 'Simulate Success', onPress: () => handlePaymentSuccess(boostType) },
              { text: 'Cancel', style: 'cancel' },
            ]
          );
        }
      }
    } catch (error) {
      console.error('[Payment] Error:', error);
      Alert.alert('Error', 'Failed to create payment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async (type: string) => {
    try {
      // In production, verify with backend
      if (boostType) {
        await monetizationService.verifyBoostPayment(
          'simulated_order',
          'simulated_payment',
          'simulated_signature',
          boostType
        );
      }
      
      Alert.alert(
        'Payment Successful! 🎉',
        isSubscription 
          ? 'Your subscription has been activated.'
          : 'Your boost has been activated.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('[Payment] Success handler error:', error);
    }
  };

  const renderPlanDetails = () => {
    if (!isSubscription) return null;

    const plans = {
      pro: { name: 'Pro', features: ['Unlimited swipes', 'Profile boost', 'See who liked you', 'Advanced filters'] },
      elite: { name: 'Elite', features: ['Everything in Pro', 'Super boost', 'Unlimited trip boosts', 'Exclusive events'] },
    };

    const plan = plans[planType as keyof typeof plans];
    if (!plan) return null;

    return (
      <View style={styles.detailsCard}>
        <Text style={styles.detailsTitle}>{plan.name} Plan</Text>
        {plan.features.map((feature, index) => (
          <View key={index} style={styles.featureRow}>
            <Text style={styles.featureCheck}>✓</Text>
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderBoostDetails = () => {
    if (!boostType) return null;

    const boosts = {
      profile: { name: 'Profile Boost', duration: '30 minutes', description: 'Get top visibility' },
      super: { name: 'Super Boost', duration: '1 hour', description: 'Stay at the top' },
      trip: { name: 'Trip Boost', duration: '2 hours', description: 'Boost trip visibility' },
    };

    const boost = boosts[boostType as keyof typeof boosts];
    if (!boost) return null;

    return (
      <View style={styles.detailsCard}>
        <Text style={styles.detailsTitle}>{boost.name}</Text>
        <Text style={styles.detailsDescription}>{boost.description}</Text>
        <Text style={styles.detailsDuration}>Duration: {boost.duration}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        {/* Order Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {isSubscription ? `${planType?.toUpperCase()} Plan` : `${boostType?.toUpperCase()} Boost`}
            </Text>
            <Text style={styles.summaryValue}>₹{displayPrice}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Billing</Text>
            <Text style={styles.summaryValue}>
              {isSubscription ? (billingCycle === 'yearly' ? 'Yearly' : 'Monthly') : 'One-time'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{displayPrice}</Text>
          </View>
        </View>

        {/* Details */}
        {renderPlanDetails()}
        {renderBoostDetails()}

        {/* Payment Method */}
        <View style={styles.paymentMethodCard}>
          <Text style={styles.paymentMethodTitle}>Payment Method</Text>
          <View style={styles.paymentOption}>
            <View style={styles.paymentOptionInfo}>
              <Text style={styles.paymentOptionName}>Razorpay</Text>
              <Text style={styles.paymentOptionDesc}>Secure payment via Razorpay</Text>
            </View>
            <Text style={styles.paymentOptionCheck}>✓</Text>
          </View>
        </View>

        {/* Pay Button */}
        <TouchableOpacity
          style={[styles.payButton, loading && styles.payButtonDisabled]}
          onPress={handlePayment}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.payButtonText}>Pay ₹{displayPrice}</Text>
          )}
        </TouchableOpacity>

        {/* Security Note */}
        <Text style={styles.securityNote}>
          🔒 Your payment is secured by Razorpay
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 24,
    color: COLORS.TEXT_PRIMARY,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  summaryCard: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  summaryValue: {
    fontSize: 14,
    color: COLORS.TEXT_PRIMARY,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginVertical: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  detailsCard: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  detailsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 12,
  },
  detailsDescription: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 8,
  },
  detailsDuration: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  featureCheck: {
    fontSize: 14,
    color: COLORS.SUCCESS_GREEN,
    marginRight: 8,
  },
  featureText: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  paymentMethodCard: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  paymentMethodTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 16,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  paymentOptionInfo: {
    flex: 1,
  },
  paymentOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  paymentOptionDesc: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginTop: 2,
  },
  paymentOptionCheck: {
    fontSize: 20,
    color: COLORS.PRIMARY_PURPLE,
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
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  securityNote: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
    marginTop: 16,
  },
});

export default PaymentScreen;
