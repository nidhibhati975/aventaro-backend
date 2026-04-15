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

import AiTripPlannerCard from '../components/discover/AiTripPlannerCard';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { fetchTripDiscover } from '../services/discoverService';
import { errorLogger } from '../services/errorLogger';
import { getSafeImageSource, getSafeMediaUrl } from '../services/media';
import { fetchPostsFeed } from '../services/socialService';
import type { SocialPost, TripRecord } from '../services/types';
import { COLORS } from '../theme/colors';

type CategoryOption = 'All' | string;

function normalizeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function formatPrice(trip: TripRecord | null | undefined) {
  if (!trip) {
    return '$0';
  }

  const amount = trip.budget_max || trip.budget_min || 0;
  return `$${amount}`;
}

function formatTravelerCount(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return `${value}`;
}

export default function DiscoverScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption>('All');
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);

  const loadDiscover = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const [tripsResult, postsResult] = await Promise.allSettled([
      fetchTripDiscover(24),
      fetchPostsFeed({ limit: 32, offset: 0 }),
    ]);

    if (tripsResult.status === 'fulfilled') {
      setTrips(Array.isArray(tripsResult.value) ? tripsResult.value : []);
    } else {
      setTrips([]);
      errorLogger.logError(tripsResult.reason, { source: 'DiscoverScreen', context: { action: 'fetchTrips' } });
    }

    if (postsResult.status === 'fulfilled') {
      setPosts(Array.isArray(postsResult.value?.items) ? postsResult.value.items : []);
    } else {
      setPosts([]);
      errorLogger.logError(postsResult.reason, { source: 'DiscoverScreen', context: { action: 'fetchPosts' } });
    }

    if (tripsResult.status === 'rejected' && postsResult.status === 'rejected') {
      setErrorMessage(extractErrorMessage(tripsResult.reason, 'Unable to load discover'));
    }

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDiscover();
    }, [loadDiscover])
  );

  const locationMediaMap = useMemo(() => {
    const nextMap: Record<string, string> = {};
    posts.forEach((post) => {
      const mediaUrl = getSafeMediaUrl(post?.media_url);
      if (post?.media_type !== 'image' || !mediaUrl) {
        return;
      }

      const locationKey = normalizeKey(post.location);
      if (locationKey && !nextMap[locationKey]) {
        nextMap[locationKey] = mediaUrl;
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

  const categories = useMemo<CategoryOption[]>(() => {
    const tripInterests = enrichedTrips.flatMap((trip) => trip.interests || []);
    const next = Array.from(new Set(tripInterests.filter(Boolean))).slice(0, 6);
    return ['All', ...next];
  }, [enrichedTrips]);

  const filteredTrips = useMemo(() => {
    if (selectedCategory === 'All') {
      return enrichedTrips;
    }

    return enrichedTrips.filter((trip) =>
      (trip.interests || []).some((interest) => normalizeKey(interest) === normalizeKey(selectedCategory))
    );
  }, [enrichedTrips, selectedCategory]);

  const featuredTrip = filteredTrips[0] || enrichedTrips[0] || null;

  const destinationChips = useMemo(() => {
    const counts = new Map<string, number>();
    enrichedTrips.forEach((trip) => {
      const key = trip.location?.trim();
      if (!key) {
        return;
      }
      counts.set(key, (counts.get(key) || 0) + Math.max(1, trip.approved_member_count || 1));
    });

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
  }, [enrichedTrips]);

  const heroTrips = filteredTrips.slice(0, 4);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      </SafeAreaView>
    );
  }

  if (errorMessage && enrichedTrips.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Discover unavailable</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadDiscover()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}>
              <Ionicons name="navigate-outline" size={18} color={COLORS.WHITE} />
            </View>
            <Text style={styles.brandText}>aventaro</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.actionCircle} onPress={() => navigateToPath(APP_PATHS.SCREEN_NOTIFICATIONS)}>
              <Ionicons name="notifications-outline" size={20} color={COLORS.TEXT_PRIMARY} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCircle} onPress={() => navigateToPath(APP_PATHS.SCREEN_TRAVELER_MAP)}>
              <Ionicons name="map-outline" size={20} color={COLORS.TEXT_PRIMARY} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.heroTitle}>Discover Your</Text>
          <Text style={styles.heroTitleAccent}>Next Adventure</Text>
          <Text style={styles.heroSubtitle}>Swipe to find your dream trip</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {categories.map((category) => (
            <TouchableOpacity
              key={category}
              activeOpacity={0.92}
              style={[styles.categoryChip, selectedCategory === category && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(category)}
            >
              <Text style={[styles.categoryChipText, selectedCategory === category && styles.categoryChipTextActive]}>
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {featuredTrip ? (
          <TouchableOpacity
            activeOpacity={0.94}
            style={styles.featuredCardWrap}
            onPress={() => navigation.navigate('TripDetails', { tripId: featuredTrip.id })}
          >
            {(() => {
              const featuredSource = getSafeImageSource(featuredTrip.heroMediaUrl);
              const content = (
                <LinearGradient colors={['rgba(20,14,44,0.05)', 'rgba(20,14,44,0.82)']} style={styles.featuredOverlay}>
                  <View style={styles.featuredTopRow}>
                    <View style={styles.featuredTag}>
                      <Text style={styles.featuredTagText}>{featuredTrip.interests?.[0] || 'Experience'}</Text>
                    </View>
                    <View style={styles.featuredRating}>
                      <Ionicons name="star-outline" size={12} color={COLORS.GOLD_DEEP} />
                      <Text style={styles.featuredRatingText}>4.9</Text>
                    </View>
                  </View>

                  <View style={styles.featuredBottom}>
                    <Text style={styles.featuredBottomTitle}>{featuredTrip.title}</Text>
                    <Text style={styles.featuredBottomLocation}>{featuredTrip.location}</Text>
                  </View>
                </LinearGradient>
              );

              return featuredSource ? (
                <ImageBackground
                  source={featuredSource}
                  style={styles.featuredCard}
                  imageStyle={styles.featuredCardImage}
                >
                  {content}
                </ImageBackground>
              ) : (
                <View style={styles.featuredCard}>
                  {content}
                </View>
              );
            })()}
          </TouchableOpacity>
        ) : null}

        <View style={styles.swipeRow}>
          <Ionicons name="arrow-back-outline" size={14} color={COLORS.TEXT_MUTED} />
          <Text style={styles.swipeText}>Swipe to explore</Text>
          <Ionicons name="arrow-forward-outline" size={14} color={COLORS.TEXT_MUTED} />
        </View>

        {destinationChips.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Trending Destinations</Text>
              <Text style={styles.sectionAction}>See all</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.destinationRow}>
              {destinationChips.map((destination) => (
                <TouchableOpacity
                  key={destination.name}
                  activeOpacity={0.92}
                  style={styles.destinationCard}
                  onPress={() => setSelectedCategory('All')}
                >
                  <View style={styles.destinationIconWrap}>
                    <Ionicons name="location-outline" size={24} color={COLORS.TEXT_SECONDARY} />
                  </View>
                  <Text style={styles.destinationName}>{destination.name}</Text>
                  <Text style={styles.destinationMeta}>{formatTravelerCount(destination.count)} travelers</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : null}

        <AiTripPlannerCard
          destination={featuredTrip?.location || null}
          budget={featuredTrip?.budget_max || featuredTrip?.budget_min || null}
        />

        {heroTrips.length > 1 ? (
          <View style={styles.tripStack}>
            {heroTrips.slice(1).map((trip) => (
              <TouchableOpacity
                key={trip.id}
                activeOpacity={0.94}
                style={styles.packageCard}
                onPress={() => navigation.navigate('TripDetails', { tripId: trip.id })}
              >
                {(() => {
                  const packageSource = getSafeImageSource(trip.heroMediaUrl);
                  const content = (
                    <LinearGradient colors={['rgba(17,10,33,0.15)', 'rgba(17,10,33,0.86)']} style={styles.packageOverlay}>
                      <View style={styles.packageTopRow}>
                        <View style={styles.featuredTag}>
                          <Text style={styles.featuredTagText}>{trip.interests?.[0] || 'Curated'}</Text>
                        </View>
                        <Text style={styles.packagePrice}>{formatPrice(trip)}/person</Text>
                      </View>
                      <View style={styles.packageBottom}>
                        <Text style={styles.packageTitle}>{trip.title}</Text>
                        <Text style={styles.packageLocation}>{trip.location}</Text>
                      </View>
                    </LinearGradient>
                  );

                  return packageSource ? (
                    <ImageBackground
                      source={packageSource}
                      style={styles.packageMedia}
                      imageStyle={styles.packageMediaImage}
                    >
                      {content}
                    </ImageBackground>
                  ) : (
                    <View style={styles.packageMedia}>
                      {content}
                    </View>
                  );
                })()}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  retryButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ECE4FF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    gap: 2,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  heroTitleAccent: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 16,
    color: COLORS.TEXT_SECONDARY,
  },
  categoryRow: {
    gap: 10,
  },
  categoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ECE4FF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  categoryChipActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  categoryChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
  },
  categoryChipTextActive: {
    color: COLORS.WHITE,
  },
  featuredCardWrap: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  featuredCard: {
    height: 430,
    backgroundColor: '#EDE6FF',
  },
  featuredCardImage: {
    resizeMode: 'cover',
  },
  featuredOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 16,
  },
  featuredTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  featuredTag: {
    borderRadius: 999,
    backgroundColor: 'rgba(108,59,255,0.96)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  featuredTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  featuredRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(33,20,76,0.72)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  featuredRatingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F4C75A',
  },
  featuredBottom: {
    paddingTop: 100,
  },
  featuredBottomTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  featuredBottomLocation: {
    marginTop: 4,
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
  },
  swipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  swipeText: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  sectionAction: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  destinationRow: {
    gap: 12,
  },
  destinationCard: {
    width: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EEE6FF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  destinationIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F7F2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationName: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  destinationMeta: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  tripStack: {
    gap: 14,
  },
  packageCard: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  packageMedia: {
    height: 220,
    backgroundColor: '#EDE6FF',
  },
  packageMediaImage: {
    resizeMode: 'cover',
  },
  packageOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 16,
  },
  packageTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  packagePrice: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  packageBottom: {
    gap: 4,
  },
  packageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  packageLocation: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
  },
});
