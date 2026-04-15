import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Linking } from 'react-native';
import { NavigationContainer, type InitialState } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ErrorBoundary from './components/ErrorBoundary';
import NetworkStatusBanner from './components/NetworkStatusBanner';
import OfflineFallback from './components/OfflineFallback';
import { AppRuntimeProvider } from './contexts/AppRuntimeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PaywallProvider } from './contexts/PaywallContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import AventaroAiScreen from './screens/AventaroAiScreen';
import BookingsScreen from './screens/BookingsScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import EmergencySosScreen from './screens/EmergencySosScreen';
import FeedScreen from './screens/FeedScreen';
import HelpSupportScreen from './screens/HelpSupportScreen';
import LocationSharingScreen from './screens/LocationSharingScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import PaymentMethodsScreen from './screens/PaymentMethodsScreen';
import PaymentsScreen from './screens/PaymentsScreen';
import PublicProfileScreen from './screens/PublicProfileScreen';
import PrivacySecurityScreen from './screens/PrivacySecurityScreen';
import ReelsScreen from './screens/ReelsScreen';
import SettingsScreen from './screens/SettingsScreen';
import StoryViewerScreen from './screens/StoryViewerScreen';
import TravelerMapScreen from './screens/TravelerMapScreen';
import TripDetailsScreen from './screens/TripDetailsScreen';
import TwoFactorAuthScreen from './screens/TwoFactorAuthScreen';
import ChatConversationScreen from './screens/ChatConversationScreen';
import { handleIncomingUrl } from './services/deepLinks';
import { ensureNotificationPermission } from './services/deviceNotifications';
import { setServerErrorHandler } from './services/api';
import { errorLogger } from './services/errorLogger';
import { initializeCrashMonitoring } from './services/sentry';
import { COLORS } from './theme/colors';
import AppNavigator from './navigation/AppNavigator';
import { navigationRef } from './navigation/router';
import SplashScreen from './app/(auth)/splash';
import SignInScreen from './app/(auth)/sign-in';
import SignUpScreen from './app/(auth)/sign-up';

const RootStack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();
const AUTH_NAVIGATION_STATE_KEY = 'navigation:guest';
const APP_NAVIGATION_STATE_KEY = 'navigation:authenticated';

initializeCrashMonitoring();

if (typeof globalThis !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = function(...args: any[]) {
    // Filter out known React Native yellowbox warnings
    const message = args[0]?.toString?.() || '';
    if (message.includes('Non-serializable values were found in the navigation state')) {
      return; // Suppress this safe warning
    }
    originalWarn.apply(console, args);
  };
}
async function readStoredNavigationState(storageKey: string): Promise<InitialState | undefined> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as InitialState;
    } catch (parseError) {
      errorLogger.logAsyncStorageError(parseError, storageKey, 'parseNavigation');
      await AsyncStorage.removeItem(storageKey);
      return undefined;
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, storageKey, 'readNavigation');
    return undefined;
  }
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Splash" component={SplashScreen} />
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
    </AuthStack.Navigator>
  );
}

function AuthenticatedNavigator() {
  return (
    <AppStack.Navigator screenOptions={{ headerShown: false }}>
      <AppStack.Screen name="Tabs" component={AppNavigator} />
      <AppStack.Screen name="AventaroAI" component={AventaroAiScreen} />
      <AppStack.Screen name="TripDetails" component={TripDetailsScreen} />
      <AppStack.Screen name="Conversation" component={ChatConversationScreen} />
      <AppStack.Screen name="Reels" component={ReelsScreen} />
      <AppStack.Screen name="StoryViewer" component={StoryViewerScreen} />
      <AppStack.Screen name="PublicProfile" component={PublicProfileScreen} />
      <AppStack.Screen name="EditProfile" component={EditProfileScreen} />
      <AppStack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <AppStack.Screen name="TwoFactorAuth" component={TwoFactorAuthScreen} />
      <AppStack.Screen name="Feed" component={FeedScreen} />
      <AppStack.Screen name="Bookings" component={BookingsScreen} />
      <AppStack.Screen name="Payments" component={PaymentsScreen} />
      <AppStack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
      <AppStack.Screen name="Notifications" component={NotificationsScreen} />
      <AppStack.Screen name="HelpSupport" component={HelpSupportScreen} />
      <AppStack.Screen name="Settings" component={SettingsScreen} />
      <AppStack.Screen name="TravelerMap" component={TravelerMapScreen} />
      <AppStack.Screen name="LocationSharing" component={LocationSharingScreen} />
      <AppStack.Screen name="EmergencySOS" component={EmergencySosScreen} />
    </AppStack.Navigator>
  );
}

function RootNavigator({ authenticated }: { authenticated: boolean }) {
  return (
    <RootStack.Navigator
      key={authenticated ? 'authenticated' : 'guest'}
      initialRouteName={authenticated ? 'AppStack' : 'AuthStack'}
      screenOptions={{ headerShown: false }}
    >
      <RootStack.Screen name="AuthStack" component={AuthNavigator} />
      <RootStack.Screen name="AppStack" component={AuthenticatedNavigator} />
    </RootStack.Navigator>
  );
}

function AppShell() {
  const { user, loading } = useAuth();
  const lastServerErrorAtRef = useRef(0);
  const didRequestInitialUrlRef = useRef(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const [initialNavigationState, setInitialNavigationState] = useState<InitialState | undefined>();
  const navigationStorageKey = user ? APP_NAVIGATION_STATE_KEY : AUTH_NAVIGATION_STATE_KEY;

  useEffect(() => {
    setServerErrorHandler(({ message }) => {
      try {
        const now = Date.now();
        if (now - lastServerErrorAtRef.current < 3000) {
          return;
        }

        lastServerErrorAtRef.current = now;
        Alert.alert('Server unavailable', message);
      } catch (error) {
        errorLogger.logError(error, { source: 'App', context: { action: 'serverErrorHandler' } });
      }
    });

    return () => setServerErrorHandler(null);
  }, []);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      try {
        void handleIncomingUrl(url);
      } catch (error) {
        errorLogger.logError(error, { source: 'App', context: { action: 'handleDeepLink', url } });
      }
    });

    if (!didRequestInitialUrlRef.current) {
      didRequestInitialUrlRef.current = true;
      void Linking.getInitialURL().then((url) => {
        try {
          void handleIncomingUrl(url);
        } catch (error) {
          errorLogger.logError(error, { source: 'App', context: { action: 'getInitialURL', url } });
        }
      }).catch((error) => {
        errorLogger.logError(error, { source: 'App', context: { action: 'getInitialURL' } });
      });
    }

    return () => {
      try {
        subscription.remove();
      } catch {
        // Safe to ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void ensureNotificationPermission().catch((error) => {
      errorLogger.logError(error, { source: 'App', context: { action: 'ensureNotificationPermission' } });
    });
  }, [user]);

  useEffect(() => {
    if (loading) {
      return;
    }

    let cancelled = false;
    setNavigationReady(false);

    void (async () => {
      try {
        const state = await readStoredNavigationState(navigationStorageKey);
        if (cancelled) {
          return;
        }

        setInitialNavigationState(state);
        setNavigationReady(true);
      } catch (error) {
        errorLogger.logError(error, { source: 'App', context: { action: 'readStoredNavigationState' } });
        setNavigationReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, navigationStorageKey]);

  if (loading || !navigationReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY_PURPLE} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NetworkStatusBanner />
      <OfflineFallback />
      <NavigationContainer
        key={navigationStorageKey}
        ref={navigationRef}
        initialState={initialNavigationState}
        onUnhandledAction={(action) => {
          if (action?.type === 'GO_BACK') {
            return;
          }
          errorLogger.logNavigationError(
            new Error('Unhandled navigation action'),
            String(action?.type || 'unknown'),
            action
          );
        }}
        onStateChange={(state) => {
          if (!state) {
            return;
          }

          void (async () => {
            try {
              await AsyncStorage.setItem(navigationStorageKey, JSON.stringify(state));
            } catch (error) {
              errorLogger.logAsyncStorageError(error, navigationStorageKey, 'saveNavigation');
            }
          })();
        }}
      >
        <RootNavigator authenticated={Boolean(user)} />
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppRuntimeProvider>
        <AuthProvider>
          <PaywallProvider>
            <RealtimeProvider>
              <AppShell />
            </RealtimeProvider>
          </PaywallProvider>
        </AuthProvider>
      </AppRuntimeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
