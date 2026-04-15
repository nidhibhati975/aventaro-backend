import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import StatusView from '../components/StatusView';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import {
  cancelMySubscription,
  fetchMySubscription,
  openUpgradeCheckout,
} from '../services/subscriptionService';
import type { SubscriptionRecord } from '../services/types';
import { COLORS } from '../theme/colors';

function formatRenewalDate(subscription: SubscriptionRecord | null) {
  if (!subscription?.current_period_end) {
    return 'Not scheduled';
  }
  try {
    const date = new Date(subscription.current_period_end);
    if (Number.isNaN(date.getTime())) {
      return 'Not scheduled';
    }
    return date.toLocaleString();
  } catch {
    return 'Not scheduled';
  }
}

export default function PaymentsScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);

  const handleBackPress = useCallback(() => {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigateToPath(APP_PATHS.TAB_PROFILE);
  }, [navigation]);

  const loadSubscription = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      setSubscription(await fetchMySubscription());
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to load subscription'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSubscription();
    }, [loadSubscription])
  );

  const handleUpgrade = async () => {
    try {
      setSubmitting(true);
      await openUpgradeCheckout();
      Alert.alert('Checkout opened', 'Complete the upgrade in the browser, then return to the app.');
    } catch (error) {
      Alert.alert('Unable to start upgrade', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    Alert.alert('Cancel subscription', 'Your premium status will end at the current period end.', [
      { text: 'Keep plan', style: 'cancel' },
      {
        text: 'Cancel plan',
        style: 'destructive',
        onPress: async () => {
          try {
            setSubmitting(true);
            const updated = await cancelMySubscription();
            setSubscription(updated);
            Alert.alert('Subscription updated', 'Your premium plan has been canceled.');
          } catch (error) {
            Alert.alert('Unable to cancel', extractErrorMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusView type="loading" message="Loading subscription..." />
      </SafeAreaView>
    );
  }

  if (errorMessage || !subscription) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
        <TouchableOpacity onPress={handleBackPress} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription & Premium</Text>
        <View style={styles.headerButton} />
      </View>
      <StatusView
        type="error"
        title="Subscription unavailable"
        message={errorMessage || 'Unable to load subscription'}
        onRetry={() => void loadSubscription()}
      />
    </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackPress} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription & Premium</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Subscription</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Plan</Text>
            <Text style={styles.infoValue}>{subscription.plan_type}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={styles.infoValue}>{subscription.status}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Renews / ends</Text>
            <Text style={styles.infoValue}>{formatRenewalDate(subscription)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Premium access</Text>
          <Text style={styles.cardBody}>
            Premium unlocks unlimited matches, more trip joins, full AI usage, and ranking boosts.
          </Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleUpgrade()}
              disabled={submitting || subscription.is_premium}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {subscription.is_premium ? 'Premium Active' : 'Upgrade to Premium'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void handleCancel()}
              disabled={submitting || !subscription.is_premium}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
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
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE_MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '700',
  },
});
