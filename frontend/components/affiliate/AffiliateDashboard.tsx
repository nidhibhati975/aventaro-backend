import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import api, { extractErrorMessage } from '../../services/api';
import { COLORS } from '../../theme/colors';

interface Commission {
  id: string;
  booking_id: string;
  commission_amount: number;
  status: string;
  created_at: string;
}

export default function AffiliateDashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<any>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestingPayout, setRequestingPayout] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setErrorMessage(null);
      const [dashRes, commRes] = await Promise.all([
        api.get('/affiliate/dashboard'),
        api.get('/affiliate/commissions'),
      ]);
      setDashboard(dashRes.data);
      setCommissions(commRes.data.commissions || []);
    } catch (error: any) {
      setErrorMessage(extractErrorMessage(error, 'Failed to load affiliate data'));
    } finally {
      setLoading(false);
    }
  };

  const requestPayout = async () => {
    try {
      setRequestingPayout(true);
      const availableBalance = dashboard?.wallet?.balance || 0;
      if (availableBalance < 100) {
        return;
      }
      await api.post('/affiliate/payout/request', {
        amount: availableBalance,
        payout_method: 'bank_transfer',
        account_details: { account_holder: 'Pending', account_number: 'Pending', ifsc: 'Pending' },
      });
      loadDashboard();
    } catch (error: any) {
      setErrorMessage(extractErrorMessage(error, 'Unable to request payout'));
    } finally {
      setRequestingPayout(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="warning-outline" size={48} color={COLORS.WARNING} />
        <Text style={styles.emptyText}>{errorMessage}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadDashboard}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: COLORS.SURFACE_MUTED }]}>
          <Ionicons name="people" size={24} color={COLORS.PRIMARY_PURPLE} />
          <Text style={styles.statValue}>{dashboard?.total_referrals || 0}</Text>
          <Text style={styles.statLabel}>Referrals</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: COLORS.SURFACE_ELEVATED }]}>
          <Ionicons name="briefcase" size={24} color={COLORS.SECONDARY_PURPLE} />
          <Text style={styles.statValue}>{dashboard?.total_bookings || 0}</Text>
          <Text style={styles.statLabel}>Bookings</Text>
        </View>
      </View>

      {/* Wallet */}
      <View style={styles.walletCard}>
        <Text style={styles.walletTitle}>Commission Wallet</Text>
        <Text style={styles.walletBalance}>INR {(dashboard?.wallet?.balance || 0).toLocaleString()}</Text>
        <View style={styles.walletRow}>
          <View>
            <Text style={styles.walletLabel}>Pending</Text>
            <Text style={styles.walletSubValue}>INR {(dashboard?.wallet?.pending || 0).toLocaleString()}</Text>
          </View>
          <View>
            <Text style={styles.walletLabel}>Total Earned</Text>
            <Text style={styles.walletSubValue}>INR {(dashboard?.wallet?.total_earned || 0).toLocaleString()}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.payoutButton}
          onPress={requestPayout}
          disabled={(dashboard?.wallet?.balance || 0) < 100 || requestingPayout}
        >
          {requestingPayout ? (
            <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
          ) : (
            <Text style={styles.payoutButtonText}>Request Payout</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Referral Code */}
      <View style={styles.referralCard}>
        <Text style={styles.referralTitle}>Your Referral Code</Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{dashboard?.referral_code || 'N/A'}</Text>
          <TouchableOpacity>
            <Ionicons name="copy-outline" size={24} color={COLORS.PRIMARY_PURPLE} />
          </TouchableOpacity>
        </View>
        <Text style={styles.commissionRate}>
          Earn {dashboard?.commission_rate || 5}% on every booking
        </Text>
      </View>

      {/* Recent Commissions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Commissions</Text>
        {commissions.length === 0 ? (
          <Text style={styles.emptyText}>No commissions yet</Text>
        ) : (
          commissions.slice(0, 5).map((commission) => (
            <View key={commission.id} style={styles.commissionItem}>
              <View>
                <Text style={styles.commissionBooking}>Booking #{commission.booking_id.slice(0, 8)}</Text>
                <Text style={styles.commissionDate}>
                  {new Date(commission.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.commissionRight}>
                <Text style={styles.commissionAmount}>+INR {commission.commission_amount}</Text>
                <Text style={[
                  styles.commissionStatus,
                  { color: commission.status === 'paid' ? COLORS.PRIMARY_PURPLE : COLORS.SECONDARY_PURPLE }
                ]}>
                  {commission.status}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', padding: 16, gap: 12 },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  statValue: { fontSize: 28, fontWeight: '800', color: COLORS.TEXT_PRIMARY, marginTop: 8 },
  statLabel: { fontSize: 14, color: COLORS.TEXT_SECONDARY, marginTop: 4 },
  walletCard: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  walletTitle: { fontSize: 14, color: COLORS.ACCENT_PURPLE },
  walletBalance: { fontSize: 36, fontWeight: '800', color: COLORS.WHITE, marginTop: 4 },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  walletLabel: { fontSize: 12, color: COLORS.ACCENT_PURPLE },
  walletSubValue: { fontSize: 18, fontWeight: '700', color: COLORS.WHITE, marginTop: 2 },
  payoutButton: {
    backgroundColor: COLORS.WHITE,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  payoutButtonText: { color: COLORS.PRIMARY_PURPLE, fontSize: 16, fontWeight: '700' },
  referralCard: {
    backgroundColor: COLORS.WHITE,
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  referralTitle: { fontSize: 16, fontWeight: '600', color: COLORS.TEXT_PRIMARY },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.SURFACE_MUTED,
    padding: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  codeText: { fontSize: 24, fontWeight: '800', color: COLORS.PRIMARY_PURPLE, letterSpacing: 2 },
  commissionRate: { fontSize: 14, color: COLORS.TEXT_SECONDARY, marginTop: 12, textAlign: 'center' },
  section: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.TEXT_PRIMARY, marginBottom: 12 },
  emptyText: { fontSize: 14, color: COLORS.TEXT_MUTED, textAlign: 'center', paddingVertical: 24 },
  commissionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.WHITE,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  commissionBooking: { fontSize: 14, fontWeight: '600', color: COLORS.TEXT_PRIMARY },
  commissionDate: { fontSize: 12, color: COLORS.TEXT_SECONDARY, marginTop: 2 },
  commissionRight: { alignItems: 'flex-end' },
  commissionAmount: { fontSize: 16, fontWeight: '700', color: COLORS.PRIMARY_PURPLE },
  commissionStatus: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  retryButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  retryButtonText: {
    color: COLORS.WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
});



