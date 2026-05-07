import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../../theme/colors';

interface ProgressDotsProps {
  total: number;
  current: number;
  dotSize?: number;
  activeColor?: string;
  inactiveColor?: string;
}

export default function ProgressDots({
  total,
  current,
  dotSize = 8,
  activeColor = COLORS.PRIMARY_PURPLE,
  inactiveColor = COLORS.BORDER,
}: ProgressDotsProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: total }, (_, index) => {
        const isActive = index <= current;
        return (
          <View
            key={index}
            style={[
              styles.dot,
              {
                width: dotSize,
                height: dotSize,
                backgroundColor: isActive ? activeColor : inactiveColor,
                opacity: isActive ? 1 : 0.4,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    borderRadius: 100,
  },
});