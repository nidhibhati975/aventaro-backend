import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { COLORS } from '../../theme/colors';

type DetailItem = {
  label: string;
  value: string;
};

type DetailAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

interface SettingsDetailScreenProps {
  title: string;
  icon: string;
  headline: string;
  description: string;
  statusLabel?: string;
  items?: DetailItem[];
  actions?: DetailAction[];
}

export default function SettingsDetailScreen({
  title,
  icon,
  headline,
  description,
  statusLabel,
  items = [],
  actions = [],
}: SettingsDetailScreenProps) {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name={icon as any} size={24} color={COLORS.PRIMARY_PURPLE} />
          </View>
          {statusLabel ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>{statusLabel}</Text>
            </View>
          ) : null}
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>

        {items.length ? (
          <View style={styles.sectionCard}>
            {items.map((item, index) => (
              <View
                key={`${item.label}_${index}`}
                style={[styles.detailRow, index < items.length - 1 && styles.detailRowBorder]}
              >
                <Text style={styles.detailLabel}>{item.label}</Text>
                <Text style={styles.detailValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {actions.length ? (
          <View style={styles.actionColumn}>
            {actions.map((action) => (
              <TouchableOpacity
                key={action.label}
                activeOpacity={0.92}
                style={[
                  styles.actionButton,
                  action.variant === 'secondary' ? styles.secondaryActionButton : styles.primaryActionButton,
                ]}
                onPress={action.onPress}
              >
                <Text
                  style={[
                    styles.actionText,
                    action.variant === 'secondary' ? styles.secondaryActionText : styles.primaryActionText,
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
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
  content: {
    padding: 16,
    gap: 14,
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    padding: 18,
    gap: 12,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.SURFACE_MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#F4EEFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  headline: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.TEXT_SECONDARY,
  },
  sectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    overflow: 'hidden',
  },
  detailRow: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 6,
  },
  detailRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1EBFF',
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  detailValue: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.TEXT_SECONDARY,
  },
  actionColumn: {
    gap: 10,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryActionButton: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
  },
  secondaryActionButton: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  primaryActionText: {
    color: COLORS.WHITE,
  },
  secondaryActionText: {
    color: COLORS.TEXT_PRIMARY,
  },
});
