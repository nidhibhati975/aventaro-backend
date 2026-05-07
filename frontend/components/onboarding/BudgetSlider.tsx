import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS } from '../../theme/colors';

interface BudgetSliderProps {
  minValue: number;
  maxValue: number;
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  currency?: string;
}

const BUDGET_PRESETS = [
  { label: '$500', value: 500 },
  { label: '$1K', value: 1000 },
  { label: '$2K', value: 2000 },
  { label: '$5K', value: 5000 },
  { label: '$10K+', value: 10000 },
];

export default function BudgetSlider({
  minValue,
  maxValue,
  min,
  max,
  onChange,
  currency = '$',
}: BudgetSliderProps) {
  const [selectedMin, setSelectedMin] = useState(minValue);
  const [selectedMax, setSelectedMax] = useState(maxValue);

  const handlePresetPress = (presetValue: number) => {
    if (presetValue === 10000) {
      // $10K+ means no upper limit
      onChange(selectedMin, 50000);
      setSelectedMax(50000);
    } else {
      onChange(selectedMin, presetValue);
      setSelectedMax(presetValue);
    }
  };

  const formatBudget = (value: number) => {
    if (value >= 50000) return '$10K+';
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.displayContainer}>
        <View style={styles.valueBox}>
          <Text style={styles.valueLabel}>Min</Text>
          <Text style={styles.valueText}>{formatBudget(selectedMin)}</Text>
        </View>
        <View style={styles.divider}>
          <Text style={styles.dividerText}>—</Text>
        </View>
        <View style={styles.valueBox}>
          <Text style={styles.valueLabel}>Max</Text>
          <Text style={styles.valueText}>{formatBudget(selectedMax)}</Text>
        </View>
      </View>

      <View style={styles.presetsContainer}>
        <Text style={styles.presetsLabel}>Quick select:</Text>
        <View style={styles.presetsRow}>
          {BUDGET_PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.value}
              style={[
                styles.presetButton,
                selectedMax === preset.value && styles.presetButtonSelected,
              ]}
              onPress={() => handlePresetPress(preset.value)}
            >
              <Text
                style={[
                  styles.presetText,
                  selectedMax === preset.value && styles.presetTextSelected,
                ]}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.rangeContainer}>
        <Text style={styles.rangeLabel}>
          Range: {formatBudget(min)} - {formatBudget(max)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  displayContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  valueBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.BORDER,
    minWidth: 100,
  },
  valueLabel: {
    fontSize: 12,
    color: COLORS.TEXT_MUTED,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  valueText: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  divider: {
    paddingHorizontal: 16,
  },
  dividerText: {
    fontSize: 24,
    color: COLORS.TEXT_MUTED,
  },
  presetsContainer: {
    marginBottom: 20,
  },
  presetsLabel: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    marginBottom: 12,
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  presetButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  presetButtonSelected: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    borderColor: COLORS.PRIMARY_PURPLE,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  presetTextSelected: {
    color: '#fff',
  },
  rangeContainer: {
    alignItems: 'center',
  },
  rangeLabel: {
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
  },
});