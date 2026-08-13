type OfflineSyncNoticeProps = {
  pendingCount: number;
  failedCount: number;
  syncingCount: number;
  isSyncing: boolean;
  isSignInRequired: boolean;
  syncError: string | null;
  legacyRecordCount: number;
  onSyncNow: () => void;
};

/*
 * Logic-driven: queue counts, sync state, sign-in state, and retry callback come from offline sync.
 * Display-only: wording and layout can be adjusted without changing attendance delivery behavior.
 */
export function OfflineSyncNotice({
  pendingCount,
  failedCount,
  syncingCount,
  isSyncing,
  isSignInRequired,
  syncError,
  legacyRecordCount,
  onSyncNow
}: OfflineSyncNoticeProps) {
  const remainingCount = pendingCount + failedCount + syncingCount;

  if (remainingCount === 0 && !isSyncing && !syncError && legacyRecordCount === 0) {
    return null;
  }

  return (
    <article className="status-panel" role={failedCount > 0 || isSignInRequired || syncError || legacyRecordCount > 0 ? 'alert' : 'status'}>
      <div>
        <span className="eyebrow">Offline attendance</span>
        <strong>
          {legacyRecordCount > 0
            ? 'An older offline record needs support'
            : isSignInRequired
            ? 'Sign in again to sync attendance'
            : isSyncing
              ? 'Syncing offline records'
              : failedCount > 0
                ? 'Some offline records need attention'
                : `${pendingCount} offline record${pendingCount === 1 ? '' : 's'} pending`}
        </strong>
        <p>
          {legacyRecordCount > 0
            ? 'It remains stored on this device but cannot be safely linked to the current account automatically.'
            : syncError
              ? syncError
            : isSignInRequired
            ? 'Your records remain saved on this device until you sign in again.'
            : 'Offline records sync when you reopen the app with internet.'}
        </p>
      </div>
      {!isSignInRequired && !isSyncing && legacyRecordCount === 0 ? (
        <button className="text-button" onClick={onSyncNow}>
          Sync now
        </button>
      ) : null}
    </article>
  );
}
