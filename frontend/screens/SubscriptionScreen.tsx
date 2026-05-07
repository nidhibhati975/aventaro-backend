/**
 * Subscription Screen
 * 
 * Display subscription plans and allow upgrades
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { monetizationService, Plan, SubscriptionStatus } from '../services/monetizationService';

interface Props {
  navigation: any;
}

export function SubscriptionScreen({ navigation }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCycle, setSelectedCycle] = useState<'monthly' | 'yearly'>('monthly');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [plansData, subData] = await Promise.all([
        monetizationService.getPlans(),
        monetizationService.getSubscriptionStatus(),
      ]);
      setPlans(plansData);
      setSubscription(subData);
    } catch (error) {
      console.error('[Subscription] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  };

  const currentPlan = subscription?.subscription?.plan_type || 'free';
  const isPremium = subscription?.subscription?.is_premium || false;

  const renderPlanCard = (plan: Plan) => {
    const isCurrent = currentPlan === plan.plan_type;
    const price = selectedCycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
    const isFree = plan.plan_type === 'free';
    
    // Calculate yearly savings
    const monthlyEquivalent = selectedCycle === 'yearly' ? Math.round(plan.yearly_price / 12) : plan.monthly_price;
    const savings = !isFree && selectedCycle === 'yearly' 
      ? Math.round(((plan.monthly_price * 12 - plan.yearly_price) / (plan.monthly_price * 12)) * 100)
      : 0;

    return (
      <View
        key={plan.plan_type}
        style={[
          styles.planCard,
          isCurrent && styles.planCardCurrent,
          plan.plan_type === 'elite' && styles.planCardElite,
        ]}
      >
        {plan.plan_type === 'elite' && (
          <View style={styles.eliteBadge}>
            <Text style={styles.eliteBadgeText}>MOST POPULAR</Text>
          </View>
        )}
        
        {isCurrent && (
          <View style={styles.currentBadge}>
            <Text style={styles.currentBadgeText}>CURRENT PLAN</Text>
          </View>
        )}

        <Text style={styles.planName}>{plan.name}</Text>
        
        <View style={styles.priceContainer}>
          <Text style={styles.priceCurrency}>₹</Text>
          <Text style={styles.priceAmount}>{isFree ? '0' : price}</Text>
          <Text style={styles.pricePeriod}>/{selectedCycle === 'yearly' ? 'year' : 'month'}</Text>
        </View>

        {savings > 0 && (
          <View style={styles.savingsBadge}>
            <Text style={styles.savingsText}>Save {savings}%</Text>
          </View>
        )}

        <View style={styles.featuresList}>
          {plan.features.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.planButton,
            isCurrent && styles.planButtonCurrent,
            plan.plan_type === 'elite' && styles.planButtonElite,
          ]}
          onPress={() => handleSelectPlan(plan)}
          disabled={isCurrent}
        >
          <Text style={[
            styles.planButtonText,
            isCurrent && styles.planButtonTextCurrent,
          ]}>
            {isCurrent ? 'Current Plan' : 'Select Plan'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const handleSelectPlan = (plan: Plan) => {
    if (plan.plan_type === 'free') return;
    
    // Navigate to payment
    navigation.navigate('Payment', {
      planType: plan.plan_type,
      billingCycle: selectedCycle,
      price: selectedCycle === 'yearly' ? plan.yearly_price : plan.monthly_price,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Premium Plans</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Current Status */}
        {isPremium && (
          <View style={styles.premiumBanner}>
            <Text style={styles.premiumBannerText}>
              🎉 You're a {subscription?.plan?.name} member!
            </Text>
            {subscription?.subscription?.current_period_end && (
              <Text style={styles.premiumBannerSubtext}>
                Expires: {new Date(subscription.subscription.current_period_end).toLocaleDateString()}
              </Text>
            )}
          </View>
        )}

        {/* Billing Cycle Toggle */}
        <View style={styles.cycleToggle}>
          <TouchableOpacity
            style={[styles.cycleButton, selectedCycle === 'monthly' && styles.cycleButtonActive]}
            onPress={() => setSelectedCycle('monthly')}
          >
            <Text style={[styles.cycleButtonText, selectedCycle === 'monthly' && styles.cycleButtonTextActive]}>
              Monthly
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cycleButton, selectedCycle === 'yearly' && styles.cycleButtonActive]}
            onPress={() => setSelectedCycle('yearly')}
          >
            <Text style={[styles.cycleButtonText, selectedCycle === 'yearly' && styles.cycleButtonTextActive]}>
              Yearly
            </Text>
          </TouchableOpacity>
        </View>

        {/* Plans */}
        <View style={styles.plansContainer}>
          {plans.map(renderPlanCard)}
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>Payment Info</Text>
          <Text style={styles.infoText}>
            • Payments are processed securely via Razorpay{'\n'}
            • Cancel anytime from settings{'\n'}
            • Unused time is not refunded
          </Text>
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
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  premiumBanner: {
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  premiumBannerText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  premiumBannerSubtext: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginTop: 4,
  },
  cycleToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 12,
    padding: 4,
  },
  cycleButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  cycleButtonActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  cycleButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.TEXT_MUTED,
  },
  cycleButtonTextActive: {
    color: '#fff',
  },
  plansContainer: {
    paddingHorizontal: 16,
    gap: 16,
  },
  planCard: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  planCardCurrent: {
    borderColor: COLORS.PRIMARY_PURPLE,
    borderWidth: 2,
  },
  planCardElite: {
    borderColor: COLORS.PRIMARY_PURPLE,
    backgroundColor: COLORS.PRIMARY_PURPLE + '10',
  },
  eliteBadge: {
    position: 'absolute',
    top: -12,
    left: '50%',
    marginLeft: -60,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  eliteBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  currentBadge: {
    position: 'absolute',
    top: -12,
    right: 16,
    backgroundColor: COLORS.SUCCESS_GREEN,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  planName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  priceCurrency: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  priceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  pricePeriod: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginLeft: 4,
  },
  savingsBadge: {
    backgroundColor: COLORS.SUCCESS_GREEN + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  savingsText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.SUCCESS_GREEN,
  },
  featuresList: {
    marginBottom: 20,
  },
  featureItem: {
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
    flex: 1,
  },
  planButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  planButtonCurrent: {
    backgroundColor: COLORS.BORDER,
  },
  planButtonElite: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  planButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  planButtonTextCurrent: {
    color: COLORS.TEXT_MUTED,
  },
  infoSection: {
    margin: 16,
    padding: 16,
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
    lineHeight: 20,
  },
});

export default SubscriptionScreen;