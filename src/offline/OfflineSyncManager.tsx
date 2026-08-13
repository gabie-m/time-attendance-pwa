import { useAuth } from '../auth/useAuth';
import { useOfflineAttendanceSync } from '../hooks/useOfflineAttendanceSync';

/*
 * Logic-driven: authenticated user identity starts a queue replay when the app opens or reconnects.
 * Display-only: none. This component intentionally renders no interface.
 */
export function OfflineSyncManager() {
  const { user, loading } = useAuth();
  useOfflineAttendanceSync(loading ? undefined : user?.id);
  return null;
}
