import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import SwipeDeck from '../components/swipe/SwipeDeck';
import { useAuth } from '../contexts/AuthContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { extractErrorMessage } from '../services/api';
import { buildConversationId } from '../services/chatService';
import {
  acceptMatchRequest,
  fetchMatchSuggestions,
  fetchReceivedMatches,
  fetchSentMatches,
  rejectMatchRequest,
  sendMatchRequest,
} from '../services/matchService';
import {
  getUserDisplayName,
  getUserHandle,
  type MatchRecord,
  type MatchSuggestionRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type ConnectTab = 'discover' | 'incoming' | 'sent';

function formatProbability(score: number | null | undefined) {
  const safeScore = typeof score === 'number' ? score : 0;
  return `${Math.round(Math.max(0, Math.min(1, safeScore)) * 100)}%`;
}

export default function MatchesScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [tab, setTab] = useState<ConnectTab>('discover');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MatchSuggestionRecord[]>([]);
  const [incoming, setIncoming] = useState<MatchRecord[]>([]);
  const [sent, setSent] = useState<MatchRecord[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [suggestionsResult, incomingResult, sentResult] = await Promise.allSettled([
        fetchMatchSuggestions(12),
        fetchReceivedMatches(),
        fetchSentMatches(),
      ]);

      setSuggestions(
        suggestionsResult.status === 'fulfilled' && Array.isArray(suggestionsResult.value)
          ? suggestionsResult.value
          : []
      );
      setIncoming(
        incomingResult.status === 'fulfilled' && Array.isArray(incomingResult.value)
          ? incomingResult.value
          : []
      );
      setSent(
        sentResult.status === 'fulfilled' && Array.isArray(sentResult.value) ? sentResult.value : []
      );

      if (suggestionsResult.status === 'rejected' && incomingResult.status === 'rejected' && sentResult.status === 'rejected') {
        throw suggestionsResult.reason;
      }
    } catch (error) {
      setErrorMessage(extractErrorMessage(error, 'Unable to load traveler connections.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const topSuggestion = suggestions[0] || null;
  const suggestionUsers = useMemo(() => suggestions.map((item) => item.user), [suggestions]);

  const removeSuggestion = useCallback((userId: number) => {
    setSuggestions((current) => current.filter((item) => item.user.id !== userId));
  }, []);

  const handleSwipeRight = useCallback(
    async (matchedUser: MatchSuggestionRecord['user']) => {
      try {
        setActionId(`discover:${matchedUser.id}`);
        await sendMatchRequest(matchedUser.id);
        removeSuggestion(matchedUser.id);
      } catch (error) {
        Alert.alert('Unable to connect', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setActionId(null);
      }
    },
    [removeSuggestion]
  );

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

  const renderRequestCard = (match: MatchRecord, mode: 'incoming' | 'sent') => (
    <View key={`${mode}_${match.id}`} style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.requestAvatar}>
          <Text style={styles.requestAvatarText}>{getUserDisplayName(match.user).slice(0, 1).toUpperCase()}</Text>
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
      {match.compatibility_reason ? (
        <View style={styles.requestReason}>
          <Ionicons name="sparkles-outline" size={14} color={COLORS.PRIMARY_PURPLE} />
          <Text style={styles.requestReasonText}>{match.compatibility_reason}</Text>
        </View>
      ) : null}
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

  const renderDiscover = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      );
    }

    if (errorMessage && !suggestions.length) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Connect unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.primaryAction} onPress={() => void loadData()}>
            <Text style={styles.primaryActionText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.discoverWrap}>
        <View style={styles.deckWrap}>
          <SwipeDeck
            users={suggestionUsers}
            isLoading={loading}
            hasMore={Boolean(suggestions.length)}
            onLoadMore={() => void loadData()}
            onSwipeLeft={(matchedUser) => removeSuggestion(matchedUser.id)}
            onSwipeRight={(matchedUser) => void handleSwipeRight(matchedUser)}
            onSwipeUp={(matchedUser) =>
              navigation.navigate('PublicProfile', { userId: matchedUser.id, initialUser: matchedUser })
            }
          />
        </View>

        <View style={styles.insightCard}>
          {topSuggestion ? (
            <>
              <View style={styles.insightHeader}>
                <View>
                  <Text style={styles.insightTitle}>{getUserDisplayName(topSuggestion.user)}</Text>
                  <Text style={styles.insightSubtitle}>{getUserHandle(topSuggestion.user)}</Text>
                </View>
                <View style={styles.matchBadge}>
                  <Text style={styles.matchBadgeValue}>{formatProbability(topSuggestion.score)}</Text>
                  <Text style={styles.matchBadgeLabel}>match</Text>
                </View>
              </View>

              <Text style={styles.insightMeta}>
                {topSuggestion.user.profile?.location || 'Open to travel'} | {topSuggestion.user.profile?.travel_style || 'Flexible'}
              </Text>

              <View style={styles.reasonList}>
                {topSuggestion.reasons.slice(0, 3).map((reason) => (
                  <View key={reason} style={styles.reasonRow}>
                    <Ionicons name="sparkles-outline" size={14} color={COLORS.PRIMARY_PURPLE} />
                    <Text style={styles.reasonText}>{reason}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>No suggestions right now</Text>
              <Text style={styles.emptyText}>Pull fresh suggestions from the live matching engine.</Text>
              <TouchableOpacity style={styles.primaryAction} onPress={() => void loadData()}>
                <Text style={styles.primaryActionText}>Refresh Suggestions</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderRequestList = (items: MatchRecord[], mode: 'incoming' | 'sent', emptyCopy: string) => (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {items.length ? items.map((item) => renderRequestCard(item, mode)) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyText}>{emptyCopy}</Text>
        </View>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Connect</Text>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigateToPath(APP_PATHS.SCREEN_TRAVELER_MAP)}>
          <Ionicons name="map-outline" size={21} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {renderTabButton('discover', 'Swipe')}
        {renderTabButton('incoming', 'Incoming', incoming.filter((item) => item.status === 'pending').length)}
        {renderTabButton('sent', 'Sent')}
      </View>

      {tab === 'discover' ? renderDiscover() : null}
      {tab === 'incoming' ? renderRequestList(incoming, 'incoming', 'New match requests will appear here.') : null}
      {tab === 'sent' ? renderRequestList(sent, 'sent', 'Sent requests will appear here once you start swiping.') : null}
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
    borderColor: COLORS.BORDER_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER_SOFT,
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
  discoverWrap: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  deckWrap: {
    flex: 1,
    minHeight: 420,
  },
  insightCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 10,
  },
  insightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  insightTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  insightSubtitle: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  matchBadge: {
    borderRadius: 18,
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchBadgeValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  matchBadgeLabel: {
    fontSize: 11,
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'uppercase',
  },
  insightMeta: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
  },
  reasonList: {
    gap: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  reasonText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_PRIMARY,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  requestCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
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
    backgroundColor: COLORS.SURFACE_MUTED,
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
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  statusAccepted: {
    backgroundColor: '#E9FBEF',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    textTransform: 'capitalize',
  },
  requestBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_PRIMARY,
  },
  requestReason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 12,
    padding: 10,
  },
  requestReasonText: {
    flex: 1,
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
    borderColor: COLORS.BORDER_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.SURFACE,
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
  },
  ghostActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.DANGER,
  },
  primaryAction: {
    minWidth: 108,
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
});

