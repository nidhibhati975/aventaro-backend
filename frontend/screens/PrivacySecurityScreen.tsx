import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { ApiError, extractErrorMessage } from '../services/api';
import {
  fetchBlockedUsers,
  fetchModerationCases,
  fetchMyReports,
  resolveModerationCase,
  unblockUser,
} from '../services/moderationService';
import {
  fetchVerificationStatus,
  submitVerification,
  type SubmitVerificationPayload,
} from '../services/verificationService';
import {
  getUserDisplayName,
  type BlockedUserRecord,
  type ModerationCaseRecord,
  type ReportRecord,
  type VerificationStatusRecord,
} from '../services/types';
import { COLORS } from '../theme/colors';

type VerificationType = SubmitVerificationPayload['type'];

const VERIFICATION_TYPES: VerificationType[] = ['id', 'selfie', 'social'];
const MODERATION_ACTIONS = ['approve', 'reject', 'ban'] as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export default function PrivacySecurityScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatusRecord | null>(null);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserRecord[]>([]);
  const [moderationCases, setModerationCases] = useState<ModerationCaseRecord[]>([]);
  const [moderationAvailable, setModerationAvailable] = useState(false);
  const [verificationType, setVerificationType] = useState<VerificationType>('id');
  const [documentUrl, setDocumentUrl] = useState('');

  const loadSafetyCenter = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        setErrorMessage(null);
        const [verificationResult, reportsResult, blockedResult, moderationResult] =
          await Promise.allSettled([
            fetchVerificationStatus(),
            fetchMyReports(),
            fetchBlockedUsers(),
            fetchModerationCases(),
          ]);

        if (verificationResult.status === 'fulfilled') {
          setVerificationStatus(verificationResult.value);
        } else {
          setVerificationStatus(null);
        }

        if (reportsResult.status === 'fulfilled') {
          setReports(Array.isArray(reportsResult.value) ? reportsResult.value : []);
        } else {
          setReports([]);
        }

        if (blockedResult.status === 'fulfilled') {
          setBlockedUsers(Array.isArray(blockedResult.value) ? blockedResult.value : []);
        } else {
          setBlockedUsers([]);
        }

        if (moderationResult.status === 'fulfilled') {
          setModerationCases(Array.isArray(moderationResult.value) ? moderationResult.value : []);
          setModerationAvailable(true);
        } else if (moderationResult.reason instanceof ApiError && moderationResult.reason.status === 403) {
          setModerationCases([]);
          setModerationAvailable(false);
        } else {
          setModerationCases([]);
          setModerationAvailable(false);
        }

        if (
          verificationResult.status === 'rejected' &&
          reportsResult.status === 'rejected' &&
          blockedResult.status === 'rejected'
        ) {
          throw verificationResult.reason;
        }
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, 'Unable to load privacy and security settings.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void loadSafetyCenter('initial');
    }, [loadSafetyCenter])
  );

  const latestVerification = verificationStatus?.latest_request || null;
  const verificationBadge = useMemo(() => {
    if (verificationStatus?.is_verified) {
      return 'Verified';
    }
    return latestVerification?.status ? latestVerification.status : 'Not submitted';
  }, [latestVerification?.status, verificationStatus?.is_verified]);

  const handleSubmitVerification = useCallback(async () => {
    const trimmedDocumentUrl = documentUrl.trim();
    if (!trimmedDocumentUrl) {
      Alert.alert('Document URL required', 'Add the secure document URL before submitting verification.');
      return;
    }

    try {
      setSubmitting(true);
      await submitVerification({
        type: verificationType,
        document_url: trimmedDocumentUrl,
      });
      setDocumentUrl('');
      Alert.alert('Verification submitted', 'Your verification request has been sent for review.');
      await loadSafetyCenter('refresh');
    } catch (error) {
      Alert.alert('Unable to submit', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }, [documentUrl, loadSafetyCenter, verificationType]);

  const handleUnblock = useCallback(
    async (userId: number) => {
      try {
        setActionId(`unblock:${userId}`);
        await unblockUser(userId);
        await loadSafetyCenter('refresh');
      } catch (error) {
        Alert.alert('Unable to unblock', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setActionId(null);
      }
    },
    [loadSafetyCenter]
  );

  const handleResolveCase = useCallback(
    async (caseId: number, action: (typeof MODERATION_ACTIONS)[number]) => {
      try {
        setActionId(`moderation:${caseId}:${action}`);
        await resolveModerationCase(caseId, action);
        await loadSafetyCenter('refresh');
      } catch (error) {
        Alert.alert('Unable to resolve case', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setActionId(null);
      }
    },
    [loadSafetyCenter]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Security</Text>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Safety center unavailable</Text>
          <Text style={styles.emptyText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => void loadSafetyCenter('initial')}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadSafetyCenter('refresh')}
              tintColor={COLORS.PRIMARY_PURPLE}
            />
          }
        >
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.PRIMARY_PURPLE} />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>Account safety</Text>
              <Text style={styles.heroBody}>
                Verification, reports, and blocked accounts are synced from the live Aventaro backend.
              </Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{verificationBadge}</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Verification</Text>
            <Text style={styles.sectionHint}>
              Status: {verificationStatus?.verification_level || 'unverified'}
              {latestVerification ? ` | latest review ${latestVerification.status}` : ''}
            </Text>
            {latestVerification ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Latest request</Text>
                <Text style={styles.detailText}>Type: {latestVerification.type}</Text>
                <Text style={styles.detailText}>Submitted: {formatDateTime(latestVerification.created_at)}</Text>
                <Text style={styles.detailText}>
                  Document: {latestVerification.document_url || 'No document URL attached'}
                </Text>
              </View>
            ) : null}

            <View style={styles.chipRow}>
              {VERIFICATION_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.chip, verificationType === type && styles.chipActive]}
                  onPress={() => setVerificationType(type)}
                >
                  <Text style={[styles.chipText, verificationType === type && styles.chipTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={documentUrl}
              onChangeText={setDocumentUrl}
              placeholder="https://secure-storage.example/document.jpg"
              placeholderTextColor={COLORS.TEXT_MUTED}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleSubmitVerification()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.WHITE} />
              ) : (
                <Text style={styles.primaryButtonText}>Submit Verification</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Report History</Text>
            {reports.length ? (
              reports.map((report) => (
                <View key={report.id} style={styles.listCard}>
                  <Text style={styles.listTitle}>
                    {report.target_type} #{report.target_id}
                  </Text>
                  <Text style={styles.listBody}>{report.reason}</Text>
                  <Text style={styles.listMeta}>{formatDateTime(report.created_at)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.sectionHint}>Reports you submit from profiles or content will appear here.</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Blocked Users</Text>
            {blockedUsers.length ? (
              blockedUsers.map((entry) => (
                <View key={entry.user.id} style={styles.rowCard}>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.listTitle}>{getUserDisplayName(entry.user)}</Text>
                    <Text style={styles.listMeta}>{entry.user.email}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => void handleUnblock(entry.user.id)}
                    disabled={actionId === `unblock:${entry.user.id}`}
                  >
                    {actionId === `unblock:${entry.user.id}` ? (
                      <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Unblock</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.sectionHint}>You have not blocked any travelers.</Text>
            )}
          </View>

          {moderationAvailable ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Moderation Queue</Text>
              {moderationCases.length ? (
                moderationCases.map((moderationCase) => (
                  <View key={moderationCase.id} style={styles.listCard}>
                    <Text style={styles.listTitle}>Case #{moderationCase.id}</Text>
                    <Text style={styles.listBody}>
                      Report #{moderationCase.report_id} | status {moderationCase.status}
                    </Text>
                    <Text style={styles.listMeta}>
                      Created {formatDateTime(moderationCase.created_at)}
                      {moderationCase.admin_action ? ` | action ${moderationCase.admin_action}` : ''}
                    </Text>
                    <View style={styles.inlineActions}>
                      {MODERATION_ACTIONS.map((action) => (
                        <TouchableOpacity
                          key={`${moderationCase.id}:${action}`}
                          style={styles.secondaryButton}
                          onPress={() => void handleResolveCase(moderationCase.id, action)}
                          disabled={actionId === `moderation:${moderationCase.id}:${action}`}
                        >
                          {actionId === `moderation:${moderationCase.id}:${action}` ? (
                            <ActivityIndicator size="small" color={COLORS.PRIMARY_PURPLE} />
                          ) : (
                            <Text style={styles.secondaryButtonText}>{action}</Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.sectionHint}>No open moderation cases right now.</Text>
              )}
            </View>
          ) : null}
        </ScrollView>
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
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  heroCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2E8FF',
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  heroBody: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#F2E8FF',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
    color: COLORS.PRIMARY_PURPLE,
  },
  sectionCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SOFT,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  detailCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: COLORS.BACKGROUND,
    gap: 6,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.TEXT_SECONDARY,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.SURFACE,
  },
  chipActive: {
    borderColor: COLORS.PRIMARY_PURPLE,
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  chipTextActive: {
    color: COLORS.WHITE,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  secondaryButton: {
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    textTransform: 'capitalize',
  },
  listCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: COLORS.BACKGROUND,
    gap: 5,
  },
  rowCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: COLORS.BACKGROUND,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTextWrap: {
    flex: 1,
    gap: 4,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  listBody: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
  },
  listMeta: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
