import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import LinearGradient from 'react-native-linear-gradient';

import StatusView from '../components/StatusView';
import { useAuth } from '../contexts/AuthContext';
import { askAventaroAi, type TripPlannerInput } from '../services/aiService';
import { extractErrorMessage } from '../services/api';
import { fetchTripDiscover } from '../services/discoverService';
import { errorLogger } from '../services/errorLogger';
import { fetchMyProfile } from '../services/profileService';
import { fetchSavedPosts } from '../services/socialService';
import { fetchMyTrips } from '../services/tripService';
import type {
  AiAssistantResponse,
  AiChatHistoryMessage,
  AppUser,
  PlannerMood,
  TripContextSnapshot,
  TripPlanResult,
  TripRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type PlannerTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: AiAssistantResponse | null;
};

type AventaroAiRouteParams = {
  seedDestination?: string;
  seedBudget?: number;
  seedMood?: PlannerMood;
  initialPrompt?: string;
};

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPastTrip(trip: TripRecord) {
  const endDate = parseDate(trip.end_date);
  return Boolean(endDate && endDate.getTime() < Date.now());
}

function sortTripsByStartDate(trips: TripRecord[]) {
  return [...trips].sort((left, right) => {
    const leftTime = parseDate(left.start_date)?.getTime() || Number.MAX_SAFE_INTEGER;
    const rightTime = parseDate(right.start_date)?.getTime() || Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
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

function buildTripSnapshot(trip: TripRecord, status: 'past' | 'active'): TripContextSnapshot {
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

function buildSuggestedBudget(profile: AppUser | null, activeTrip: TripRecord | null) {
  const tripBudget = activeTrip?.budget_max || activeTrip?.budget_min;
  if (tripBudget && tripBudget > 0) {
    return tripBudget;
  }

  const profileBudgetMax = profile?.profile?.budget_max;
  if (profileBudgetMax && profileBudgetMax > 0) {
    return profileBudgetMax;
  }

  const profileBudgetMin = profile?.profile?.budget_min;
  if (profileBudgetMin && profileBudgetMin > 0) {
    return Math.max(profileBudgetMin, 1200);
  }

  return 1500;
}

function buildSuggestedDays(activeTrip: TripRecord | null) {
  const start = parseDate(activeTrip?.start_date);
  const end = parseDate(activeTrip?.end_date);

  if (start && end) {
    return Math.max(2, Math.min(10, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1));
  }

  return 5;
}

function turnsToHistory(turns: PlannerTurn[]): AiChatHistoryMessage[] {
  return turns.slice(-6).map((turn) => ({ role: turn.role, content: turn.content }));
}

function formatCurrency(amount: number | null | undefined) {
  if (!amount || Number.isNaN(amount)) {
    return '$0';
  }

  return `$${Math.round(amount)}`;
}

function buildPlannerContext(params: {
  profile: AppUser | null;
  activeTrip: TripRecord | null;
  pastTrips: TripRecord[];
  savedDestinations: string[];
  discoverLocations: string[];
  budget: number;
  days: number;
  mood: PlannerMood;
  destination: string;
}): TripPlannerInput {
  const {
    profile,
    activeTrip,
    pastTrips,
    savedDestinations,
    discoverLocations,
    budget,
    days,
    mood,
    destination,
  } = params;

  return {
    budget,
    days,
    destination: destination || activeTrip?.location || savedDestinations[0] || discoverLocations[0] || null,
    mood,
    traveler_count: Math.max(activeTrip?.approved_member_count || 1, 1),
    travel_style: profile?.profile?.travel_style || null,
    profile_context: {
      name: profile?.profile?.name || null,
      home_base: profile?.profile?.location || null,
      travel_style: profile?.profile?.travel_style || null,
      interests: (profile?.profile?.interests || []).slice(0, 6),
      budget_min: profile?.profile?.budget_min ?? null,
      budget_max: profile?.profile?.budget_max ?? null,
    },
    past_trips: pastTrips.slice(0, 4).map((trip) => buildTripSnapshot(trip, 'past')),
    active_trip: activeTrip ? buildTripSnapshot(activeTrip, 'active') : null,
    saved_destinations: savedDestinations.slice(0, 6),
    candidate_destinations: discoverLocations.slice(0, 6),
    must_include: (profile?.profile?.interests || []).slice(0, 3),
    avoid: [],
  };
}

export default function AventaroAiScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const appliedSeedKeyRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [discoverTrips, setDiscoverTrips] = useState<TripRecord[]>([]);
  const [savedDestinations, setSavedDestinations] = useState<string[]>([]);
  const [mood, setMood] = useState<PlannerMood>('adventure');
  const [dayCount, setDayCount] = useState(5);
  const [budgetInput, setBudgetInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [composer, setComposer] = useState('');
  const [turns, setTurns] = useState<PlannerTurn[]>([]);

  const orderedTrips = useMemo(() => sortTripsByStartDate(trips), [trips]);
  const pastTrips = useMemo(() => orderedTrips.filter((trip) => isPastTrip(trip)), [orderedTrips]);
  const activeTrip = useMemo(() => orderedTrips.find((trip) => !isPastTrip(trip)) || orderedTrips[0] || null, [orderedTrips]);
  const discoverLocations = useMemo(
    () => uniqueLocations(discoverTrips.map((trip) => trip.location), 6),
    [discoverTrips]
  );
  const suggestedBudget = useMemo(() => buildSuggestedBudget(profile, activeTrip), [activeTrip, profile]);
  const suggestedDays = useMemo(() => buildSuggestedDays(activeTrip), [activeTrip]);

  const loadAiContext = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const [profileResult, tripsResult, savedPostsResult, discoverTripsResult] = await Promise.allSettled([
      fetchMyProfile(),
      fetchMyTrips(user.id),
      fetchSavedPosts({ limit: 24, offset: 0 }),
      fetchTripDiscover(18),
    ]);

    if (profileResult.status === 'fulfilled') {
      setProfile(profileResult.value);
    } else {
      setProfile(null);
      errorLogger.logError(profileResult.reason, { source: 'AventaroAiScreen', context: { action: 'fetchMyProfile' } });
    }

    if (tripsResult.status === 'fulfilled') {
      setTrips(Array.isArray(tripsResult.value) ? tripsResult.value : []);
    } else {
      setTrips([]);
      errorLogger.logError(tripsResult.reason, { source: 'AventaroAiScreen', context: { action: 'fetchMyTrips' } });
    }

    if (savedPostsResult.status === 'fulfilled') {
      setSavedDestinations(uniqueLocations(savedPostsResult.value?.items?.map((post) => post.location), 6));
    } else {
      setSavedDestinations([]);
      errorLogger.logError(savedPostsResult.reason, { source: 'AventaroAiScreen', context: { action: 'fetchSavedPosts' } });
    }

    if (discoverTripsResult.status === 'fulfilled') {
      setDiscoverTrips(Array.isArray(discoverTripsResult.value) ? discoverTripsResult.value : []);
    } else {
      setDiscoverTrips([]);
      errorLogger.logError(discoverTripsResult.reason, { source: 'AventaroAiScreen', context: { action: 'fetchTripDiscover' } });
    }

    if (
      profileResult.status === 'rejected' &&
      tripsResult.status === 'rejected' &&
      savedPostsResult.status === 'rejected' &&
      discoverTripsResult.status === 'rejected'
    ) {
      setErrorMessage(extractErrorMessage(profileResult.reason, 'Unable to load Aventaro AI context'));
    }

    setLoading(false);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadAiContext();
    }, [loadAiContext])
  );

  useEffect(() => {
    const params = (route.params || {}) as AventaroAiRouteParams;
    const nextKey = JSON.stringify({
      seedDestination: params.seedDestination || null,
      seedBudget: params.seedBudget || null,
      seedMood: params.seedMood || null,
      initialPrompt: params.initialPrompt || null,
    });

    if (appliedSeedKeyRef.current === nextKey) {
      return;
    }

    if (params.seedDestination?.trim()) {
      setDestinationInput(params.seedDestination.trim());
    }

    if (typeof params.seedBudget === 'number' && params.seedBudget > 0) {
      setBudgetInput(String(Math.round(params.seedBudget)));
    }

    if (params.seedMood) {
      setMood(params.seedMood);
    }

    if (params.initialPrompt?.trim()) {
      setComposer(params.initialPrompt.trim());
    }

    appliedSeedKeyRef.current = nextKey;
  }, [route.params]);

  useEffect(() => {
    if (!budgetInput) {
      setBudgetInput(String(suggestedBudget));
    }
  }, [budgetInput, suggestedBudget]);

  useEffect(() => {
    if (dayCount === 5 && suggestedDays !== 5) {
      setDayCount(suggestedDays);
    }
  }, [dayCount, suggestedDays]);

  useEffect(() => {
    if (destinationInput.trim()) {
      return;
    }

    const nextDestination = activeTrip?.location || savedDestinations[0] || discoverLocations[0] || '';
    if (nextDestination) {
      setDestinationInput(nextDestination);
    }
  }, [activeTrip, destinationInput, discoverLocations, savedDestinations]);

  const quickPrompts = useMemo(() => {
    const destination = destinationInput.trim() || activeTrip?.location || 'my next trip';
    const homeBase = profile?.profile?.location || 'my city';
    return [
      `Plan my next trip from ${homeBase}`,
      `Suggest the best places under ${formatCurrency(Number(budgetInput) || suggestedBudget)}`,
      `Create a full ${dayCount}-day trip for ${destination}`,
      `Recommend a better destination than ${destination} for my budget`,
    ];
  }, [activeTrip, budgetInput, dayCount, destinationInput, profile?.profile?.location, suggestedBudget]);

  const latestPlan: TripPlanResult | null = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const maybePlan = turns[index]?.response?.trip_plan;
      if (maybePlan) {
        return maybePlan;
      }
    }

    return null;
  }, [turns]);

  const handleSend = useCallback(
    async (rawPrompt?: string) => {
      const prompt = (rawPrompt ?? composer).trim();
      if (!prompt || sending) {
        return;
      }

      const budgetValue = Math.max(Number(budgetInput) || suggestedBudget, 300);
      const context = buildPlannerContext({
        profile,
        activeTrip,
        pastTrips,
        savedDestinations,
        discoverLocations,
        budget: budgetValue,
        days: dayCount,
        mood,
        destination: destinationInput.trim(),
      });

      const userTurn: PlannerTurn = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: prompt,
      };
      const nextTurns = [...turns, userTurn];

      setTurns(nextTurns);
      setComposer('');
      setErrorMessage(null);
      setSending(true);

      try {
        const response = await askAventaroAi({
          message: prompt,
          history: turnsToHistory(nextTurns),
          planner_context: context,
        });

        setTurns((previous) => [
          ...previous,
          {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: response.reply,
            response,
          },
        ]);
      } catch (error) {
        const message = extractErrorMessage(error, 'Aventaro AI is unavailable right now');
        errorLogger.logError(error, { source: 'AventaroAiScreen', context: { action: 'askAventaroAi', prompt } });
        setErrorMessage(message);
        setTurns((previous) => [
          ...previous,
          {
            id: `assistant_error_${Date.now()}`,
            role: 'assistant',
            content: message,
            response: null,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      activeTrip,
      budgetInput,
      composer,
      dayCount,
      destinationInput,
      discoverLocations,
      mood,
      pastTrips,
      profile,
      savedDestinations,
      sending,
      suggestedBudget,
      turns,
    ]
  );

  const renderPlan = useCallback(
    (plan: TripPlanResult, followUpPrompts: string[] | undefined) => (
      <View style={styles.planWrap}>
        <LinearGradient
          colors={[COLORS.PRIMARY_PURPLE, COLORS.SECONDARY_PURPLE, '#9E7BFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.planHero}
        >
          <Text style={styles.planHeroTitle}>{plan.overview.headline}</Text>
          <Text style={styles.planHeroSubtitle}>
            {plan.overview.destination} · {plan.overview.duration_days} days · {formatCurrency(plan.total_estimated_cost)}
          </Text>

          <View style={styles.heroMetrics}>
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>{plan.overview.best_travel_window}</Text>
              <Text style={styles.heroMetricLabel}>Best window</Text>
            </View>
            <View style={styles.heroMetricDivider} />
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricValue}>{plan.itinerary.length}</Text>
              <Text style={styles.heroMetricLabel}>Planned days</Text>
            </View>
          </View>

          <Text style={styles.planHeroNote}>{plan.overview.transport_strategy}</Text>
        </LinearGradient>

        {plan.destination_suggestions?.length ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Best destination matches</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
              {plan.destination_suggestions.map((item) => (
                <View key={`${item.destination}_${item.ideal_days}`} style={styles.destinationCard}>
                  <Text style={styles.destinationCardTitle}>{item.destination}</Text>
                  <Text style={styles.destinationCardMeta}>{item.ideal_days} days · {formatCurrency(item.estimated_total_cost)}</Text>
                  <Text style={styles.destinationCardText}>{item.reason}</Text>
                  <Text style={styles.destinationCardTag}>{item.best_for.join(' · ')}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {plan.budget_breakdown?.length ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Budget breakdown</Text>
            <View style={styles.budgetList}>
              {plan.budget_breakdown.map((item) => (
                <View key={item.category} style={styles.budgetRow}>
                  <View style={styles.budgetRowHeader}>
                    <Text style={styles.budgetLabel}>{item.label}</Text>
                    <Text style={styles.budgetAmount}>{formatCurrency(item.amount)}</Text>
                  </View>
                  <Text style={styles.budgetNote}>{item.note}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>Day-wise plan</Text>
          <View style={styles.itineraryList}>
            {plan.itinerary.map((day) => (
              <View key={day.day} style={styles.dayCard}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayTitle}>Day {day.day}</Text>
                  <Text style={styles.dayCost}>{formatCurrency(day.estimated_cost)}</Text>
                </View>
                <View style={styles.dayActivities}>
                  {day.activities.map((activity, index) => (
                    <View key={`${day.day}_${index}`} style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <Text style={styles.activityText}>{activity}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>Planner notes</Text>
          <View style={styles.noteList}>
            {plan.overview.personalization_notes?.map((item, index) => (
              <View key={`personal_${index}`} style={styles.inlinePill}>
                <Text style={styles.inlinePillText}>{item}</Text>
              </View>
            ))}
            {plan.tips?.map((item, index) => (
              <View key={`tip_${index}`} style={styles.inlinePillMuted}>
                <Text style={styles.inlinePillMutedText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        {followUpPrompts?.length ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Refine this plan</Text>
            <View style={styles.promptWrap}>
              {followUpPrompts.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  activeOpacity={0.92}
                  style={styles.refineChip}
                  onPress={() => void handleSend(prompt)}
                >
                  <Text style={styles.refineChipText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    ),
    [handleSend]
  );

  const renderAssistantInsights = useCallback((response: AiAssistantResponse) => {
    const sections: Array<{ title: string; items: string[] }> = [
      response.trip_suggestions?.length
        ? {
            title: 'Why this fits',
            items: response.trip_suggestions,
          }
        : null,
      response.budget_tips?.length
        ? {
            title: 'Budget guardrails',
            items: response.budget_tips,
          }
        : null,
      response.next_steps?.length
        ? {
            title: 'Next moves',
            items: response.next_steps,
          }
        : null,
    ].filter((section): section is { title: string; items: string[] } => Boolean(section));

    if (!sections.length) {
      return null;
    }

    return (
      <View style={styles.insightWrap}>
        {sections.map((section) => (
          <View key={section.title} style={styles.insightCard}>
            <Text style={styles.insightTitle}>{section.title}</Text>
            <View style={styles.insightList}>
              {section.items.map((item) => (
                <View key={`${section.title}_${item}`} style={styles.insightRow}>
                  <View style={styles.insightDot} />
                  <Text style={styles.insightText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  }, []);

  if (loading && !profile && trips.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusView type="loading" message="Loading Aventaro AI..." />
      </SafeAreaView>
    );
  }

  if (errorMessage && !profile && trips.length === 0 && turns.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusView type="error" title="Aventaro AI unavailable" message={errorMessage} onRetry={() => void loadAiContext()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Aventaro AI</Text>
            <Text style={styles.headerSubtitle}>Full trip planning copilot</Text>
          </View>
          <View style={styles.headerButton} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <LinearGradient
            colors={['#1D1344', COLORS.PRIMARY_PURPLE, '#A67FFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.contextHero}
          >
            <View style={styles.contextBadge}>
              <Ionicons name="sparkles-outline" size={16} color={COLORS.GOLD_SOFT} />
              <Text style={styles.contextBadgeText}>History-aware planner</Text>
            </View>
            <Text style={styles.contextTitle}>From idea to full trip plan</Text>
            <Text style={styles.contextSubtitle}>
              Past trips, active trips, saved places, budget range, and travel style are all used before Aventaro AI suggests the next move.
            </Text>

            <View style={styles.contextStats}>
              <View style={styles.contextStat}>
                <Text style={styles.contextStatValue}>{profile?.profile?.travel_style || 'Flexible'}</Text>
                <Text style={styles.contextStatLabel}>Style</Text>
              </View>
              <View style={styles.contextDivider} />
              <View style={styles.contextStat}>
                <Text style={styles.contextStatValue}>{activeTrip?.location || savedDestinations[0] || 'Open'}</Text>
                <Text style={styles.contextStatLabel}>Current focus</Text>
              </View>
              <View style={styles.contextDivider} />
              <View style={styles.contextStat}>
                <Text style={styles.contextStatValue}>{formatCurrency(Number(budgetInput) || suggestedBudget)}</Text>
                <Text style={styles.contextStatLabel}>Budget</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.controlCard}>
            <Text style={styles.controlTitle}>Planner controls</Text>
            <Text style={styles.controlSubtitle}>Tune the mood, trip length, and target budget before you ask.</Text>

            <View style={styles.controlSection}>
              <Text style={styles.controlLabel}>Mood</Text>
              <View style={styles.moodRow}>
                {(['chill', 'adventure', 'party', 'luxury'] as PlannerMood[]).map((option) => (
                  <TouchableOpacity
                    key={option}
                    activeOpacity={0.92}
                    style={[styles.controlChip, mood === option && styles.controlChipActive]}
                    onPress={() => setMood(option)}
                  >
                    <Text style={[styles.controlChipText, mood === option && styles.controlChipTextActive]}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.controlSection}>
              <Text style={styles.controlLabel}>Trip length</Text>
              <View style={styles.moodRow}>
                {[3, 5, 7, 10].map((value) => (
                  <TouchableOpacity
                    key={value}
                    activeOpacity={0.92}
                    style={[styles.controlChip, dayCount === value && styles.controlChipActive]}
                    onPress={() => setDayCount(value)}
                  >
                    <Text style={[styles.controlChipText, dayCount === value && styles.controlChipTextActive]}>
                      {value} days
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGrid}>
              <View style={styles.inputWrap}>
                <Text style={styles.controlLabel}>Destination</Text>
                <TextInput
                  style={styles.input}
                  value={destinationInput}
                  onChangeText={setDestinationInput}
                  placeholder="Where should Aventaro AI focus?"
                  placeholderTextColor={COLORS.TEXT_MUTED}
                />
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.controlLabel}>Budget</Text>
                <TextInput
                  style={styles.input}
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  keyboardType="numeric"
                  placeholder="1500"
                  placeholderTextColor={COLORS.TEXT_MUTED}
                />
              </View>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Quick starts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
              {quickPrompts.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  activeOpacity={0.92}
                  style={styles.quickPromptCard}
                  onPress={() => void handleSend(prompt)}
                >
                  <Ionicons name="flash-outline" size={16} color={COLORS.PRIMARY_PURPLE} />
                  <Text style={styles.quickPromptText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {errorMessage ? (
            <View style={styles.inlineErrorCard}>
              <Ionicons name="warning-outline" size={18} color={COLORS.WARNING} />
              <Text style={styles.inlineErrorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {turns.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Start with one real question</Text>
              <Text style={styles.emptyText}>
                Ask for destination ideas, a full budgeted itinerary, or a cheaper alternative to your current trip.
              </Text>

              <View style={styles.signalWrap}>
                <View style={styles.signalChip}>
                  <Text style={styles.signalChipText}>{pastTrips.length} past trip signals</Text>
                </View>
                <View style={styles.signalChip}>
                  <Text style={styles.signalChipText}>{savedDestinations.length} saved destination signals</Text>
                </View>
                <View style={styles.signalChip}>
                  <Text style={styles.signalChipText}>{discoverLocations.length} live destination options</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.turnList}>
              {turns.map((turn) => (
                <View key={turn.id} style={[styles.turnCard, turn.role === 'user' ? styles.userTurn : styles.assistantTurn]}>
                  <View style={styles.turnHeader}>
                    <Text style={styles.turnRole}>{turn.role === 'user' ? 'You' : 'Aventaro AI'}</Text>
                    {turn.role === 'assistant' && turn.response?.trip_plan ? (
                      <Ionicons name="sparkles-outline" size={16} color={COLORS.PRIMARY_PURPLE} />
                    ) : null}
                  </View>
                  <Text style={styles.turnContent}>{turn.content}</Text>
                  {turn.role === 'assistant' && turn.response ? renderAssistantInsights(turn.response) : null}
                  {turn.role === 'assistant' && turn.response?.trip_plan
                    ? renderPlan(turn.response.trip_plan, turn.response.follow_up_prompts)
                    : null}
                  {turn.role === 'assistant' && !turn.response?.trip_plan && turn.response?.follow_up_prompts?.length ? (
                    <View style={styles.promptWrap}>
                      {turn.response.follow_up_prompts.map((prompt) => (
                        <TouchableOpacity
                          key={prompt}
                          activeOpacity={0.92}
                          style={styles.refineChip}
                          onPress={() => void handleSend(prompt)}
                        >
                          <Text style={styles.refineChipText}>{prompt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {latestPlan?.travel_routes?.length ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Execution checklist</Text>
              <View style={styles.checklistWrap}>
                {latestPlan.travel_routes.map((item, index) => (
                  <View key={`route_${index}`} style={styles.checklistRow}>
                    <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
                    <Text style={styles.checklistText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composerWrap}>
          <TextInput
            style={styles.composerInput}
            value={composer}
            onChangeText={setComposer}
            placeholder="Ask for a complete trip plan, cheaper option, or better destination..."
            placeholderTextColor={COLORS.TEXT_MUTED}
            multiline
          />
          <TouchableOpacity
            activeOpacity={0.92}
            style={[styles.sendButton, (!composer.trim() || sending) && styles.sendButtonDisabled]}
            onPress={() => void handleSend()}
            disabled={!composer.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.WHITE} />
            ) : (
              <Ionicons name="arrow-up" size={18} color={COLORS.WHITE} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    alignItems: 'center',
    gap: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
    gap: 16,
  },
  contextHero: {
    borderRadius: 26,
    padding: 20,
    gap: 14,
  },
  contextBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  contextBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  contextTitle: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  contextSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.86)',
  },
  contextStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  contextStat: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  contextDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  contextStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.WHITE,
    textAlign: 'center',
  },
  contextStatLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.80)',
  },
  controlCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 14,
  },
  controlTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  controlSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  controlSection: {
    gap: 10,
  },
  controlLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.BACKGROUND,
  },
  controlChipActive: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  controlChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_SECONDARY,
    textTransform: 'capitalize',
  },
  controlChipTextActive: {
    color: COLORS.WHITE,
  },
  inputGrid: {
    gap: 12,
  },
  inputWrap: {
    gap: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 14,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  horizontalRow: {
    gap: 12,
  },
  quickPromptCard: {
    width: 220,
    minHeight: 96,
    borderRadius: 20,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    padding: 16,
    gap: 12,
  },
  quickPromptText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  inlineErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: COLORS.WARNING_SOFT,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.WARNING,
  },
  emptyCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.TEXT_SECONDARY,
  },
  signalWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  signalChip: {
    borderRadius: 999,
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signalChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_SECONDARY,
  },
  turnList: {
    gap: 16,
  },
  turnCard: {
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  userTurn: {
    backgroundColor: '#EFE7FF',
  },
  assistantTurn: {
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
  },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  turnRole: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.TEXT_MUTED,
    textTransform: 'uppercase',
  },
  turnContent: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.TEXT_PRIMARY,
  },
  insightWrap: {
    gap: 10,
  },
  insightCard: {
    borderRadius: 18,
    backgroundColor: COLORS.SURFACE_ELEVATED,
    padding: 14,
    gap: 10,
  },
  insightTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
    textTransform: 'uppercase',
  },
  insightList: {
    gap: 8,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  insightText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
  },
  planWrap: {
    gap: 16,
  },
  planHero: {
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  planHeroTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  planHeroSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
  },
  heroMetrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  heroMetric: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  heroMetricDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroMetricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
    textAlign: 'center',
  },
  heroMetricLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.78)',
  },
  planHeroNote: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.86)',
  },
  destinationCard: {
    width: 260,
    borderRadius: 20,
    padding: 16,
    backgroundColor: COLORS.SURFACE_ELEVATED,
    gap: 8,
  },
  destinationCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  destinationCardMeta: {
    fontSize: 12,
    color: COLORS.PRIMARY_PURPLE,
    fontWeight: '700',
  },
  destinationCardText: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
  },
  destinationCardTag: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.TEXT_MUTED,
  },
  budgetList: {
    gap: 10,
  },
  budgetRow: {
    borderRadius: 18,
    backgroundColor: COLORS.SURFACE_ELEVATED,
    padding: 14,
    gap: 6,
  },
  budgetRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  budgetLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  budgetAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  budgetNote: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.TEXT_SECONDARY,
  },
  itineraryList: {
    gap: 12,
  },
  dayCard: {
    borderRadius: 20,
    backgroundColor: COLORS.SURFACE_ELEVATED,
    padding: 16,
    gap: 12,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  dayCost: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
  dayActivities: {
    gap: 10,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: COLORS.GOLD_DEEP,
  },
  activityText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_PRIMARY,
  },
  noteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlinePill: {
    borderRadius: 16,
    backgroundColor: '#EEE4FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlinePillText: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.TEXT_PRIMARY,
    fontWeight: '700',
  },
  inlinePillMuted: {
    borderRadius: 16,
    backgroundColor: COLORS.SURFACE_ELEVATED,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlinePillMutedText: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.TEXT_SECONDARY,
  },
  promptWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  refineChip: {
    borderRadius: 999,
    backgroundColor: '#EBE1FF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refineChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  checklistWrap: {
    gap: 10,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 18,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
  },
  checklistText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_PRIMARY,
  },
  composerWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER_SOFT,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
