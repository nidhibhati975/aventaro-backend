import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getSafeImageSource } from '../../services/media';
import { COLORS } from '../../theme/colors';

export interface BookingItemData {
  id: string;
  service_type: string;
  name: string;
  description: string;
  location?: string;
  origin?: string;
  destination?: string;
  price: number;
  currency: string;
  original_price?: number;
  images: string[];
  rating?: number;
  reviews_count: number;
  amenities: string[];
  departure_time?: string;
  arrival_time?: string;
  duration?: string;
}

interface Props {
  item: BookingItemData;
  onPress: (item: BookingItemData) => void;
}

export default function BookingItemCard({ item, onPress }: Props) {
  const hasDiscount = item.original_price && item.original_price > item.price;
  const discountPercent = hasDiscount
    ? Math.round(((item.original_price! - item.price) / item.original_price!) * 100)
    : 0;
  const imageSource = getSafeImageSource(item.images?.[0]);

  const renderServiceSpecific = () => {
    switch (item.service_type) {
      case 'flight':
      case 'bus':
      case 'train':
        return (
          <View style={styles.transportInfo}>
            <View style={styles.routeContainer}>
              <Text style={styles.routeText}>{item.origin}</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.TEXT_SECONDARY} />
              <Text style={styles.routeText}>{item.destination}</Text>
            </View>
            {item.departure_time && (
              <Text style={styles.timeText}>
                {item.departure_time} | {item.duration}
              </Text>
            )}
          </View>
        );
      case 'cab':
        return (
          <View style={styles.transportInfo}>
            <View style={styles.routeContainer}>
              <Text style={styles.routeText}>{item.origin}</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.TEXT_SECONDARY} />
              <Text style={styles.routeText}>{item.destination}</Text>
            </View>
            {item.duration && (
              <Text style={styles.timeText}>{item.duration} estimated</Text>
            )}
          </View>
        );
      default:
        return (
          item.location && (
            <View style={styles.locationContainer}>
              <Ionicons name="location" size={14} color={COLORS.TEXT_SECONDARY} />
              <Text style={styles.locationText}>{item.location}</Text>
            </View>
          )
        );
    }
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(item)}
      activeOpacity={0.8}
    >
      <View style={styles.imageContainer}>
        {imageSource ? (
          <Image source={imageSource} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.placeholderImage]}>
            <Ionicons name="image-outline" size={32} color={COLORS.TEXT_MUTED} />
          </View>
        )}
        {hasDiscount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>{discountPercent}% OFF</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        
        {renderServiceSpecific()}

        {item.rating && (
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={14} color={COLORS.PRIMARY_PURPLE} />
            <Text style={styles.ratingText}>{item.rating}</Text>
            <Text style={styles.reviewsText}>({item.reviews_count} reviews)</Text>
          </View>
        )}

        <View style={styles.priceContainer}>
          <Text style={styles.price}>
            {item.currency} {item.price.toLocaleString()}
          </Text>
          {hasDiscount && (
            <Text style={styles.originalPrice}>
              {item.currency} {item.original_price?.toLocaleString()}
            </Text>
          )}
        </View>

        {item.amenities && item.amenities.length > 0 && (
          <View style={styles.amenitiesContainer}>
            {item.amenities.slice(0, 3).map((amenity, index) => (
              <View key={index} style={styles.amenityTag}>
                <Text style={styles.amenityText}>{amenity}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 160,
    backgroundColor: COLORS.SURFACE_ELEVATED,
  },
  placeholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  discountBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: COLORS.DANGER,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  discountText: {
    color: COLORS.WHITE,
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    padding: 16,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationText: {
    fontSize: 13,
    color: COLORS.TEXT_SECONDARY,
    marginLeft: 4,
  },
  transportInfo: {
    marginBottom: 8,
  },
  routeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT_SECONDARY,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginLeft: 4,
  },
  reviewsText: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    marginLeft: 4,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
  originalPrice: {
    fontSize: 14,
    color: COLORS.TEXT_MUTED,
    textDecorationLine: 'line-through',
  },
  amenitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  amenityTag: {
    backgroundColor: COLORS.SURFACE_MUTED,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  amenityText: {
    fontSize: 11,
    color: COLORS.TEXT_SECONDARY,
  },
});


