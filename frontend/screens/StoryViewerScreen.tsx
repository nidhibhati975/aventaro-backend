import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Video from 'react-native-video';

import StatusView from '../components/StatusView';
import { useAppRuntime } from '../contexts/AppRuntimeContext';
import { errorLogger } from '../services/errorLogger';
import { getSafeMediaUrl } from '../services/media';
import { safeParseNumber, safeParseString } from '../services/navigationSafety';
import { markStoryViewed } from '../services/socialService';
import { getUserDisplayName, type StoryGroup } from '../services/types';
import { COLORS } from '../theme/colors';

function timeAgo(value: string | null | undefined) {
  if (!value) {
    return 'now';
  }
  try {
    const diffMs = Date.now() - Date.parse(value);
    const diffHours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
    if (diffHours < 24) {
      return `${diffHours}h`;
    }
    return `${Math.floor(diffHours / 24)}d`;
  } catch {
    return 'now';
  }
}

export default function StoryViewerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { isForeground } = useAppRuntime();
  const initialGroups = Array.isArray(route.params?.groups) ? (route.params?.groups as StoryGroup[]) : [];
  const initialGroupIndex = Math.max(0, safeParseNumber(route.params?.initialGroupIndex, 0));
  const [groups, setGroups] = useState<StoryGroup[]>(initialGroups);
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  const currentGroup = groups?.[groupIndex];
  const currentStory = currentGroup?.stories?.[storyIndex];
  const storyMediaUrl = getSafeMediaUrl(currentStory?.media_url);
  const canAutoProgress = isFocused && isForeground && !mediaError && Boolean(storyMediaUrl);

  useEffect(() => {
    setMediaError(storyMediaUrl ? null : 'Story media unavailable');
  }, [currentStory?.id, storyMediaUrl]);

  const goNext = useCallback(() => {
    try {
      if (!currentGroup?.stories || currentGroup.stories.length === 0) {
        navigation.goBack?.();
        return;
      }

      if (storyIndex < currentGroup.stories.length - 1) {
        setMediaError(null);
        setStoryIndex((value) => value + 1);
        return;
      }

      if (groupIndex < groups.length - 1) {
        setMediaError(null);
        setGroupIndex((value) => value + 1);
        setStoryIndex(0);
        return;
      }

      navigation.goBack?.();
    } catch (error) {
      errorLogger.logError(error, { source: 'StoryViewerScreen', context: { action: 'goNext' } });
      navigation.goBack?.();
    }
  }, [currentGroup, groupIndex, navigation, groups.length, storyIndex]);

  const goPrevious = useCallback(() => {
    try {
      setMediaError(null);
      
      if (storyIndex > 0) {
        setStoryIndex((value) => value - 1);
        return;
      }

      if (groupIndex > 0) {
        const previousGroupIndex = groupIndex - 1;
        setGroupIndex(previousGroupIndex);
        const prevStories = groups?.[previousGroupIndex]?.stories || [];
        setStoryIndex(Math.max(0, prevStories.length - 1));
        return;
      }

      navigation.goBack?.();
    } catch (error) {
      errorLogger.logError(error, { source: 'StoryViewerScreen', context: { action: 'goPrevious' } });
      navigation.goBack?.();
    }
  }, [groupIndex, groups, navigation, storyIndex]);

  useEffect(() => {
    if (!currentStory?.id || !canAutoProgress) {
      return;
    }

    progress.setValue(0);

    (async () => {
      try {
        const updated = await markStoryViewed(currentStory.id);
        if (updated?.id) {
          setGroups((previous) =>
            (previous || []).map((group) =>
              group?.user_id !== currentGroup?.user_id
                ? group
                : {
                    ...group,
                    has_unseen: (group.stories || []).some((story) =>
                      story?.id === updated.id ? false : !story?.is_seen
                    ),
                    stories: (group.stories || []).map((story) =>
                      story?.id === updated.id ? { ...story, is_seen: true, viewed_by_current_user: true } : story
                    ),
                  }
            )
          );
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'StoryViewerScreen', context: { action: 'markStoryViewed' } });
      }
    })();

    const duration = currentStory?.media_type === 'video' ? 8000 : 5000;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) {
        goNext();
      }
    });

    return () => {
      try {
        animation.stop();
      } catch {
        // Safe to ignore
      }
    };
  }, [canAutoProgress, currentGroup?.user_id, currentStory?.id, goNext, progress]);

  const progressWidths = useMemo(
    () =>
      (currentGroup?.stories || []).map((story, index) => {
        if (index < storyIndex) {
          return 1;
        }
        if (index > storyIndex) {
          return 0;
        }
        return progress;
      }),
    [currentGroup?.stories, progress, storyIndex]
  );

  if (!currentStory?.id || !currentGroup) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusView
          type="error"
          title="Stories unavailable"
          message="There are no active stories to display right now."
          onRetry={() => navigation.goBack?.()}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {currentStory?.media_type === 'video' ? (
        storyMediaUrl ? (
          <Video
            source={{ uri: storyMediaUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            paused={!canAutoProgress}
            repeat={false}
            onEnd={goNext}
            onError={(error) => {
              setMediaError('Unable to load story');
              errorLogger.logRenderError(error, 'StoryViewerScreen.Video');
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.mediaFallback]} />
        )
      ) : (
        storyMediaUrl ? (
          <ImageBackground
            source={{ uri: storyMediaUrl }}
            style={StyleSheet.absoluteFill}
            onError={() => {
              setMediaError('Unable to load story');
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.mediaFallback]} />
        )
      )}

      <LinearGradient colors={['rgba(16,12,34,0.45)', 'rgba(16,12,34,0.05)', 'rgba(16,12,34,0.72)']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.progressRow}>
          {progressWidths.map((value, index) => (
            <View key={`${currentGroup.user_id}_${index}`} style={styles.progressTrack}>
              {typeof value === 'number' ? (
                <View style={[styles.progressFill, { flex: value }]} />
              ) : (
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: value.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              )}
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <View style={styles.userMeta}>
            <Text style={styles.userName}>{getUserDisplayName(currentGroup.user)}</Text>
            <Text style={styles.userTime}>{timeAgo(currentStory.created_at)}</Text>
          </View>
          <Pressable style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={24} color={COLORS.WHITE} />
          </Pressable>
        </View>

        <View style={styles.touchLayer}>
          <Pressable style={styles.touchZone} onPress={goPrevious} />
          <Pressable style={styles.touchZone} onPress={goNext} />
        </View>
        {mediaError ? (
          <View style={styles.mediaError}>
            <Text style={styles.mediaErrorText}>{mediaError}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05030A',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 14,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: COLORS.WHITE,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
  },
  userMeta: {
    gap: 2,
  },
  userName: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  userTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  touchLayer: {
    flex: 1,
    flexDirection: 'row',
  },
  touchZone: {
    flex: 1,
  },
  mediaError: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    alignItems: 'center',
  },
  mediaFallback: {
    backgroundColor: '#120C2A',
  },
  mediaErrorText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.WHITE,
  },
});
