import { useCallback, useEffect, useState } from 'react';
import {
  getOfflineQueueState,
  subscribeToOfflineQueue,
  type OfflineQueueState
} from '../offline/offlineQueue';
import { syncQueuedAttendanceEvents } from '../services/attendanceCaptureService';

const emptyQueueState: OfflineQueueState = {
  pendingCount: 0,
  failedCount: 0,
  syncingCount: 0,
  queuedEventIds: [],
  failedEventIds: [],
  legacyRecordCount: 0
};

export function useOfflineAttendanceSync(userId?: string) {
  const [queueState, setQueueState] = useState<OfflineQueueState>(emptyQueueState);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSignInRequired, setIsSignInRequired] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    if (!userId) {
      setQueueState(emptyQueueState);
      return;
    }

    try {
      setQueueState(await getOfflineQueueState(userId));
    } catch {
      setSyncError('Offline attendance records could not be read from this device.');
    }
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!userId) {
      await refreshSummary();
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
    try {
      const result = await syncQueuedAttendanceEvents(userId);
      if (!result.success) {
        setSyncError(result.error);
        return;
      }

      setIsSignInRequired(result.data.pausedForSignIn);
      await refreshSummary();
    } catch {
      setSyncError('Offline attendance records could not sync. They remain saved on this device.');
    } finally {
      setIsSyncing(false);
    }
  }, [refreshSummary, userId]);

  useEffect(() => {
    const unsubscribe = subscribeToOfflineQueue(() => void refreshSummary());
    const handleOnline = () => void syncNow();
    window.addEventListener('online', handleOnline);
    const startupTimer = window.setTimeout(() => {
      void refreshSummary();
      void syncNow();
    }, 0);
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.clearTimeout(startupTimer);
    };
  }, [refreshSummary, syncNow]);

  return {
    ...queueState,
    isSyncing,
    isSignInRequired,
    syncError,
    syncNow
  };
}
