import React, { useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../../theme/colors';

const { width } = Dimensions.get('window');

const INTERESTS = [
  { id: 'beach', label: '🏖️ Beach', emoji: '🏖️' },
  { id: 'mountains', label: '⛰️ Mountains', emoji: '⛰️' },
  { id: 'adventure', label: '🧗 Adventure', emoji: '🧗' },
  { id: 'food', label: '🍜 Food & Dining', emoji: '🍜' },
  { id: 'culture', label: '🏛️ Culture', emoji: '🏛️' },
  { id: 'nightlife', label: '🌙 Nightlife', emoji: '🌙' },
  { id: 'nature', label: '🌿 Nature', emoji: '🌿' },
  { id: 'photography', label: '📸 Photography', emoji: '📸' },
  { id: 'shopping', label: '🛍️ Shopping', emoji: '🛍️' },
  { id: 'wellness', label: '🧘 Wellness', emoji: '🧘' },
  { id: 'sports', label: '⚽ Sports', emoji: '⚽' },
  { id: 'music', label: '🎵 Music', emoji: '🎵' },
  { id: 'art', label: '🎨 Art', emoji: '🎨' },
  { id: 'history', label: '📜 History', emoji: '📜' },
  { id: 'wildlife', label: '🦁 Wildlife', emoji: '🦁' },
  { id: 'roadtrip', label: '🚗 Road Trip', emoji: '🚗' },
  { id: 'cruise', label: '🚢 Cruise', emoji: '🚢' },
  { id: 'skiing', label: '⛷️ Skiing', emoji: '⛷️' },
  { id: 'hiking', label: '🥾 Hiking', emoji: '🥾' },
  { id: 'local', label: '🏘️ Local Experience', emoji: '🏘️' },
  { id: 'festivals', label: '🎉 Festivals', emoji: '🎉' },
  { id: 'wine', label: '🍷 Wine & Spirits', emoji: '🍷' },
  { id: 'volunteering', label: '🤝 Volunteering', emoji: '🤝' },
  { id: 'luxury', label: '💎 Luxury', emoji: '💎' },
];

export default function OnboardingInterestsScreen() {
  const navigation = useNavigation<any>();
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) =>
      prev.includes(id)
        ? prev.filter((i) => i !== id)
        : [...prev, id]
    );
  };

  const handleContinue = () => {
    // TODO: Save to user profile via API
    console.log('Selected interests:', selectedInterests);
    navigation.navigate('OnboardingTravelStyle');
  };

  const renderInterest = ({ item }: { item: typeof INTERESTS[0] }) => {
    const isSelected = selectedInterests.includes(item.id);
    return (
      <TouchableOpacity
        style={[styles.interestChip, isSelected && styles.interestChipSelected]}
        onPress={() => toggleInterest(item.id)}
        activeOpacity={0.7}
      >
        <Text style={styles.interestEmoji}>{item.emoji}</Text>
        <Text
          style={[
            styles.interestLabel,
            isSelected && styles.interestLabelSelected,
          ]}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>What are you into?</Text>
        <Text style={styles.subtitle}>
          Select at least 3 interests to personalize your experience
        </Text>
      </View>

      <FlatList
        data={INTERESTS}
        renderItem={renderInterest}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        <Text style={styles.counter}>
          {selectedInterests.length} / 3 minimum
        </Text>
        <TouchableOpacity
          style={[
            styles.continueButton,
            selectedInterests.length < 3 && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={selectedInterests.length < 3}
          activeOpacity={0.8}
        >
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  interestChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    margin: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  interestChipSelected: {
    backgroundColor: COLORS.primary + '15',
    borderColor: COLORS.primary,
  },
  interestEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  interestLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  interestLabelSelected: {
    color: COLORS.primary,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  counter: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  continueButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  continueText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});