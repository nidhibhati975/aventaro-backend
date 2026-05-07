import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

import StatusView from '../components/StatusView';
import { useAuth } from '../contexts/AuthContext';
import { extractErrorMessage } from '../services/api';
import { blockUser, createReport } from '../services/moderationService';
import { safeParseNumber } from '../services/navigationSafety';
import { fetchPublicProfile } from '../services/profileService';
import { getUserDisplayName, type AppUser } from '../services/types';
import { COLORS } from '../theme/colors';

export default function PublicProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const userId = safeParseNumber(route.params?.userId, 0);
  const initialUser = (route.params?.initialUser || null) as AppUser | null;
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(initialUser);
  const [actionId, setActionId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!userId && !initialUser?.id) {
        setErrorMessage('Profile is unavailable.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setErrorMessage(null);
        setProfile(await fetchPublicProfile(userId || initialUser?.id || 0, initialUser));
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, 'Unable to load public profile'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [initialUser, userId]);

  const canModerate = Boolean(profile?.id && user?.id && profile.id !== user.id);

  const handleBlockUser = async () => {
    if (!profile?.id) {
      return;
    }

    try {
      setActionId('block');
      await blockUser(profile.id);
      setActionMessage('This traveler has been blocked. They will no longer appear in discovery surfaces.');
    } catch (error) {
      Alert.alert('Unable to block user', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  const handleReportUser = async () => {
    if (!profile?.id) {
      return;
    }

    const trimmedReason = reportReason.trim();
    if (!trimmedReason) {
      Alert.alert('Reason required', 'Add a short reason before reporting this traveler.');
      return;
    }

    try {
      setActionId('report');
      await createReport({
        target_type: 'user',
        target_id: profile.id,
        reason: trimmedReason,
      });
      setReportReason('');
      setActionMessage('Your report has been submitted to Aventaro moderation.');
    } catch (error) {
      Alert.alert('Unable to report user', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setActionId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} style={styles.loader} />
      ) : errorMessage && !profile ? (
        <StatusView
          type="error"
          title="Profile unavailable"
          message={errorMessage}
          onRetry={() => navigation.goBack?.()}
        />
      ) : (
        <View style={styles.content}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={42} color={COLORS.PRIMARY_PURPLE} />
          </View>
          <Text style={styles.name}>{getUserDisplayName(profile)}</Text>
          <Text style={styles.email}>{profile?.email || 'Unknown email'}</Text>
          <Text style={styles.bio}>{profile?.profile?.bio || 'This user has not added a public bio yet.'}</Text>
          <Text style={styles.note}>
            {profile?.profile?.location || 'Unknown location'}
            {profile?.profile?.travel_style ? ` | ${profile.profile.travel_style}` : ''}
          </Text>
          {canModerate ? (
            <View style={styles.moderationCard}>
              <Text style={styles.moderationTitle}>Safety tools</Text>
              <TextInput
                style={styles.input}
                value={reportReason}
                onChangeText={setReportReason}
                placeholder="Reason for report"
                placeholderTextColor={COLORS.TEXT_MUTED}
                multiline
              />
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={() => void handleReportUser()}
                  disabled={actionId === 'report'}
                >
                  {actionId === 'report' ? (
                    <ActivityIndicator size="small" color={COLORS.WHITE} />
                  ) : (
                    <Text style={styles.primaryActionText}>Report User</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => void handleBlockUser()}
                  disabled={actionId === 'block'}
                >
                  {actionId === 'block' ? (
                    <ActivityIndicator size="small" color={COLORS.DANGER} />
                  ) : (
                    <Text style={styles.secondaryActionText}>Block User</Text>
                  )}
                </TouchableOpacity>
              </View>
              <Text style={styles.note}>
                {actionMessage || 'Reports and block actions are sent directly to the production backend.'}
              </Text>
            </View>
          ) : null}
        </View>
      )}
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
  loader: {
    marginTop: 40,
  },
  content: {
    alignItems: 'center',
    padding: 20,
    gap: 10,
    width: '100%',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  email: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  bio: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  note: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  moderationCard: {
    width: '100%',
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    padding: 16,
    gap: 12,
  },
  moderationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  input: {
    minHeight: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BACKGROUND,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.TEXT_PRIMARY,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  primaryActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFD9DE',
    backgroundColor: '#FFF8F9',
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.DANGER,
  },
});
