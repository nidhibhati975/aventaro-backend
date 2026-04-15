import React, { memo } from 'react';
import {
  FlatList,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { getSafeImageSource } from '../../services/media';
import { COLORS } from '../../theme/colors';

export interface BookingCardItem {
  id: string;
  category: 'Hotels' | 'Flights' | 'Packages';
  title: string;
  location: string;
  priceLabel: string;
  socialLabel: string;
  mediaUrl?: string | null;
  onPress: () => void;
}

function BookingRail({ items }: { items: BookingCardItem[] }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item }) => {
        const mediaSource = getSafeImageSource(item.mediaUrl);
        const content = (
          <LinearGradient colors={['rgba(18,14,44,0.05)', 'rgba(18,14,44,0.8)']} style={styles.overlay}>
            <View style={styles.topRow}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{item.category}</Text>
              </View>
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color={COLORS.GOLD_DEEP} />
                <Text style={styles.ratingText}>{item.socialLabel}</Text>
              </View>
            </View>
            <View style={styles.bottomWrap}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.location}</Text>
              <View style={styles.bottomRow}>
                <Text style={styles.price}>{item.priceLabel}</Text>
                <View style={styles.cta}>
                  <Text style={styles.ctaText}>Book Now</Text>
                </View>
              </View>
            </View>
          </LinearGradient>
        );

        return (
          <TouchableOpacity activeOpacity={0.9} style={styles.cardWrap} onPress={item.onPress}>
            {mediaSource ? (
              <ImageBackground
                source={mediaSource}
                style={styles.card}
                imageStyle={styles.cardImage}
              >
                {content}
              </ImageBackground>
            ) : (
              <View style={styles.card}>
                {content}
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

export default memo(BookingRail);

const styles = StyleSheet.create({
  listContent: {
    paddingRight: 8,
    gap: 14,
  },
  cardWrap: {
    width: 252,
  },
  card: {
    height: 188,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  cardImage: {
    borderRadius: 24,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  categoryBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.WHITE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.GOLD_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.GOLD_DEEP,
  },
  bottomWrap: {
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  meta: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.84)',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.WHITE,
  },
  cta: {
    borderRadius: 999,
    backgroundColor: COLORS.WHITE,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.PRIMARY_PURPLE,
  },
});
