import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import StatusView from '../components/StatusView';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { extractErrorMessage } from '../services/api';
import { safeParseNumber } from '../services/navigationSafety';
import {
  approveTripMember,
  canApproveTripMembers,
  createTripItineraryDay,
  createTripPlace,
  createTripPoll,
  deleteTripPlace,
  fetchTripById,
  fetchTripWorkspace,
  joinTrip,
  leaveTrip,
  rejectTripMember,
  updateTripMeta,
  updateTripPlace,
  voteTripPoll,
} from '../services/tripService';
import {
  getUserDisplayName,
  getUserHandle,
  type TripItineraryDayRecord,
  type TripPlaceRecord,
  type TripPollRecord,
  type TripRecord,
  type TripWorkspaceRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type LifecycleStatus = 'draft' | 'planned' | 'active' | 'completed' | 'cancelled';
type TripVisibility = 'public' | 'private';

const LIFECYCLE_OPTIONS: LifecycleStatus[] = ['draft', 'planned', 'active', 'completed', 'cancelled'];
const VISIBILITY_OPTIONS: TripVisibility[] = ['public', 'private'];

function formatDisplayDate(value: string | null | undefined) {
  if (!value) {
    return 'Not set';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateInput(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeDateInputToIso(value: string, boundary: 'start' | 'end') {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hasTime = trimmed.includes('T');
  const parsed = new Date(hasTime ? trimmed : `${trimmed}T${boundary === 'start' ? '00:00:00' : '23:59:59'}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function formatVoteCount(votes: number) {
  return `${votes} vote${votes === 1 ? '' : 's'}`;
}

function buildDayWorkspace(workspace: TripWorkspaceRecord | null) {
  if (!workspace) {
    return {
      days: [] as TripItineraryDayRecord[],
      unassignedPlaces: [] as TripPlaceRecord[],
      unassignedPolls: [] as TripPollRecord[],
    };
  }

  const topLevelPlaces = workspace.places || [];
  const topLevelPolls = workspace.polls || [];
  const normalizedDays = (workspace.days || [])
    .slice()
    .sort((left, right) => String(left.day_date).localeCompare(String(right.day_date)))
    .map((day) => ({
      ...day,
      places: day.places || topLevelPlaces.filter((place) => place.day_id === day.id),
      polls: day.polls || topLevelPolls.filter((poll) => poll.day_id === day.id),
    }));

  return {
    days: normalizedDays,
    unassignedPlaces:
      workspace.unassigned_places?.length
        ? workspace.unassigned_places
        : topLevelPlaces.filter((place) => !place.day_id),
    unassignedPolls:
      workspace.unassigned_polls?.length
        ? workspace.unassigned_polls
        : topLevelPolls.filter((poll) => !poll.day_id),
  };
}

export default function TripDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { connectionStatus, joinTripRoom, leaveTripRoom, subscribe } = useRealtime();
  const tripId = safeParseNumber(route.params?.tripId, 0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [workspace, setWorkspace] = useState<TripWorkspaceRecord | null>(null);

  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [visibility, setVisibility] = useState<TripVisibility>('public');
  const [lifecycleStatus, setLifecycleStatus] = useState<LifecycleStatus>('planned');

  const [dayDateInput, setDayDateInput] = useState('');
  const [dayTitleInput, setDayTitleInput] = useState('');
  const [dayNotesInput, setDayNotesInput] = useState('');

  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [editingPlaceId, setEditingPlaceId] = useState<number | null>(null);
  const [placeNameInput, setPlaceNameInput] = useState('');
  const [placeAddressInput, setPlaceAddressInput] = useState('');
  const [placeNotesInput, setPlaceNotesInput] = useState('');
  const [placeStartInput, setPlaceStartInput] = useState('');
  const [placeEndInput, setPlaceEndInput] = useState('');

  const [pollDayId, setPollDayId] = useState<number | null>(null);
  const [pollQuestionInput, setPollQuestionInput] = useState('');
  const [pollOptionsInput, setPollOptionsInput] = useState('');
  const [pollClosesAtInput, setPollClosesAtInput] = useState('');

  const loadTripDetails = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!tripId) {
        setErrorMessage('Trip is unavailable.');
        setLoading(false);
        return;
      }

      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        setErrorMessage(null);
        const nextTrip = await fetchTripById(tripId);
        setTrip(nextTrip);
        setStartDateInput(formatDateInput(nextTrip.start_date));
        setEndDateInput(formatDateInput(nextTrip.end_date));
        setVisibility((nextTrip.visibility || 'public') as TripVisibility);
        setLifecycleStatus((nextTrip.lifecycle_status || nextTrip.status || 'planned') as LifecycleStatus);

        const canLoadWorkspace = Boolean(
          user?.id && (nextTrip.owner?.id === user.id || nextTrip.current_user_status === 'approved')
        );

        if (canLoadWorkspace) {
          try {
            setWorkspaceError(null);
            const nextWorkspace = await fetchTripWorkspace(tripId);
            setWorkspace(nextWorkspace);
          } catch (workspaceLoadError) {
            setWorkspace(null);
            setWorkspaceError(extractErrorMessage(workspaceLoadError, 'Unable to load the trip workspace.'));
          }
        } else {
          setWorkspace(null);
          setWorkspaceError(null);
        }
      } catch (error) {
        setTrip(null);
        setWorkspace(null);
        setErrorMessage(extractErrorMessage(error, 'Unable to load trip details.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tripId, user?.id]
  );

  useFocusEffect(
    useCallback(() => {
      void loadTripDetails('initial');
    }, [loadTripDetails])
  );

  const isOwner = Boolean(user?.id && trip?.owner?.id === user.id);
  const canAccessWorkspace = Boolean(user?.id && (isOwner || trip?.current_user_status === 'approved'));
  const canJoinTrip = Boolean(
    trip &&
      user?.id &&
      !isOwner &&
      !trip.current_user_status &&
      trip.lifecycle_status !== 'completed' &&
      trip.lifecycle_status !== 'cancelled'
  );
  const canLeaveTrip = Boolean(trip?.current_user_status);
  const canEditTrip = Boolean(isOwner && trip?.lifecycle_status !== 'cancelled');

  useEffect(() => {
    if (!tripId || !canAccessWorkspace) {
      return;
    }

    joinTripRoom(tripId);
    return () => {
      leaveTripRoom(tripId);
    };
  }, [canAccessWorkspace, joinTripRoom, leaveTripRoom, tripId]);

  useEffect(() => {
    if (!tripId) {
      return;
    }

    return subscribe((event) => {
      const data = event.data as Record<string, unknown> | undefined;
      const eventTripId = safeParseNumber(data?.tripId ?? data?.trip_id, 0);

      if (eventTripId !== tripId) {
        return;
      }

      if (
        event.type === 'trip.joined' ||
        event.type === 'trip.left' ||
        event.type === 'trip.itinerary.updated' ||
        event.type === 'trip.poll.updated' ||
        event.type === 'expense.created' ||
        event.type === 'expense.settled'
      ) {
        void loadTripDetails('refresh');
      }
    });
  }, [loadTripDetails, subscribe, tripId]);

  const workspaceSections = useMemo(() => buildDayWorkspace(workspace), [workspace]);
  const pendingMembers = useMemo(
    () => (trip?.members || []).filter((member) => member.status === 'pending'),
    [trip?.members]
  );
  const approvedMembers = useMemo(
    () => (trip?.members || []).filter((member) => member.status === 'approved'),
    [trip?.members]
  );

  const resetPlaceForm = useCallback(() => {
    setEditingPlaceId(null);
    setSelectedDayId(null);
    setPlaceNameInput('');
    setPlaceAddressInput('');
    setPlaceNotesInput('');
    setPlaceStartInput('');
    setPlaceEndInput('');
  }, []);

  const handleRefresh = useCallback(async () => {
    await loadTripDetails('refresh');
  }, [loadTripDetails]);

  const handleJoinTrip = useCallback(async () => {
    if (!tripId) {
      return;
    }

    try {
      setMutating('join');
      const nextTrip = await joinTrip(tripId);
      setTrip(nextTrip);
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to join', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [loadTripDetails, tripId]);

  const handleLeaveTrip = useCallback(async () => {
    if (!tripId) {
      return;
    }

    try {
      setMutating('leave');
      const nextTrip = await leaveTrip(tripId);
      setTrip(nextTrip);
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to leave', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [loadTripDetails, tripId]);

  const handleSaveMetadata = useCallback(async () => {
    if (!tripId || !canEditTrip) {
      return;
    }

    const normalizedStart = normalizeDateInputToIso(startDateInput, 'start');
    const normalizedEnd = normalizeDateInputToIso(endDateInput, 'end');

    if (!normalizedStart || !normalizedEnd) {
      Alert.alert('Invalid dates', 'Enter valid start and end dates in YYYY-MM-DD format.');
      return;
    }

    if (new Date(normalizedEnd).getTime() <= new Date(normalizedStart).getTime()) {
      Alert.alert('Invalid dates', 'End date must be later than the start date.');
      return;
    }

    try {
      setMutating('meta');
      const nextTrip = await updateTripMeta(tripId, {
        start_date: normalizedStart,
        end_date: normalizedEnd,
        visibility,
        lifecycle_status: lifecycleStatus,
      });
      setTrip(nextTrip);
      Alert.alert('Trip updated', 'Trip metadata has been saved.');
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to save', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [canEditTrip, endDateInput, lifecycleStatus, loadTripDetails, startDateInput, tripId, visibility]);

  const handleApproveMember = useCallback(
    async (userId: number) => {
      if (!tripId) {
        return;
      }

      try {
        setMutating(`approve:${userId}`);
        await approveTripMember(tripId, userId);
        await loadTripDetails('refresh');
      } catch (error) {
        Alert.alert('Unable to approve', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setMutating(null);
      }
    },
    [loadTripDetails, tripId]
  );

  const handleRejectMember = useCallback(
    async (userId: number) => {
      if (!tripId) {
        return;
      }

      try {
        setMutating(`reject:${userId}`);
        await rejectTripMember(tripId, userId);
        await loadTripDetails('refresh');
      } catch (error) {
        Alert.alert('Unable to reject', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setMutating(null);
      }
    },
    [loadTripDetails, tripId]
  );

  const handleCreateDay = useCallback(async () => {
    if (!tripId || !canAccessWorkspace) {
      return;
    }

    const normalizedDate = normalizeDateInputToIso(dayDateInput, 'start');
    if (!normalizedDate) {
      Alert.alert('Invalid date', 'Enter a valid itinerary day in YYYY-MM-DD format.');
      return;
    }

    try {
      setMutating('day');
      const createdDay = await createTripItineraryDay(tripId, {
        day_date: normalizedDate,
        title: dayTitleInput.trim() || null,
        notes: dayNotesInput.trim() || null,
      });
      setDayDateInput('');
      setDayTitleInput('');
      setDayNotesInput('');
      setSelectedDayId(createdDay.id);
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to add day', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [canAccessWorkspace, dayDateInput, dayNotesInput, dayTitleInput, loadTripDetails, tripId]);

  const handleSavePlace = useCallback(async () => {
    if (!tripId || !canAccessWorkspace) {
      return;
    }

    if (!placeNameInput.trim()) {
      Alert.alert('Place required', 'Add a place name before saving.');
      return;
    }

    const startsAt = placeStartInput.trim() ? normalizeDateInputToIso(placeStartInput, 'start') : null;
    const endsAt = placeEndInput.trim() ? normalizeDateInputToIso(placeEndInput, 'end') : null;

    if (placeStartInput.trim() && !startsAt) {
      Alert.alert('Invalid start time', 'Use YYYY-MM-DD or ISO datetime for place start.');
      return;
    }

    if (placeEndInput.trim() && !endsAt) {
      Alert.alert('Invalid end time', 'Use YYYY-MM-DD or ISO datetime for place end.');
      return;
    }

    try {
      setMutating(editingPlaceId ? `place:${editingPlaceId}` : 'place:new');
      const payload = {
        day_id: selectedDayId,
        name: placeNameInput.trim(),
        address: placeAddressInput.trim() || null,
        notes: placeNotesInput.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
      };

      if (editingPlaceId) {
        await updateTripPlace(tripId, editingPlaceId, payload);
      } else {
        await createTripPlace(tripId, payload);
      }

      resetPlaceForm();
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to save place', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [
    canAccessWorkspace,
    editingPlaceId,
    loadTripDetails,
    placeAddressInput,
    placeEndInput,
    placeNameInput,
    placeNotesInput,
    placeStartInput,
    resetPlaceForm,
    selectedDayId,
    tripId,
  ]);

  const handleEditPlace = useCallback((place: TripPlaceRecord) => {
    setEditingPlaceId(place.id);
    setSelectedDayId(place.day_id || null);
    setPlaceNameInput(place.name || '');
    setPlaceAddressInput(place.address || '');
    setPlaceNotesInput(place.notes || '');
    setPlaceStartInput(formatDateInput(place.starts_at));
    setPlaceEndInput(formatDateInput(place.ends_at));
  }, []);

  const handleDeletePlace = useCallback(
    async (placeId: number) => {
      if (!tripId) {
        return;
      }

      try {
        setMutating(`delete-place:${placeId}`);
        await deleteTripPlace(tripId, placeId);
        if (editingPlaceId === placeId) {
          resetPlaceForm();
        }
        await loadTripDetails('refresh');
      } catch (error) {
        Alert.alert('Unable to delete place', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setMutating(null);
      }
    },
    [editingPlaceId, loadTripDetails, resetPlaceForm, tripId]
  );

  const handleCreatePoll = useCallback(async () => {
    if (!tripId || !canAccessWorkspace) {
      return;
    }

    const options = pollOptionsInput
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean);

    if (!pollQuestionInput.trim() || options.length < 2) {
      Alert.alert('Poll incomplete', 'Add a question and at least two options.');
      return;
    }

    const closesAt = pollClosesAtInput.trim() ? normalizeDateInputToIso(pollClosesAtInput, 'end') : null;
    if (pollClosesAtInput.trim() && !closesAt) {
      Alert.alert('Invalid closing date', 'Use YYYY-MM-DD or ISO datetime for poll close.');
      return;
    }

    try {
      setMutating('poll');
      await createTripPoll(tripId, {
        day_id: pollDayId,
        question: pollQuestionInput.trim(),
        options,
        closes_at: closesAt,
      });
      setPollQuestionInput('');
      setPollOptionsInput('');
      setPollClosesAtInput('');
      setPollDayId(null);
      await loadTripDetails('refresh');
    } catch (error) {
      Alert.alert('Unable to create poll', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setMutating(null);
    }
  }, [canAccessWorkspace, loadTripDetails, pollClosesAtInput, pollDayId, pollOptionsInput, pollQuestionInput, tripId]);

  const handleVote = useCallback(
    async (pollId: number, optionIndex: number) => {
      if (!tripId) {
        return;
      }

      try {
        setMutating(`vote:${pollId}:${optionIndex}`);
        await voteTripPoll(tripId, pollId, optionIndex);
        await loadTripDetails('refresh');
      } catch (error) {
        Alert.alert('Unable to vote', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setMutating(null);
      }
    },
    [loadTripDetails, tripId]
  );

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
          message={errorMessage || 'Trip details could not be loaded.'}
          onRetry={() => void loadTripDetails('initial')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trip Details</Text>
        <View style={styles.connectionPill}>
          <View
            style={[
              styles.connectionDot,
              connectionStatus === 'connected' ? styles.connectionDotLive : styles.connectionDotIdle,
            ]}
          />
          <Text style={styles.connectionText}>{connectionStatus === 'connected' ? 'Live' : 'Offline'}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={COLORS.PRIMARY_PURPLE}
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.tripTitle}>{trip.title}</Text>
              <Text style={styles.tripLocation}>{trip.location}</Text>
            </View>
            <View style={styles.tripBadge}>
              <Text style={styles.tripBadgeText}>{trip.visibility || 'public'}</Text>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Dates</Text>
              <Text style={styles.metaValue}>
                {formatDisplayDate(trip.start_date)} - {formatDisplayDate(trip.end_date)}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Status</Text>
              <Text style={styles.metaValue}>{trip.lifecycle_status || trip.status || 'planned'}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Members</Text>
              <Text style={styles.metaValue}>
                {trip.approved_member_count}/{trip.capacity}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Host</Text>
              <Text style={styles.metaValue}>{getUserDisplayName(trip.owner)}</Text>
            </View>
          </View>

          {trip.interests?.length ? (
            <View style={styles.tagRow}>
              {trip.interests.slice(0, 6).map((interest) => (
                <View key={interest} style={styles.tag}>
                  <Text style={styles.tagText}>{interest}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actionRow}>
            {canJoinTrip ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => void handleJoinTrip()}
                disabled={mutating === 'join'}
              >
                {mutating === 'join' ? (
                  <ActivityIndicator size="small" color={COLORS.WHITE} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {trip.visibility === 'private' ? 'Request to Join' : 'Join Trip'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
            {canLeaveTrip ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void handleLeaveTrip()}
                disabled={mutating === 'leave'}
              >
                {mutating === 'leave' ? (
                  <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
                ) : (
                  <Text style={styles.secondaryButtonText}>
                    {trip.current_user_status === 'pending' ? 'Cancel Request' : 'Leave Trip'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                navigation.navigate('PublicProfile', { userId: trip.owner.id, initialUser: trip.owner })
              }
            >
              <Text style={styles.secondaryButtonText}>View Host</Text>
            </TouchableOpacity>
          </View>

          {trip.current_user_status === 'pending' ? (
            <Text style={styles.pendingNotice}>
              Your join request is pending approval from the trip owner.
            </Text>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Members</Text>
          {approvedMembers.length ? (
            approvedMembers.map((member) => (
              <View key={`${member.user.id}:${member.status}`} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {getUserDisplayName(member.user).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberTextWrap}>
                  <Text style={styles.memberName}>{getUserDisplayName(member.user)}</Text>
                  <Text style={styles.memberMeta}>
                    {getUserHandle(member.user)} | {member.role || 'member'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.inlineButton}
                  onPress={() =>
                    navigation.navigate('PublicProfile', { userId: member.user.id, initialUser: member.user })
                  }
                >
                  <Text style={styles.inlineButtonText}>Profile</Text>
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.sectionHint}>No approved members yet.</Text>
          )}

          {canApproveTripMembers(trip, user) ? (
            <View style={styles.subsection}>
              <Text style={styles.subsectionTitle}>Pending Approvals</Text>
              {pendingMembers.length ? (
                pendingMembers.map((member) => (
                  <View key={`${member.user.id}:pending`} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {getUserDisplayName(member.user).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.memberTextWrap}>
                      <Text style={styles.memberName}>{getUserDisplayName(member.user)}</Text>
                      <Text style={styles.memberMeta}>{member.user.profile?.bio || 'Traveler waiting for approval.'}</Text>
                    </View>
                    <View style={styles.inlineActions}>
                      <TouchableOpacity
                        style={styles.rejectButton}
                        onPress={() => void handleRejectMember(member.user.id)}
                        disabled={mutating === `reject:${member.user.id}`}
                      >
                        {mutating === `reject:${member.user.id}` ? (
                          <ActivityIndicator size="small" color={COLORS.DANGER} />
                        ) : (
                          <Text style={styles.rejectButtonText}>Reject</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.approveButton}
                        onPress={() => void handleApproveMember(member.user.id)}
                        disabled={mutating === `approve:${member.user.id}`}
                      >
                        {mutating === `approve:${member.user.id}` ? (
                          <ActivityIndicator size="small" color={COLORS.WHITE} />
                        ) : (
                          <Text style={styles.approveButtonText}>Approve</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.sectionHint}>No pending approvals right now.</Text>
              )}
            </View>
          ) : null}
        </View>

        {isOwner ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Trip Settings</Text>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Start Date</Text>
              <TextInput
                style={styles.input}
                value={startDateInput}
                onChangeText={setStartDateInput}
                placeholder="2026-04-20"
                placeholderTextColor={COLORS.TEXT_MUTED}
              />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>End Date</Text>
              <TextInput
                style={styles.input}
                value={endDateInput}
                onChangeText={setEndDateInput}
                placeholder="2026-04-25"
                placeholderTextColor={COLORS.TEXT_MUTED}
              />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Visibility</Text>
              <View style={styles.optionRow}>
                {VISIBILITY_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.optionChip, visibility === option && styles.optionChipActive]}
                    onPress={() => setVisibility(option)}
                  >
                    <Text style={[styles.optionChipText, visibility === option && styles.optionChipTextActive]}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Lifecycle</Text>
              <View style={styles.optionRow}>
                {LIFECYCLE_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.optionChip, lifecycleStatus === option && styles.optionChipActive]}
                    onPress={() => setLifecycleStatus(option)}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        lifecycleStatus === option && styles.optionChipTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleSaveMetadata()}
              disabled={mutating === 'meta' || !canEditTrip}
            >
              {mutating === 'meta' ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <Text style={styles.primaryButtonText}>Save Trip Settings</Text>
              )}
            </TouchableOpacity>
            {trip.lifecycle_status === 'cancelled' ? (
              <Text style={styles.sectionHint}>
                Cancelled trips can still be viewed, but further changes are locked by the backend.
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Trip Workspace</Text>
          {!canAccessWorkspace ? (
            <Text style={styles.sectionHint}>
              {trip.current_user_status === 'pending'
                ? 'Workspace access unlocks after the trip owner approves your request.'
                : 'Join this trip to access itinerary updates, places, and polls.'}
            </Text>
          ) : workspaceError ? (
            <Text style={styles.errorText}>{workspaceError}</Text>
          ) : (
            <>
              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Add Itinerary Day</Text>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Day Date</Text>
                  <TextInput
                    style={styles.input}
                    value={dayDateInput}
                    onChangeText={setDayDateInput}
                    placeholder="2026-04-20"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    value={dayTitleInput}
                    onChangeText={setDayTitleInput}
                    placeholder="Arrival and check-in"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={dayNotesInput}
                    onChangeText={setDayNotesInput}
                    placeholder="Shared notes for this day"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    multiline
                  />
                </View>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => void handleCreateDay()}
                  disabled={mutating === 'day'}
                >
                  {mutating === 'day' ? (
                    <ActivityIndicator size="small" color={COLORS.WHITE} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Add Day</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>{editingPlaceId ? 'Edit Place' : 'Add Place'}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayChipRow}>
                  <TouchableOpacity
                    style={[styles.dayChip, selectedDayId === null && styles.dayChipActive]}
                    onPress={() => setSelectedDayId(null)}
                  >
                    <Text style={[styles.dayChipText, selectedDayId === null && styles.dayChipTextActive]}>
                      Unassigned
                    </Text>
                  </TouchableOpacity>
                  {workspaceSections.days.map((day) => (
                    <TouchableOpacity
                      key={day.id}
                      style={[styles.dayChip, selectedDayId === day.id && styles.dayChipActive]}
                      onPress={() => setSelectedDayId(day.id)}
                    >
                      <Text style={[styles.dayChipText, selectedDayId === day.id && styles.dayChipTextActive]}>
                        {day.title || formatDisplayDate(day.day_date)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Place Name</Text>
                  <TextInput
                    style={styles.input}
                    value={placeNameInput}
                    onChangeText={setPlaceNameInput}
                    placeholder="Sunset Point"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Address</Text>
                  <TextInput
                    style={styles.input}
                    value={placeAddressInput}
                    onChangeText={setPlaceAddressInput}
                    placeholder="Address or venue details"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <View style={styles.row}>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>Starts</Text>
                    <TextInput
                      style={styles.input}
                      value={placeStartInput}
                      onChangeText={setPlaceStartInput}
                      placeholder="2026-04-20"
                      placeholderTextColor={COLORS.TEXT_MUTED}
                    />
                  </View>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>Ends</Text>
                    <TextInput
                      style={styles.input}
                      value={placeEndInput}
                      onChangeText={setPlaceEndInput}
                      placeholder="2026-04-20"
                      placeholderTextColor={COLORS.TEXT_MUTED}
                    />
                  </View>
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={placeNotesInput}
                    onChangeText={setPlaceNotesInput}
                    placeholder="Why this place matters to the group"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    multiline
                  />
                </View>
                <View style={styles.inlineActions}>
                  <TouchableOpacity
                    style={styles.primaryButtonFlex}
                    onPress={() => void handleSavePlace()}
                    disabled={mutating === 'place:new' || (editingPlaceId !== null && mutating === `place:${editingPlaceId}`)}
                  >
                    {mutating === 'place:new' || (editingPlaceId !== null && mutating === `place:${editingPlaceId}`) ? (
                      <ActivityIndicator size="small" color={COLORS.WHITE} />
                    ) : (
                      <Text style={styles.primaryButtonText}>{editingPlaceId ? 'Update Place' : 'Add Place'}</Text>
                    )}
                  </TouchableOpacity>
                  {editingPlaceId ? (
                    <TouchableOpacity style={styles.secondaryButtonFlex} onPress={resetPlaceForm}>
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Create Poll</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayChipRow}>
                  <TouchableOpacity
                    style={[styles.dayChip, pollDayId === null && styles.dayChipActive]}
                    onPress={() => setPollDayId(null)}
                  >
                    <Text style={[styles.dayChipText, pollDayId === null && styles.dayChipTextActive]}>
                      Whole trip
                    </Text>
                  </TouchableOpacity>
                  {workspaceSections.days.map((day) => (
                    <TouchableOpacity
                      key={`poll-day-${day.id}`}
                      style={[styles.dayChip, pollDayId === day.id && styles.dayChipActive]}
                      onPress={() => setPollDayId(day.id)}
                    >
                      <Text style={[styles.dayChipText, pollDayId === day.id && styles.dayChipTextActive]}>
                        {day.title || formatDisplayDate(day.day_date)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Question</Text>
                  <TextInput
                    style={styles.input}
                    value={pollQuestionInput}
                    onChangeText={setPollQuestionInput}
                    placeholder="What should we do first?"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Options</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={pollOptionsInput}
                    onChangeText={setPollOptionsInput}
                    placeholder={'One option per line\nBeach brunch\nMuseum walk'}
                    placeholderTextColor={COLORS.TEXT_MUTED}
                    multiline
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Closes At</Text>
                  <TextInput
                    style={styles.input}
                    value={pollClosesAtInput}
                    onChangeText={setPollClosesAtInput}
                    placeholder="2026-04-19"
                    placeholderTextColor={COLORS.TEXT_MUTED}
                  />
                </View>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => void handleCreatePoll()}
                  disabled={mutating === 'poll'}
                >
                  {mutating === 'poll' ? (
                    <ActivityIndicator size="small" color={COLORS.WHITE} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Create Poll</Text>
                  )}
                </TouchableOpacity>
              </View>

              {workspaceSections.days.length ? (
                workspaceSections.days.map((day) => (
                  <View key={day.id} style={styles.dayCard}>
                    <View style={styles.dayHeader}>
                      <View>
                        <Text style={styles.dayTitle}>{day.title || formatDisplayDate(day.day_date)}</Text>
                        <Text style={styles.daySubtitle}>{formatDisplayDate(day.day_date)}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.inlineButton, selectedDayId === day.id && styles.inlineButtonActive]}
                        onPress={() => setSelectedDayId(day.id)}
                      >
                        <Text style={[styles.inlineButtonText, selectedDayId === day.id && styles.inlineButtonTextActive]}>
                          Add here
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {day.notes ? <Text style={styles.dayNotes}>{day.notes}</Text> : null}

                    <View style={styles.subsectionCompact}>
                      <Text style={styles.compactTitle}>Places</Text>
                      {day.places?.length ? (
                        day.places.map((place) => (
                          <View key={place.id} style={styles.placeCard}>
                            <View style={styles.placeHeader}>
                              <View style={styles.placeTextWrap}>
                                <Text style={styles.placeName}>{place.name}</Text>
                                {place.address ? <Text style={styles.placeMeta}>{place.address}</Text> : null}
                                {place.starts_at || place.ends_at ? (
                                  <Text style={styles.placeMeta}>
                                    {formatDisplayDate(place.starts_at)} - {formatDisplayDate(place.ends_at)}
                                  </Text>
                                ) : null}
                                {place.notes ? <Text style={styles.placeBody}>{place.notes}</Text> : null}
                              </View>
                              <View style={styles.inlineActions}>
                                <TouchableOpacity style={styles.inlineButton} onPress={() => handleEditPlace(place)}>
                                  <Text style={styles.inlineButtonText}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.inlineButton}
                                  onPress={() => void handleDeletePlace(place.id)}
                                  disabled={mutating === `delete-place:${place.id}`}
                                >
                                  {mutating === `delete-place:${place.id}` ? (
                                    <ActivityIndicator size="small" color={COLORS.DANGER} />
                                  ) : (
                                    <Text style={styles.deleteInlineText}>Delete</Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.sectionHint}>No places assigned to this day yet.</Text>
                      )}
                    </View>

                    <View style={styles.subsectionCompact}>
                      <Text style={styles.compactTitle}>Polls</Text>
                      {day.polls?.length ? (
                        day.polls.map((poll) => {
                          const currentVote = poll.votes.find((vote) => vote.user_id === user?.id) || null;
                          return (
                            <View key={poll.id} style={styles.pollCard}>
                              <Text style={styles.pollQuestion}>{poll.question}</Text>
                              {poll.closes_at ? (
                                <Text style={styles.pollMeta}>Closes {formatDisplayDate(poll.closes_at)}</Text>
                              ) : null}
                              <View style={styles.pollOptions}>
                                {poll.options.map((option, optionIndex) => {
                                  const optionVotes = poll.votes.filter(
                                    (vote) => vote.option_index === optionIndex
                                  ).length;
                                  const isSelected = currentVote?.option_index === optionIndex;
                                  const isVoting = mutating === `vote:${poll.id}:${optionIndex}`;
                                  return (
                                    <TouchableOpacity
                                      key={`${poll.id}:${optionIndex}`}
                                      style={[styles.pollOption, isSelected && styles.pollOptionActive]}
                                      onPress={() => void handleVote(poll.id, optionIndex)}
                                      disabled={isVoting}
                                    >
                                      <View style={styles.pollOptionTextWrap}>
                                        <Text
                                          style={[
                                            styles.pollOptionTitle,
                                            isSelected && styles.pollOptionTitleActive,
                                          ]}
                                        >
                                          {option}
                                        </Text>
                                        <Text
                                          style={[
                                            styles.pollOptionVotes,
                                            isSelected && styles.pollOptionVotesActive,
                                          ]}
                                        >
                                          {formatVoteCount(optionVotes)}
                                        </Text>
                                      </View>
                                      {isVoting ? (
                                        <ActivityIndicator
                                          size="small"
                                          color={isSelected ? COLORS.WHITE : COLORS.PRIMARY_PURPLE}
                                        />
                                      ) : null}
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          );
                        })
                      ) : (
                        <Text style={styles.sectionHint}>No polls created for this day yet.</Text>
                      )}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.sectionHint}>No itinerary days added yet.</Text>
              )}

              {workspaceSections.unassignedPlaces.length ? (
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Unassigned Places</Text>
                  {workspaceSections.unassignedPlaces.map((place) => (
                    <View key={`unassigned-place-${place.id}`} style={styles.placeCard}>
                      <View style={styles.placeHeader}>
                        <View style={styles.placeTextWrap}>
                          <Text style={styles.placeName}>{place.name}</Text>
                          {place.address ? <Text style={styles.placeMeta}>{place.address}</Text> : null}
                          {place.notes ? <Text style={styles.placeBody}>{place.notes}</Text> : null}
                        </View>
                        <View style={styles.inlineActions}>
                          <TouchableOpacity style={styles.inlineButton} onPress={() => handleEditPlace(place)}>
                            <Text style={styles.inlineButtonText}>Assign</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {workspaceSections.unassignedPolls.length ? (
                <View style={styles.subsection}>
                  <Text style={styles.subsectionTitle}>Trip-wide Polls</Text>
                  {workspaceSections.unassignedPolls.map((poll) => {
                    const currentVote = poll.votes.find((vote) => vote.user_id === user?.id) || null;
                    return (
                      <View key={`unassigned-poll-${poll.id}`} style={styles.pollCard}>
                        <Text style={styles.pollQuestion}>{poll.question}</Text>
                        <View style={styles.pollOptions}>
                          {poll.options.map((option, optionIndex) => {
                            const optionVotes = poll.votes.filter(
                              (vote) => vote.option_index === optionIndex
                            ).length;
                            const isSelected = currentVote?.option_index === optionIndex;
                            const isVoting = mutating === `vote:${poll.id}:${optionIndex}`;
                            return (
                              <TouchableOpacity
                                key={`${poll.id}:trip-wide:${optionIndex}`}
                                style={[styles.pollOption, isSelected && styles.pollOptionActive]}
                                onPress={() => void handleVote(poll.id, optionIndex)}
                                disabled={isVoting}
                              >
                                <View style={styles.pollOptionTextWrap}>
                                  <Text
                                    style={[
                                      styles.pollOptionTitle,
                                      isSelected && styles.pollOptionTitleActive,
                                    ]}
                                  >
                                    {option}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.pollOptionVotes,
                                      isSelected && styles.pollOptionVotesActive,
                                    ]}
                                  >
                                    {formatVoteCount(optionVotes)}
                                  </Text>
                                </View>
                                {isVoting ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={isSelected ? COLORS.WHITE : COLORS.PRIMARY_PURPLE}
                                  />
                                ) : null}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </>
          )}
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
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  connectionPill: {
    minWidth: 74,
    height: 30,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionDotLive: {
    backgroundColor: COLORS.SUCCESS_GREEN,
  },
  connectionDotIdle: {
    backgroundColor: COLORS.TEXT_MUTED,
  },
  connectionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  heroCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTitleWrap: {
    flex: 1,
    gap: 4,
  },
  tripTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  tripLocation: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  tripBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#F2E8FF',
  },
  tripBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
    color: COLORS.PRIMARY_PURPLE,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    width: '47%',
    borderRadius: 16,
    padding: 12,
    backgroundColor: COLORS.BACKGROUND,
    gap: 4,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_MUTED,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_PRIMARY,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.BACKGROUND,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_SECONDARY,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 18,
  },
  primaryButtonFlex: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 18,
  },
  secondaryButtonFlex: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  pendingNotice: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  sectionCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  subsection: {
    gap: 12,
  },
  subsectionCompact: {
    gap: 10,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  compactTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.DANGER,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 12,
    backgroundColor: COLORS.BACKGROUND,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1E9FF',
  },
  memberAvatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  memberTextWrap: {
    flex: 1,
    gap: 3,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  memberMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.TEXT_SECONDARY,
  },
  inlineButton: {
    minHeight: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: COLORS.SURFACE,
  },
  inlineButtonActive: {
    backgroundColor: '#F2E8FF',
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  inlineButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  inlineButtonTextActive: {
    color: COLORS.PRIMARY_PURPLE,
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rejectButton: {
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFD9DE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#FFF8F9',
  },
  rejectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.DANGER,
  },
  approveButton: {
    minHeight: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  approveButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  formGroup: {
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
  textArea: {
    minHeight: 98,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  optionChipActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    textTransform: 'capitalize',
  },
  optionChipTextActive: {
    color: COLORS.WHITE,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowField: {
    flex: 1,
    gap: 8,
  },
  dayChipRow: {
    gap: 8,
  },
  dayChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.SURFACE,
  },
  dayChipActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  dayChipTextActive: {
    color: COLORS.WHITE,
  },
  dayCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: COLORS.BACKGROUND,
    gap: 14,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  daySubtitle: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  dayNotes: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  placeCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
  },
  placeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  placeTextWrap: {
    flex: 1,
    gap: 4,
  },
  placeName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  placeMeta: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  placeBody: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_PRIMARY,
  },
  deleteInlineText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.DANGER,
  },
  pollCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 10,
  },
  pollQuestion: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  pollMeta: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  pollOptions: {
    gap: 8,
  },
  pollOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  pollOptionActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  pollOptionTextWrap: {
    flex: 1,
    gap: 3,
  },
  pollOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  pollOptionTitleActive: {
    color: COLORS.WHITE,
  },
  pollOptionVotes: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  pollOptionVotesActive: {
    color: 'rgba(255,255,255,0.82)',
  },
});
