import React, { useState, useEffect } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Geolocation from '@react-native-community/geolocation';
import { COLORS } from '../../theme/colors';

const { width } = Dimensions.get('window');

const POPULAR_DESTINATIONS = [
  { id: '1', name: 'Bali', country: 'Indonesia', emoji: '🌴' },
  { id: '2', name: 'Paris', country: 'France', emoji: '🗼' },
  { id: '3', name: 'Tokyo', country: 'Japan', emoji: '🗾' },
  { id: '4', name: 'New York', country: 'USA', emoji: '🗽' },
  { id: '5', name: 'Barcelona', country: 'Spain', emoji: '🏖️' },
  { id: '6', name: 'London', country: 'UK', emoji: '🎡' },
  { id: '7', name: 'Sydney', country: 'Australia', emoji: '🦘' },
  { id: '8', name: 'Dubai', country: 'UAE', emoji: '🏙️' },
  { id: '9', name: 'Rome', country: 'Italy', emoji: '🏛️' },
  { id: '10', name: 'Bangkok', country: 'Thailand', emoji: '🛕' },
  { id: '11', name: 'Amsterdam', country: 'Netherlands', emoji: '🚲' },
  { id: '12', name: 'Singapore', country: 'Singapore', emoji: '🌆' },
];

export default function OnboardingLocationScreen() {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentLocation, setCurrentLocation] = useState<string | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);

  useEffect(() => {
    // Try to get current location
    Geolocation.getCurrentPosition(
      (position) => {
        // In production, reverse geocode to get city name
        setCurrentLocation('Current Location');
      },
      (error) => {
        console.log('Location error:', error);
      },
      { enableHighAccuracy: false, timeout: 15000 }
    );
  }, []);

  const handleContinue = () => {
    // TODO: Save to user profile via API
    console.log('Selected destination:', selectedDestination);
    navigation.navigate('OnboardingComplete');
  };

  const filteredDestinations = searchQuery
    ? POPULAR_DESTINATIONS.filter(
        (d) =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.country.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : POPULAR_DESTINATIONS;

  const renderDestination = ({ item }: { item: typeof POPULAR_DESTINATIONS[0] }) => {
    const isSelected = selectedDestination === item.name;
    return (
      <TouchableOpacity
        style={[styles.destinationCard, isSelected && styles.destinationCardSelected]}
        onPress={() => setSelectedDestination(item.name)}
        activeOpacity={0.7}
      >
        <Text style={styles.destinationEmoji}>{item.emoji}</Text>
        <View style={styles.destinationInfo}>
          <Text style={[styles.destinationName, isSelected && styles.destinationNameSelected]}>
            {item.name}
          </Text>
          <Text style={styles.destinationCountry}>{item.country}</Text>
        </View>
        {isSelected && (
          <View style={styles.checkmark}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Where do you want to go?</Text>
        <Text style={styles.subtitle}>
          Select your dream destination or enable location for personalized recommendations
        </Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search destinations..."
            placeholderTextColor={COLORS.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        
        {/* Current Location Button */}
        {currentLocation && (
          <TouchableOpacity style={styles.locationButton} activeOpacity={0.7}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationText}>Use current location</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Destinations List */}
      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Popular Destinations</Text>
        <FlatList
          data={filteredDestinations}
          renderItem={renderDestination}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !selectedDestination && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selectedDestination}
          activeOpacity={0.8}
        >
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  searchContainer: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  locationIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  locationText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  destinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  destinationCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  destinationEmoji: {
    fontSize: 28,
    marginRight: 14,
  },
  destinationInfo: {
    flex: 1,
  },
  destinationName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  destinationNameSelected: {
    color: COLORS.primary,
  },
  destinationCountry: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  continueButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  continueText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});