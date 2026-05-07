/**
 * Rewards Screen
 * 
 * Display coin balance, reward actions, and transaction history
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { monetizationService, RewardBalance, RewardAction, Transaction } from '../services/monetizationService';

interface Props {
  navigation: any;
}

export function RewardsScreen({ navigation }: Props) {
  const [balance, setBalance] = useState<RewardBalance | null>(null);
  const [actions, setActions] = useState<RewardAction[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [balanceData, actionsData, transactionsData] = await Promise.all([
        monetizationService.getRewardBalance(),
        monetizationService.getRewardActions(),
        monetizationService.getTransactions(20),
      ]);
      setBalance(balanceData);
      setActions(actionsData);
      setTransactions(transactionsData);
    } catch (error) {
      console.error('[Rewards] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleClaim = async (actionType: string) => {
    setClaiming(actionType);
    try {
      const result = await monetizationService.claimReward(actionType);
      
      if (result.success) {
        // Refresh data
        await loadData();
      } else {
        console.log('[Rewards] Claim failed:', result.error);
      }
    } catch (error) {
      console.error('[Rewards] Claim error:', error);
    } finally {
      setClaiming(null);
    }
  };

  const renderActionCard = (action: RewardAction) => {
    const isClaiming = claiming === action.action_type;
    
    return (
      <TouchableOpacity
        key={action.action_type}
        style={styles.actionCard}
        onPress={() => handleClaim(action.action_type)}
        disabled={isClaiming}
      >
        <View style={styles.actionInfo}>
          <Text style={styles.actionName}>{action.description}</Text>
          <Text style={styles.actionLimit}>Daily: {action.max_per_day}</Text>
        </View>
        <View style={styles.actionReward}>
          <Text style={styles.actionCoins}>+{action.coins}</Text>
          <Text style={styles.actionCoinIcon}>🪙</Text>
        </View>
        {isClaiming && (
          <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
        )}
      </TouchableOpacity>
    );
  };

  const renderTransaction = (tx: Transaction) => {
    const isPositive = tx.amount > 0;
    
    return (
      <View key={tx.id} style={styles.transactionItem}>
        <View style={styles.transactionInfo}>
          <Text style={styles.transactionDescription}>
            {tx.description || tx.transaction_type}
          </Text>
          <Text style={styles.transactionDate}>
            {new Date(tx.created_at).toLocaleDateString()}
          </Text>
        </View>
        <Text style={[
          styles.transactionAmount,
          isPositive ? styles.transactionPositive : styles.transactionNegative,
        ]}>
          {isPositive ? '+' : ''}{tx.amount} 🪙
        </Text>
      </View>
    );
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
        <Text style={styles.headerTitle}>Rewards</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[COLORS.PRIMARY_PURPLE]}
          />
        }
      >
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Your Coins</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceAmount}>{balance?.coins || 0}</Text>
            <Text style={styles.balanceIcon}>🪙</Text>
          </View>
          <Text style={styles.balanceLifetime}>
            Lifetime earned: {balance?.lifetime_coins || 0} 🪙
          </Text>
          
          <TouchableOpacity
            style={styles.buyCoinsButton}
            onPress={() => navigation.navigate('Payment')}
          >
            <Text style={styles.buyCoinsButtonText}>Buy More Coins</Text>
          </TouchableOpacity>
        </View>

        {/* Earn Coins Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Earn Coins</Text>
          <Text style={styles.sectionSubtitle}>
            Complete actions to earn coins
          </Text>
          
          <View style={styles.actionsList}>
            {actions.map(renderActionCard)}
          </View>
        </View>

        {/* Transaction History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>History</Text>
          
          {transactions.length > 0 ? (
            <View style={styles.transactionsList}>
              {transactions.map(renderTransaction)}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No transactions yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Earn coins by completing actions above
              </Text>
            </View>
          )}
        </View>

        {/* How to Use */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>Use Your Coins</Text>
          <Text style={styles.infoText}>
            • Purchase Profile Boosts{'\n'}
            • Buy Super Boosts{'\n'}
            • Unlock premium features{'\n'}
            • Get exclusive rewards
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
  balanceCard: {
    margin: 16,
    padding: 24,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderRadius: 20,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fff',
  },
  balanceIcon: {
    fontSize: 36,
    marginLeft: 8,
  },
  balanceLifetime: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 20,
  },
  buyCoinsButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  buyCoinsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  section: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginBottom: 16,
  },
  actionsList: {
    gap: 12,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  actionInfo: {
    flex: 1,
  },
  actionName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.TEXT_PRIMARY,
  },
  actionLimit: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginTop: 2,
  },
  actionReward: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.WARNING_YELLOW + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  actionCoins: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.WARNING_YELLOW,
  },
  actionCoinIcon: {
    fontSize: 14,
    marginLeft: 4,
  },
  transactionsList: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 12,
    overflow: 'hidden',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 14,
    color: COLORS.TEXT_PRIMARY,
    textTransform: 'capitalize',
  },
  transactionDate: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionPositive: {
    color: COLORS.SUCCESS_GREEN,
  },
  transactionNegative: {
    color: COLORS.ERROR_RED,
  },
  emptyState: {
    backgroundColor: COLORS.CARD_BACKGROUND,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    textAlign: 'center',
  },
  infoSection: {
    margin: 16,
    marginTop: 0,
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

export default RewardsScreen;