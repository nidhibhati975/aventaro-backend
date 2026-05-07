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

const TRAVEL_STYLES = [
  {
    id: 'adventure_seeker',
    title: 'Adventure Seeker',
    emoji: '🧗',
    description: 'Thrill-seeking, outdoor activities, challenging trails',
    color: '#FF6B6B',
  },
  {
    id: 'luxury_traveler',
    title: 'Luxury Traveler',
    emoji: '💎',
    description: 'Premium experiences, fine dining, exclusive access',
    color: '#9B59B6',
  },
  {
    id: 'budget_backpacker',
    title: 'Budget Backpacker',
    emoji: '🎒',
    description: 'Hostels, local food, off-the-beaten-path',
    color: '#27AE60',
  },
  {
    id: 'cultural_explorer',
    title: 'Cultural Explorer',
    emoji: '🏛️',
    description: 'Museums, history, local traditions, authentic experiences',
    color: '#3498DB',
  },
  {
    id: 'relaxation_seeker',
    title: 'Relaxation Seeker',
    emoji: '🏖️',
    description: 'Beach resorts, spa, slow travel, wellness',
    color: '#F39C12',
  },
  {
    id: 'foodie',
    title: 'Foodie',
    emoji: '🍜',
    description: 'Culinary adventures, street food, cooking classes',
    color: '#E74C3C',
  },
  {
    id: 'digital_nomad',
    title: 'Digital Nomad',
    emoji: '💻',
    description: 'Wi-Fi focused, co-working, long-term stays',
    color: '#1ABC9C',
  },
  {
    id: 'group_traveler',
    title: 'Group Traveler',
    emoji: '👥',
    description: 'Social trips, meeting new people, group activities',
    color: '#E91E63',
  },
];

export default function OnboardingTravelStyleScreen() {
  const navigation = useNavigation<any>();
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  const handleContinue = () => {
    if (selectedStyle) {
      // TODO: Save to user profile via API
      console.log('Selected travel style:', selectedStyle);
      navigation.navigate('OnboardingBudget');
    }
  };

  const renderStyle = ({ item }: { item: typeof TRAVEL_STYLES[0] }) => {
    const isSelected = selectedStyle === item.id;
    return (
      <TouchableOpacity
        style={[
          styles.styleCard,
          isSelected && { borderColor: item.color, borderWidth: 3 },
        ]}
        onPress={() => setSelectedStyle(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.emojiContainer, { backgroundColor: item.color + '20' }]}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.cardTitle, isSelected && { color: item.color }]}>
            {item.title}
          </Text>
          <Text style={styles.description}>{item.description}</Text>
        </View>
        {isSelected && (
          <View style={[styles.checkmark, { backgroundColor: item.color }]}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>How do you like to travel?</Text>
        <Text style={styles.subtitle}>
          This helps us find the right travel buddies for you
        </Text>
      </View>

      <FlatList
        data={TRAVEL_STYLES}
        renderItem={renderStyle}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !selectedStyle && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selectedStyle}
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
  headerTitle: {
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
  list: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  styleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  emoji: {
    fontSize: 28,
  },
  textContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
