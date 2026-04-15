import React, { memo } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { getSafeMediaUrl } from '../../services/media';
import { getUserDisplayName, type StoryGroup } from '../../services/types';
import { COLORS } from '../../theme/colors';

interface StoryTrayProps {
  groups: StoryGroup[];
  onOpenGroup: (groupIndex: number) => void;
}

const StoryAvatar = memo(function StoryAvatar({
  group,
  onPress,
}: {
  group: StoryGroup;
  onPress: () => void;
}) {
  const stories = Array.isArray(group?.stories) ? group.stories : [];
  const firstStory = stories[0];
  const cover = firstStory?.media_type === 'image' ? getSafeMediaUrl(firstStory?.media_url) : null;

  return (
    <TouchableOpacity style={styles.storyItem} onPress={onPress} activeOpacity={0.9}>
      {group.has_unseen ? (
        <LinearGradient colors={[COLORS.GOLD, COLORS.SECONDARY_PURPLE, COLORS.PRIMARY_PURPLE]} style={styles.ring}>
          <View style={styles.innerRing}>
            {cover ? <Image source={{ uri: cover }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          </View>
        </LinearGradient>
      ) : (
        <View style={[styles.ring, styles.ringSeen]}>
          <View style={styles.innerRing}>
            {cover ? <Image source={{ uri: cover }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          </View>
        </View>
      )}
      <Text style={styles.storyLabel} numberOfLines={1}>
        {getUserDisplayName(group.user)}
      </Text>
    </TouchableOpacity>
  );
});

function StoryTray({ groups, onOpenGroup }: StoryTrayProps) {
  return (
    <FlatList
      horizontal
      data={groups}
      keyExtractor={(item) => String(item.user_id)}
      contentContainerStyle={styles.listContent}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item, index }) => (
        <StoryAvatar group={item} onPress={() => onOpenGroup(index)} />
      )}
    />
  );
}

export default memo(StoryTray);

const styles = StyleSheet.create({
  listContent: {
    paddingRight: 8,
    gap: 14,
  },
  storyItem: {
    width: 76,
    alignItems: 'center',
    gap: 8,
  },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSeen: {
    backgroundColor: COLORS.BORDER,
  },
  innerRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: COLORS.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarFallback: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  storyLabel: {
    width: '100%',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
});
