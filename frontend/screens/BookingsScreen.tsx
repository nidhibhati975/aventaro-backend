import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { TripCardSkeleton } from '../components/common/SkeletonLoader';
import { useAuth } from '../contexts/AuthContext';
import { extractErrorMessage } from '../services/api';
import {
  createReservation,
  confirmBooking,
  fetchBooking,
  fetchBookingDetails,
  fetchBookingHistory,
  openBookingPaymentCheckout,
  searchBookings,
  type BookingSearchPayload,
} from '../services/bookingService';
import { getUserDisplayName, type BookingDetailsRecord, type BookingRecord, type BookingSearchDetailsRecord, type BookingSearchResultRecord } from '../services/types';
import { COLORS } from '../theme/colors';

type BookingTab = 'search' | 'history';
type BookingCategory = 'hotel' | 'flight' | 'activity';

const SEARCH_OPTIONS: Array<{ key: BookingCategory; label: string; icon: string }> = [
  { key: 'hotel', label: 'Hotels', icon: 'bed-outline' },
  { key: 'flight', label: 'Flights', icon: 'airplane-outline' },
  { key: 'activity', label: 'Activities', icon: 'compass-outline' },
];

const HISTORY_PAGE_SIZE = 10;

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined = 'USD') {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return 'Unavailable';
  }

  return `${currency || 'USD'} ${amount.toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Flexible';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function renderPolicySummary(details: BookingSearchDetailsRecord | null) {
  if (!details?.policies) {
    return [];
  }

  return Object.entries(details.policies)
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`);
}

export default function BookingsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const routeBookingId = Number(route.params?.bookingId || 0);
  const [tab, setTab] = useState<BookingTab>('search');
  const [category, setCategory] = useState<BookingCategory>('hotel');
  const [location, setLocation] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState('1');
  const [loadingResults, setLoadingResults] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<BookingSearchResultRecord[]>([]);
  const [selectedResult, setSelectedResult] = useState<BookingSearchResultRecord | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<BookingSearchDetailsRecord | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [reservation, setReservation] = useState<BookingDetailsRecord | null>(null);
  const [reserving, setReserving] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<BookingRecord[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);

  const loadHistory = useCallback(
    async (mode: 'initial' | 'refresh' | 'more' = 'initial') => {
      const nextOffset = mode === 'more' ? historyOffset : 0;
      if (mode === 'initial') {
        setHistoryLoading(true);
      } else if (mode === 'refresh') {
        setHistoryRefreshing(true);
      } else {
        setHistoryLoadingMore(true);
      }

      try {
        setHistoryError(null);
        const items = await fetchBookingHistory(HISTORY_PAGE_SIZE, nextOffset);
        setHistory((current) => (mode === 'more' ? [...current, ...items] : items));
        setHistoryOffset(nextOffset + items.length);
        setHistoryHasMore(items.length >= HISTORY_PAGE_SIZE);
      } catch (error) {
        setHistoryError(extractErrorMessage(error, 'Unable to load booking history.'));
      } finally {
        setHistoryLoading(false);
        setHistoryRefreshing(false);
        setHistoryLoadingMore(false);
      }
    },
    [historyOffset]
  );

  useFocusEffect(
    useCallback(() => {
      void loadHistory('initial');
      if (reservation?.id) {
        void fetchBooking(reservation.id)
          .then((nextBooking) => setReservation(nextBooking))
          .catch(() => undefined);
      }
      if (routeBookingId > 0) {
        void fetchBooking(routeBookingId)
          .then((nextBooking) => {
            setReservation(nextBooking);
            setTab('history');
          })
          .catch(() => undefined);
      }
    }, [loadHistory, reservation?.id, routeBookingId])
  );

  const handleSearch = useCallback(async () => {
    const trimmedLocation = location.trim();
    const guestCount = Number(guests || '1');

    if (!trimmedLocation) {
      Alert.alert('Destination required', 'Enter a location to search live travel inventory.');
      return;
    }

    setLoadingResults(true);
    setSearchError(null);
    setSelectedResult(null);
    setSelectedDetails(null);
    setReservation(null);

    try {
      const payload: BookingSearchPayload = {
        result_type: category,
        location: trimmedLocation,
        check_in: checkIn.trim() || null,
        check_out: checkOut.trim() || null,
        guests: Number.isFinite(guestCount) && guestCount > 0 ? guestCount : 1,
      };
      const items = await searchBookings(payload);
      setResults(items);
      if (!items.length) {
        setSearchError('No live results matched this search yet.');
      }
    } catch (error) {
      setResults([]);
      setSearchError(extractErrorMessage(error, 'Unable to search bookings.'));
    } finally {
      setLoadingResults(false);
    }
  }, [category, checkIn, checkOut, guests, location]);

  const handleSelectResult = useCallback(async (item: BookingSearchResultRecord) => {
    setSelectedResult(item);
    setReservation(null);
    setLoadingDetails(true);
    try {
      const details = await fetchBookingDetails(item.result_type, item.external_id);
      setSelectedDetails(details);
    } catch (error) {
      setSelectedDetails(null);
      Alert.alert('Unable to load details', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const handleReserve = useCallback(async () => {
    if (!selectedDetails || !user?.email) {
      return;
    }

    try {
      setReserving(true);
      const response = await createReservation({
        result_type: selectedDetails.result_type,
        external_id: selectedDetails.external_id,
        guest_name: getUserDisplayName(user),
        guest_email: user.email,
        payment_method: 'card',
      });
      setReservation(response.booking);
      setTab('search');
      Alert.alert('Reservation created', 'Your booking has been created. Complete payment to confirm it.');
      void loadHistory('refresh');
    } catch (error) {
      Alert.alert('Unable to reserve', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setReserving(false);
    }
  }, [loadHistory, selectedDetails, user]);

  const handleCheckout = useCallback(async () => {
    if (!reservation?.id) {
      return;
    }

    try {
      setStartingCheckout(true);
      await openBookingPaymentCheckout(reservation.id);
      Alert.alert('Stripe Checkout opened', 'Complete the payment in the browser, then return to Aventaro.');
      void loadHistory('refresh');
    } catch (error) {
      Alert.alert('Unable to start checkout', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setStartingCheckout(false);
    }
  }, [loadHistory, reservation?.id]);

  const handleRefreshReservation = useCallback(async () => {
    if (!reservation?.id) {
      return;
    }

    try {
      setStartingCheckout(true);
      const refreshed = await confirmBooking(reservation.id);
      setReservation(refreshed);
      Alert.alert('Booking refreshed', 'Latest booking status has been synced from the backend.');
      void loadHistory('refresh');
    } catch (error) {
      Alert.alert('Unable to refresh booking', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setStartingCheckout(false);
    }
  }, [loadHistory, reservation?.id]);

  const historyStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'confirmed':
      case 'completed':
        return COLORS.SUCCESS_GREEN;
      case 'cancelled':
      case 'refunded':
        return COLORS.ERROR_RED;
      default:
        return COLORS.PRIMARY_PURPLE;
    }
  }, []);

  const detailPolicySummary = useMemo(() => renderPolicySummary(selectedDetails), [selectedDetails]);

  const renderSearchBody = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loadingResults} onRefresh={() => void handleSearch()} tintColor={COLORS.PRIMARY_PURPLE} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {SEARCH_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.key}
            activeOpacity={0.92}
            style={[styles.categoryChip, category === option.key && styles.categoryChipActive]}
            onPress={() => setCategory(option.key)}
          >
            <Ionicons
              name={option.icon as any}
              size={16}
              color={category === option.key ? COLORS.WHITE : COLORS.TEXT_MUTED}
            />
            <Text style={[styles.categoryChipText, category === option.key && styles.categoryChipTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.searchCard}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Destination</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            style={styles.input}
            placeholder="Where are you headed?"
            placeholderTextColor={COLORS.TEXT_MUTED}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowField}>
            <Text style={styles.label}>Check-in</Text>
            <TextInput
              value={checkIn}
              onChangeText={setCheckIn}
              style={styles.input}
              placeholder="2026-04-20"
              placeholderTextColor={COLORS.TEXT_MUTED}
            />
          </View>
          <View style={styles.rowField}>
            <Text style={styles.label}>Check-out</Text>
            <TextInput
              value={checkOut}
              onChangeText={setCheckOut}
              style={styles.input}
              placeholder="2026-04-24"
              placeholderTextColor={COLORS.TEXT_MUTED}
            />
          </View>
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Travelers</Text>
          <TextInput
            value={guests}
            onChangeText={setGuests}
            style={styles.input}
            keyboardType="number-pad"
            placeholder="1"
            placeholderTextColor={COLORS.TEXT_MUTED}
          />
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={() => void handleSearch()} disabled={loadingResults}>
          {loadingResults ? (
            <ActivityIndicator size="small" color={COLORS.WHITE} />
          ) : (
            <>
              <Ionicons name="search-outline" size={18} color={COLORS.WHITE} />
              <Text style={styles.primaryButtonText}>Search {SEARCH_OPTIONS.find((item) => item.key === category)?.label}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {searchError ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Search update</Text>
          <Text style={styles.emptyText}>{searchError}</Text>
        </View>
      ) : null}

      {loadingResults ? (
        <View style={styles.skeletonList}>
          <TripCardSkeleton />
          <TripCardSkeleton />
        </View>
      ) : results.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Results</Text>
          <View style={styles.resultList}>
            {results.map((item) => (
              <TouchableOpacity
                key={`${item.result_type}:${item.external_id}`}
                activeOpacity={0.92}
                style={[
                  styles.resultCard,
                  selectedResult?.external_id === item.external_id && styles.resultCardActive,
                ]}
                onPress={() => void handleSelectResult(item)}
              >
                <View style={styles.resultHeader}>
                  <Text style={styles.resultTitle}>{item.title}</Text>
                  <Text style={styles.resultPrice}>{formatCurrency(item.price, item.currency)}</Text>
                </View>
                <Text style={styles.resultMeta}>{item.location}</Text>
                <Text style={styles.resultMeta}>
                  {item.provider_name}
                  {typeof item.rating === 'number' ? ` | ${item.rating.toFixed(1)} rating` : ''}
                </Text>
                {item.description ? <Text style={styles.resultBody}>{item.description}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {selectedResult ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Selected Offer</Text>
          <View style={styles.detailsCard}>
            {loadingDetails ? (
              <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
            ) : selectedDetails ? (
              <>
                <Text style={styles.detailsTitle}>{selectedDetails.title}</Text>
                <Text style={styles.detailsSubtitle}>{selectedDetails.location}</Text>
                <Text style={styles.detailsPrice}>{formatCurrency(selectedDetails.price, selectedDetails.currency)}</Text>
                {selectedDetails.description ? <Text style={styles.detailsBody}>{selectedDetails.description}</Text> : null}
                {selectedDetails.amenities?.length ? (
                  <View style={styles.tagRow}>
                    {selectedDetails.amenities.slice(0, 6).map((amenity) => (
                      <View key={amenity} style={styles.tag}>
                        <Text style={styles.tagText}>{amenity}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {detailPolicySummary.length ? (
                  <View style={styles.policyList}>
                    {detailPolicySummary.map((policy) => (
                      <Text key={policy} style={styles.policyText}>
                        - {policy}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <TouchableOpacity style={styles.primaryButton} onPress={() => void handleReserve()} disabled={reserving}>
                  {reserving ? (
                    <ActivityIndicator size="small" color={COLORS.WHITE} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.WHITE} />
                      <Text style={styles.primaryButtonText}>Reserve Now</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.emptyText}>Choose a result to load details.</Text>
            )}
          </View>
        </View>
      ) : null}

      {reservation ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Booking Confirmation</Text>
          <View style={styles.confirmationCard}>
            <Text style={styles.confirmationTitle}>Booking #{reservation.id}</Text>
            <Text style={styles.confirmationMeta}>Status: {reservation.status}</Text>
            <Text style={styles.confirmationMeta}>
              Total: {formatCurrency(reservation.total_amount, reservation.currency)}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleCheckout()}
              disabled={startingCheckout}
            >
              {startingCheckout ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <>
                  <Ionicons name="card-outline" size={18} color={COLORS.WHITE} />
                  <Text style={styles.primaryButtonText}>Pay with Stripe Checkout</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void handleRefreshReservation()}
              disabled={startingCheckout}
            >
              <Text style={styles.secondaryButtonText}>Refresh Booking Status</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );

  const renderHistoryItem = ({ item }: { item: BookingRecord }) => (
    <TouchableOpacity
      activeOpacity={0.92}
      style={styles.historyCard}
      onPress={() => {
        void fetchBooking(item.id)
          .then((booking) => setReservation(booking))
          .catch((error) => Alert.alert('Unable to load booking', extractErrorMessage(error, 'Please try again.')));
      }}
    >
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>Booking #{item.id}</Text>
        <Text style={[styles.historyStatus, { color: historyStatusColor(item.status) }]}>{item.status}</Text>
      </View>
      <Text style={styles.historyMeta}>{formatCurrency(item.total_amount, item.currency)}</Text>
      <Text style={styles.historyMeta}>{formatDateTime(item.created_at)}</Text>
    </TouchableOpacity>
  );

  const renderHistoryBody = () => {
    if (historyLoading && !history.length) {
      return (
        <View style={styles.skeletonList}>
          <TripCardSkeleton />
          <TripCardSkeleton />
        </View>
      );
    }

    if (historyError && !history.length) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>History unavailable</Text>
          <Text style={styles.emptyText}>{historyError}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void loadHistory('initial')}>
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.historyList}
        renderItem={renderHistoryItem}
        refreshControl={
          <RefreshControl
            refreshing={historyRefreshing}
            onRefresh={() => void loadHistory('refresh')}
            tintColor={COLORS.PRIMARY_PURPLE}
          />
        }
        onEndReached={() => {
          if (!historyLoadingMore && historyHasMore) {
            void loadHistory('more');
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          historyLoadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No bookings yet</Text>
            <Text style={styles.emptyText}>Completed reservations and paid bookings will appear here.</Text>
          </View>
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bookings</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.tabRow}>
        {(['search', 'history'] as BookingTab[]).map((value) => (
          <TouchableOpacity key={value} style={styles.tabButton} onPress={() => setTab(value)}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {value === 'search' ? 'Search' : 'Order History'}
            </Text>
            {tab === value ? <View style={styles.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'search' ? renderSearchBody() : renderHistoryBody()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.SURFACE,
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
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER_SOFT,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  tabText: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  tabTextActive: {
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '700',
  },
  tabUnderline: {
    width: '70%',
    height: 3,
    borderRadius: 999,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
  categoryRow: {
    gap: 10,
  },
  categoryChip: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryChipActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
  },
  categoryChipTextActive: {
    color: COLORS.WHITE,
  },
  searchCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 12,
  },
  inputGroup: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowField: {
    flex: 1,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    color: COLORS.TEXT_PRIMARY,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    color: COLORS.WHITE,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: COLORS.SURFACE,
  },
  secondaryButtonText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '700',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  resultList: {
    gap: 12,
  },
  resultCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 8,
  },
  resultCardActive: {
    borderColor: COLORS.PRIMARY_PURPLE,
    shadowColor: COLORS.SHADOW,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  resultTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  resultPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  resultMeta: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  resultBody: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  detailsCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 10,
  },
  detailsTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  detailsSubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  detailsPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  detailsBody: {
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.TEXT_SECONDARY,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    borderRadius: 999,
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  policyList: {
    gap: 4,
  },
  policyText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  confirmationCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: COLORS.SURFACE_MUTED,
    gap: 10,
  },
  confirmationTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  confirmationMeta: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  historyList: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  historyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 6,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  historyStatus: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  historyMeta: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyCard: {
    borderRadius: 20,
    padding: 24,
    backgroundColor: COLORS.BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  skeletonList: {
    gap: 12,
  },
});

