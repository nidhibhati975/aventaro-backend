import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '@env';

const hasValidDsn = Boolean(
  SENTRY_DSN && SENTRY_DSN.trim() && SENTRY_DSN.trim() !== 'REPLACE_ME'
);
const shouldEnableSentry = !__DEV__ && hasValidDsn;

let initialized = false;

export function initializeCrashMonitoring() {
  if (!shouldEnableSentry || initialized) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: shouldEnableSentry,
    debug: false,
    environment: 'production',
    tracesSampleRate: 0.2,
    attachStacktrace: true,
  });

  initialized = true;
}

export function captureCrash(error: unknown, extra?: Record<string, unknown>) {
  if (!shouldEnableSentry || !initialized) {
    return;
  }
  Sentry.captureException(error, {
    extra,
  });
}

export function isCrashMonitoringEnabled() {
  return shouldEnableSentry;
}
