import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '@env';

const PLACEHOLDER_VALUES = new Set(['REPLACE', 'REPLACE_ME', 'CHANGE_ME', 'PLACEHOLDER']);
const normalizedDsn = SENTRY_DSN?.trim();
const hasValidDsn = Boolean(normalizedDsn && !PLACEHOLDER_VALUES.has(normalizedDsn.toUpperCase()));
const shouldEnableSentry = !__DEV__ && hasValidDsn;

let initialized = false;

export function initializeCrashMonitoring() {
  if (!shouldEnableSentry || initialized) {
    return;
  }

  Sentry.init({
    dsn: normalizedDsn,
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
