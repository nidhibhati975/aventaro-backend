import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { COLORS } from '../../theme/colors';

interface AiTripPlannerCardProps {
  destination?: string | null;
  budget?: number | null;
}

export default function AiTripPlannerCard({ destination, budget }: AiTripPlannerCardProps) {
  const navigation = useNavigation<any>();
  const roundedBudget = budget ? Math.round(budget) : null;
  const initialPrompt = destination
    ? `Build a complete trip plan for ${destination}${roundedBudget ? ` under $${roundedBudget}` : ''} using my travel history and preferences.`
    : 'Plan my next trip using my travel history, saved destinations, and budget.';

  return (
    <LinearGradient
      colors={['#1D1242', COLORS.PRIMARY_PURPLE, '#A57BFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles-outline" size={22} color={COLORS.WHITE} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Aventaro AI Copilot</Text>
          <Text style={styles.subtitle}>
            Full trip planning with destination suggestions, day-wise plan, and budget split.
          </Text>
        </View>
      </View>

      <View style={styles.signalWrap}>
        <View style={styles.signalChip}>
          <Text style={styles.signalChipText}>{destination || 'Any destination'}</Text>
        </View>
        <View style={styles.signalChip}>
          <Text style={styles.signalChipText}>{budget ? `$${Math.round(budget)}` : 'Budget-aware'}</Text>
        </View>
        <View style={styles.signalChip}>
          <Text style={styles.signalChipText}>Past + active trips</Text>
        </View>
      </View>

      <View style={styles.promptList}>
        <Text style={styles.promptLabel}>It can handle:</Text>
        <Text style={styles.promptItem}>Best destination according to your travel history</Text>
        <Text style={styles.promptItem}>Budget split for stay, food, transport, and activities</Text>
        <Text style={styles.promptItem}>Follow-up changes like cheaper, luxury, family, or different vibe</Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.92}
        style={styles.button}
        onPress={() =>
          navigation.navigate('AventaroAI', {
            seedDestination: destination || undefined,
            seedBudget: roundedBudget || undefined,
            initialPrompt,
          })
        }
      >
        <Text style={styles.buttonText}>Open Aventaro AI</Text>
        <Ionicons name="arrow-forward" size={18} color={COLORS.PRIMARY_PURPLE} />
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.84)',
  },
  signalWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  signalChip: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signalChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
  promptList: {
    gap: 8,
  },
  promptLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.GOLD_SOFT,
    textTransform: 'uppercase',
  },
  promptItem: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.90)',
  },
  button: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
});
