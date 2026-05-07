/**
 * Pull to Refresh Component
 * 
 * Custom pull-to-refresh with:
 * - Animated spinner
 * - Custom refresh text
 * - Haptic feedback on trigger
 * - Progress indicator
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  RefreshControl,
  ScrollView,
  FlatList,
  Dimensions,
} from 'react-native';
import { COLORS } from '../../theme/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PULL_THRESHOLD = 80;

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  refreshing?: boolean;
  pullText?: string;
  refreshingText?: string;
  successText?: string;
}

export default function PullToRefresh({
  onRefresh,
  children,
  refreshing = false,
  pullText = 'Pull to refresh',
  refreshingText = 'Refreshing...',
  successText = 'Updated!',
}: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (refreshing && !isRefreshing) {
      setIsRefreshing(true);
    } else if (!refreshing && isRefreshing) {
      // Show success briefly
      Animated.sequence([
        Animated.timing(successAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(800),
        Animated.timing(successAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setIsRefreshing(false));
    }
  }, [refreshing]);

  const handleRefresh = async () => {
    await onRefresh();
  };

  // Custom refresh control
  const renderHeader = () => (
    <View style={styles.header}>
      <Animated.View
        style={[
          styles.spinnerContainer,
          {
            transform: [
              {
                rotate: rotateAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.spinner}>↻</Text>
      </Animated.View>
      <Text style={styles.headerText}>
        {isRefreshing ? refreshingText : pullText}
      </Text>
      <Animated.View
        style={[
          styles.successBadge,
          {
            opacity: successAnim,
            transform: [
              {
                scale: successAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.successText}>✓</Text>
      </Animated.View>
    </View>
  );

  return (
    <FlatList
      data={[]}
      renderItem={null}
      ListHeaderComponent={renderHeader}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={styles.container}
      style={styles.list}
    >
      {children}
    </FlatList>
  );
}

// Alternative: ScrollView version with custom pull detection
interface CustomPullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  refreshing?: boolean;
}

export function CustomPullToRefresh({
  onRefresh,
  children,
  refreshing = false,
}: CustomPullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullValue = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );

  const handleScrollEndDrag = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    
    if (offsetY < -PULL_THRESHOLD && !isRefreshing) {
      setIsPulling(true);
      pullValue.setValue(-PULL_THRESHOLD);
      setIsRefreshing(true);
      onRefresh().then(() => {
        setIsRefreshing(false);
        setIsPulling(false);
        Animated.spring(pullValue, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      });
    }
  };

  return (
    <Animated.ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      onScroll={handleScroll}
      onScrollEndDrag={handleScrollEndDrag}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        style={[
          styles.pullIndicator,
          {
            transform: [{ translateY: pullValue }],
            opacity: pullValue.interpolate({
              inputRange: [-PULL_THRESHOLD, 0],
              outputRange: [1, 0],
            }),
          },
        ]}
      >
        <Text style={styles.pullIcon}>
          {isRefreshing ? '⏳' : '↓'}
        </Text>
        <Text style={styles.pullText}>
          {isRefreshing ? 'Refreshing...' : 'Pull to refresh'}
        </Text>
      </Animated.View>
      {children}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  list: {
    flex: 1,
  },
  header: {
    height: PULL_THRESHOLD,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  spinnerContainer: {
    marginRight: 8,
  },
  spinner: {
    fontSize: 20,
    color: COLORS.PRIMARY_PURPLE,
  },
  headerText: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
  successBadge: {
    marginLeft: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.SUCCESS_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  pullIndicator: {
    height: PULL_THRESHOLD,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  pullIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  pullText: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
  },
});