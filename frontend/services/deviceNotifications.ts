import firebasePushService from './firebasePushService';

export async function ensureNotificationPermission(): Promise<boolean> {
  await firebasePushService.init();

  const currentStatus = await firebasePushService.checkPermissionStatus();
  if (currentStatus === 'granted' || currentStatus === 'provisional') {
    await firebasePushService.syncTokenWithBackend();
    return true;
  }

  const nextStatus = await firebasePushService.requestPermission();
  return nextStatus === 'granted' || nextStatus === 'provisional';
}

export async function flushPendingNotificationNavigation(): Promise<boolean> {
  await firebasePushService.init();
  return firebasePushService.drainPendingNotificationNavigation();
}

export async function teardownDeviceNotifications(): Promise<void> {
  await firebasePushService.end();
}
