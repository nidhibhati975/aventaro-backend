/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { captureCrash, initializeCrashMonitoring, isCrashMonitoringEnabled } from './services/sentry';
import { assertProductionRuntimeConfig } from './services/runtimeGuard';

assertProductionRuntimeConfig();
initializeCrashMonitoring();

if (!__DEV__) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
  console.error = noop;
}

if (global.ErrorUtils?.setGlobalHandler && global.ErrorUtils?.getGlobalHandler) {
  const defaultHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    captureCrash(error, { isFatal, source: 'globalErrorHandler' });
    try {
      if (typeof defaultHandler === 'function') {
        defaultHandler(error, isFatal);
      }
    } catch {
      // Keep fallback silent to avoid recursive crashes.
    }
  });
}

if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('unhandledRejection', (reason) => {
    captureCrash(reason, {
      source: 'unhandledRejection',
      sentry_enabled: isCrashMonitoringEnabled(),
    });
  });
}

AppRegistry.registerComponent(appName, () => App);
