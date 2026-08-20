import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { ConsentGate } from '../components/ConsentGate';
import { Icon } from '../components/Icon';
import { LocationWarning } from '../components/LocationWarning';
import { ManualEditRequestPanel } from '../components/ManualEditRequestPanel';
import { MetricCard } from '../components/MetricCard';
import { MissingPhotoWarning } from '../components/MissingPhotoWarning';
import { OfflineSyncNotice } from '../components/OfflineSyncNotice';
import { PlatformNotice } from '../components/PlatformNotice';
import { Pill } from '../components/Pill';
import { TimeGapWarning } from '../components/TimeGapWarning';
import type {
  AttendanceEventType,
  AttendanceFlagType,
  AttendanceRecorderInput,
  AttendanceRecorderResult,
  Location,
  Visit
} from '../domain/types';
import { useAttendanceLocations } from '../hooks/useAttendanceLocations';
import { useAttendanceRules } from '../hooks/useAttendanceRules';
import { useOfflineAttendanceSync } from '../hooks/useOfflineAttendanceSync';
import {
  getAttendanceAcknowledgement,
  getAttendanceAcknowledgements,
  getQueuedAttendanceEventsForPresentation,
  getRovingAttendancePresentation,
  canResetMockAttendanceRecords,
  clearMockAttendanceRecords,
  createAttendancePresentationLoadGuard,
  saveRovingAttendancePresentation
} from '../offline/offlineQueue';
import { getAttendanceRuleValue } from '../services/attendanceRulesService';
import { captureAttendanceEvent } from '../services/attendanceCaptureService';
import {
  checkCurrentPositionAgainstLocation,
  getGpsUnavailableResult,
  type GeoCheckResult
} from '../utils/geo';

const purposes = ['Inventory check', 'Promo audit', 'Staff coaching', 'Stock replenishment', 'Client meeting'];
type RecorderConfirmations = {
  gpsWarningAcknowledged: boolean;
  missingPhotoAcknowledged: boolean;
  shortGapAcknowledged: boolean;
};

export function RovingScreen() {
  const { user: authUser } = useAuth();
  const user = authUser!;
  const offlineSync = useOfflineAttendanceSync(user.id);
  const {
    data: locations,
    isError: hasLocationsError,
    refetch: refetchAttendanceLocations
  } = useAttendanceLocations(user.id);
  const {
    data: attendanceRules,
    isError: hasRulesError,
    refetch: refetchAttendanceRules
  } = useAttendanceRules();
  const [isRecording, setIsRecording] = useState(false);
  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedLocationName, setSelectedLocationName] = useState('');
  const [selectedPurpose, setSelectedPurpose] = useState(purposes[0]);
  const [pendingLocationWarning, setPendingLocationWarning] = useState<{
    type: 'start' | 'end';
    result: GeoCheckResult;
    visitId?: string;
    confirmations: RecorderConfirmations;
  } | null>(null);
  const [pendingTimeGapWarning, setPendingTimeGapWarning] = useState<{
    type: 'start' | 'end';
    previousActionLabel: string;
    gapMinutes: number;
    visitId?: string;
  } | null>(null);
  const [pendingPhotoWarning, setPendingPhotoWarning] = useState<{
    type: 'start' | 'end';
    result: GeoCheckResult;
    confirmations: RecorderConfirmations;
    visitId?: string;
  } | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [presentationUserId, setPresentationUserId] = useState<string | null>(null);
  const [presentationLoadGuard] = useState(createAttendancePresentationLoadGuard);
  const isPresentationLoaded = presentationUserId === user.id;
  const queueStateKey = `${offlineSync.failedEventIds.join(',')}:${offlineSync.queuedEventIds.join(',')}`;
  const hasFailedVisits = offlineSync.legacyRecordCount > 0
    || offlineSync.failedEventIds.length > 0
    || visits.some((visit) => visit.serverStatus === 'failed');
  const activeVisit = visits.find((visit) => visit.status === 'active' && visit.serverStatus !== 'failed');
  const recordedVisits = visits.filter((visit) => visit.serverStatus !== 'failed');
  const doneVisits = recordedVisits.filter((visit) => visit.status === 'done');
  const totalVisitMinutes = doneVisits.reduce((sum, visit) => sum + getVisitMinutes(visit), 0);
  const shortGapConfirmationMinutes = attendanceRules
    ? getAttendanceRuleValue(attendanceRules, 'short_attendance_gap_confirmation_minutes')
    : null;
  const hasAvailableRules = Boolean(attendanceRules) && !hasRulesError;
  const hasAvailableLocations = Boolean(locations?.length) && !hasLocationsError;
  const hasNoPermittedLocations = locations?.length === 0 && !hasLocationsError;
  const hasAvailableCaptureSetup = isPresentationLoaded && hasAvailableRules && hasAvailableLocations && !hasFailedVisits;

  useEffect(() => {
    let active = true;
    const loadVersion = presentationLoadGuard.startLoad();
    void Promise.all([
      getRovingAttendancePresentation(user.id),
      getQueuedAttendanceEventsForPresentation(user.id),
      getAttendanceAcknowledgements(user.id)
    ]).then(([storedVisits, pendingEvents, acknowledgements]) => {
      if (active && presentationLoadGuard.isCurrent(loadVersion)) {
        setVisits(mergeRovingVisits(
          storedVisits ?? readLegacyStoredVisits(user.id),
          rebuildRovingVisits(pendingEvents, acknowledgements) ?? []
        ));
        setPresentationUserId(user.id);
      }
    });
    return () => {
      active = false;
    };
  }, [presentationLoadGuard, queueStateKey, user.id]);

  useEffect(() => {
    if (isPresentationLoaded) {
      void saveRovingAttendancePresentation(user.id, visits);
    }
  }, [isPresentationLoaded, user.id, visits]);

  useEffect(() => {
    const awaitingAcknowledgement = visits.filter((visit) => getVisitSyncEventIds(visit).some(
      (clientEventId) => !offlineSync.queuedEventIds.includes(clientEventId)
    ));
    if (awaitingAcknowledgement.length === 0) {
      return;
    }

    void Promise.all(awaitingAcknowledgement.map(async (visit) => ({
      visit,
      results: await Promise.all(getVisitSyncEventIds(visit).map(async (clientEventId) => ({
        clientEventId,
        result: await getAttendanceAcknowledgement(user.id, clientEventId)
      })))
    }))).then((acknowledgements) => {
      if (!acknowledgements.some((item) => item.results.some((result) => result.result))) {
        return;
      }
      setVisits((currentVisits) => currentVisits.map((visit) => {
        const acknowledgement = acknowledgements.find((item) => item.visit.id === visit.id);
        return acknowledgement ? applyAcknowledgements(visit, acknowledgement.results) : visit;
      }));
    });
  }, [offlineSync.queuedEventIds, user.id, visits]);

  async function startVisit() {
    if (activeVisit || !hasAvailableCaptureSetup || !locations) {
      return;
    }

    const selectedLocation = getLocationByName(getSelectedLocationName(selectedLocationName, locations), locations);
    const geoCheck = await getGeoCheck(selectedLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ type: 'start', result: geoCheck, confirmations: createEmptyConfirmations() });
      return;
    }

    await continueStartVisit(geoCheck, createEmptyConfirmations());
  }

  async function continueStartVisit(geoCheck: GeoCheckResult, confirmations: RecorderConfirmations) {
    if (isRecording) {
      return;
    }

    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);

    if (!confirmations.missingPhotoAcknowledged) {
      setPendingPhotoWarning({ type: 'start', result: geoCheck, confirmations });
      return;
    }

    setIsRecording(true);
    setMessage(null);
    const capturedAtLocal = new Date().toISOString();
    const result = await captureAttendanceEvent(user.id, {
      clientEventId: crypto.randomUUID(),
      eventType: 'visit_in',
      capturedAtLocal,
      locationId: geoCheck.location.id,
      purpose: selectedPurpose,
      latitude: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.latitude,
      longitude: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.longitude,
      gpsAccuracyMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.accuracyMeters,
      ...confirmations
    });
    setIsRecording(false);

    if (!result.success) {
      setMessage(result.error);
      return;
    }

    const localTime = formatLocalTime(capturedAtLocal);
    const nextVisit: Visit = {
      id: result.data.record.sessionId,
      sessionId: result.data.record.sessionId,
      capturedAtLocal,
      status: 'active',
      locationName: geoCheck.location.name,
      purpose: selectedPurpose,
      timeIn: localTime,
      duration: 'In progress',
      travelFromPrevious: getTravelGapLabel(visits),
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus: result.data.record.validationStatus,
      flagTypes: result.data.record.flagTypes,
      serverStatus: result.data.delivery === 'queued' ? 'pending' : 'synced',
      syncEventIds: result.data.delivery === 'queued' ? [result.data.record.clientEventId] : []
    };

    setVisits((currentVisits) => [nextVisit, ...currentVisits]);
    setShowForm(false);
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
    setPendingPhotoWarning(null);
  }

  async function endVisit(visitId: string) {
    const visit = visits.find((item) => item.id === visitId);
    if (!hasAvailableCaptureSetup || shortGapConfirmationMinutes === null) {
      return;
    }

    const timeGapWarning = getEndVisitTimeGapWarning(visit, shortGapConfirmationMinutes);
    if (timeGapWarning) {
      setPendingTimeGapWarning({ type: 'end', visitId, ...timeGapWarning });
      return;
    }

    await endVisitAfterTimeConfirmation(visitId, createEmptyConfirmations());
  }

  async function endVisitAfterTimeConfirmation(visitId: string, confirmations: RecorderConfirmations) {
    setPendingTimeGapWarning(null);
    const visit = visits.find((item) => item.id === visitId);
    const visitLocation = getLocationByName(
      visit?.locationName ?? getSelectedLocationName(selectedLocationName, locations ?? []),
      locations ?? []
    );
    const geoCheck = await getGeoCheck(visitLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ type: 'end', result: geoCheck, visitId, confirmations });
      return;
    }

    await continueEndVisit(visitId, geoCheck, confirmations);
  }

  async function continueEndVisit(
    visitId: string,
    geoCheck: GeoCheckResult,
    confirmations: RecorderConfirmations
  ) {
    if (isRecording) {
      return;
    }

    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);

    if (!confirmations.missingPhotoAcknowledged) {
      setPendingPhotoWarning({ type: 'end', result: geoCheck, visitId, confirmations });
      return;
    }

    const visit = visits.find((item) => item.id === visitId);
    if (!visit) {
      setMessage('The selected attendance session is unavailable.');
      return;
    }

    setIsRecording(true);
    setMessage(null);
    const capturedAtLocal = new Date().toISOString();
    const result = await captureAttendanceEvent(user.id, {
      clientEventId: crypto.randomUUID(),
      eventType: 'visit_out',
      capturedAtLocal,
      locationId: geoCheck.location.id,
      sessionId: visit.sessionId,
      latitude: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.latitude,
      longitude: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.longitude,
      gpsAccuracyMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.accuracyMeters,
      ...confirmations
    });
    setIsRecording(false);

    if (!result.success) {
      setMessage(result.error);
      return;
    }

    const localTime = formatLocalTime(capturedAtLocal);

    setVisits((currentVisits) => currentVisits.map((visit) => {
          if (visit.id !== visitId) {
            return visit;
          }

          return {
            ...visit,
            status: 'done',
            timeOut: localTime,
            timeOutCapturedAtLocal: capturedAtLocal,
            duration: getDurationLabel(visit.capturedAtLocal, capturedAtLocal),
            distanceMeters: geoCheck.status === 'gps_unavailable' ? visit.distanceMeters : geoCheck.distanceMeters,
            validationStatus: result.data.record.validationStatus,
            flagTypes: mergeFlagTypes(visit.flagTypes, result.data.record.flagTypes),
            serverStatus: result.data.delivery === 'queued' ? 'pending' : 'synced',
            syncEventIds: result.data.delivery === 'queued'
              ? [...getVisitSyncEventIds(visit), result.data.record.clientEventId]
              : getVisitSyncEventIds(visit)
          };
        }));
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
    setPendingPhotoWarning(null);
  }

  async function resetDemoDay() {
    if (!isMockAuthMode() || !canResetMockAttendanceRecords({
      isRecording,
      isResetting: isResettingDemo,
      isSyncing: offlineSync.isSyncing,
      syncingCount: offlineSync.syncingCount
    })) {
      return;
    }
    setIsResettingDemo(true);
    presentationLoadGuard.invalidate();
    try {
      await clearMockAttendanceRecords(user.id);
      setVisits([]);
      setShowForm(false);
    } finally {
      setIsResettingDemo(false);
    }
  }

  return (
    <section className="screen mobile-first">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Tuesday · May 5</span>
          <h1>Roving Visits</h1>
          <p>{user.name} · Field attendance is captured per location session.</p>
        </div>
        <Pill tone="overtime">Route 04</Pill>
      </header>
      <PlatformNotice />
      <OfflineSyncNotice {...offlineSync} onSyncNow={() => void offlineSync.syncNow()} />

      {!hasAvailableRules ? (
        <article className="status-panel" role={hasRulesError ? 'alert' : 'status'}>
          <div>
            <span className="eyebrow">Attendance rules</span>
            <strong>{hasRulesError ? 'Attendance actions are unavailable' : 'Loading attendance rules'}</strong>
            <p>
              {hasRulesError
                ? 'We could not verify the current attendance rules. Try again before recording attendance.'
                : 'Attendance actions will be available after the current rules are verified.'}
            </p>
          </div>
          {hasRulesError ? (
            <button className="text-button" onClick={() => void refetchAttendanceRules()}>
              Retry
            </button>
          ) : null}
        </article>
      ) : null}

      {hasAvailableRules && !hasAvailableLocations ? (
        <article className="status-panel" role={hasLocationsError ? 'alert' : 'status'}>
          <div>
            <span className="eyebrow">Attendance locations</span>
            <strong>
              {hasLocationsError
                ? 'Attendance actions are unavailable'
                : hasNoPermittedLocations
                  ? 'No permitted attendance location'
                  : 'Loading permitted locations'}
            </strong>
            <p>
              {hasLocationsError
                ? 'We could not verify your permitted locations. Try again before recording attendance.'
                : hasNoPermittedLocations
                  ? 'Ask an administrator to assign an active attendance location before recording attendance.'
                  : 'Attendance actions will be available after your permitted locations are verified.'}
            </p>
          </div>
          {hasLocationsError ? (
            <button className="text-button" onClick={() => void refetchAttendanceLocations()}>
              Retry
            </button>
          ) : null}
        </article>
      ) : null}

      <div className="metric-grid">
        <MetricCard label="Visits" value={String(recordedVisits.length)} detail={`${doneVisits.length} done · ${activeVisit ? '1 active' : '0 active'}`} />
        <MetricCard label="On-site" value={formatMinutes(totalVisitMinutes)} detail="Travel excluded" tone="success" />
        <MetricCard label="Recorded" value={String(recordedVisits.length)} detail="Submitted through attendance recorder" tone="success" />
        <MetricCard label="Travel" value="Paid" detail="Non-productive, separate" tone="indigo" />
      </div>

      {user.locationConsentGivenAt && hasAvailableCaptureSetup && locations ? (
        <>
          {pendingLocationWarning ? (
            <LocationWarning
              actionLabel={pendingLocationWarning.type === 'start' ? 'Start Visit' : 'End Visit'}
              result={pendingLocationWarning.result}
              onCancel={() => setPendingLocationWarning(null)}
              onConfirm={() =>
                pendingLocationWarning.type === 'start'
                  ? void continueStartVisit(
                      pendingLocationWarning.result,
                      { ...pendingLocationWarning.confirmations, gpsWarningAcknowledged: true }
                    )
                  : void continueEndVisit(
                      pendingLocationWarning.visitId ?? '',
                      pendingLocationWarning.result,
                      { ...pendingLocationWarning.confirmations, gpsWarningAcknowledged: true }
                    )
              }
            />
          ) : null}
          {pendingTimeGapWarning ? (
            <TimeGapWarning
              actionLabel={pendingTimeGapWarning.type === 'start' ? 'Start Visit' : 'End Visit'}
              previousActionLabel={pendingTimeGapWarning.previousActionLabel}
              gapMinutes={pendingTimeGapWarning.gapMinutes}
              onCancel={() => setPendingTimeGapWarning(null)}
              onConfirm={() =>
                pendingTimeGapWarning.type === 'start'
                  ? undefined
                  : void endVisitAfterTimeConfirmation(
                      pendingTimeGapWarning.visitId ?? '',
                      { ...createEmptyConfirmations(), shortGapAcknowledged: true }
                    )
              }
            />
          ) : null}
          {pendingPhotoWarning ? (
            <MissingPhotoWarning
              actionLabel={pendingPhotoWarning.type === 'start' ? 'Start Visit' : 'End Visit'}
              onCancel={() => setPendingPhotoWarning(null)}
              onConfirm={() =>
                pendingPhotoWarning.type === 'start'
                  ? void continueStartVisit(
                      pendingPhotoWarning.result,
                      { ...pendingPhotoWarning.confirmations, missingPhotoAcknowledged: true }
                    )
                  : void continueEndVisit(
                      pendingPhotoWarning.visitId ?? '',
                      pendingPhotoWarning.result,
                      { ...pendingPhotoWarning.confirmations, missingPhotoAcknowledged: true }
                    )
              }
            />
          ) : null}
          {message ? <p className="form-warning">{message}</p> : null}
          <article className="status-panel">
            <div>
              <span className="eyebrow">Roving rule</span>
              <strong>{activeVisit ? 'Visit in progress' : 'Ready for next visit'}</strong>
              <p>{activeVisit ? 'Close your current visit before starting a new one.' : 'Travel gaps are paid but reported separately.'}</p>
            </div>
            {isMockAuthMode() ? (
              <button
                className="text-button"
                disabled={!canResetMockAttendanceRecords({
                  isRecording,
                  isResetting: isResettingDemo,
                  isSyncing: offlineSync.isSyncing,
                  syncingCount: offlineSync.syncingCount
                })}
                onClick={() => void resetDemoDay()}
              >
                Reset demo
              </button>
            ) : null}
          </article>

          {showForm ? (
            <article className="visit-form">
              <label>
                Location
                <select
                    value={getSelectedLocationName(selectedLocationName, locations)}
                  onChange={(event) => setSelectedLocationName(event.target.value)}
                >
                  {locations.map((location) => (
                    <option value={location.name} key={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <select value={selectedPurpose} onChange={(event) => setSelectedPurpose(event.target.value)}>
                  {purposes.map((purpose) => (
                    <option value={purpose} key={purpose}>{purpose}</option>
                  ))}
                </select>
              </label>
              <div className="inline-actions">
                <button onClick={() => void startVisit()} disabled={Boolean(activeVisit) || isRecording}>Start Visit</button>
                <button className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </article>
          ) : (
            <button className="action-button full" onClick={() => setShowForm(true)} disabled={Boolean(activeVisit) || isRecording}>
              <Icon name="plus" />
              Add Visit
            </button>
          )}
        </>
      ) : !user.locationConsentGivenAt ? (
        <ConsentGate />
      ) : null}

      <div className="visit-list">
        {visits.length === 0 ? (
          <div className="empty-state">
            <strong>No visits yet</strong>
            <p>Add Visit starts a location session and is recorded with server-side authorization.</p>
          </div>
        ) : null}
        {visits.map((visit) => (
          <article className="visit-card" key={visit.id}>
            <div>
              <div className="visit-card-top">
                <h2>{visit.locationName}</h2>
                <Pill tone={isVisitFailed(visit, offlineSync.failedEventIds) ? 'warn' : isVisitPending(visit, offlineSync.queuedEventIds) ? 'sync' : visit.validationStatus === 'flagged' ? 'flag' : visit.status === 'active' ? 'warn' : visit.status === 'done' ? 'success' : 'neutral'}>
                  {isVisitFailed(visit, offlineSync.failedEventIds) ? 'needs attention' : isVisitPending(visit, offlineSync.queuedEventIds) ? 'pending' : visit.validationStatus === 'flagged' ? 'flagged' : visit.status}
                </Pill>
              </div>
              <p>{visit.purpose}</p>
              {visit.flagTypes?.length ? <small>Flags: {visit.flagTypes.map(formatFlagType).join(', ')}</small> : null}
            </div>
            <div className="visit-meta">
              <span>{visit.timeIn ?? '--'} → {visit.timeOut ?? '--'}</span>
              <strong>{visit.duration}</strong>
              <small>{visit.distanceMeters ? `${visit.distanceMeters}m from selected location` : visit.travelFromPrevious}</small>
            </div>
            {visit.status === 'active' ? (
              <button className="action-button full" onClick={() => void endVisit(visit.id)} disabled={isRecording || hasFailedVisits}>
                End Visit
              </button>
            ) : null}
          </article>
        ))}
      </div>

      <ManualEditRequestPanel user={user} />
    </section>
  );
}

function applyAcknowledgements(
  visit: Visit,
  acknowledgements: Array<{ clientEventId: string; result: AttendanceRecorderResult | null }>
): Visit {
  const acknowledgedResults = acknowledgements.flatMap((item) => item.result ? [item.result] : []);
  const flagTypes = acknowledgedResults.reduce(
    (currentFlags, result) => mergeFlagTypes(currentFlags, result.flagTypes),
    visit.flagTypes ?? []
  );
  const pendingSyncEventIds = acknowledgements
    .filter((item) => !item.result)
    .map((item) => item.clientEventId);
  return {
    ...visit,
    serverStatus: pendingSyncEventIds.length > 0 ? 'pending' : 'synced',
    validationStatus: flagTypes.length > 0 ? 'flagged' : acknowledgedResults.at(-1)?.validationStatus ?? visit.validationStatus,
    flagTypes,
    syncEventIds: pendingSyncEventIds,
    syncEventId: undefined
  };
}

function mergeFlagTypes(current: AttendanceFlagType[] | undefined, next: AttendanceFlagType[]) {
  return [...new Set([...(current ?? []), ...next])];
}

function readLegacyStoredVisits(userId: string): Visit[] {
  const rawValue = window.localStorage.getItem(`roving-visits:${userId}`);
  if (!rawValue) {
    return [];
  }

  try {
    const visits = JSON.parse(rawValue) as Visit[];
    return visits.every((visit) => Boolean(visit.sessionId && visit.capturedAtLocal)) ? visits : [];
  } catch {
    return [];
  }
}

function rebuildRovingVisits(
  pendingEvents: Array<AttendanceRecorderInput & { syncStatus: 'pending' | 'syncing' | 'failed' }>,
  acknowledgements: Array<{ input: AttendanceRecorderInput; result: AttendanceRecorderResult }>
): Visit[] | null {
  const acknowledgedRoving = acknowledgements.filter((item) => isRovingEvent(item.input.eventType));
  const acknowledgedIds = new Set(acknowledgedRoving.map((item) => item.input.clientEventId));
  const pendingRoving = pendingEvents.filter(
    (event) => isRovingEvent(event.eventType) && !acknowledgedIds.has(event.clientEventId)
  );
  if (acknowledgedRoving.length === 0 && pendingRoving.length === 0) {
    return null;
  }

  const eventRecords = [
    ...acknowledgedRoving.map(({ input, result }) => ({ input, result, pending: false, failed: false })),
    ...pendingRoving.map((input) => ({ input, result: null, pending: input.syncStatus !== 'failed', failed: input.syncStatus === 'failed' }))
  ].sort((left, right) => left.input.capturedAtLocal.localeCompare(right.input.capturedAtLocal));
  const visitsBySession = new Map<string, Visit>();

  for (const record of eventRecords) {
    const sessionId = record.result?.sessionId ?? record.input.sessionId ?? record.input.clientEventId;
    if (record.input.eventType === 'visit_in') {
      visitsBySession.set(sessionId, {
        id: sessionId,
        sessionId,
        capturedAtLocal: record.input.capturedAtLocal,
        status: record.failed ? 'planned' : 'active',
        locationName: record.input.locationId,
        purpose: record.input.purpose ?? 'Field visit',
        timeIn: formatLocalTime(record.input.capturedAtLocal),
        duration: 'In progress',
        travelFromPrevious: 'Recovered from offline queue',
        validationStatus: record.result?.validationStatus ?? provisionalValidationStatus(record.input),
        flagTypes: record.result?.flagTypes ?? getProvisionalFlagTypes(record.input),
        serverStatus: record.failed ? 'failed' : record.pending ? 'pending' : 'synced',
        syncEventIds: record.pending ? [record.input.clientEventId] : []
      });
      continue;
    }

    const visit = visitsBySession.get(sessionId);
    if (!visit) {
      continue;
    }
    if (record.failed) {
      visitsBySession.set(sessionId, {
        ...visit,
        serverStatus: 'failed',
        syncEventIds: [...getVisitSyncEventIds(visit), record.input.clientEventId]
      });
      continue;
    }
    const flags = mergeFlagTypes(visit.flagTypes, record.result?.flagTypes ?? getProvisionalFlagTypes(record.input));
    visitsBySession.set(sessionId, {
      ...visit,
      status: 'done',
      timeOut: formatLocalTime(record.input.capturedAtLocal),
      timeOutCapturedAtLocal: record.input.capturedAtLocal,
      duration: getDurationLabel(visit.capturedAtLocal, record.input.capturedAtLocal),
      validationStatus: flags.length > 0 ? 'flagged' : record.result?.validationStatus ?? visit.validationStatus,
      flagTypes: flags,
      serverStatus: record.pending ? 'pending' : visit.serverStatus,
      syncEventIds: record.pending
        ? [...getVisitSyncEventIds(visit), record.input.clientEventId]
        : getVisitSyncEventIds(visit)
    });
  }

  return [...visitsBySession.values()].sort((left, right) => right.capturedAtLocal.localeCompare(left.capturedAtLocal));
}

function mergeRovingVisits(storedVisits: Visit[], recoveredVisits: Visit[]) {
  const recoveredBySession = new Map(recoveredVisits.map((visit) => [visit.sessionId, visit]));
  const mergedStoredVisits = storedVisits.map((visit) => {
    const recovered = recoveredBySession.get(visit.sessionId);
    if (!recovered) {
      return visit;
    }
    recoveredBySession.delete(visit.sessionId);
    return {
      ...visit,
      ...recovered,
      flagTypes: mergeFlagTypes(visit.flagTypes, recovered.flagTypes ?? []),
      syncEventIds: mergeSyncEventIds(visit, recovered)
    };
  });
  return [...mergedStoredVisits, ...recoveredBySession.values()]
    .sort((left, right) => right.capturedAtLocal.localeCompare(left.capturedAtLocal));
}

function mergeSyncEventIds(left: Visit, right: Visit) {
  return [...new Set([...getVisitSyncEventIds(left), ...getVisitSyncEventIds(right)])];
}

function isRovingEvent(eventType: AttendanceEventType) {
  return eventType === 'visit_in' || eventType === 'visit_out';
}

function isPhotoRequired(eventType: AttendanceEventType) {
  return eventType === 'time_in' || eventType === 'time_out' || eventType === 'visit_in' || eventType === 'visit_out';
}

function getProvisionalFlagTypes(input: AttendanceRecorderInput) {
  const flagTypes: AttendanceFlagType[] = [];
  if (input.offlineDeclared) {
    flagTypes.push('offline_submission');
  }
  if (isPhotoRequired(input.eventType) && !input.photoPath?.trim()) {
    flagTypes.push('missing_photo');
  }
  return flagTypes;
}

function provisionalValidationStatus(input: AttendanceRecorderInput): Visit['validationStatus'] {
  return getProvisionalFlagTypes(input).length > 0 ? 'flagged' : 'normal';
}

function isVisitPending(visit: Visit, queuedEventIds: string[]) {
  return visit.serverStatus === 'pending' && getVisitSyncEventIds(visit).some((eventId) => queuedEventIds.includes(eventId));
}

function isVisitFailed(visit: Visit, failedEventIds: string[]) {
  return visit.serverStatus === 'failed' || getVisitSyncEventIds(visit).some((eventId) => failedEventIds.includes(eventId));
}

function getVisitSyncEventIds(visit: Visit) {
  return visit.syncEventIds ?? (visit.syncEventId ? [visit.syncEventId] : []);
}

function formatFlagType(flagType: AttendanceFlagType) {
  return flagType.replaceAll('_', ' ');
}

function formatLocalTime(isoDate: string) {
  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(isoDate));
}

function getTravelGapLabel(visits: Visit[]) {
  const lastDoneVisit = visits.find((visit) => visit.status === 'done' && visit.timeOut);
  if (!lastDoneVisit?.timeOut) {
    return 'First visit';
  }

  return `${getDurationLabel(lastDoneVisit.timeOutCapturedAtLocal, new Date().toISOString())} travel gap`;
}

function getDurationLabel(startTime: string | undefined, endTime: string | undefined) {
  if (!startTime || !endTime) {
    return 'In progress';
  }

  const minutes = Math.max(0, Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
  return formatMinutes(minutes);
}

function getVisitMinutes(visit: Visit) {
  if (!visit.timeIn || !visit.timeOut) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (new Date(visit.timeOutCapturedAtLocal ?? visit.timeOut).getTime() - new Date(visit.capturedAtLocal).getTime()) / 60000
    )
  );
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function getEndVisitTimeGapWarning(visit: Visit | undefined, thresholdMinutes: number) {
  if (!visit?.timeIn) {
    return null;
  }

  const gapMinutes = getMinutesSince(visit.capturedAtLocal);
  if (gapMinutes >= thresholdMinutes) {
    return null;
  }

  return {
    previousActionLabel: 'Start Visit',
    gapMinutes
  };
}

function getMinutesSince(capturedAtLocal: string) {
  return Math.max(0, Math.floor((new Date().getTime() - new Date(capturedAtLocal).getTime()) / 60000));
}

function getLocationByName(locationName: string, locations: Location[]) {
  return locations.find((location: { name: string }) => location.name === locationName) ?? locations[0];
}

function getSelectedLocationName(selectedLocationName: string, locations: Location[]) {
  return selectedLocationName || locations[0]?.name || '';
}

async function getGeoCheck(location: Location) {
  try {
    return await checkCurrentPositionAgainstLocation(location);
  } catch (error) {
    return getGpsUnavailableResult(location, error instanceof Error ? error.message : undefined);
  }
}

function createEmptyConfirmations(): RecorderConfirmations {
  return {
    gpsWarningAcknowledged: false,
    missingPhotoAcknowledged: false,
    shortGapAcknowledged: false
  };
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}
