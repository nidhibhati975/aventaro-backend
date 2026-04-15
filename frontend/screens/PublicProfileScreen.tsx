import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

import StatusView from '../components/StatusView';
import { extractErrorMessage } from '../services/api';
import { safeParseNumber } from '../services/navigationSafety';
import { fetchPublicProfile } from '../services/profileService';
import { getUserDisplayName, type AppUser } from '../services/types';
import { COLORS } from '../theme/colors';

export default function PublicProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const userId = safeParseNumber(route.params?.userId, 0);
  const initialUser = (route.params?.initialUser || null) as AppUser | null;
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(initialUser);

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
          <Text style={styles.note}>{errorMessage || 'Public profile details are loaded from the live backend.'}</Text>
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
});
