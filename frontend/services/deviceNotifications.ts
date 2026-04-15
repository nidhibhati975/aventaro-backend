import { PermissionsAndroid, Platform } from 'react-native';
import { errorLogger } from './errorLogger';

let permissionRequestInFlight: Promise<boolean> | null = null;

export async function ensureNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }

  if (!permissionRequestInFlight) {
    permissionRequestInFlight = (async () => {
      try {
        const alreadyGranted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );

        if (alreadyGranted) {
          return true;
        }

        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );

        return result === PermissionsAndroid.RESULTS.GRANTED;
      } catch (error) {
        errorLogger.logError(error, { source: 'Notifications', context: { action: 'ensurePermission' } });
        return false;
      }
    })().finally(() => {
      permissionRequestInFlight = null;
    });
  }

  return permissionRequestInFlight;
}
