import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useAuth } from '../contexts/AuthContext';
import { fetchTripDiscover } from '../services/discoverService';
import { extractErrorMessage } from '../services/api';
import { errorLogger } from '../services/errorLogger';
import { fetchPostsFeed } from '../services/socialService';
import type { SocialPost, TripRecord } from '../services/types';
import { COLORS } from '../theme/colors';

type BookingCategory = 'flights' | 'hotels' | 'trains' | 'cabs' | 'activities' | 'packages';
type BookingMode = 'roundTrip' | 'oneWay';

type SearchFilters = {
  from: string;
  to: string;
  departure: string;
  returnDate: string;
  travelers: string;
};

const CATEGORY_OPTIONS: Array<{ key: BookingCategory; label: string; icon: string }> = [
  { key: 'flights', label: 'Flights', icon: 'airplane-outline' },
  { key: 'hotels', label: 'Hotels', icon: 'bed-outline' },
  { key: 'trains', label: 'Trains', icon: 'train-outline' },
  { key: 'cabs', label: 'Cabs', icon: 'car-outline' },
  { key: 'activities', label: 'Activities', icon: 'compass-outline' },
  { key: 'packages', label: 'Packages', icon: 'cube-outline' },
];

function normalizeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCurrency(amount: number | null | undefined) {
  if (!amount || Number.isNaN(amount)) {
    return 'Flexible';
  }

  return `$${Math.round(amount)}`;
}

function formatTripDuration(trip: TripRecord) {
  const start = parseDate(trip.start_date);
  const end = parseDate(trip.end_date);

  if (!start || !end) {
    return 'Open dates';
  }

  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  return `${totalDays} days`;
}

function matchesCategory(trip: TripRecord, category: BookingCategory) {
  const interests = (trip.interests || []).map((interest) => normalizeKey(interest));

  switch (category) {
    case 'flights':
      return Boolean(trip.start_date);
    case 'hotels':
      return Boolean((trip.budget_max || trip.budget_min || 0) >= 1200);
    case 'trains':
      return interests.some((interest) => ['culture', 'city', 'heritage'].includes(interest));
    case 'cabs':
      return trip.capacity <= 4;
    case 'activities':
      return interests.length > 0;
    case 'packages':
      return true;
    default:
      return true;
  }
}

function deriveLocationMediaMap(posts: SocialPost[]) {
  const nextMap: Record<string, string> = {};

  posts.forEach((post) => {
    if (post.media_type !== 'image' || !post.media_url) {
      return;
    }

    const key = normalizeKey(post.location);
    if (key && !nextMap[key]) {
      nextMap[key] = post.media_url;
    }
  });

  return nextMap;
}

export default function BookingsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [category, setCategory] = useState<BookingCategory>('flights');
  const [mode, setMode] = useState<BookingMode>('roundTrip');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [departureInput, setDepartureInput] = useState('');
  const [returnInput, setReturnInput] = useState('');
  const [travelersInput, setTravelersInput] = useState('1');
  const [submittedFilters, setSubmittedFilters] = useState<SearchFilters>({
    from: '',
    to: '',
    departure: '',
    returnDate: '',
    travelers: '1',
  });
  const [discoverTrips, setDiscoverTrips] = useState<TripRecord[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);

  useEffect(() => {
    if (!fromInput && user?.profile?.location) {
      setFromInput(user.profile.location);
      setSubmittedFilters((current) => ({ ...current, from: user.profile?.location || '' }));
    }
  }, [fromInput, user?.profile?.location]);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const [tripsResult, postsResult] = await Promise.allSettled([
        fetchTripDiscover(30),
        fetchPostsFeed({ limit: 30, offset: 0 }),
      ]);

      setDiscoverTrips(
        tripsResult.status === 'fulfilled' && Array.isArray(tripsResult.value) ? tripsResult.value : []
      );
      setPosts(postsResult.status === 'fulfilled' && Array.isArray(postsResult.value?.items) ? postsResult.value.items : []);

      if (tripsResult.status === 'rejected' && postsResult.status === 'rejected') {
        throw tripsResult.reason;
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'BookingsScreen', context: { action: 'loadInventory' } });
      setErrorMessage(extractErrorMessage(error, 'Unable to load travel inventory'));
      setDiscoverTrips([]);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadInventory();
    }, [loadInventory])
  );

  const locationMediaMap = useMemo(() => deriveLocationMediaMap(posts), [posts]);

  const filteredTrips = useMemo(() => {
    const categoryMatches = discoverTrips.filter((trip) => matchesCategory(trip, category));
    const categoryBase = categoryMatches.length ? categoryMatches : discoverTrips;

    const destinationQuery = normalizeKey(submittedFilters.to);
    const originQuery = normalizeKey(submittedFilters.from);

    return categoryBase
      .filter((trip) => {
        if (destinationQuery && !normalizeKey(trip.location).includes(destinationQuery)) {
          return false;
        }

        if (originQuery && originQuery === normalizeKey(trip.location)) {
          return false;
        }

        return true;
      })
      .map((trip) => ({
        ...trip,
        heroMediaUrl: locationMediaMap[normalizeKey(trip.location)] || null,
      }))
      .slice(0, 8);
  }, [category, discoverTrips, locationMediaMap, submittedFilters.from, submittedFilters.to]);

  const handleSearch = () => {
    setSubmittedFilters({
      from: fromInput.trim(),
      to: toInput.trim(),
      departure: departureInput.trim(),
      returnDate: returnInput.trim(),
      travelers: travelersInput.trim() || '1',
    });
  };

  const destinationChips = useMemo(
    () =>
      Array.from(new Set(discoverTrips.map((trip) => trip.location).filter(Boolean))).slice(0, 6),
    [discoverTrips]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book Travel</Text>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Travel inventory unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.searchButton} onPress={() => void loadInventory()}>
            <Text style={styles.searchButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {CATEGORY_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                activeOpacity={0.92}
                style={[styles.categoryChip, category === option.key && styles.categoryChipActive]}
                onPress={() => setCategory(option.key)}
              >
                <Ionicons
                  name={option.icon}
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
            <View style={styles.modeRow}>
              <TouchableOpacity
                activeOpacity={0.92}
                style={[styles.modeButton, mode === 'roundTrip' && styles.modeButtonActive]}
                onPress={() => setMode('roundTrip')}
              >
                <Text style={[styles.modeButtonText, mode === 'roundTrip' && styles.modeButtonTextActive]}>
                  Round Trip
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.92}
                style={[styles.modeButton, mode === 'oneWay' && styles.modeButtonActive]}
                onPress={() => setMode('oneWay')}
              >
                <Text style={[styles.modeButtonText, mode === 'oneWay' && styles.modeButtonTextActive]}>One Way</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.fieldRow}>
                <Ionicons name="navigate-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                <View style={styles.fieldText}>
                  <Text style={styles.fieldLabel}>From</Text>
                  <TextInput
                    value={fromInput}
                    onChangeText={setFromInput}
                    placeholder="Where are you leaving from?"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    style={styles.fieldInput}
                  />
                </View>
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <Ionicons name="location-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                <View style={styles.fieldText}>
                  <Text style={styles.fieldLabel}>To</Text>
                  <TextInput
                    value={toInput}
                    onChangeText={setToInput}
                    placeholder="Where are you going?"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    style={styles.fieldInput}
                  />
                </View>
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <Ionicons name="calendar-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                <View style={styles.fieldText}>
                  <Text style={styles.fieldLabel}>Departure</Text>
                  <TextInput
                    value={departureInput}
                    onChangeText={setDepartureInput}
                    placeholder="Select date"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    style={styles.fieldInput}
                  />
                </View>
              </View>

              {mode === 'roundTrip' ? (
                <>
                  <View style={styles.fieldDivider} />
                  <View style={styles.fieldRow}>
                    <Ionicons name="calendar-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                    <View style={styles.fieldText}>
                      <Text style={styles.fieldLabel}>Return</Text>
                      <TextInput
                        value={returnInput}
                        onChangeText={setReturnInput}
                        placeholder="Select date"
                        placeholderTextColor={COLORS.TEXT_MUTED}
                        style={styles.fieldInput}
                      />
                    </View>
                  </View>
                </>
              ) : null}

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <Ionicons name="people-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                <View style={styles.fieldText}>
                  <Text style={styles.fieldLabel}>Travelers</Text>
                  <TextInput
                    value={travelersInput}
                    onChangeText={setTravelersInput}
                    placeholder="1"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    keyboardType="number-pad"
                    style={styles.fieldInput}
                  />
                </View>
              </View>
            </View>

            <TouchableOpacity activeOpacity={0.92} style={styles.searchButton} onPress={handleSearch}>
              <Ionicons name="search-outline" size={18} color={COLORS.WHITE} />
              <Text style={styles.searchButtonText}>Search Travel</Text>
            </TouchableOpacity>
          </View>

          {destinationChips.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.destinationRow}>
              {destinationChips.map((destination) => (
                <TouchableOpacity
                  key={destination}
                  activeOpacity={0.92}
                  style={styles.destinationChip}
                  onPress={() => {
                    setToInput(destination);
                    setSubmittedFilters((current) => ({ ...current, to: destination }));
                  }}
                >
                  <Text style={styles.destinationChipText}>{destination}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Best Deals</Text>
            <View style={styles.aiBadge}>
              <Ionicons name="sparkles-outline" size={12} color={COLORS.PRIMARY_PURPLE} />
              <Text style={styles.aiBadgeText}>AI Curated</Text>
            </View>
          </View>

          {filteredTrips.length ? (
            <View style={styles.dealList}>
              {filteredTrips.map((trip) => (
                <TouchableOpacity
                  key={trip.id}
                  activeOpacity={0.94}
                  style={styles.dealCard}
                  onPress={() => navigation.navigate('TripDetails', { tripId: trip.id })}
                >
                  <View style={styles.dealHeader}>
                    <Text style={styles.dealTitle}>{trip.title}</Text>
                    <View style={styles.dealTag}>
                      <Text style={styles.dealTagText}>{trip.interests?.[0] || 'Curated'}</Text>
                    </View>
                  </View>

                  <View style={styles.dealGrid}>
                    <View style={styles.dealBlock}>
                      <Text style={styles.dealValue}>{formatCurrency(trip.budget_min || trip.budget_max)}</Text>
                      <Text style={styles.dealCaption}>Budget</Text>
                    </View>
                    <View style={styles.dealCenter}>
                      <Ionicons name="arrow-forward" size={18} color={COLORS.PRIMARY_PURPLE} />
                      <Text style={styles.dealDuration}>{formatTripDuration(trip)}</Text>
                    </View>
                    <View style={[styles.dealBlock, styles.dealBlockRight]}>
                      <Text style={styles.dealValue}>{trip.location}</Text>
                      <Text style={styles.dealCaption}>{trip.approved_member_count}/{trip.capacity} joined</Text>
                    </View>
                  </View>

                  <View style={styles.dealFooter}>
                    <Text style={styles.dealMeta}>
                      {submittedFilters.departure || formatTripDuration(trip)} - {submittedFilters.travelers || '1'} traveler
                    </Text>
                    <TouchableOpacity activeOpacity={0.92} style={styles.selectButton}>
                      <Text style={styles.selectButtonText}>Select</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No live travel deals matched</Text>
              <Text style={styles.emptyText}>Try another destination or category to explore live Aventaro trips.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    paddingBottom: 28,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  categoryRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  categoryChip: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE8FF',
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
    marginHorizontal: 16,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE8FF',
    padding: 12,
    gap: 14,
  },
  modeRow: {
    flexDirection: 'row',
    borderRadius: 16,
    backgroundColor: '#F6F1FF',
    padding: 4,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_MUTED,
  },
  modeButtonTextActive: {
    color: COLORS.WHITE,
  },
  fieldGroup: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3EEFF',
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: '#F4EEFF',
  },
  fieldText: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  fieldInput: {
    paddingVertical: 0,
    fontSize: 16,
    color: COLORS.TEXT_PRIMARY,
  },
  searchButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  searchButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  destinationRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  destinationChip: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    backgroundColor: '#F5F0FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  aiBadge: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: '#F5F0FF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  dealList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  dealCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE8FF',
    padding: 16,
    gap: 14,
  },
  dealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dealTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  dealTag: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: '#EAFBF2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1FA45B',
  },
  dealGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dealBlock: {
    flex: 1,
    gap: 4,
  },
  dealBlockRight: {
    alignItems: 'flex-end',
  },
  dealValue: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  dealCaption: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  dealCenter: {
    alignItems: 'center',
    gap: 6,
  },
  dealDuration: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  dealFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dealMeta: {
    flex: 1,
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  selectButton: {
    minHeight: 38,
    minWidth: 88,
    borderRadius: 19,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  selectButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
    backgroundColor: '#F7F2FF',
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
});
