/**
 * Boost Screen
 * 
 * Display available boosts and allow purchases
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { monetizationService, Boost, ActiveBoost, RewardBalance } from '../services/monetizationService';

interface Props {
  navigation: any;
}

export function BoostScreen({ navigation }: Props) {
  const [boosts, setBoosts] = useState<Boost[]>([]);
  const [activeBoosts, setActiveBoosts] = useState<ActiveBoost[]>([]);
  const [balance, setBalance] = useState<RewardBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [boostsData, activeData, balanceData] = await Promise.all([
        monetizationService.getBoosts(),
        monetizationService.getActiveBoosts(),
        monetizationService.getRewardBalance(),
      ]);
      setBoosts(boostsData);
      setActiveBoosts(activeData);
      setBalance(balanceData);
    } catch (error) {
      console.error('[Boost] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (boost: Boost, useCoins: boolean = false) => {
    if (useCoins && balance) {
      const coinCost = Math.round((boost.price * 100) / 10); // ₹10 = 100 coins
      if (balance.coins < coinCost) {
        Alert.alert(
          'Insufficient Coins',
          `You need ${coinCost} coins but have ${balance.coins}. Would you like to buy coins?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Buy Coins', onPress: () => navigation.navigate('Rewards') },
          ]
        );
        return;
      }
    }

    setPurchasing(boost.boost_type);
    try {
      const result = await monetizationService.purchaseBoost(boost.boost_type, useCoins);
      
      if (result) {
        Alert.alert(
          'Boost Activated! 🎉',
          `${boost.name} is now active for ${boost.duration_minutes} minutes`,
          [{ text: 'OK', onPress: loadData }]
        );
      } else {
        Alert.alert('Error', 'Failed to purchase boost. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to purchase boost.');
    } finally {
      setPurchasing(null);
    }
  };

  const renderBoostCard = (boost: Boost) => {
    const isPurchasing = purchasing === boost.boost_type;
    const coinCost = Math.round((boost.price * 100) / 10);
    
    return (
      <View key={boost.boost_type} style={styles.boostCard}>
        <View style={styles.boostHeader}>
          <View style={styles.boostIconContainer}>
            <Text style={styles.boostIcon}>
              {boost.boost_type === 'profile' ? '⚡' : boost.boost_type === 'super' ? '🌟' : '✈️'}
            </Text>
          </View>
          <View style={styles.boostInfo}>
            <Text style={styles.boostName}>{boost.name}</Text>
            <Text style={styles.boostDuration}>{boost.duration_minutes} minutes</Text>
          </View>
        </View>

        <Text style={styles.boostDescription}>{boost.description}</Text>

        <View style={styles.boostPriceRow}>
          <View style={styles.priceOption}>
            <Text style={styles.priceLabel}>Razorpay</Text>
            <Text style={styles.priceValue}>₹{boost.price}</Text>
          </View>
          
          {balance && (
            <View style={styles.priceOption}>
              <Text style={styles.priceLabel}>Coins</Text>
              <Text style={styles.priceValue}>🪙 {coinCost}</Text>
            </View>
          )}
        </View>

        <View style={styles.boostActions}>
          <TouchableOpacity
            style={[styles.buyButton, styles.buyButtonRazorpay]}
            onPress={() => handlePurchase(boost, false)}
            disabled={isPurchasing}
          >
            {isPurchasing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.buyButtonText}>Pay ₹{boost.price}</Text>
            )}
          </TouchableOpacity>

          {balance && balance.coins >= coinCost && (
            <TouchableOpacity
              style={[styles.buyButton, styles.buyButtonCoins]}
              onPress={() => handlePurchase(boost, true)}
              disabled={isPurchasing}
            >
              <Text style={styles.buyButtonText}>Use {coinCost} 🪙</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderActiveBoost = (boost: ActiveBoost) => (
    <View key={boost.id} style={styles.activeBoostCard}>
      <View style={styles.activeBoostIcon}>
        <Text style={styles.activeBoostIconText}>⏱️</Text>
      </View>
      <View style={styles.activeBoostInfo}>
        <Text style={styles.activeBoostName}>{boost.config.name}</Text>
        <Text style={styles.activeBoostTime}>
          {boost.remaining_minutes} min remaining
        </Text>
      </View>
      <View style={styles.activeBoostTimer}>
        <Text style={styles.activeBoostTimerText}>
          {new Date(boost.expires_at).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );

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
        <Text style={styles.headerTitle}>Boosts</Text>
        <TouchableOpacity 
          onPress={() => navigation.navigate('Rewards')}
          style={styles.coinButton}
        >
          <Text style={styles.coinButtonText}>🪙 {balance?.coins || 0}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Active Boosts */}
        {activeBoosts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Boosts</Text>
            {activeBoosts.map(renderActiveBoost)}
          </View>
        )}

        {/* Available Boosts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Boosts</Text>
          {boosts.map(renderBoostCard)}
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>How Boosts Work</Text>
          <Text style={styles.infoText}>
            • Profile Boost shows your profile to more people{'\n'}
            • Super Boost puts you at the top of the stack{'\n'}
            • Trip Boost increases visibility for your trip{'\n'}
            • Boosts can be purchased with coins or money
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
  coinButton: {
    backgroundColor: COLORS.WARNING_YELLOW + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  coinButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.WARNING_YELLOW,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 16,
  },
  activeBoostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.SUCCESS_GREEN + '20',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.SUCCESS_GREEN,
  },
  activeBoostIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.SUCCESS_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activeBoostIconText: {
    fontSize: 20,
  },
  activeBoostInfo: {
    flex: 1,
  },
  activeBoostName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  activeBoostTime: {
    fontSize: 14,
    color: COLORS.SUCCESS_GREEN,
    marginTop: 2,
  },
  activeBoostTimer: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  activeBoostTimerText: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  boostCard: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  boostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  boostIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  boostIcon: {
    fontSize: 28,
  },
  boostInfo: {
    flex: 1,
  },
  boostName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  boostDuration: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginTop: 2,
  },
  boostDescription: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 16,
    lineHeight: 20,
  },
  boostPriceRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  priceOption: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginBottom: 4,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  boostActions: {
    flexDirection: 'row',
    gap: 12,
  },
  buyButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buyButtonRazorpay: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  buyButtonCoins: {
    backgroundColor: COLORS.WARNING_YELLOW,
  },
  buyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
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

export default BoostScreen;