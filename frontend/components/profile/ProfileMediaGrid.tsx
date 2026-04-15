import React, { memo } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { getSafeImageSource } from '../../services/media';
import type { SocialPost } from '../../services/types';
import { COLORS } from '../../theme/colors';

function ProfileMediaGrid({
  posts,
  onOpenPost,
}: {
  posts: SocialPost[];
  onOpenPost: (post: SocialPost) => void;
}) {
  return (
    <FlatList
      data={posts}
      keyExtractor={(item) => String(item.id)}
      numColumns={3}
      scrollEnabled={false}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => {
        const mediaSource = getSafeImageSource(item.media_url);

        return (
          <TouchableOpacity style={styles.tile} activeOpacity={0.9} onPress={() => onOpenPost(item)}>
            {mediaSource ? (
              <Image source={mediaSource} style={styles.image} />
            ) : (
              <View style={[styles.image, styles.imageFallback]}>
                <Ionicons name="image-outline" size={22} color={COLORS.TEXT_MUTED} />
              </View>
            )}
            {item.media_type === 'video' ? (
              <View style={styles.videoBadge}>
                <Ionicons name="play" size={14} color={COLORS.WHITE} />
              </View>
            ) : null}
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No live posts yet</Text>
          <Text style={styles.emptyText}>Your visual grid will populate automatically from real social posts.</Text>
        </View>
      }
    />
  );
}

export default memo(ProfileMediaGrid);

const styles = StyleSheet.create({
  content: {
    gap: 10,
  },
  row: {
    gap: 10,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    minHeight: 180,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.TEXT_PRIMARY,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
});
