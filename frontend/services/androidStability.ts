/**
 * Android-specific stability fixes and permissionhandler
 * Handles lifecycle events, permissions, and Android-specific crashes
 */
import { useEffect, useRef } from 'react';
import { AppState, PermissionsAndroid, Platform, type AppStateStatus, type Permission, type PermissionStatus } from 'react-native';
import { errorLogger } from './errorLogger';

export const DANGEROUS_PERMISSIONS: Permission[] = [
  PermissionsAndroid.PERMISSIONS.CAMERA,
  PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
  PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
];


export async function requestAndroidPermissions(permissions: Permission[]): Promise<Record<string, PermissionStatus>> {
  if (Platform.OS !== 'android') {
    return {};
  }
  try {
    const results = await PermissionsAndroid.requestMultiple(permissions);
    const granted: Record<string, PermissionStatus> = {};
    for (const permission of permissions) {
      granted[permission] = results[permission] ?? PermissionsAndroid.RESULTS.DENIED;
    }
    return granted;
  } catch (error) {
    errorLogger.logError(error, { source: 'Android', context: { action: 'requestPermissions', permissions } });
    return {};
  }
}


export async function checkAndroidPermission(permission: Permission): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    return await PermissionsAndroid.check(permission);
  } catch (error) {
    errorLogger.logError(error, { source: 'Android', context: { action: 'checkPermission', permission } });
    return false;
  }
}


export function useAndroidLifecycleHandler(
  onBackground?: () => void,
  onForeground?: () => void
): void {
  const lastStateRef = useRef(AppState.currentState);
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        const prevState = lastStateRef.current;
        lastStateRef.current = nextState;
        try {
          if (prevState === 'active' && (nextState === 'background' || nextState === 'inactive')) {
            onBackground?.();
          } else if ((prevState === 'background' || prevState === 'inactive') && nextState === 'active') {
            onForeground?.();
          }
        } catch (error) {
          errorLogger.logError(error, {
            source: 'Android',
            context: { action: 'lifecycleHandler', state: nextState },
          });
        }
      });
    } catch (error) {
      errorLogger.logError(error, { source: 'Android', context: { action: 'subscribeToAppState' } });
    }
    return () => {
      try {
        if (subscription && typeof subscription.remove === 'function') {
          subscription.remove();
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'Android', context: { action: 'unsubscribeAppState' } });
      }
    };
  }, [onBackground, onForeground]);
}


// Removed unsafe unhandled rejection and global logic


export async function safeAndroidCall<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    errorLogger.logError(error, { source: 'Android', context: { action: 'safeAndroidCall', context } });
    return fallback;
  }
}


export function requestAndroidGarbageCollection(): void {
  if (Platform.OS !== 'android') {
    return;
  }
  // No-op: left for future native integration if needed
}
