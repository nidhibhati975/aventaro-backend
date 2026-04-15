import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
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
import { buildConversationId } from '../services/chatService';
import { errorLogger } from '../services/errorLogger';
import { fetchReceivedMatches, fetchSentMatches } from '../services/matchService';
import { getUserDisplayName, getUserInitials, type AppUser, type MatchRecord } from '../services/types';
import { COLORS } from '../theme/colors';

function dedupeContacts(matches: MatchRecord[]) {
  const seen = new Map<number, AppUser>();
  matches.forEach((match) => {
    if (match?.status !== 'accepted' || !match?.user?.id || seen.has(match.user.id)) {
      return;
    }
    seen.set(match.user.id, match.user);
  });
  return [...seen.values()];
}

export default function EmergencySosScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [contacts, setContacts] = useState<AppUser[]>([]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const [received, sent] = await Promise.all([fetchReceivedMatches(), fetchSentMatches()]);
      setContacts(dedupeContacts([...(received || []), ...(sent || [])]));
    } catch (error) {
      errorLogger.logError(error, { source: 'EmergencySosScreen', context: { action: 'loadContacts' } });
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadContacts();
    }, [loadContacts])
  );

  const sosMessage = useMemo(() => {
    const name = getUserDisplayName(user);
    const location = user?.profile?.location || 'Location unavailable';
    return `Emergency alert from ${name} via Aventaro. Last known location: ${location}. Please check in immediately.`;
  }, [user]);

  const handleSendAlert = async () => {
    if (contacts.length === 0) {
      Alert.alert('No emergency contacts', 'Accept a connection first, then add them from Connect.');
      return;
    }

    try {
      setSharing(true);
      await Share.share({ message: sosMessage });
    } catch (error) {
      errorLogger.logError(error, { source: 'EmergencySosScreen', context: { action: 'shareSOS' } });
      Alert.alert('Unable to send SOS', 'Please try again.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Emergency SOS</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={18} color="#E65757" />
          <Text style={styles.warningText}>
            Use only in genuine emergencies. This shares your last known profile location with all emergency contacts.
          </Text>
        </View>

        <TouchableOpacity activeOpacity={0.9} style={styles.sosButton} onPress={() => void handleSendAlert()}>
          {sharing ? (
            <ActivityIndicator size="large" color={COLORS.WHITE} />
          ) : (
            <>
              <Ionicons name="warning-outline" size={42} color={COLORS.WHITE} />
              <Text style={styles.sosText}>SOS</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.sosHint}>Tap to send emergency alert</Text>

        <View style={styles.sectionWrap}>
          <Text style={styles.sectionTitle}>Emergency Contacts</Text>

          {loading ? (
            <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} style={styles.loader} />
          ) : contacts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No accepted connections yet</Text>
              <Text style={styles.emptyText}>Your accepted Aventaro connections become emergency contacts here.</Text>
            </View>
          ) : (
            contacts.map((contact) => (
              <View key={contact.id} style={styles.contactCard}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>{getUserInitials(contact)}</Text>
                </View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>{getUserDisplayName(contact)}</Text>
                  <Text style={styles.contactMeta}>
                    {contact.email} · {contact.profile?.location || 'Traveler'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.contactAction}
                  onPress={() => {
                    if (!user?.id) {
                      return;
                    }

                    navigation.navigate('Conversation', {
                      conversationId: buildConversationId(user.id, contact.id),
                      participant: contact,
                    });
                  }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.PRIMARY_PURPLE} />
                </TouchableOpacity>
              </View>
            ))
          )}

          <TouchableOpacity style={styles.addContactButton} onPress={() => navigateToPath(APP_PATHS.TAB_CONNECT)}>
            <Ionicons name="add-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
            <Text style={styles.addContactText}>Add Emergency Contact</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerInfo}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.PRIMARY_PURPLE} />
          <Text style={styles.footerInfoText}>
            Aventaro uses your live accepted connections as emergency contacts until dedicated contact management is configured.
          </Text>
        </View>
      </ScrollView>
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
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD8D8',
    backgroundColor: '#FFF0F1',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#C75A67',
  },
  sosButton: {
    alignSelf: 'center',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#FF4747',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    shadowColor: '#FF4747',
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sosText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.WHITE,
    letterSpacing: 1,
  },
  sosHint: {
    textAlign: 'center',
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
    marginTop: -2,
  },
  sectionWrap: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  loader: {
    marginVertical: 14,
  },
  emptyState: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE6FF',
    padding: 18,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEE6FF',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F2ECFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  contactText: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  contactMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.TEXT_SECONDARY,
  },
  contactAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addContactButton: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  addContactText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#F4EEFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  footerInfoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
  },
});
