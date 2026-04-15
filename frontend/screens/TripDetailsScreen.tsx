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
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';

import StatusView from '../components/StatusView';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { extractErrorMessage } from '../services/api';
import { safeParseNumber } from '../services/navigationSafety';
import { approveTripMember, canApproveTripMembers, fetchTripById } from '../services/tripService';
import { getUserDisplayName, type TripRecord } from '../services/types';
import { COLORS } from '../theme/colors';

export default function TripDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { joinTripRoom, leaveTripRoom, subscribe } = useRealtime();
  const tripId = safeParseNumber(route.params?.tripId, 0);
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadTrip = useCallback(async () => {
    if (!tripId) {
      setLoading(false);
      setTrip(null);
      setErrorMessage('Trip ID is missing.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      setTrip(await fetchTripById(tripId));
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to load trip details'));
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      void loadTrip();
    }, [loadTrip])
  );

  React.useEffect(() => {
    if (!trip || !user) {
      return;
    }

    const canJoinRoom =
      trip.owner?.id === user.id || trip.current_user_status === 'approved';

    if (canJoinRoom) {
      joinTripRoom(trip.id);
    }

    const unsubscribe = subscribe((event) => {
      const payload = event.data as { tripId?: number; trip_id?: number } | undefined;
      const eventTripId = payload?.tripId || payload?.trip_id;
      if (eventTripId !== trip.id) {
        return;
      }

      if (
        event.type === 'trip.joined' ||
        event.type === 'trip.left' ||
        event.type === 'expense.created' ||
        event.type === 'expense.settled'
      ) {
        void loadTrip();
      }
    });

    return () => {
      unsubscribe();
      if (canJoinRoom) {
        leaveTripRoom(trip.id);
      }
    };
  }, [joinTripRoom, leaveTripRoom, loadTrip, subscribe, trip, user]);

  const handleApprove = async (memberUserId: number) => {
    try {
      setActionId(`approve:${memberUserId}`);
      await approveTripMember(tripId, memberUserId);
      await loadTrip();
    } catch (error) {
      Alert.alert('Unable to approve', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusView type="loading" message="Loading trip details..." />
      </SafeAreaView>
    );
  }

  if (errorMessage || !trip) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trip Details</Text>
          <View style={styles.headerButton} />
        </View>
        <StatusView
          type="error"
          title="Trip unavailable"
          message={errorMessage || 'Trip not found'}
          onRetry={() => void loadTrip()}
        />
      </SafeAreaView>
    );
  }

  const canApprove = canApproveTripMembers(trip, user);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trip Details</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.tripTitle}>{trip.title}</Text>
          <Text style={styles.tripMeta}>{trip.location}</Text>
          <Text style={styles.tripBody}>
            Capacity {trip.approved_member_count}/{trip.capacity}. Dates, budget, and extended itinerary fields are structurally supported in the UI and will hydrate as backend fields arrive.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Members</Text>
          {(Array.isArray(trip.members) ? trip.members : []).map((member) => {
            const pending = member.status === 'pending';
            return (
              <View key={member.user.id} style={styles.memberRow}>
                <View style={styles.memberText}>
                  <Text style={styles.memberName}>{getUserDisplayName(member.user)}</Text>
                  <Text style={styles.memberMeta}>{member.status}</Text>
                </View>
                {pending && canApprove ? (
                  <TouchableOpacity
                    style={styles.inlineButton}
                    onPress={() => void handleApprove(member.user.id)}
                    disabled={actionId === `approve:${member.user.id}`}
                  >
                    {actionId === `approve:${member.user.id}` ? (
                      <ActivityIndicator size="small" color={COLORS.WHITE} />
                    ) : (
                      <Text style={styles.inlineButtonText}>Approve</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Trip Chat</Text>
          <Text style={styles.tripBody}>
            Group chat, expenses, and activity live under the trip workspace so collaboration stays attached to the trip.
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
  tripTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  tripMeta: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  tripBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  memberText: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  memberMeta: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'capitalize',
  },
  inlineButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButtonText: {
    color: COLORS.WHITE,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
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
});
