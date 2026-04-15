import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { fetchPeopleDiscover, fetchTripDiscover } from '../services/discoverService';
import { errorLogger } from '../services/errorLogger';
import { COLORS } from '../theme/colors';

const MARKER_LAYOUT = [
  { top: '22%', left: '18%' },
  { top: '21%', left: '52%' },
  { top: '18%', left: '80%' },
  { top: '28%', left: '64%' },
  { top: '58%', left: '80%' },
  { top: '63%', left: '71%' },
];

function iconForDestination(label: string) {
  const value = label.toLowerCase();
  if (value.includes('tokyo') || value.includes('paris')) {
    return 'business-outline';
  }
  if (value.includes('santorini')) {
    return 'boat-outline';
  }
  if (value.includes('maldives') || value.includes('bali')) {
    return 'leaf-outline';
  }
  return 'location-outline';
}

export default function TravelerMapScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState<Array<{ name: string; count: number }>>([]);
  const [travelerCount, setTravelerCount] = useState(0);

  const loadMap = useCallback(async () => {
    setLoading(true);
    try {
      const [people, trips] = await Promise.all([fetchPeopleDiscover(24), fetchTripDiscover(24)]);
      const counts = new Map<string, number>();

      (people || []).forEach((person) => {
        const location = person?.profile?.location?.trim();
        if (!location) {
          return;
        }
        counts.set(location, (counts.get(location) || 0) + 1);
      });

      (trips || []).forEach((trip) => {
        const location = trip?.location?.trim();
        if (!location) {
          return;
        }
        counts.set(location, (counts.get(location) || 0) + Math.max(1, trip.approved_member_count || 1));
      });

      const nextDestinations = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);

      setTravelerCount(
        (people || []).length +
          (trips || []).reduce((sum, trip) => sum + (trip.approved_member_count || 0), 0)
      );
      setDestinations(nextDestinations);
    } catch (error) {
      errorLogger.logError(error, { source: 'TravelerMapScreen', context: { action: 'loadMap' } });
      setDestinations([]);
      setTravelerCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadMap();
    }, [loadMap])
  );

  const markers = useMemo(
    () =>
      destinations.map((destination, index) => ({
        ...destination,
        ...MARKER_LAYOUT[index % MARKER_LAYOUT.length],
      })),
    [destinations]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Traveler Map</Text>
        <TouchableOpacity style={styles.headerButton}>
          <Ionicons name="options-outline" size={21} color={COLORS.TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.mapArea}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
        ) : (
          <>
            {markers.map((marker) => (
              <View
                key={marker.name}
                style={[
                  styles.mapMarker,
                  {
                    top: marker.top as never,
                    left: marker.left as never,
                  },
                ]}
              >
                <Ionicons name={iconForDestination(marker.name)} size={22} color={COLORS.WHITE} />
              </View>
            ))}

            <View style={styles.mapCenterCopy}>
              <Ionicons name="map-outline" size={34} color="#E9E1FF" />
              <Text style={styles.centerTitle}>Interactive Map</Text>
              <Text style={styles.centerSubtitle}>{travelerCount.toLocaleString()} travelers worldwide</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.bottomSheet}>
        <Text style={styles.bottomTitle}>Live Destinations</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.destinationRow}>
          {destinations.map((destination) => (
            <View key={destination.name} style={styles.destinationChip}>
              <Ionicons name={iconForDestination(destination.name)} size={18} color={COLORS.TEXT_SECONDARY} />
              <Text style={styles.destinationName}>{destination.name}</Text>
              <View style={styles.destinationCountPill}>
                <Text style={styles.destinationCountText}>
                  {destination.count >= 1000 ? `${(destination.count / 1000).toFixed(1)}k` : destination.count}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  mapArea: {
    flex: 1,
    backgroundColor: '#F7F4FF',
    position: 'relative',
    overflow: 'hidden',
  },
  mapMarker: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.PRIMARY_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.SHADOW,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  mapCenterCopy: {
    position: 'absolute',
    top: '44%',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  centerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  centerSubtitle: {
    fontSize: 14,
    color: COLORS.TEXT_SECONDARY,
  },
  bottomSheet: {
    borderTopWidth: 1,
    borderTopColor: '#F0ECFA',
    paddingTop: 16,
    paddingBottom: 18,
  },
  bottomTitle: {
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
  },
  destinationRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 10,
  },
  destinationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ECE4FF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  destinationName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
  destinationCountPill: {
    borderRadius: 999,
    backgroundColor: '#F4EEFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  destinationCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.PRIMARY_PURPLE,
  },
});
