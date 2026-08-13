import { useEffect, useMemo, useState } from 'react';
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
  AttendanceEvent,
  AttendanceEventType,
  AttendanceRecorderInput,
  AttendanceRecorderResult,
  Location
} from '../domain/types';
import { useAttendanceLocations } from '../hooks/useAttendanceLocations';
import { useAttendanceRules } from '../hooks/useAttendanceRules';
import { useOfflineAttendanceSync } from '../hooks/useOfflineAttendanceSync';
import {
  getAttendanceAcknowledgement,
  getAttendanceAcknowledgements,
  getQueuedAttendanceEventsForPresentation,
  getStationaryAttendancePresentation,
  saveStationaryAttendancePresentation
} from '../offline/offlineQueue';
import { getAttendanceRuleValue } from '../services/attendanceRulesService';
import { captureAttendanceEvent } from '../services/attendanceCaptureService';
import {
  checkCurrentPositionAgainstLocation,
  getGpsUnavailableResult,
  type GeoCheckResult
} from '../utils/geo';

const stationaryActionOrder: AttendanceEventType[] = ['time_in', 'lunch_out', 'lunch_in', 'time_out'];
const actionLabels: Record<AttendanceEventType, string> = {
  time_in: 'Time In',
  lunch_out: 'Lunch Out',
  lunch_in: 'Lunch In',
  time_out: 'Time Out',
  visit_in: 'Visit In',
  visit_out: 'Visit Out',
  gps_ping: 'GPS Ping'
};

type RecorderConfirmations = {
  gpsWarningAcknowledged: boolean;
  missingPhotoAcknowledged: boolean;
  shortGapAcknowledged: boolean;
};

export function StationaryScreen() {
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
  const [message, setMessage] = useState<string | null>(null);
  const [pendingLocationWarning, setPendingLocationWarning] = useState<{
    action: AttendanceEventType;
    result: GeoCheckResult;
  } | null>(null);
  const [pendingTimeGapWarning, setPendingTimeGapWarning] = useState<{
    action: AttendanceEventType;
    geoCheck: GeoCheckResult;
    previousActionLabel: string;
    gapMinutes: number;
    confirmations: RecorderConfirmations;
  } | null>(null);
  const [pendingPhotoWarning, setPendingPhotoWarning] = useState<{
    action: AttendanceEventType;
    geoCheck: GeoCheckResult;
    confirmations: RecorderConfirmations;
  } | null>(null);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [presentationUserId, setPresentationUserId] = useState<string | null>(null);
  const isPresentationLoaded = presentationUserId === user.id;
  const queueStateKey = `${offlineSync.failedEventIds.join(',')}:${offlineSync.queuedEventIds.join(',')}`;
  const assignedLocation = useMemo(() => {
    return locations?.find((location) => location.name === user.expectedLocation) ?? locations?.[0];
  }, [locations, user.expectedLocation]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getStationaryAttendancePresentation(user.id),
      getQueuedAttendanceEventsForPresentation(user.id),
      getAttendanceAcknowledgements(user.id)
    ]).then(([storedEvents, pendingEvents, acknowledgements]) => {
      if (active) {
        setEvents(mergeStationaryEvents(
          storedEvents ?? readLegacyStoredEvents(user.id),
          rebuildStationaryEvents(pendingEvents, acknowledgements) ?? []
        ));
        setPresentationUserId(user.id);
      }
    });
    return () => {
      active = false;
    };
  }, [queueStateKey, user.id]);

  useEffect(() => {
    if (isPresentationLoaded) {
      void saveStationaryAttendancePresentation(user.id, events);
    }
  }, [events, isPresentationLoaded, user.id]);

  useEffect(() => {
    const awaitingAcknowledgement = events.filter(
      (event) => event.serverStatus === 'pending' && !offlineSync.queuedEventIds.includes(event.id)
    );
    if (awaitingAcknowledgement.length === 0) {
      return;
    }

    void Promise.all(
      awaitingAcknowledgement.map(async (event) => ({
        event,
        result: await getAttendanceAcknowledgement(user.id, event.id)
      }))
    ).then((acknowledgements) => {
      const byClientEventId = new Map(
        acknowledgements
          .filter((item) => item.result)
          .map((item) => [item.event.id, item.result!])
      );
      if (byClientEventId.size === 0) {
        return;
      }
      setEvents((currentEvents) => currentEvents.map((event) => {
        const result = byClientEventId.get(event.id);
        return result ? applyAcknowledgement(event, result) : event;
      }));
    });
  }, [events, offlineSync.queuedEventIds, user.id]);

  const hasFailedEvents = offlineSync.legacyRecordCount > 0
    || offlineSync.failedEventIds.length > 0
    || events.some((event) => event.serverStatus === 'failed');
  const nextAction = useMemo(() => {
    if (hasFailedEvents) return undefined;
    const completedTypes = events.filter((event) => event.serverStatus !== 'failed').map((event) => event.type);
    return stationaryActionOrder.find((type) => !completedTypes.includes(type));
  }, [events, hasFailedEvents]);

  const completedEvents = events.filter((event) => event.serverStatus !== 'failed');
  const isClockedIn = completedEvents.some((event) => event.type === 'time_in') && !completedEvents.some((event) => event.type === 'time_out');
  const isOnLunch = completedEvents.some((event) => event.type === 'lunch_out') && !completedEvents.some((event) => event.type === 'lunch_in');
  const hasAvailableRules = Boolean(attendanceRules) && !hasRulesError;
  const hasAvailableLocations = Boolean(locations?.length) && !hasLocationsError;
  const hasNoPermittedLocations = locations?.length === 0 && !hasLocationsError;
  const hasAvailableCaptureSetup = isPresentationLoaded && hasAvailableRules && hasAvailableLocations && Boolean(assignedLocation);
  const lunchDeductionMinutes = attendanceRules
    ? getAttendanceRuleValue(attendanceRules, 'lunch_deduction_minutes')
    : null;
  const lunchDeductionLabel = lunchDeductionMinutes === null ? 'Unavailable' : formatDurationMinutes(lunchDeductionMinutes);
  const workedLabel = lunchDeductionMinutes === null ? 'Unavailable' : getWorkedLabel(events, lunchDeductionMinutes);
  const shortGapConfirmationMinutes = attendanceRules
    ? getAttendanceRuleValue(attendanceRules, 'short_attendance_gap_confirmation_minutes')
    : null;

  async function handleAttendanceAction(action: AttendanceEventType) {
    if (!hasAvailableCaptureSetup || !assignedLocation || action !== nextAction) {
      return;
    }

    const geoCheck = await getGeoCheck(assignedLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ action, result: geoCheck });
      return;
    }

    await continueAttendanceAction(action, geoCheck, createEmptyConfirmations());
  }

  async function continueAttendanceAction(
    action: AttendanceEventType,
    geoCheck: GeoCheckResult,
    confirmations: RecorderConfirmations
  ) {
    if (!hasAvailableCaptureSetup || action !== nextAction || isRecording) {
      return;
    }

    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);

    const timeGapWarning = confirmations.shortGapAcknowledged || shortGapConfirmationMinutes === null
      ? null
      : getTimeGapWarning(action, events, shortGapConfirmationMinutes);
    if (timeGapWarning) {
      setPendingTimeGapWarning({ action, geoCheck, confirmations, ...timeGapWarning });
      return;
    }

    if (isPhotoRequired(action) && !confirmations.missingPhotoAcknowledged) {
      setPendingPhotoWarning({ action, geoCheck, confirmations });
      return;
    }

    setIsRecording(true);
    setMessage(null);
    const capturedAtLocal = new Date().toISOString();
    const sessionId = action === 'time_in'
      ? undefined
      : events.find((event) => event.type === 'time_in')?.sessionId;
    const result = await captureAttendanceEvent(user.id, {
      clientEventId: crypto.randomUUID(),
      eventType: action,
      capturedAtLocal,
      locationId: geoCheck.location.id,
      sessionId,
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

    const nextEvent: AttendanceEvent = {
      id: result.data.record.eventId,
      sessionId: result.data.record.sessionId,
      capturedAtLocal,
      workDate: result.data.record.workDate,
      type: action,
      label: actionLabels[action],
      localTime: formatLocalTime(capturedAtLocal),
      serverStatus: result.data.delivery === 'queued' ? 'pending' : 'synced',
      locationName: geoCheck.location.name,
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus: result.data.record.validationStatus,
      flagTypes: result.data.record.flagTypes,
      detail: getEventDetail(geoCheck, result.data.record)
    };

    setEvents((currentEvents) => [...currentEvents, nextEvent]);
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
    setPendingPhotoWarning(null);
  }

  function resetDemoDay() {
    if (!isMockAuthMode()) {
      return;
    }
    setEvents([]);
  }

  return (
    <section className="screen mobile-first">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Tuesday · May 5</span>
          <h1>Stationary Attendance</h1>
          <p>{assignedLocation?.name ?? user.expectedLocation} · Shift {user.shift}</p>
        </div>
        <Pill tone={isClockedIn ? 'success' : 'neutral'}>{getStatusLabel(events)}</Pill>
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

      <article className="hero-card">
        <span className="eyebrow">Live</span>
        <strong className="clock-display">{getNowLabel()}<span>{isOnLunch ? ' break' : ' local'}</span></strong>
        <div className="hero-card-row">
          <span>Worked {workedLabel}</span>
          <span>Lunch fixed {lunchDeductionLabel}</span>
        </div>
      </article>

      {!user.locationConsentGivenAt ? <ConsentGate /> : null}

      {user.locationConsentGivenAt && hasAvailableCaptureSetup ? (
        <>
          {pendingLocationWarning ? (
            <LocationWarning
              actionLabel={actionLabels[pendingLocationWarning.action]}
              result={pendingLocationWarning.result}
              onCancel={() => setPendingLocationWarning(null)}
              onConfirm={() =>
                void continueAttendanceAction(
                  pendingLocationWarning.action,
                  pendingLocationWarning.result,
                  { ...createEmptyConfirmations(), gpsWarningAcknowledged: true }
                )
              }
            />
          ) : null}
          {pendingTimeGapWarning ? (
            <TimeGapWarning
              actionLabel={actionLabels[pendingTimeGapWarning.action]}
              previousActionLabel={pendingTimeGapWarning.previousActionLabel}
              gapMinutes={pendingTimeGapWarning.gapMinutes}
              onCancel={() => setPendingTimeGapWarning(null)}
              onConfirm={() =>
                void continueAttendanceAction(
                  pendingTimeGapWarning.action,
                  pendingTimeGapWarning.geoCheck,
                  { ...pendingTimeGapWarning.confirmations, shortGapAcknowledged: true }
                )
              }
            />
          ) : null}
          {pendingPhotoWarning ? (
            <MissingPhotoWarning
              actionLabel={actionLabels[pendingPhotoWarning.action]}
              onCancel={() => setPendingPhotoWarning(null)}
              onConfirm={() =>
                void continueAttendanceAction(
                  pendingPhotoWarning.action,
                  pendingPhotoWarning.geoCheck,
                  { ...pendingPhotoWarning.confirmations, missingPhotoAcknowledged: true }
                )
              }
            />
          ) : null}
          {message ? <p className="form-warning">{message}</p> : null}
          <article className="status-panel">
            <div>
              <span className="eyebrow">Next allowed action</span>
              <strong>{hasFailedEvents ? 'Attendance needs attention' : nextAction ? actionLabels[nextAction] : 'Day complete'}</strong>
              <p>{hasFailedEvents ? 'Resolve the failed attendance action before recording another action.' : getNextActionDetail(nextAction)}</p>
            </div>
            {isMockAuthMode() ? <button className="text-button" onClick={resetDemoDay}>Reset demo</button> : null}
          </article>
          <div className="action-grid">
            {stationaryActionOrder.map((action) => (
              <button
                className={`action-button ${action !== nextAction ? 'quiet' : ''}`}
                disabled={action !== nextAction || isRecording}
                key={action}
                onClick={() => void handleAttendanceAction(action)}
              >
                {actionLabels[action]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="metric-grid">
        <MetricCard label="Regular" value={workedLabel} detail={`After ${lunchDeductionLabel} lunch deduction`} tone="indigo" />
        <MetricCard label="Recorded" value={String(completedEvents.length)} detail="Submitted through attendance recorder" tone="success" />
      </div>

      {assignedLocation ? (
      <article className="panel">
        <div className="panel-title">
          <h2>Assigned Location</h2>
          <Pill tone="success">Radius {assignedLocation.radiusMeters}m</Pill>
        </div>
        <div className="location-row">
          <div className="map-placeholder"><Icon name="pin" size={26} /></div>
          <div>
            <strong>{assignedLocation.name}</strong>
            <p>{assignedLocation.address} · GPS captured on each attendance action</p>
          </div>
        </div>
      </article>
      ) : null}

      <article className="panel">
        <div className="panel-title">
          <h2>Today’s Events</h2>
          <Pill tone="sync">Audit ready</Pill>
        </div>
        <div className="timeline">
          {events.length === 0 ? (
            <div className="empty-state">
              <strong>No punches yet</strong>
              <p>Time In starts the stationary workday and is recorded with server-side authorization.</p>
            </div>
          ) : null}
          {events.map((event) => (
            <div className="timeline-item" key={event.id}>
              <time>{event.localTime}</time>
              <div>
                <strong>{event.label}</strong>
                <p>{event.detail}</p>
              </div>
              <Pill tone={isEventFailed(event, offlineSync.failedEventIds) ? 'warn' : isEventPending(event, offlineSync.queuedEventIds) ? 'sync' : event.validationStatus === 'flagged' ? 'flag' : 'success'}>
                {isEventFailed(event, offlineSync.failedEventIds) ? 'needs attention' : isEventPending(event, offlineSync.queuedEventIds) ? 'pending' : event.validationStatus === 'flagged' ? 'flagged' : 'synced'}
              </Pill>
            </div>
          ))}
        </div>
      </article>

      <ManualEditRequestPanel user={user} />
    </section>
  );
}

async function getGeoCheck(location: Location) {
  try {
    return await checkCurrentPositionAgainstLocation(location);
  } catch (error) {
    return getGpsUnavailableResult(location, error instanceof Error ? error.message : undefined);
  }
}

function getEventDetail(geoCheck: GeoCheckResult, result: AttendanceRecorderResult) {
  if (result.flagTypes.length > 0) {
    return `${geoCheck.message} Flags: ${result.flagTypes.map(formatFlagType).join(', ')}. Flagged for manager or admin review.`;
  }

  return `${geoCheck.message} Recorded at ${formatLocalTime(result.receivedAtServer)}.`;
}

function formatFlagType(flagType: AttendanceRecorderResult['flagTypes'][number]) {
  return flagType.replaceAll('_', ' ');
}

function isEventPending(event: AttendanceEvent, queuedEventIds: string[]) {
  return event.serverStatus === 'pending' && queuedEventIds.includes(event.id);
}

function isEventFailed(event: AttendanceEvent, failedEventIds: string[]) {
  return event.serverStatus === 'failed' || failedEventIds.includes(event.id);
}

function applyAcknowledgement(event: AttendanceEvent, result: AttendanceRecorderResult): AttendanceEvent {
  return {
    ...event,
    id: result.eventId,
    serverStatus: 'synced',
    validationStatus: result.validationStatus,
    flagTypes: result.flagTypes,
    detail: result.flagTypes.length
      ? `Synced. Flags: ${result.flagTypes.map(formatFlagType).join(', ')}. Flagged for manager or admin review.`
      : `Synced at ${formatLocalTime(result.receivedAtServer)}.`
  };
}

function readLegacyStoredEvents(userId: string): AttendanceEvent[] {
  const rawValue = window.localStorage.getItem(`stationary-events:${userId}`);
  if (!rawValue) {
    return [];
  }

  try {
    const events = JSON.parse(rawValue) as AttendanceEvent[];
    return events.every((event) => Boolean(event.sessionId && event.capturedAtLocal)) ? events : [];
  } catch {
    return [];
  }
}

function rebuildStationaryEvents(
  pendingEvents: Array<AttendanceRecorderInput & { syncStatus: 'pending' | 'syncing' | 'failed' }>,
  acknowledgements: Array<{ input: AttendanceRecorderInput; result: AttendanceRecorderResult }>
): AttendanceEvent[] | null {
  const stationaryAcknowledgements = acknowledgements.filter((item) => !isRovingEvent(item.input.eventType));
  const acknowledgedIds = new Set(stationaryAcknowledgements.map((item) => item.input.clientEventId));
  const stationaryPending = pendingEvents.filter(
    (event) => !isRovingEvent(event.eventType)
      && !acknowledgedIds.has(event.clientEventId)
  );
  if (stationaryAcknowledgements.length === 0 && stationaryPending.length === 0) {
    return null;
  }

  return [
    ...stationaryAcknowledgements.map(({ input, result }) => ({
      id: result.eventId,
      sessionId: result.sessionId,
      capturedAtLocal: input.capturedAtLocal,
      workDate: result.workDate,
      type: input.eventType,
      label: actionLabels[input.eventType],
      localTime: formatLocalTime(input.capturedAtLocal),
      serverStatus: 'synced' as const,
      locationName: input.locationId,
      validationStatus: result.validationStatus,
      flagTypes: result.flagTypes,
      detail: result.flagTypes.length ? `Synced. Flags: ${result.flagTypes.map(formatFlagType).join(', ')}.` : 'Synced.'
    })),
    ...stationaryPending.map((input) => ({
      id: input.clientEventId,
      sessionId: input.sessionId ?? input.clientEventId,
      capturedAtLocal: input.capturedAtLocal,
      workDate: getWorkDate(input.capturedAtLocal),
      type: input.eventType,
      label: actionLabels[input.eventType],
      localTime: formatLocalTime(input.capturedAtLocal),
      serverStatus: input.syncStatus === 'failed' ? 'failed' as const : 'pending' as const,
      locationName: input.locationId,
      validationStatus: input.offlineDeclared || input.missingPhotoAcknowledged ? 'flagged' as const : 'normal' as const,
      flagTypes: getProvisionalFlagTypes(input),
      detail: input.syncStatus === 'failed'
        ? 'This attendance action needs attention before another action can be recorded.'
        : 'Saved on this device and waiting to sync.'
    }))
  ].sort((left, right) => left.capturedAtLocal.localeCompare(right.capturedAtLocal));
}

function mergeStationaryEvents(storedEvents: AttendanceEvent[], recoveredEvents: AttendanceEvent[]) {
  const recoveredByIdentity = new Map(recoveredEvents.map((event) => [getEventIdentity(event), event]));
  const mergedStoredEvents = storedEvents.map((event) => {
    const recovered = recoveredByIdentity.get(getEventIdentity(event));
    if (!recovered) {
      return event;
    }
    recoveredByIdentity.delete(getEventIdentity(event));
    return recovered;
  });
  return getCurrentStationarySessionEvents([...mergedStoredEvents, ...recoveredByIdentity.values()])
    .sort((left, right) => left.capturedAtLocal.localeCompare(right.capturedAtLocal));
}

function getEventIdentity(event: AttendanceEvent) {
  return `${event.sessionId}:${event.type}:${event.capturedAtLocal}`;
}

function getCurrentStationarySessionEvents(events: AttendanceEvent[]) {
  const today = getWorkDate(new Date().toISOString());
  const eventsBySession = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    eventsBySession.set(event.sessionId, [...(eventsBySession.get(event.sessionId) ?? []), event]);
  }
  const eligibleSessions = [...eventsBySession.values()].flatMap((sessionEvents) => {
    const timeIn = sessionEvents.find((event) => event.type === 'time_in');
    const workDate = timeIn?.workDate ?? (timeIn ? getWorkDate(timeIn.capturedAtLocal) : undefined);
    const isOpen = !sessionEvents.some((event) => event.type === 'time_out' && event.serverStatus !== 'failed');
    return workDate === today || isOpen ? [{ sessionEvents, workDate, isOpen }] : [];
  });
  const selected = eligibleSessions
    .sort((left, right) => {
      // An unfinished session must be resolved before a newer day can accept another action.
      const leftPriority = left.isOpen ? 1 : left.workDate === today ? 0 : -1;
      const rightPriority = right.isOpen ? 1 : right.workDate === today ? 0 : -1;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.sessionEvents[0].capturedAtLocal.localeCompare(right.sessionEvents[0].capturedAtLocal);
    })
    .at(0);
  return selected?.sessionEvents ?? [];
}

function getWorkDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(timestamp));
}

function isRovingEvent(eventType: AttendanceEventType) {
  return eventType === 'visit_in' || eventType === 'visit_out';
}

function getProvisionalFlagTypes(input: AttendanceRecorderInput) {
  const flagTypes: AttendanceRecorderResult['flagTypes'] = [];
  if (input.offlineDeclared) {
    flagTypes.push('offline_submission');
  }
  if (isPhotoRequired(input.eventType) && !input.photoPath?.trim()) {
    flagTypes.push('missing_photo');
  }
  return flagTypes;
}

function formatLocalTime(isoDate: string) {
  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(isoDate));
}

function getNowLabel() {
  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

function getStatusLabel(events: AttendanceEvent[]) {
  const completedEvents = events.filter((event) => event.serverStatus !== 'failed');
  if (completedEvents.some((event) => event.type === 'time_out')) {
    return 'Timed out';
  }

  if (completedEvents.some((event) => event.type === 'lunch_out') && !completedEvents.some((event) => event.type === 'lunch_in')) {
    return 'On lunch';
  }

  if (completedEvents.some((event) => event.type === 'time_in')) {
    return 'Timed in';
  }

  return 'Not timed in';
}

function getNextActionDetail(nextAction: AttendanceEventType | undefined) {
  if (!nextAction) {
    return 'The stationary session is closed for this work date.';
  }

  if (nextAction === 'time_in') {
    return 'Creates one stationary session for the work date.';
  }

  if (nextAction === 'lunch_out') {
    return 'Starts the unpaid lunch interval.';
  }

  if (nextAction === 'lunch_in') {
    return 'Resumes work and may create an overtime candidate if lunch is too short.';
  }

  return 'Closes the stationary session for the work date.';
}

function getWorkedLabel(events: AttendanceEvent[], lunchDeductionMinutes: number) {
  const completedEvents = events.filter((event) => event.serverStatus !== 'failed');
  const timeIn = completedEvents.find((event) => event.type === 'time_in');
  const timeOut = completedEvents.find((event) => event.type === 'time_out');

  if (!timeIn) {
    return '0h 00m';
  }

  const end = timeOut ? new Date(timeOut.capturedAtLocal) : new Date();
  const start = new Date(timeIn.capturedAtLocal);
  const diffMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const payableMinutes = completedEvents.some((event) => event.type === 'lunch_out')
    ? Math.max(0, diffMinutes - lunchDeductionMinutes)
    : diffMinutes;

  return formatDurationMinutes(payableMinutes);
}

function getTimeGapWarning(action: AttendanceEventType, events: AttendanceEvent[], thresholdMinutes: number) {
  const previousEvent = events.at(-1);
  if (!previousEvent) {
    return null;
  }

  const gapMinutes = Math.max(
    0,
    Math.floor((new Date().getTime() - new Date(previousEvent.capturedAtLocal).getTime()) / 60000)
  );

  if (gapMinutes >= thresholdMinutes) {
    return null;
  }

  return {
    previousActionLabel: actionLabels[previousEvent.type],
    actionLabel: actionLabels[action],
    gapMinutes
  };
}

function createEmptyConfirmations(): RecorderConfirmations {
  return {
    gpsWarningAcknowledged: false,
    missingPhotoAcknowledged: false,
    shortGapAcknowledged: false
  };
}

function isPhotoRequired(action: AttendanceEventType) {
  return action === 'time_in' || action === 'time_out';
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}

function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
