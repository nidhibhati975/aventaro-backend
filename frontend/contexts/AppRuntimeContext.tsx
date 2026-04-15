import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { errorLogger } from '../services/errorLogger';

interface AppRuntimeContextValue {
  isForeground: boolean;
  isOnline: boolean;
  appState: AppStateStatus;
  lastForegroundAt: number;
  checkingNetwork: boolean;
  refreshNetworkState: () => Promise<boolean>;
}

const AppRuntimeContext = createContext<AppRuntimeContextValue>({
  isForeground: true,
  isOnline: true,
  appState: 'active',
  lastForegroundAt: Date.now(),
  checkingNetwork: false,
  refreshNetworkState: async () => true,
});

function isConnected(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) {
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}

export function useAppRuntime() {
  return useContext(AppRuntimeContext);
}

export function AppRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [isOnline, setIsOnline] = useState(true);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [lastForegroundAt, setLastForegroundAt] = useState(Date.now());
  const previousAppStateRef = useRef(AppState.currentState);

  const isForeground = appState === 'active';

  const refreshNetworkState = useCallback(async () => {
    setCheckingNetwork(true);
    try {
      const state = await NetInfo.fetch();
      const connected = isConnected(state);
      setIsOnline(connected);
      return connected;
    } catch (error) {
      errorLogger.logError(error, { source: 'AppRuntime', context: { action: 'refreshNetworkState' } });
      setIsOnline(false);
      return false;
    } finally {
      setCheckingNetwork(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(isConnected(state));
    });

    void refreshNetworkState();

    return unsubscribe;
  }, [refreshNetworkState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = previousAppStateRef.current;
      previousAppStateRef.current = nextState;
      setAppState(nextState);

      if (nextState === 'active' && previousState !== 'active') {
        setLastForegroundAt(Date.now());
        void refreshNetworkState();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshNetworkState]);

  const value = useMemo(
    () => ({
      isForeground,
      isOnline,
      appState,
      lastForegroundAt,
      checkingNetwork,
      refreshNetworkState,
    }),
    [appState, checkingNetwork, isForeground, isOnline, lastForegroundAt, refreshNetworkState]
  );

  return <AppRuntimeContext.Provider value={value}>{children}</AppRuntimeContext.Provider>;
}
