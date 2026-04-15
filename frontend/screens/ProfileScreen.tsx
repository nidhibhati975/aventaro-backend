import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import ProfileMediaGrid from '../components/profile/ProfileMediaGrid';
import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { getActiveBoost } from '../services/boostService';
import { errorLogger } from '../services/errorLogger';
import { getSafeImageSource, getSafeMediaUrl } from '../services/media';
import { fetchMyProfile } from '../services/profileService';
import { fetchMyProfilePosts, fetchSavedPosts } from '../services/socialService';
import { fetchMySubscription } from '../services/subscriptionService';
import { fetchMyTrips } from '../services/tripService';
import {
  getUserDisplayName,
  getUserHandle,
  getUserInitials,
  type AppUser,
  type BoostRecord,
  type SocialPost,
  type SubscriptionRecord,
  type TripRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type ProfileTab = 'posts' | 'trips' | 'saved';

function formatCompactNumber(value: number | null | undefined) {
  const safeValue = Number(value || 0);

  if (safeValue >= 1000) {
    return `${(safeValue / 1000).toFixed(safeValue >= 10000 ? 0 : 1)}k`;
  }

  return `${safeValue}`;
}

function formatCurrency(amount: number | null | undefined) {
  if (!amount || Number.isNaN(amount)) {
    return 'Flexible';
  }

  return `$${Math.round(amount)}`;
}

function formatTripSubtitle(trip: TripRecord) {
  if (!trip.start_date || !trip.end_date) {
    return trip.location;
  }

  try {
    const start = new Date(trip.start_date);
    const end = new Date(trip.end_date);
    return `${trip.location} - ${start.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })} to ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch {
    return trip.location;
  }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyPanel}>
      <Text style={styles.emptyPanelTitle}>{title}</Text>
      <Text style={styles.emptyPanelBody}>{body}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { lastForegroundAt } = useAppRuntime();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ProfileTab>('posts');
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [activeBoost, setActiveBoost] = useState<BoostRecord | null>(null);
  const [profilePosts, setProfilePosts] = useState<SocialPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<SocialPost[]>([]);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const lastForegroundRef = React.useRef(lastForegroundAt);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const nextProfile = await fetchMyProfile();
      if (!nextProfile?.id) {
        throw new Error('Invalid profile response');
      }

      const [subscriptionResult, boostResult, postsResult, savedResult, tripsResult] = await Promise.allSettled([
        fetchMySubscription(),
        getActiveBoost('profile'),
        fetchMyProfilePosts(),
        fetchSavedPosts({ limit: 24, offset: 0 }),
        fetchMyTrips(nextProfile.id),
      ]);

      setProfile(nextProfile);
      setSubscription(subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : null);
      setActiveBoost(boostResult.status === 'fulfilled' ? boostResult.value : null);
      setProfilePosts(postsResult.status === 'fulfilled' && Array.isArray(postsResult.value) ? postsResult.value : []);
      setSavedPosts(
        savedResult.status === 'fulfilled' && Array.isArray(savedResult.value?.items) ? savedResult.value.items : []
      );
      setTrips(tripsResult.status === 'fulfilled' && Array.isArray(tripsResult.value) ? tripsResult.value : []);
    } catch (error) {
      errorLogger.logError(error, { source: 'ProfileScreen', context: { action: 'loadProfile' } });
      setErrorMessage(extractErrorMessage(error, 'Unable to load profile'));
      setProfile(null);
      setSubscription(null);
      setActiveBoost(null);
      setProfilePosts([]);
      setSavedPosts([]);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile])
  );

  React.useEffect(() => {
    if (lastForegroundAt === lastForegroundRef.current) {
      return;
    }

    lastForegroundRef.current = lastForegroundAt;
    void loadProfile();
  }, [lastForegroundAt, loadProfile]);

  const heroImage = useMemo(() => {
    const mediaPool = [...profilePosts, ...savedPosts];
    return mediaPool
      .filter((post) => post.media_type === 'image')
      .map((post) => getSafeMediaUrl(post.media_url))
      .find(Boolean) || null;
  }, [profilePosts, savedPosts]);
  const heroImageSource = useMemo(() => getSafeImageSource(heroImage), [heroImage]);

  const interestChips = useMemo(
    () => (profile?.profile?.interests || []).filter(Boolean).slice(0, 4),
    [profile?.profile?.interests]
  );

  const handleShare = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      const message = subscription?.referral_code
        ? `Explore Aventaro with me using referral code ${subscription.referral_code}.`
        : `Follow ${getUserDisplayName(profile)} on Aventaro and plan the next trip together.`;

      await Share.share({ message });
    } catch (error) {
      errorLogger.logError(error, { source: 'ProfileScreen', context: { action: 'shareProfile' } });
    }
  }, [profile, subscription?.referral_code]);

  const renderTripsPanel = () => {
    if (!trips.length) {
      return <EmptyPanel title="No trips yet" body="Your joined and created trips will appear here automatically." />;
    }

    return (
      <View style={styles.tripPanelList}>
        {trips.slice(0, 4).map((trip) => (
          <TouchableOpacity
            key={trip.id}
            activeOpacity={0.92}
            style={styles.tripPanelCard}
            onPress={() => navigation.navigate('TripDetails', { tripId: trip.id })}
          >
            <View style={styles.tripPanelIcon}>
              <Ionicons name="location-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
            </View>
            <View style={styles.tripPanelText}>
              <Text style={styles.tripPanelTitle}>{trip.title}</Text>
              <Text style={styles.tripPanelSubtitle}>{formatTripSubtitle(trip)}</Text>
            </View>
            <Text style={styles.tripPanelPrice}>{formatCurrency(trip.budget_max || trip.budget_min)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      </SafeAreaView>
    );
  }

  if (errorMessage || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Profile unavailable</Text>
          <Text style={styles.errorText}>{errorMessage || 'Unable to load profile'}</Text>
          <TouchableOpacity activeOpacity={0.92} style={styles.primaryButton} onPress={() => void loadProfile()}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.screenTitle}>Profile</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigateToPath(APP_PATHS.SCREEN_SETTINGS)}>
              <Ionicons name="settings-outline" size={20} color={COLORS.TEXT_PRIMARY} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconButton, styles.sosButton]} onPress={() => navigateToPath(APP_PATHS.SCREEN_EMERGENCY_SOS)}>
              <Ionicons name="warning-outline" size={20} color="#F0465B" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.heroWrap}>
          {heroImageSource ? (
            <ImageBackground
              source={heroImageSource}
              style={styles.heroBanner}
              imageStyle={styles.heroBannerImage}
            >
              <LinearGradient
                colors={['#6C3BFF', '#A253FF', '#E6BE56']}
                start={{ x: 0, y: 0.4 }}
                end={{ x: 1, y: 0.6 }}
                style={styles.heroGradient}
              />
            </ImageBackground>
          ) : (
            <LinearGradient
              colors={['#6C3BFF', '#A253FF', '#E6BE56']}
              start={{ x: 0, y: 0.4 }}
              end={{ x: 1, y: 0.6 }}
              style={styles.heroBanner}
            />
          )}

          <View style={styles.profileInfo}>
            <View style={styles.avatarOuter}>
              <View style={styles.avatarInner}>
                <Text style={styles.avatarText}>{getUserInitials(profile)}</Text>
              </View>
            </View>

            <View style={styles.badgeRow}>
              <View style={styles.premiumBadge}>
                <Ionicons
                  name={subscription?.is_premium ? 'star-outline' : 'person-outline'}
                  size={12}
                  color={COLORS.GOLD_DEEP}
                />
                <Text style={styles.premiumBadgeText}>{subscription?.is_premium ? 'Premium' : 'Traveler'}</Text>
              </View>
              {activeBoost ? (
                <View style={styles.boostBadge}>
                  <Ionicons name="flash" size={12} color={COLORS.WHITE} />
                  <Text style={styles.boostBadgeText}>Boost</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.name}>{getUserDisplayName(profile)}</Text>
            <Text style={styles.handle}>{getUserHandle(profile)}</Text>
            <Text style={styles.bio}>
              {profile.profile?.bio || 'Build your traveler identity with a strong profile, live posts, and shared trips.'}
            </Text>
            <Text style={styles.locationLine}>
              <Ionicons name="location-outline" size={13} color={COLORS.PRIMARY_PURPLE} /> {profile.profile?.location || 'Location not set'}
            </Text>

            {interestChips.length ? (
              <View style={styles.chipRow}>
                {interestChips.map((chip) => (
                  <View key={chip} style={styles.chip}>
                    <Text style={styles.chipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.statsRow}>
              <Stat value={formatCompactNumber(trips.length)} label="Trips" />
              <Stat value={formatCompactNumber(profile.followers_count)} label="Followers" />
              <Stat value={formatCompactNumber(profile.following_count)} label="Following" />
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.editButton} onPress={() => navigation.navigate('EditProfile')}>
                <Ionicons name="create-outline" size={16} color={COLORS.PRIMARY_PURPLE} />
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareButton} onPress={() => void handleShare()}>
                <Ionicons name="share-social-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoCardIcon}>
            <Ionicons name="compass-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
          </View>
          <View style={styles.infoCardText}>
            <Text style={styles.infoCardLabel}>Travel Style</Text>
            <Text style={styles.infoCardValue}>{profile.profile?.travel_style || 'Open to new adventures'}</Text>
          </View>
          <Text style={styles.infoCardMeta}>{activeBoost ? 'Boost active' : subscription?.plan_type || 'free'}</Text>
        </View>

        <View style={styles.segmentRow}>
          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.segmentButton, selectedTab === 'posts' && styles.segmentButtonActive]}
            onPress={() => setSelectedTab('posts')}
          >
            <Ionicons name="grid-outline" size={18} color={selectedTab === 'posts' ? COLORS.PRIMARY_PURPLE : COLORS.TEXT_MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.segmentButton, selectedTab === 'trips' && styles.segmentButtonActive]}
            onPress={() => setSelectedTab('trips')}
          >
            <Ionicons name="map-outline" size={18} color={selectedTab === 'trips' ? COLORS.PRIMARY_PURPLE : COLORS.TEXT_MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.segmentButton, selectedTab === 'saved' && styles.segmentButtonActive]}
            onPress={() => setSelectedTab('saved')}
          >
            <Ionicons name="bookmark-outline" size={18} color={selectedTab === 'saved' ? COLORS.PRIMARY_PURPLE : COLORS.TEXT_MUTED} />
          </TouchableOpacity>
        </View>

        {selectedTab === 'posts' ? (
          <ProfileMediaGrid
            posts={profilePosts}
            onOpenPost={(post) => {
              if (post.media_type === 'video') {
                navigation.navigate('Reels', { initialPostId: post.id });
              }
            }}
          />
        ) : null}

        {selectedTab === 'trips' ? renderTripsPanel() : null}

        {selectedTab === 'saved' ? (
          savedPosts.length ? (
            <ProfileMediaGrid
              posts={savedPosts}
              onOpenPost={(post) => {
                if (post.media_type === 'video') {
                  navigation.navigate('Reels', { initialPostId: post.id });
                }
              }}
            />
          ) : (
            <EmptyPanel title="No saved posts yet" body="Posts you save from the live Aventaro feed will appear here." />
          )
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
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0EAFF',
  },
  sosButton: {
    borderColor: '#FFD8DE',
    backgroundColor: '#FFF3F5',
  },
  heroWrap: {
    alignItems: 'center',
  },
  heroBanner: {
    width: '100%',
    height: 132,
    backgroundColor: '#D8C8FF',
  },
  heroBannerImage: {
    opacity: 0.18,
  },
  heroGradient: {
    flex: 1,
  },
  profileInfo: {
    width: '100%',
    marginTop: -30,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  avatarOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.SHADOW,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  avatarInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#F2ECFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  premiumBadge: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: '#FFF5DA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  premiumBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.GOLD_DEEP,
  },
  boostBadge: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  boostBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  name: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
    textAlign: 'center',
  },
  handle: {
    marginTop: 2,
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  bio: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  locationLine: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.PRIMARY_PURPLE,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: '#F4EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 18,
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  actionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 6,
  },
  editButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: COLORS.PRIMARY_PURPLE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  shareButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F3EDFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F0EAFF',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  infoCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F4EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCardText: {
    flex: 1,
    gap: 2,
  },
  infoCardLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  infoCardValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  infoCardMeta: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'capitalize',
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0EAFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EAFF',
    paddingVertical: 10,
  },
  segmentButton: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#F3EDFF',
  },
  tripPanelList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  tripPanelCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F0EAFF',
    backgroundColor: '#FFFFFF',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tripPanelIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F4EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripPanelText: {
    flex: 1,
    gap: 4,
  },
  tripPanelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  tripPanelSubtitle: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  tripPanelPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  emptyPanel: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 24,
    backgroundColor: '#F7F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyPanelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
    textAlign: 'center',
  },
  emptyPanelBody: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
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
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 18,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
});
