import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { COLORS } from '../../theme/colors';

interface TravelStyleOptionProps {
  id: string;
  label: string;
  icon: string;
  description: string;
  isSelected: boolean;
  onPress: () => void;
}

export default function TravelStyleOption({
  id,
  label,
  icon,
  description,
  isSelected,
  onPress,
}: TravelStyleOptionProps) {
  return (
    <TouchableOpacity
      style={[
        styles.option,
        isSelected && styles.optionSelected,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, isSelected && styles.iconContainerSelected]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.label, isSelected && styles.labelSelected]}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {isSelected && (
        <View style={styles.checkmark}>
          <Text style={styles.checkmarkText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1.5,
    borderColor: COLORS.BORDER,
    marginBottom: 12,
  },
  optionSelected: {
    borderColor: COLORS.PRIMARY_PURPLE,
    backgroundColor: COLORS.PRIMARY_PURPLE + '10',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.BACKGROUND,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  iconContainerSelected: {
    backgroundColor: COLORS.PRIMARY_PURPLE + '20',
  },
  icon: {
    fontSize: 24,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 2,
  },
  labelSelected: {
    color: COLORS.PRIMARY_PURPLE,
  },
  description: {
    fontSize: 13,
    color: COLORS.TEXT_MUTED,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});