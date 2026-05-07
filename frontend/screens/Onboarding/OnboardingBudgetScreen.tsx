import React, { useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../../theme/colors';

const { width } = Dimensions.get('window');

const BUDGET_PRESETS = [
  { label: '$500', value: 500, description: 'Budget-friendly' },
  { label: '$1,000', value: 1000, description: 'Economy' },
  { label: '$2,000', value: 2000, description: 'Moderate' },
  { label: '$5,000', value: 5000, description: 'Comfort' },
  { label: '$10,000+', value: 10000, description: 'Luxury' },
];

export default function OnboardingBudgetScreen() {
  const navigation = useNavigation<any>();
  const [budgetMin, setBudgetMin] = useState(500);
  const [budgetMax, setBudgetMax] = useState(2000);

  const handleContinue = () => {
    // TODO: Save to user profile via API
    console.log('Budget range:', budgetMin, '-', budgetMax);
    navigation.navigate('OnboardingLocation');
  };

  const selectPreset = (preset: typeof BUDGET_PRESETS[0]) => {
    setBudgetMin(preset.value);
    setBudgetMax(preset.value * 2);
  };

  const formatCurrency = (value: number) => {
    if (value >= 10000) return '$10,000+';
    return `$${value.toLocaleString()}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>What's your budget?</Text>
        <Text style={styles.subtitle}>
          Set your typical trip budget to find compatible travelers
        </Text>
      </View>

      <View style={styles.content}>
        {/* Budget Display */}
        <View style={styles.budgetDisplay}>
          <View style={styles.budgetItem}>
            <Text style={styles.budgetLabel}>Min</Text>
            <Text style={styles.budgetValue}>{formatCurrency(budgetMin)}</Text>
          </View>
          <View style={styles.budgetDivider}>
            <Text style={styles.budgetDividerText}>—</Text>
          </View>
          <View style={styles.budgetItem}>
            <Text style={styles.budgetLabel}>Max</Text>
            <Text style={styles.budgetValue}>{formatCurrency(budgetMax)}</Text>
          </View>
        </View>

        {/* Slider */}
        <View style={styles.sliderContainer}>
          <Text style={styles.sliderLabel}>Trip Budget (per person)</Text>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderMin}>$0</Text>
            <View style={styles.sliderWrapper}>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={15000}
                value={budgetMin}
                onValueChange={setBudgetMin}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.border}
                thumbTintColor={COLORS.primary}
              />
              <Slider
                style={[styles.slider, styles.sliderMax]}
                minimumValue={0}
                maximumValue={15000}
                value={budgetMax}
                onValueChange={setBudgetMax}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.border}
                thumbTintColor={COLORS.primary}
              />
            </View>
            <Text style={styles.sliderMaxLabel}>$15k+</Text>
          </View>
        </View>

        {/* Presets */}
        <View style={styles.presetsContainer}>
          <Text style={styles.presetsLabel}>Quick Select</Text>
          <View style={styles.presets}>
            {BUDGET_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.label}
                style={[
                  styles.presetChip,
                  budgetMin === preset.value && styles.presetChipSelected,
                ]}
                onPress={() => selectPreset(preset)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.presetLabel,
                    budgetMin === preset.value && styles.presetLabelSelected,
                  ]}
                >
                  {preset.label}
                </Text>
                <Text style={styles.presetDescription}>{preset.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  budgetDisplay: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  budgetItem: {
    alignItems: 'center',
    flex: 1,
  },
  budgetLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  budgetValue: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.primary,
  },
  budgetDivider: {
    paddingHorizontal: 20,
  },
  budgetDividerText: {
    fontSize: 24,
    color: COLORS.textSecondary,
  },
  sliderContainer: {
    marginBottom: 24,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderMin: {
    fontSize: 12,
    color: COLORS.textSecondary,
    width: 30,
  },
  sliderWrapper: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderMax: {
    position: 'absolute',
    top: 0,
  },
  sliderMaxLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    width: 40,
    textAlign: 'right',
  },
  presetsContainer: {
    flex: 1,
  },
  presetsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  presetChip: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    margin: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    minWidth: (width - 48 - 24) / 3 - 12,
  },
  presetChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  presetLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  presetLabelSelected: {
    color: COLORS.primary,
  },
  presetDescription: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
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
  continueText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});