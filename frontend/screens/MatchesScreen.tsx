import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useAuth } from '../contexts/AuthContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { buildConversationId } from '../services/chatService';
import { fetchPeopleDiscover } from '../services/discoverService';
import { errorLogger } from '../services/errorLogger';
import { getSafeImageSource, getSafeMediaUrl } from '../services/media';
import {
  acceptMatchRequest,
  fetchReceivedMatches,
  fetchSentMatches,
  rejectMatchRequest,
  sendMatchRequest,
} from '../services/matchService';
import { fetchPostsFeed } from '../services/socialService';
import {
  getUserDisplayName,
  getUserHandle,
  getUserInitials,
  type AppUser,
  type MatchRecord,
  type SocialPost,
} from '../services/types';
import { COLORS } from '../theme/colors';

type ConnectTab = 'discover' | 'incoming' | 'sent';

function normalizeKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

export default function MatchesScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [tab, setTab] = useState<ConnectTab>('discover');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [discoverPeople, setDiscoverPeople] = useState<AppUser[]>([]);
  const [incoming, setIncoming] = useState<MatchRecord[]>([]);
  const [sent, setSent] = useState<MatchRecord[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [peopleResult, incomingResult, sentResult, postsResult] = await Promise.allSettled([
        fetchPeopleDiscover(12),
        fetchReceivedMatches(),
        fetchSentMatches(),
        fetchPostsFeed({ limit: 30, offset: 0 }),
      ]);

      if (peopleResult.status === 'fulfilled') {
        setDiscoverPeople(Array.isArray(peopleResult.value) ? peopleResult.value : []);
      } else {
        setDiscoverPeople([]);
      }

      if (incomingResult.status === 'fulfilled') {
        setIncoming(Array.isArray(incomingResult.value) ? incomingResult.value : []);
      } else {
        setIncoming([]);
      }

      if (sentResult.status === 'fulfilled') {
        setSent(Array.isArray(sentResult.value) ? sentResult.value : []);
      } else {
        setSent([]);
      }

      if (postsResult.status === 'fulfilled') {
        setPosts(Array.isArray(postsResult.value?.items) ? postsResult.value.items : []);
      } else {
        setPosts([]);
      }

      if (
        peopleResult.status === 'rejected' &&
        incomingResult.status === 'rejected' &&
        sentResult.status === 'rejected'
      ) {
        throw peopleResult.reason;
      }
    } catch (error) {
      errorLogger.logError(error, { source: 'MatchesScreen', context: { action: 'loadData' } });
      setErrorMessage(extractErrorMessage(error, 'Unable to load traveler connections'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const userMediaMap = useMemo(() => {
    const nextMap: Record<number, string> = {};
    posts.forEach((post) => {
      const mediaUrl = getSafeMediaUrl(post?.media_url);
      if (post?.media_type !== 'image' || !post?.user?.id || !mediaUrl) {
        return;
      }
      if (!nextMap[post.user.id]) {
        nextMap[post.user.id] = mediaUrl;
      }
    });
    return nextMap;
  }, [posts]);

  const handleSendRequest = async (person: AppUser) => {
    try {
      setActionId(`discover:${person.id}`);
      await sendMatchRequest(person.id);
      setDiscoverPeople((current) => current.filter((item) => item.id !== person.id));
    } catch (error) {
      Alert.alert('Unable to connect', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  const handleAccept = async (match: MatchRecord) => {
    try {
      setActionId(`accept:${match.id}`);
      const accepted = await acceptMatchRequest(match.id);
      await loadData();
      if (!user?.id) {
        return;
      }
      navigation.navigate('Conversation', {
        conversationId: buildConversationId(user.id, accepted.user.id),
        participant: accepted.user,
      });
    } catch (error) {
      Alert.alert('Unable to accept', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (matchId: number) => {
    try {
      setActionId(`reject:${matchId}`);
      await rejectMatchRequest(matchId);
      await loadData();
    } catch (error) {
      Alert.alert('Unable to reject', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  const renderTabButton = (value: ConnectTab, label: string, count?: number) => (
    <TouchableOpacity activeOpacity={0.92} style={styles.tabButton} onPress={() => setTab(value)}>
      <Text style={[styles.tabLabel, tab === value && styles.tabLabelActive]}>
        {label}
        {typeof count === 'number' && count > 0 ? ` ${count}` : ''}
      </Text>
      {tab === value ? <View style={styles.tabUnderline} /> : null}
    </TouchableOpacity>
  );

  const renderDiscoverCard = (person: AppUser) => {
    const cover = userMediaMap[person.id];

    return (
      <View key={person.id} style={styles.connectCard}>
        <View style={styles.connectCardTop}>
          <View style={styles.avatarHeroWrap}>
            {getSafeImageSource(cover) ? (
              <Image source={getSafeImageSource(cover)} style={styles.avatarHero} />
            ) : (
              <View style={[styles.avatarHero, styles.avatarHeroFallback]}>
                <Text style={styles.avatarHeroText}>{getUserInitials(person)}</Text>
              </View>
            )}
          </View>
          <View style={styles.matchPill}>
            <Text style={styles.matchPillText}>Match</Text>
          </View>
        </View>

        <View style={styles.connectBody}>
          <Text style={styles.connectName}>{getUserDisplayName(person)}</Text>
          <Text style={styles.connectHandle}>{getUserHandle(person)}</Text>
          <Text style={styles.connectBio}>
            {person.profile?.bio || 'Traveling with intention, stories, and a flexible next route.'}
          </Text>
          <Text style={styles.connectLocation}>
            <Ionicons name="navigate-outline" size={13} color={COLORS.PRIMARY_PURPLE} /> Currently: {person.profile?.location || 'Open to travel'}
          </Text>

          <View style={styles.chipRow}>
            {(person.profile?.interests || []).slice(0, 3).map((interest) => (
              <View key={interest} style={styles.softChip}>
                <Text style={styles.softChipText}>{interest}</Text>
              </View>
            ))}
          </View>

          <View style={styles.travelBanner}>
            <Ionicons name="calendar-outline" size={15} color={COLORS.PRIMARY_PURPLE} />
            <Text style={styles.travelBannerText}>
              {person.profile?.travel_style || 'Solo Explorer'} · Budget {person.profile?.budget_max || person.profile?.budget_min || 'Flexible'}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{person.posts_count || 0}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{person.followers_count || 0}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{person.profile?.travel_style || 'Solo'}</Text>
              <Text style={styles.statLabel}>Style</Text>
            </View>
          </View>

          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.rejectCircle} onPress={() => setDiscoverPeople((current) => current.filter((item) => item.id !== person.id))}>
              <Ionicons name="close" size={24} color={COLORS.TEXT_MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.connectButton}
              disabled={actionId === `discover:${person.id}`}
              onPress={() => void handleSendRequest(person)}
            >
              {actionId === `discover:${person.id}` ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={19} color={COLORS.WHITE} />
                  <Text style={styles.connectButtonText}>Connect</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.chatCircle}
              onPress={() => navigation.navigate('PublicProfile', { userId: person.id, initialUser: person })}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={22} color="#BE9E2C" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderRequestCard = (match: MatchRecord, mode: 'incoming' | 'sent') => (
    <View key={`${mode}_${match.id}`} style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.requestAvatar}>
          <Text style={styles.requestAvatarText}>{getUserInitials(match.user)}</Text>
        </View>
        <View style={styles.requestText}>
          <Text style={styles.requestName}>{getUserDisplayName(match.user)}</Text>
          <Text style={styles.requestHandle}>{getUserHandle(match.user)}</Text>
        </View>
        <View style={[styles.statusBadge, match.status === 'accepted' ? styles.statusAccepted : styles.statusPending]}>
          <Text style={styles.statusText}>{match.status}</Text>
        </View>
      </View>
      <Text style={styles.requestBody}>{match.user.profile?.bio || 'Traveler profile available.'}</Text>
      <Text style={styles.requestLocation}>{match.user.profile?.location || 'Traveler on the move'}</Text>
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={() => navigation.navigate('PublicProfile', { userId: match.user.id, initialUser: match.user })}
        >
          <Text style={styles.secondaryActionText}>View Profile</Text>
        </TouchableOpacity>
        {mode === 'incoming' && match.status === 'pending' ? (
          <>
            <TouchableOpacity style={styles.ghostAction} onPress={() => void handleReject(match.id)}>
              {actionId === `reject:${match.id}` ? (
                <ActivityIndicator size="small" color={COLORS.DANGER} />
              ) : (
                <Text style={styles.ghostActionText}>Reject</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryAction} onPress={() => void handleAccept(match)}>
              {actionId === `accept:${match.id}` ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <Text style={styles.primaryActionText}>Accept</Text>
              )}
            </TouchableOpacity>
          </>
        ) : match.status === 'accepted' ? (
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={() => {
              if (!user?.id) {
                return;
              }

              navigation.navigate('Conversation', {
                conversationId: buildConversationId(user.id, match.user.id),
                participant: match.user,
              });
            }}
          >
            <Text style={styles.primaryActionText}>Open Chat</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const activeBody = (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {tab === 'discover'
        ? discoverPeople.map(renderDiscoverCard)
        : tab === 'incoming'
          ? incoming.map((item) => renderRequestCard(item, 'incoming'))
          : sent.map((item) => renderRequestCard(item, 'sent'))}

      {(tab === 'discover' && discoverPeople.length === 0) ||
      (tab === 'incoming' && incoming.length === 0) ||
      (tab === 'sent' && sent.length === 0) ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyText}>
            {tab === 'discover'
              ? 'New traveler suggestions will appear here from the live backend.'
              : 'Requests will appear here as soon as they are available.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Connect</Text>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigateToPath(APP_PATHS.SCREEN_TRAVELER_MAP)}>
          <Ionicons name="options-outline" size={21} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {renderTabButton('discover', 'Discover')}
        {renderTabButton('incoming', 'Incoming Requests', incoming.filter((item) => item.status === 'pending').length)}
        {renderTabButton('sent', 'Sent Requests')}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Connect unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.primaryAction} onPress={() => void loadData()}>
            <Text style={styles.primaryActionText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        activeBody
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
    paddingTop: 10,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#ECE4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EDFB',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  tabLabelActive: {
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '700',
  },
  tabUnderline: {
    width: '100%',
    height: 2,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  connectCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE6FF',
    overflow: 'hidden',
    shadowColor: COLORS.SHADOW,
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  connectCardTop: {
    height: 148,
    backgroundColor: '#F2EBFF',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
    gap: 10,
  },
  avatarHeroWrap: {
    marginBottom: 2,
  },
  avatarHero: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  avatarHeroFallback: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHeroText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  matchPill: {
    borderRadius: 999,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  matchPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  connectBody: {
    padding: 18,
    gap: 10,
  },
  connectName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  connectHandle: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  connectBio: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.TEXT_PRIMARY,
  },
  connectLocation: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  softChip: {
    borderRadius: 999,
    backgroundColor: '#F2EBFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  softChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.PRIMARY_PURPLE,
  },
  travelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#F4EEFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  travelBannerText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.PRIMARY_PURPLE,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#F0ECFA',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  rejectCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: '#ECE4FF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  connectButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  chatCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFF4C9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EEE6FF',
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 10,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  requestAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F2ECFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  requestText: {
    flex: 1,
    gap: 2,
  },
  requestName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  requestHandle: {
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPending: {
    backgroundColor: '#F4EEFF',
  },
  statusAccepted: {
    backgroundColor: '#E9FBEF',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  requestBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_PRIMARY,
  },
  requestLocation: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E0FF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  ghostAction: {
    minWidth: 88,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD9DE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  ghostActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.DANGER,
  },
  primaryAction: {
    minWidth: 102,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  emptyCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE6FF',
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
});
