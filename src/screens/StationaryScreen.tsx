import { useEffect, useMemo, useState } from 'react';
import { useMockAuth } from '../auth/useMockAuth';
import { ConsentGate } from '../components/ConsentGate';
import { Icon } from '../components/Icon';
import { LocationWarning } from '../components/LocationWarning';
import { ManualEditRequestPanel } from '../components/ManualEditRequestPanel';
import { MetricCard } from '../components/MetricCard';
import { PlatformNotice } from '../components/PlatformNotice';
import { Pill } from '../components/Pill';
import { TimeGapWarning } from '../components/TimeGapWarning';
import { locations } from '../data/mockData';
import type { AttendanceEvent, AttendanceEventType } from '../domain/types';
import { queueAttendanceEvent, offlineDb } from '../offline/offlineQueue';
import {
  checkCurrentPositionAgainstLocation,
  getGpsUnavailableResult,
  type GeoCheckResult
} from '../utils/geo';

const stationaryActionOrder: AttendanceEventType[] = ['time_in', 'lunch_out', 'lunch_in', 'time_out'];
const shortPunchGapConfirmationMinutes = 30;

const actionLabels: Record<AttendanceEventType, string> = {
  time_in: 'Time In',
  lunch_out: 'Lunch Out',
  lunch_in: 'Lunch In',
  time_out: 'Time Out',
  visit_in: 'Visit In',
  visit_out: 'Visit Out',
  gps_ping: 'GPS Ping'
};

export function StationaryScreen() {
  const { user } = useMockAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLocationWarning, setPendingLocationWarning] = useState<{
    action: AttendanceEventType;
    result: GeoCheckResult;
  } | null>(null);
  const [pendingTimeGapWarning, setPendingTimeGapWarning] = useState<{
    action: AttendanceEventType;
    geoCheck: GeoCheckResult;
    previousActionLabel: string;
    gapMinutes: number;
  } | null>(null);
  const [eventsByUser, setEventsByUser] = useState<Record<string, AttendanceEvent[]>>({});
  const events = useMemo(() => eventsByUser[user.id] ?? readStoredEvents(user.id), [eventsByUser, user.id]);
  const assignedLocation = useMemo(() => {
    return locations.find((location) => location.name === user.expectedLocation) ?? locations[0];
  }, [user.expectedLocation]);

  useEffect(() => {
    window.localStorage.setItem(getStorageKey(user.id), JSON.stringify(events));
  }, [events, user.id]);

  useEffect(() => {
    let active = true;

    async function refreshPendingCount() {
      const count = await offlineDb.pendingEvents.count();
      if (active) {
        setPendingCount(count);
      }
    }

    void refreshPendingCount();
    const timer = window.setInterval(refreshPendingCount, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const nextAction = useMemo(() => {
    const completedTypes = events.map((event) => event.type);
    return stationaryActionOrder.find((type) => !completedTypes.includes(type));
  }, [events]);

  const isClockedIn = events.some((event) => event.type === 'time_in') && !events.some((event) => event.type === 'time_out');
  const isOnLunch = events.some((event) => event.type === 'lunch_out') && !events.some((event) => event.type === 'lunch_in');
  const workedLabel = getWorkedLabel(events);

  async function handleAttendanceAction(action: AttendanceEventType) {
    if (action !== nextAction) {
      return;
    }

    const geoCheck = await getGeoCheck(assignedLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ action, result: geoCheck });
      return;
    }

    const timeGapWarning = getTimeGapWarning(action, events);
    if (timeGapWarning) {
      setPendingTimeGapWarning({ action, geoCheck, ...timeGapWarning });
      return;
    }

    await completeAttendanceAction(action, geoCheck, false);
  }

  async function completeAttendanceAction(
    action: AttendanceEventType,
    geoCheck: GeoCheckResult,
    warningAcknowledged: boolean
  ) {
    const pendingEvent = await queueAttendanceEvent(action, getQueueOptionsFromGeoCheck(geoCheck, warningAcknowledged));
    const localTime = formatLocalTime(pendingEvent.capturedAtLocal);
    const validationStatus =
      geoCheck.status !== 'normal'
        ? 'flagged'
        : action === 'lunch_in'
          ? 'overtime_candidate'
          : 'warning';

    const nextEvent: AttendanceEvent = {
      id: pendingEvent.clientEventId,
      type: action,
      label: actionLabels[action],
      localTime,
      serverStatus: 'pending',
      locationName: geoCheck.location.name,
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus,
      detail: getEventDetail(action, geoCheck)
    };

    setEventsByUser((currentEventsByUser) => {
      const currentEvents = currentEventsByUser[user.id] ?? readStoredEvents(user.id);
      return {
        ...currentEventsByUser,
        [user.id]: [...currentEvents, nextEvent]
      };
    });
    setPendingCount((currentCount) => currentCount + 1);
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
  }

  function resetDemoDay() {
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
          <p>{user.expectedLocation} · Shift {user.shift}</p>
        </div>
        <Pill tone={isClockedIn ? 'success' : 'neutral'}>{getStatusLabel(events)}</Pill>
      </header>
      <PlatformNotice />

      <article className="hero-card">
        <span className="eyebrow">Live</span>
        <strong className="clock-display">{getNowLabel()}<span>{isOnLunch ? ' break' : ' local'}</span></strong>
        <div className="hero-card-row">
          <span>Worked {workedLabel}</span>
          <span>Lunch fixed 1h</span>
        </div>
      </article>

      {user.locationConsentGivenAt ? (
        <>
          {pendingLocationWarning ? (
            <LocationWarning
              actionLabel={actionLabels[pendingLocationWarning.action]}
              result={pendingLocationWarning.result}
              onCancel={() => setPendingLocationWarning(null)}
              onConfirm={() =>
                void completeAttendanceAction(
                  pendingLocationWarning.action,
                  pendingLocationWarning.result,
                  true
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
                void completeAttendanceAction(
                  pendingTimeGapWarning.action,
                  pendingTimeGapWarning.geoCheck,
                  true
                )
              }
            />
          ) : null}
          <article className="status-panel">
            <div>
              <span className="eyebrow">Next allowed action</span>
              <strong>{nextAction ? actionLabels[nextAction] : 'Day complete'}</strong>
              <p>{getNextActionDetail(nextAction)}</p>
            </div>
            <button className="text-button" onClick={resetDemoDay}>Reset demo</button>
          </article>
          <div className="action-grid">
            {stationaryActionOrder.map((action) => (
              <button
                className={`action-button ${action !== nextAction ? 'quiet' : ''}`}
                disabled={action !== nextAction}
                key={action}
                onClick={() => void handleAttendanceAction(action)}
              >
                {actionLabels[action]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <ConsentGate />
      )}

      <div className="metric-grid">
        <MetricCard label="Regular" value={workedLabel} detail="Before lunch deduction" tone="indigo" />
        <MetricCard label="Pending sync" value={String(pendingCount)} detail="Sync on app open" tone="warn" />
      </div>

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

      <article className="panel">
        <div className="panel-title">
          <h2>Today’s Events</h2>
          <Pill tone="sync">Audit ready</Pill>
        </div>
        <div className="timeline">
          {events.length === 0 ? (
            <div className="empty-state">
              <strong>No punches yet</strong>
              <p>Time In starts the stationary workday. Later phases will send this to the API for server authorization and official timestamps.</p>
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

async function getGeoCheck(location: NonNullable<typeof locations[number]>) {
  try {
    return await checkCurrentPositionAgainstLocation(location);
  } catch (error) {
    return getGpsUnavailableResult(location, error instanceof Error ? error.message : undefined);
  }
}

function getQueueOptionsFromGeoCheck(geoCheck: GeoCheckResult, warningAcknowledged: boolean) {
  if (geoCheck.status === 'gps_unavailable') {
    return {
      locationName: geoCheck.location.name,
      outsideAllowedRadius: true,
      warningAcknowledged
    };
  }

  return {
    locationName: geoCheck.location.name,
    latitude: geoCheck.latitude,
    longitude: geoCheck.longitude,
    gpsAccuracyMeters: geoCheck.accuracyMeters,
    distanceMeters: geoCheck.distanceMeters,
    outsideAllowedRadius: geoCheck.status === 'outside_radius',
    warningAcknowledged
  };
}

function getEventDetail(action: AttendanceEventType, geoCheck: GeoCheckResult) {
  if (geoCheck.status !== 'normal') {
    return `${geoCheck.message} Flagged for manager/admin review.`;
  }

  if (action === 'lunch_in') {
    return `${geoCheck.message} Pending sync. Early lunch return may need manager review.`;
  }

  return `${geoCheck.message} Pending sync with captured GPS and device audit details.`;
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
    return JSON.parse(rawValue) as AttendanceEvent[];
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

function getWorkedLabel(events: AttendanceEvent[]) {
  const timeIn = events.find((event) => event.type === 'time_in');
  const timeOut = events.find((event) => event.type === 'time_out');

  if (!timeIn) {
    return '0h 00m';
  }

  const end = timeOut ? todayAt(timeOut.localTime) : new Date();
  const start = todayAt(timeIn.localTime);
  const diffMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function getTimeGapWarning(action: AttendanceEventType, events: AttendanceEvent[]) {
  const previousEvent = events.at(-1);
  if (!previousEvent) {
    return null;
  }

  const gapMinutes = Math.max(
    0,
    Math.floor((new Date().getTime() - todayAt(previousEvent.localTime).getTime()) / 60000)
  );

  if (gapMinutes >= shortPunchGapConfirmationMinutes) {
    return null;
  }

  return {
    previousActionLabel: actionLabels[previousEvent.type],
    actionLabel: actionLabels[action],
    gapMinutes
  };
}

function todayAt(timeLabel: string) {
  const [hour = '0', minute = '0'] = timeLabel.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date;
}
