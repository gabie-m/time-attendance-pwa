import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { ConsentGate } from '../components/ConsentGate';
import { Icon } from '../components/Icon';
import { LocationWarning } from '../components/LocationWarning';
import { ManualEditRequestPanel } from '../components/ManualEditRequestPanel';
import { MetricCard } from '../components/MetricCard';
import { MissingPhotoWarning } from '../components/MissingPhotoWarning';
import { PlatformNotice } from '../components/PlatformNotice';
import { Pill } from '../components/Pill';
import { TimeGapWarning } from '../components/TimeGapWarning';
import type { AttendanceEvent, AttendanceEventType, AttendanceRecorderResult, Location } from '../domain/types';
import { useAttendanceLocations } from '../hooks/useAttendanceLocations';
import { useAttendanceRules } from '../hooks/useAttendanceRules';
import { getAttendanceRuleValue } from '../services/attendanceRulesService';
import { recordAttendanceEvent } from '../services/attendanceRecorderService';
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
  const [eventsByUser, setEventsByUser] = useState<Record<string, AttendanceEvent[]>>({});
  const events = useMemo(() => eventsByUser[user.id] ?? readStoredEvents(user.id), [eventsByUser, user.id]);
  const assignedLocation = useMemo(() => {
    return locations?.find((location) => location.name === user.expectedLocation) ?? locations?.[0];
  }, [locations, user.expectedLocation]);

  useEffect(() => {
    window.localStorage.setItem(getStorageKey(user.id), JSON.stringify(events));
  }, [events, user.id]);

  const nextAction = useMemo(() => {
    const completedTypes = events.map((event) => event.type);
    return stationaryActionOrder.find((type) => !completedTypes.includes(type));
  }, [events]);

  const isClockedIn = events.some((event) => event.type === 'time_in') && !events.some((event) => event.type === 'time_out');
  const isOnLunch = events.some((event) => event.type === 'lunch_out') && !events.some((event) => event.type === 'lunch_in');
  const hasAvailableRules = Boolean(attendanceRules) && !hasRulesError;
  const hasAvailableLocations = Boolean(locations?.length) && !hasLocationsError;
  const hasNoPermittedLocations = locations?.length === 0 && !hasLocationsError;
  const hasAvailableCaptureSetup = hasAvailableRules && hasAvailableLocations && Boolean(assignedLocation);
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
    const result = await recordAttendanceEvent({
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
      id: result.data.eventId,
      sessionId: result.data.sessionId,
      capturedAtLocal,
      type: action,
      label: actionLabels[action],
      localTime: formatLocalTime(capturedAtLocal),
      serverStatus: 'synced',
      locationName: geoCheck.location.name,
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus: result.data.validationStatus,
      detail: getEventDetail(geoCheck, result.data)
    };

    setEventsByUser((currentEventsByUser) => {
      const currentEvents = currentEventsByUser[user.id] ?? readStoredEvents(user.id);
      return {
        ...currentEventsByUser,
        [user.id]: [...currentEvents, nextEvent]
      };
    });
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
    setPendingPhotoWarning(null);
  }

  function resetDemoDay() {
    if (!isMockAuthMode()) {
      return;
    }
    setEventsByUser((currentEventsByUser) => ({
      ...currentEventsByUser,
      [user.id]: []
    }));
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
              <strong>{nextAction ? actionLabels[nextAction] : 'Day complete'}</strong>
              <p>{getNextActionDetail(nextAction)}</p>
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
        <MetricCard label="Recorded" value={String(events.length)} detail="Submitted through attendance recorder" tone="success" />
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
              <Pill tone={event.validationStatus === 'flagged' ? 'flag' : event.serverStatus === 'pending' ? 'sync' : 'success'}>
                {event.validationStatus === 'flagged' ? 'flagged' : event.serverStatus}
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
    return `${geoCheck.message} Flagged for manager or admin review.`;
  }

  return `${geoCheck.message} Recorded at ${formatLocalTime(result.receivedAtServer)}.`;
}

function getStorageKey(userId: string) {
  return `stationary-events:${userId}`;
}

function readStoredEvents(userId: string): AttendanceEvent[] {
  const rawValue = window.localStorage.getItem(getStorageKey(userId));
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
  if (events.some((event) => event.type === 'time_out')) {
    return 'Timed out';
  }

  if (events.some((event) => event.type === 'lunch_out') && !events.some((event) => event.type === 'lunch_in')) {
    return 'On lunch';
  }

  if (events.some((event) => event.type === 'time_in')) {
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
  const timeIn = events.find((event) => event.type === 'time_in');
  const timeOut = events.find((event) => event.type === 'time_out');

  if (!timeIn) {
    return '0h 00m';
  }

  const end = timeOut ? new Date(timeOut.capturedAtLocal) : new Date();
  const start = new Date(timeIn.capturedAtLocal);
  const diffMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const payableMinutes = events.some((event) => event.type === 'lunch_out')
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
