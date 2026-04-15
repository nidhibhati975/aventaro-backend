import {
  CommonActions,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { useMemo } from 'react';

export const APP_PATHS = {
  AUTH_SPLASH: '/(auth)/splash',
  AUTH_SIGN_IN: '/(auth)/sign-in',
  AUTH_SIGN_UP: '/(auth)/sign-up',
  TAB_DISCOVER: '/(tabs)/discover',
  TAB_CONNECT: '/(tabs)/connect',
  TAB_MATCHES: '/(tabs)/matches',
  TAB_FEED: '/(tabs)/feed',
  TAB_TRIPS: '/(tabs)/trips',
  TAB_CHAT: '/(tabs)/chat',
  TAB_PROFILE: '/(tabs)/profile',
  SCREEN_BOOKINGS: '/bookings',
  SCREEN_NOTIFICATIONS: '/notifications',
  SCREEN_PAYMENTS: '/payments',
  SCREEN_REELS: '/reels',
  SCREEN_STORIES: '/stories',
  SCREEN_TRIP_DETAILS: '/trip-details',
  SCREEN_CHAT_CONVERSATION: '/chat/conversation',
  SCREEN_PUBLIC_PROFILE: '/profile/public',
  SCREEN_EDIT_PROFILE: '/profile/edit',
  SCREEN_AVENTARO_AI: '/aventaro-ai',
  SCREEN_PRIVACY_SECURITY: '/privacy-security',
  SCREEN_TWO_FACTOR_AUTH: '/two-factor-auth',
  SCREEN_HELP_SUPPORT: '/help-support',
  SCREEN_SETTINGS: '/settings',
  SCREEN_PAYMENT_METHODS: '/payment-methods',
  SCREEN_TRAVELER_MAP: '/traveler-map',
  SCREEN_LOCATION_SHARING: '/location-sharing',
  SCREEN_EMERGENCY_SOS: '/emergency-sos',
} as const;

export type AppPath = (typeof APP_PATHS)[keyof typeof APP_PATHS];

export const navigationRef = createNavigationContainerRef();

type RootRoute = {
  name: 'AuthStack' | 'AppStack';
  params?: {
    screen?: string;
    params?: {
      screen?: string;
    };
  };
};

function getRouteForPath(path: string): RootRoute {
  switch (path) {
    case APP_PATHS.AUTH_SPLASH:
      return { name: 'AuthStack', params: { screen: 'Splash' } };
    case APP_PATHS.AUTH_SIGN_IN:
      return { name: 'AuthStack', params: { screen: 'SignIn' } };
    case APP_PATHS.AUTH_SIGN_UP:
      return { name: 'AuthStack', params: { screen: 'SignUp' } };
    case APP_PATHS.TAB_DISCOVER:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'DiscoverTab' } } };
    case APP_PATHS.TAB_CONNECT:
    case APP_PATHS.TAB_MATCHES:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'ConnectTab' } } };
    case APP_PATHS.TAB_FEED:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'FeedTab' } } };
    case APP_PATHS.TAB_TRIPS:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'TripsTab' } } };
    case APP_PATHS.TAB_CHAT:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'ChatTab' } } };
    case APP_PATHS.TAB_PROFILE:
      return { name: 'AppStack', params: { screen: 'Tabs', params: { screen: 'ProfileTab' } } };
    case APP_PATHS.SCREEN_BOOKINGS:
      return { name: 'AppStack', params: { screen: 'Bookings' } };
    case APP_PATHS.SCREEN_NOTIFICATIONS:
      return { name: 'AppStack', params: { screen: 'Notifications' } };
    case APP_PATHS.SCREEN_PAYMENTS:
      return { name: 'AppStack', params: { screen: 'Payments' } };
    case APP_PATHS.SCREEN_REELS:
      return { name: 'AppStack', params: { screen: 'Reels' } };
    case APP_PATHS.SCREEN_STORIES:
      return { name: 'AppStack', params: { screen: 'StoryViewer' } };
    case APP_PATHS.SCREEN_EDIT_PROFILE:
      return { name: 'AppStack', params: { screen: 'EditProfile' } };
    case APP_PATHS.SCREEN_AVENTARO_AI:
      return { name: 'AppStack', params: { screen: 'AventaroAI' } };
    case APP_PATHS.SCREEN_PRIVACY_SECURITY:
      return { name: 'AppStack', params: { screen: 'PrivacySecurity' } };
    case APP_PATHS.SCREEN_TWO_FACTOR_AUTH:
      return { name: 'AppStack', params: { screen: 'TwoFactorAuth' } };
    case APP_PATHS.SCREEN_HELP_SUPPORT:
      return { name: 'AppStack', params: { screen: 'HelpSupport' } };
    case APP_PATHS.SCREEN_SETTINGS:
      return { name: 'AppStack', params: { screen: 'Settings' } };
    case APP_PATHS.SCREEN_PAYMENT_METHODS:
      return { name: 'AppStack', params: { screen: 'PaymentMethods' } };
    case APP_PATHS.SCREEN_TRAVELER_MAP:
      return { name: 'AppStack', params: { screen: 'TravelerMap' } };
    case APP_PATHS.SCREEN_LOCATION_SHARING:
      return { name: 'AppStack', params: { screen: 'LocationSharing' } };
    case APP_PATHS.SCREEN_EMERGENCY_SOS:
      return { name: 'AppStack', params: { screen: 'EmergencySOS' } };
    default:
      return { name: 'AuthStack', params: { screen: 'Splash' } };
  }
}

export function navigateToPath(path: string, replace: boolean = false) {
  if (!navigationRef.isReady()) {
    return;
  }

  const route = getRouteForPath(path);

  if (replace) {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [route as never],
      })
    );
    return;
  }

  navigationRef.dispatch(
    CommonActions.navigate({
      name: route.name,
      params: route.params,
    })
  );
}

export function goBack() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
}

export function useRouter() {
  return useMemo(
    () => ({
      push: (path: string) => navigateToPath(path, false),
      replace: (path: string) => navigateToPath(path, true),
      back: () => goBack(),
    }),
    []
  );
}
