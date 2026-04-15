import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from './AuthContext';
import { useAppRuntime } from './AppRuntimeContext';
import { errorLogger } from '../services/errorLogger';
import {
  realtimeService,
  type RealtimeConnectionStatus,
  type RealtimeEvent,
} from '../services/realtimeService';

interface RealtimeContextValue {
  connectionStatus: RealtimeConnectionStatus;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  joinTripRoom: (tripId: number | null | undefined) => void;
  leaveTripRoom: (tripId: number | null | undefined) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connectionStatus: 'idle',
  subscribe: () => () => undefined,
  joinTripRoom: () => undefined,
  leaveTripRoom: () => undefined,
});

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut } = useAuth();
  const { isForeground, isOnline } = useAppRuntime();
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>(
    realtimeService.getStatus()
  );

  useEffect(() => {
    if (!realtimeService) {
      return;
    }

    return realtimeService.subscribeToStatus((status) => {
      try {
        setConnectionStatus(status);
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'subscribeToStatus' } });
      }
    });
  }, []);

  useEffect(() => {
    if (!token) {
      try {
        realtimeService.disconnect();
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'disconnect' } });
      }
      return;
    }

    void (async () => {
      try {
        await realtimeService.connect(token);
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'connect' } });
      }
    })();

    return () => {
      try {
        realtimeService.disconnect();
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'disconnectCleanup' } });
      }
    };
  }, [token]);

  useEffect(() => {
    void (async () => {
      try {
        await realtimeService.setNetworkAvailable(isOnline);
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'setNetworkAvailable' } });
      }
    })();
  }, [isOnline]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void (async () => {
      try {
        if (isForeground && isOnline) {
          await realtimeService.resume();
        } else {
          realtimeService.suspend();
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: isForeground && isOnline ? 'resume' : 'suspend' } });
      }
    })();
  }, [isForeground, isOnline, token]);

  useEffect(() => {
    if (!realtimeService) {
      return;
    }

    return realtimeService.subscribe((event) => {
      try {
        if (event?.type === 'auth.expired') {
          void signOut();
        }
      } catch (error) {
        errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'handleEvent', eventType: event?.type } });
      }
    });
  }, [signOut]);

  const value = useMemo(
    () => ({
      connectionStatus,
      subscribe: (listener: (event: RealtimeEvent) => void) => {
        try {
          return realtimeService.subscribe(listener);
        } catch (error) {
          errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'subscribe' } });
          return () => undefined;
        }
      },
      joinTripRoom: (tripId: number | null | undefined) => {
        if (!tripId || typeof tripId !== 'number' || tripId <= 0) {
          return;
        }
        try {
          realtimeService.joinTripRoom(tripId);
        } catch (error) {
          errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'joinTripRoom', tripId } });
        }
      },
      leaveTripRoom: (tripId: number | null | undefined) => {
        if (!tripId || typeof tripId !== 'number' || tripId <= 0) {
          return;
        }
        try {
          realtimeService.leaveTripRoom(tripId);
        } catch (error) {
          errorLogger.logError(error, { source: 'RealtimeContext', context: { action: 'leaveTripRoom', tripId } });
        }
      },
    }),
    [connectionStatus]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
