import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useAuth } from '../contexts/AuthContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { generateTripPlan } from '../services/aiService';
import { extractErrorMessage } from '../services/api';
import { errorLogger } from '../services/errorLogger';
import { getSafeImageSource, getSafeMediaUrl } from '../services/media';
import { fetchPostsFeed } from '../services/socialService';
import { fetchMyTrips, fetchTripActivity } from '../services/tripService';
import type {
  SocialPost,
  TripActivityRecord,
  TripPlanResult,
  TripRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type TripsTab = 'upcoming' | 'past' | 'itinerary';

type TimelineSection = {
  id: string;
  title: string;
  subtitle: string;
  items: Array<{
    id: string;
    time: string;
    title: string;
    amount?: string | null;
  }>;
};

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

function sortTripsByDate(trips: TripRecord[]) {
  return [...trips].sort((left, right) => {
    const leftDate = parseDate(left.start_date)?.getTime() || Number.MAX_SAFE_INTEGER;
    const rightDate = parseDate(right.start_date)?.getTime() || Number.MAX_SAFE_INTEGER;
    return leftDate - rightDate;
  });
}

function isPastTrip(trip: TripRecord) {
  const endDate = parseDate(trip.end_date);
  return Boolean(endDate && endDate.getTime() < Date.now());
}

function formatDateRange(trip: TripRecord) {
  const start = parseDate(trip.start_date);
  const end = parseDate(trip.end_date);

  if (!start || !end) {
    return 'Flexible dates';
  }

  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(
    undefined,
    { month: 'short', day: 'numeric' }
  )}`;
}

function formatTripDuration(trip: TripRecord) {
  const start = parseDate(trip.start_date);
  const end = parseDate(trip.end_date);

  if (!start || !end) {
    return 'Open trip';
  }

  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  return `${dayCount} days`;
}

function formatCurrency(amount: number | null | undefined) {
  if (!amount || Number.isNaN(amount)) {
    return 'Flexible';
  }

  return `$${Math.round(amount)}`;
}

function formatActivityTime(value: string | null | undefined, fallbackHour: number) {
  const parsed = parseDate(value);
  if (!parsed) {
    return `${String(fallbackHour).padStart(2, '0')}:00`;
  }

  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatActivityTitle(activity: TripActivityRecord) {
  const actor = activity.user?.profile?.name?.trim() || activity.user?.email?.split('@')[0] || 'Traveler';
  const metadata = activity.metadata || {};
  const rawDescription = typeof metadata.description === 'string' ? metadata.description.trim() : '';
  const rawContent = typeof metadata.content === 'string' ? metadata.content.trim() : '';

  switch (activity.type) {
    case 'join':
      return `${actor} joined the trip`;
    case 'leave':
      return `${actor} left the trip`;
    case 'expense':
      return rawDescription || 'Expense added to the trip';
    case 'expense_settled':
      return rawDescription || 'Expense settled';
    case 'message':
      return rawContent || 'New group chat message';
    default:
      return activity.type
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function extractActivityAmount(activity: TripActivityRecord) {
  const metadata = activity.metadata || {};
  const directAmount = typeof metadata.amount === 'number' ? metadata.amount : null;
  if (directAmount && directAmount > 0) {
    return formatCurrency(directAmount);
  }

  const totalAmount = typeof metadata.total_amount === 'number' ? metadata.total_amount : null;
  if (totalAmount && totalAmount > 0) {
    return formatCurrency(totalAmount);
  }

  return null;
}

function uniqueLocations(values: Array<string | null | undefined>, limit: number = 6) {
  const next: string[] = [];
  const seen = new Set<string>();

  values.forEach((rawValue) => {
    const value = rawValue?.trim();
    if (!value) {
      return;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    next.push(value);
  });

  return next.slice(0, limit);
}

function buildTripSnapshot(trip: TripRecord, status: 'past' | 'active') {
  return {
    title: trip.title,
    location: trip.location,
    status,
    budget_min: trip.budget_min ?? null,
    budget_max: trip.budget_max ?? null,
    interests: (trip.interests || []).slice(0, 6),
    start_date: trip.start_date ?? null,
    end_date: trip.end_date ?? null,
  };
}

function buildTripPlanInput(trip: TripRecord, allTrips: TripRecord[], travelStyle?: string | null) {
  const start = parseDate(trip.start_date);
  const end = parseDate(trip.end_date);
  const days =
    start && end
      ? Math.max(2, Math.min(10, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1))
      : 4;
  const pastTrips = allTrips.filter((item) => item.id !== trip.id && isPastTrip(item)).slice(0, 4);
  const candidateDestinations = uniqueLocations(
    allTrips.filter((item) => item.id !== trip.id).map((item) => item.location),
    6
  );

  return {
    budget: trip.budget_max || trip.budget_min || 1200,
    days,
    destination: trip.location,
    mood: 'adventure' as const,
    traveler_count: Math.max(trip.approved_member_count || 1, 1),
    travel_style: travelStyle || null,
    active_trip: buildTripSnapshot(trip, 'active'),
    past_trips: pastTrips.map((item) => buildTripSnapshot(item, 'past')),
    candidate_destinations: candidateDestinations,
    must_include: (trip.interests || []).slice(0, 3),
  };
}

function buildTimelineFromPlan(plan: TripPlanResult | null): TimelineSection[] {
  if (!plan?.itinerary?.length) {
    return [];
  }

  return plan.itinerary.map((day, dayIndex) => ({
    id: `plan_${day.day}`,
    title: dayIndex === 0 ? 'Arrival Day' : `Day ${day.day}`,
    subtitle: 'Optimized by Aventaro AI',
    items: day.activities.map((activity, activityIndex) => ({
      id: `plan_${day.day}_${activityIndex}`,
      time: `${String(9 + activityIndex * 3).padStart(2, '0')}:00`,
      title: activity,
      amount: null,
    })),
  }));
}

function buildTimelineFromActivity(activity: TripActivityRecord[]): TimelineSection[] {
  if (!activity.length) {
    return [];
  }

  const sections = new Map<string, TimelineSection>();

  activity.forEach((entry, index) => {
    const createdAt = parseDate(entry.created_at);
    const groupKey = createdAt ? createdAt.toDateString() : `group_${index}`;
    const title = createdAt
      ? createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : `Update ${index + 1}`;

    if (!sections.has(groupKey)) {
      sections.set(groupKey, {
        id: groupKey,
        title: sections.size === 0 ? 'Arrival Day' : `Day ${sections.size + 1}`,
        subtitle: title,
        items: [],
      });
    }

    sections.get(groupKey)?.items.push({
      id: `activity_${entry.id}`,
      time: formatActivityTime(entry.created_at, 9 + index * 2),
      title: formatActivityTitle(entry),
      amount: extractActivityAmount(entry),
    });
  });

  return [...sections.values()];
}

export default function TripsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [tab, setTab] = useState<TripsTab>('upcoming');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [activity, setActivity] = useState<TripActivityRecord[]>([]);
  const [plan, setPlan] = useState<TripPlanResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const loadTrips = useCallback(async () => {
    if (!user?.id) {
      setTrips([]);
      setPosts([]);
      setActivity([]);
      setPlan(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const [tripsResult, postsResult] = await Promise.allSettled([
        fetchMyTrips(user.id),
        fetchPostsFeed({ limit: 36, offset: 0 }),
      ]);

      const nextTrips =
        tripsResult.status === 'fulfilled' && Array.isArray(tripsResult.value)
          ? sortTripsByDate(tripsResult.value)
          : [];
      const nextPosts =
        postsResult.status === 'fulfilled' && Array.isArray(postsResult.value?.items)
          ? postsResult.value.items
          : [];

      setTrips(nextTrips);
      setPosts(nextPosts);

      const itineraryTrip = nextTrips.find((trip) => !isPastTrip(trip)) || nextTrips[0] || null;

      if (itineraryTrip) {
        const [activityResult, planResult] = await Promise.allSettled([
          fetchTripActivity(itineraryTrip.id, 32),
          generateTripPlan(buildTripPlanInput(itineraryTrip, nextTrips, user?.profile?.travel_style)),
        ]);

        if (activityResult.status === 'fulfilled') {
          setActivity(Array.isArray(activityResult.value?.items) ? activityResult.value.items : []);
        } else {
          setActivity([]);
          errorLogger.logError(activityResult.reason, {
            source: 'TripsScreen',
            context: { action: 'fetchTripActivity', tripId: itineraryTrip.id },
          });
        }

        if (planResult.status === 'fulfilled') {
          setPlan(planResult.value || null);
        } else {
          setPlan(null);
          errorLogger.logError(planResult.reason, {
            source: 'TripsScreen',
            context: { action: 'generateTripPlan', tripId: itineraryTrip.id },
          });
        }
      } else {
        setActivity([]);
        setPlan(null);
      }

      if (tripsResult.status === 'rejected' && postsResult.status === 'rejected') {
        throw tripsResult.reason;
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'TripsScreen', context: { action: 'loadTrips' } });
      setErrorMessage(extractErrorMessage(error, 'Unable to load your trips'));
      setTrips([]);
      setPosts([]);
      setActivity([]);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.profile?.travel_style]);

  useFocusEffect(
    useCallback(() => {
      void loadTrips();
    }, [loadTrips])
  );

  const locationMediaMap = useMemo(() => {
    const nextMap: Record<string, string> = {};

    posts.forEach((post) => {
      const mediaUrl = getSafeMediaUrl(post.media_url);
      if (post.media_type !== 'image' || !mediaUrl) {
        return;
      }

      const key = normalizeKey(post.location);
      if (key && !nextMap[key]) {
        nextMap[key] = mediaUrl;
      }
    });

    return nextMap;
  }, [posts]);

  const enrichedTrips = useMemo(
    () =>
      trips.map((trip) => ({
        ...trip,
        heroMediaUrl: locationMediaMap[normalizeKey(trip.location)] || null,
      })),
    [locationMediaMap, trips]
  );

  const upcomingTrips = useMemo(() => enrichedTrips.filter((trip) => !isPastTrip(trip)), [enrichedTrips]);
  const pastTrips = useMemo(() => enrichedTrips.filter((trip) => isPastTrip(trip)), [enrichedTrips]);
  const activeTrip = upcomingTrips[0] || enrichedTrips[0] || null;
  const timelineSections = useMemo(() => {
    const realTimeline = buildTimelineFromActivity(activity);
    return realTimeline.length ? realTimeline : buildTimelineFromPlan(plan);
  }, [activity, plan]);

  const handleOptimize = useCallback(async () => {
    if (!activeTrip) {
      return;
    }

    try {
      setOptimizing(true);
      const nextPlan = await generateTripPlan(buildTripPlanInput(activeTrip, trips, user?.profile?.travel_style));
      setPlan(nextPlan);
    } catch (error) {
      errorLogger.logError(error, {
        source: 'TripsScreen',
        context: { action: 'optimizeTrip', tripId: activeTrip.id },
      });
    } finally {
      setOptimizing(false);
    }
  }, [activeTrip, trips, user?.profile?.travel_style]);

  const renderTripCard = useCallback(
    (trip: TripRecord & { heroMediaUrl?: string | null }) => {
      const tripImageSource = getSafeImageSource(trip.heroMediaUrl);
      const content = (
        <LinearGradient colors={['rgba(25,16,46,0.18)', 'rgba(25,16,46,0.84)']} style={styles.tripOverlay}>
          <View style={styles.tripDateBadge}>
            <Text style={styles.tripDateText}>{formatDateRange(trip)}</Text>
          </View>

          <View style={styles.tripCardBottom}>
            <Text style={styles.tripTitle}>{trip.title}</Text>
            <Text style={styles.tripLocation}>{trip.location}</Text>
            <View style={styles.tripMetaRow}>
              <Text style={styles.tripMeta}>{formatTripDuration(trip)}</Text>
              <Text style={styles.tripMeta}>{formatCurrency(trip.budget_max || trip.budget_min)}</Text>
              <Text style={styles.tripMeta}>{trip.approved_member_count}/{trip.capacity}</Text>
            </View>
          </View>
        </LinearGradient>
      );

      return (
        <TouchableOpacity
          key={trip.id}
          activeOpacity={0.94}
          style={styles.tripCardWrap}
          onPress={() => navigation.navigate('TripDetails', { tripId: trip.id })}
        >
          {tripImageSource ? (
            <ImageBackground
              source={tripImageSource}
              style={styles.tripCard}
              imageStyle={styles.tripCardImage}
            >
              {content}
            </ImageBackground>
          ) : (
            <View style={styles.tripCard}>
              {content}
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [navigation]
  );

  const renderTripList = (items: Array<TripRecord & { heroMediaUrl?: string | null }>, emptyLabel: string) => {
    if (!items.length) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{emptyLabel}</Text>
          <Text style={styles.emptyText}>Your live Aventaro trips will appear here as soon as they are available.</Text>
        </View>
      );
    }

    return <View style={styles.tripList}>{items.map(renderTripCard)}</View>;
  };

  const renderItinerary = () => {
    if (!activeTrip) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No itinerary available</Text>
          <Text style={styles.emptyText}>Join or create a trip first to unlock the itinerary view.</Text>
        </View>
      );
    }

    return (
      <View style={styles.itineraryWrap}>
        <LinearGradient colors={[COLORS.PRIMARY_PURPLE, '#8D4EFF']} style={styles.heroSummary}>
          <Text style={styles.heroSummaryTitle}>{activeTrip.title}</Text>
          <Text style={styles.heroSummarySubtitle}>
            {formatDateRange(activeTrip)} - {formatTripDuration(activeTrip)}
          </Text>

          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>{formatCurrency(plan?.total_estimated_cost || activeTrip.budget_max || activeTrip.budget_min)}</Text>
              <Text style={styles.summaryLabel}>Budget</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>{timelineSections.length || 0}</Text>
              <Text style={styles.summaryLabel}>Days Planned</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>
                {timelineSections.reduce((total, section) => total + section.items.length, 0)}
              </Text>
              <Text style={styles.summaryLabel}>Activities</Text>
            </View>
          </View>

          <TouchableOpacity activeOpacity={0.92} style={styles.optimizeButton} onPress={() => void handleOptimize()}>
            {optimizing ? (
              <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color={COLORS.PRIMARY_PURPLE} />
                <Text style={styles.optimizeButtonText}>Optimize with AI</Text>
              </>
            )}
          </TouchableOpacity>
        </LinearGradient>

        {timelineSections.length ? (
          timelineSections.map((section, sectionIndex) => (
            <View key={section.id} style={styles.timelineGroup}>
              <View style={styles.timelineHeader}>
                <View style={styles.timelineNumber}>
                  <Text style={styles.timelineNumberText}>{sectionIndex + 1}</Text>
                </View>
                <View style={styles.timelineHeaderText}>
                  <Text style={styles.timelineTitle}>{section.title}</Text>
                  <Text style={styles.timelineSubtitle}>{section.subtitle}</Text>
                </View>
              </View>

              <View style={styles.timelineRows}>
                {section.items.map((item, itemIndex) => (
                  <View key={item.id} style={styles.timelineRow}>
                    <Text style={styles.timelineTime}>{item.time}</Text>
                    <View style={styles.timelineTrack}>
                      <View style={styles.timelineDot} />
                      {itemIndex < section.items.length - 1 ? <View style={styles.timelineLine} /> : null}
                    </View>
                    <View style={styles.timelineCard}>
                      <Text style={styles.timelineCardText}>{item.title}</Text>
                      {item.amount ? <Text style={styles.timelineAmount}>{item.amount}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Itinerary is still being built</Text>
            <Text style={styles.emptyText}>Aventaro will show your trip activity or AI plan here as soon as it is ready.</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>My Trips</Text>
        <TouchableOpacity activeOpacity={0.92} style={styles.bookButton} onPress={() => navigateToPath(APP_PATHS.SCREEN_BOOKINGS)}>
          <Text style={styles.bookButtonText}>+ Book Trip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {(['upcoming', 'past', 'itinerary'] as TripsTab[]).map((value) => (
          <TouchableOpacity key={value} style={styles.tabButton} onPress={() => setTab(value)}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {value === 'upcoming' ? 'Upcoming' : value === 'past' ? 'Past' : 'Itinerary'}
            </Text>
            {tab === value ? <View style={styles.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Trips unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity activeOpacity={0.92} style={styles.retryButton} onPress={() => void loadTrips()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {tab === 'upcoming' ? renderTripList(upcomingTrips, 'No upcoming trips') : null}
          {tab === 'past' ? renderTripList(pastTrips, 'No past trips yet') : null}
          {tab === 'itinerary' ? renderItinerary() : null}
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
    paddingBottom: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  bookButton: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#EFE8FF',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
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
    paddingBottom: 28,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 18,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  tripList: {
    gap: 16,
  },
  tripCardWrap: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#F3ECFF',
  },
  tripCard: {
    minHeight: 166,
    justifyContent: 'flex-end',
    backgroundColor: '#D8C8FF',
  },
  tripCardImage: {
    borderRadius: 22,
  },
  tripOverlay: {
    padding: 14,
    gap: 40,
  },
  tripDateBadge: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  tripDateText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  tripCardBottom: {
    gap: 4,
  },
  tripTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  tripLocation: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
  },
  tripMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  tripMeta: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.84)',
  },
  itineraryWrap: {
    gap: 16,
  },
  heroSummary: {
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  heroSummaryTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  heroSummarySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  summaryLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.86)',
  },
  optimizeButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: COLORS.WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  optimizeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  timelineGroup: {
    gap: 12,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timelineNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineNumberText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  timelineHeaderText: {
    gap: 2,
  },
  timelineTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  timelineSubtitle: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  timelineRows: {
    gap: 10,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  timelineTime: {
    width: 44,
    paddingTop: 16,
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  timelineTrack: {
    width: 18,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 20,
    backgroundColor: COLORS.GOLD_DEEP,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    marginTop: 4,
    backgroundColor: '#EEE6FF',
  },
  timelineCard: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0EAFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  timelineCardText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  timelineAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_SECONDARY,
  },
  emptyCard: {
    borderRadius: 22,
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
