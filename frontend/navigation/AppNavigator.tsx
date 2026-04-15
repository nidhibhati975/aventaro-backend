import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from 'react-native-vector-icons/Ionicons';

import ChatListScreen from '../screens/ChatListScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import FeedScreen from '../screens/FeedScreen';
import MatchesScreen from '../screens/MatchesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TripsScreen from '../screens/TripsScreen';
import { COLORS } from '../theme/colors';

const Tabs = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: COLORS.PRIMARY_PURPLE,
        tabBarInactiveTintColor: COLORS.TEXT_MUTED,
        tabBarStyle: {
          backgroundColor: COLORS.SURFACE,
          borderTopColor: COLORS.BORDER,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: 6,
          height: 68,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
        },
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<string, string> = {
            DiscoverTab: 'home-outline',
            ConnectTab: 'people-outline',
            FeedTab: 'grid-outline',
            TripsTab: 'map-outline',
            ChatTab: 'chatbubble-outline',
            ProfileTab: 'person-outline',
          };

          return <Ionicons name={iconMap[route.name] || 'ellipse-outline'} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="DiscoverTab" component={DiscoverScreen} options={{ title: 'Discover' }} />
      <Tabs.Screen name="ConnectTab" component={MatchesScreen} options={{ title: 'Connect' }} />
      <Tabs.Screen name="FeedTab" component={FeedScreen} options={{ title: 'Feed' }} />
      <Tabs.Screen name="TripsTab" component={TripsScreen} options={{ title: 'Trips' }} />
      <Tabs.Screen name="ChatTab" component={ChatListScreen} options={{ title: 'Chat' }} />
      <Tabs.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tabs.Navigator>
  );
}
