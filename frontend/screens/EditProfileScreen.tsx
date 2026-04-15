import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../contexts/AuthContext';
import { extractErrorMessage } from '../services/api';
import { fetchMyProfile, updateMyProfile } from '../services/profileService';
import { COLORS } from '../theme/colors';

export default function EditProfileScreen() {
  const navigation = useNavigation<any>();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const profile = await fetchMyProfile();
        setName(profile.profile?.name || '');
        setAge(profile.profile?.age ? String(profile.profile.age) : '');
        setBio(profile.profile?.bio || '');
      } catch (error) {
        Alert.alert('Unable to load profile', extractErrorMessage(error, 'Please try again.'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateMyProfile({
        name: name.trim() || undefined,
        age: age.trim() ? Number(age) : null,
        bio: bio.trim() || undefined,
      });
      await refreshUser();
      Alert.alert('Profile updated', 'Your profile changes have been saved.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Unable to save', extractErrorMessage(error, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={COLORS.TEXT_MUTED} />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Age</Text>
            <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="number-pad" placeholder="28" placeholderTextColor={COLORS.TEXT_MUTED} />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell fellow travelers a bit about yourself"
              placeholderTextColor={COLORS.TEXT_MUTED}
              multiline
            />
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={() => void handleSave()} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={COLORS.WHITE} /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
          </TouchableOpacity>
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
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  loader: {
    marginTop: 40,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    paddingHorizontal: 14,
    color: COLORS.TEXT_PRIMARY,
  },
  textArea: {
    minHeight: 120,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '700',
  },
});
