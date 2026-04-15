import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { useAuth } from '../contexts/AuthContext';
import { APP_PATHS, navigateToPath } from '../navigation/router';
import { errorLogger } from '../services/errorLogger';
import { COLORS } from '../theme/colors';

type SettingsRow = {
  key: string;
  label: string;
  icon: string;
  onPress?: () => void;
  toggle?: boolean;
};

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.sectionCard}>{children}</View>;
}

function SettingsItem({
  item,
  darkMode,
  onToggleDarkMode,
}: {
  item: SettingsRow;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={item.toggle ? 1 : 0.9}
      disabled={item.toggle}
      onPress={item.onPress}
      style={styles.settingsItem}
    >
      <View style={styles.rowIconWrap}>
        <Ionicons name={item.icon} size={20} color={COLORS.PRIMARY_PURPLE} />
      </View>
      <Text style={styles.rowLabel}>{item.label}</Text>
      {item.toggle ? (
        <Switch
          value={darkMode}
          onValueChange={onToggleDarkMode}
          trackColor={{ false: '#ECE7FB', true: '#CDB9FF' }}
          thumbColor="#FFFFFF"
        />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_MUTED} />
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();
  const [darkMode, setDarkMode] = useState(false);

  const localeLabel = useMemo(() => {
    try {
      return `${Intl.DateTimeFormat().resolvedOptions().locale}`;
    } catch {
      return 'en-IN';
    }
  }, []);

  const accountRows = useMemo<SettingsRow[]>(
    () => [
      { key: 'edit', label: 'Edit Profile', icon: 'person-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_EDIT_PROFILE) },
      { key: 'privacy', label: 'Privacy & Security', icon: 'lock-closed-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_PRIVACY_SECURITY) },
      { key: 'notifications', label: 'Notifications', icon: 'notifications-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_NOTIFICATIONS) },
      { key: '2fa', label: 'Two-Factor Authentication', icon: 'shield-checkmark-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_TWO_FACTOR_AUTH) },
    ],
    []
  );

  const travelRows = useMemo<SettingsRow[]>(
    () => [
      { key: 'travel-preferences', label: 'Travel Preferences', icon: 'globe-outline', onPress: () => navigateToPath(APP_PATHS.TAB_TRIPS) },
      { key: 'destinations', label: 'My Destinations', icon: 'location-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_TRAVELER_MAP) },
      { key: 'subscription', label: 'Subscription & Premium', icon: 'star-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_PAYMENTS) },
      { key: 'payments', label: 'Payment Methods', icon: 'cash-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_PAYMENT_METHODS) },
    ],
    []
  );

  const safetyRows = useMemo<SettingsRow[]>(
    () => [
      { key: 'emergency', label: 'Emergency Contacts', icon: 'warning-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_EMERGENCY_SOS) },
      { key: 'sharing', label: 'Location Sharing', icon: 'map-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_LOCATION_SHARING) },
    ],
    []
  );

  const appRows = useMemo<SettingsRow[]>(
    () => [
      {
        key: 'language',
        label: 'Language & Region',
        icon: 'language-outline',
        onPress: () => Alert.alert('Language & Region', `Current device locale: ${localeLabel}`),
      },
      { key: 'dark', label: 'Dark Mode', icon: 'moon-outline', toggle: true },
      { key: 'help', label: 'Help & Support', icon: 'help-circle-outline', onPress: () => navigateToPath(APP_PATHS.SCREEN_HELP_SUPPORT) },
      {
        key: 'terms',
        label: 'Terms & Privacy',
        icon: 'document-text-outline',
        onPress: () => navigateToPath(APP_PATHS.SCREEN_PRIVACY_SECURITY),
      },
      {
        key: 'about',
        label: 'About Aventaro',
        icon: 'information-circle-outline',
        onPress: () => Alert.alert('About Aventaro', 'Aventaro v1.0.0\nMade with love for wanderers'),
      },
    ],
    [localeLabel]
  );

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      errorLogger.logError(error, { source: 'SettingsScreen', context: { action: 'signOut' } });
      Alert.alert('Unable to sign out', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.headerButton} />
        </View>

        <TouchableOpacity activeOpacity={0.92} onPress={() => navigateToPath(APP_PATHS.SCREEN_PAYMENTS)}>
          <LinearGradient colors={['#D7A42B', '#F5C355']} style={styles.premiumCard}>
            <View style={styles.premiumIcon}>
              <Ionicons name="star-outline" size={20} color={COLORS.WHITE} />
            </View>
            <View style={styles.premiumText}>
              <Text style={styles.premiumTitle}>Aventaro Premium</Text>
              <Text style={styles.premiumSubtitle}>Unlimited trips · No booking fees · Priority support</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.WHITE} />
          </LinearGradient>
        </TouchableOpacity>

        <SectionLabel>ACCOUNT</SectionLabel>
        <SectionCard>
          {accountRows.map((item) => (
            <SettingsItem key={item.key} item={item} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} />
          ))}
        </SectionCard>

        <SectionLabel>TRAVEL</SectionLabel>
        <SectionCard>
          {travelRows.map((item) => (
            <SettingsItem key={item.key} item={item} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} />
          ))}
        </SectionCard>

        <SectionLabel>SAFETY</SectionLabel>
        <SectionCard>
          {safetyRows.map((item) => (
            <SettingsItem key={item.key} item={item} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} />
          ))}
        </SectionCard>

        <SectionLabel>APP</SectionLabel>
        <SectionCard>
          {appRows.map((item) => (
            <SettingsItem key={item.key} item={item} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((value) => !value)} />
          ))}
        </SectionCard>

        <TouchableOpacity activeOpacity={0.92} style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Ionicons name="log-out-outline" size={18} color="#E45858" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>Aventaro v1.0.0 · Made with love for wanderers</Text>
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
    paddingBottom: 32,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
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
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 8,
  },
  premiumIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumText: {
    flex: 1,
    gap: 3,
  },
  premiumTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  premiumSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
  },
  sectionLabel: {
    marginTop: 4,
    marginLeft: 4,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#7C739C',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EEE6FF',
    overflow: 'hidden',
  },
  settingsItem: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F4EEFF',
  },
  rowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F4EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 17,
    color: COLORS.TEXT_PRIMARY,
  },
  signOutButton: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#F2A7A7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E45858',
  },
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginTop: 4,
  },
});
