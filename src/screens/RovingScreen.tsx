import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { ConsentGate } from '../components/ConsentGate';
import { Icon } from '../components/Icon';
import { LocationWarning } from '../components/LocationWarning';
import { ManualEditRequestPanel } from '../components/ManualEditRequestPanel';
import { MetricCard } from '../components/MetricCard';
import { PlatformNotice } from '../components/PlatformNotice';
import { Pill } from '../components/Pill';
import { TimeGapWarning } from '../components/TimeGapWarning';
import type { Location, Visit } from '../domain/types';
import { offlineDb, queueAttendanceEvent } from '../offline/offlineQueue';
import { useMockLocations } from '../services/mockLocationService';
import {
  checkCurrentPositionAgainstLocation,
  getGpsUnavailableResult,
  type GeoCheckResult
} from '../utils/geo';

const purposes = ['Inventory check', 'Promo audit', 'Staff coaching', 'Stock replenishment', 'Client meeting'];
const shortAttendanceGapConfirmationMinutes = 30;

export function RovingScreen() {
  const { user: authUser } = useAuth();
  const user = authUser!;
  const locations = useMockLocations();
  const [pendingCount, setPendingCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [selectedLocationName, setSelectedLocationName] = useState(locations[0]?.name ?? '');
  const [selectedPurpose, setSelectedPurpose] = useState(purposes[0]);
  const [pendingLocationWarning, setPendingLocationWarning] = useState<{
    type: 'start' | 'end';
    result: GeoCheckResult;
    visitId?: string;
  } | null>(null);
  const [pendingTimeGapWarning, setPendingTimeGapWarning] = useState<{
    type: 'start' | 'end';
    previousActionLabel: string;
    gapMinutes: number;
    visitId?: string;
  } | null>(null);
  const [visitsByUser, setVisitsByUser] = useState<Record<string, Visit[]>>({});
  const visits = useMemo(() => visitsByUser[user.id] ?? readStoredVisits(user.id), [user.id, visitsByUser]);
  const activeVisit = visits.find((visit) => visit.status === 'active');
  const doneVisits = visits.filter((visit) => visit.status === 'done');
  const totalVisitMinutes = doneVisits.reduce((sum, visit) => sum + getVisitMinutes(visit), 0);

  useEffect(() => {
    window.localStorage.setItem(getStorageKey(user.id), JSON.stringify(visits));
  }, [user.id, visits]);

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

  async function startVisit() {
    if (activeVisit) {
      return;
    }

    const selectedLocation = getLocationByName(getSelectedLocationName(selectedLocationName, locations), locations);
    const geoCheck = await getGeoCheck(selectedLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ type: 'start', result: geoCheck });
      return;
    }

    await completeStartVisit(geoCheck, false);
  }

  async function completeStartVisit(geoCheck: GeoCheckResult, warningAcknowledged: boolean) {
    const pendingEvent = await queueAttendanceEvent('visit_in', getQueueOptionsFromGeoCheck(geoCheck, warningAcknowledged));
    const localTime = formatLocalTime(pendingEvent.capturedAtLocal);
    const nextVisit: Visit = {
      id: pendingEvent.clientEventId,
      status: 'active',
      locationName: geoCheck.location.name,
      purpose: selectedPurpose,
      timeIn: localTime,
      duration: 'In progress',
      travelFromPrevious: getTravelGapLabel(visits),
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus: geoCheck.status === 'normal' ? 'warning' : 'flagged'
    };

    setVisitsByUser((currentVisitsByUser) => {
      const currentVisits = currentVisitsByUser[user.id] ?? readStoredVisits(user.id);
      return {
        ...currentVisitsByUser,
        [user.id]: [nextVisit, ...currentVisits]
      };
    });
    setPendingCount((currentCount) => currentCount + 1);
    setShowForm(false);
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
  }

  async function endVisit(visitId: string) {
    const visit = visits.find((item) => item.id === visitId);
    const timeGapWarning = getEndVisitTimeGapWarning(visit);
    if (timeGapWarning) {
      setPendingTimeGapWarning({ type: 'end', visitId, ...timeGapWarning });
      return;
    }

    await endVisitAfterTimeConfirmation(visitId);
  }

  async function endVisitAfterTimeConfirmation(visitId: string) {
    setPendingTimeGapWarning(null);
    const visit = visits.find((item) => item.id === visitId);
    const visitLocation = getLocationByName(visit?.locationName ?? getSelectedLocationName(selectedLocationName, locations), locations);
    const geoCheck = await getGeoCheck(visitLocation);
    if (geoCheck.status !== 'normal') {
      setPendingLocationWarning({ type: 'end', result: geoCheck, visitId });
      return;
    }

    await completeEndVisit(visitId, geoCheck, false);
  }

  async function completeEndVisit(visitId: string, geoCheck: GeoCheckResult, warningAcknowledged: boolean) {
    const pendingEvent = await queueAttendanceEvent('visit_out', getQueueOptionsFromGeoCheck(geoCheck, warningAcknowledged));
    const localTime = formatLocalTime(pendingEvent.capturedAtLocal);

    setVisitsByUser((currentVisitsByUser) => {
      const currentVisits = currentVisitsByUser[user.id] ?? readStoredVisits(user.id);
      return {
        ...currentVisitsByUser,
        [user.id]: currentVisits.map((visit) => {
          if (visit.id !== visitId) {
            return visit;
          }

          return {
            ...visit,
            status: 'done',
            timeOut: localTime,
            duration: getDurationLabel(visit.timeIn, localTime),
            distanceMeters: geoCheck.status === 'gps_unavailable' ? visit.distanceMeters : geoCheck.distanceMeters,
            validationStatus: geoCheck.status === 'normal' && visit.validationStatus !== 'flagged' ? 'warning' : 'flagged'
          };
        })
      };
    });
    setPendingCount((currentCount) => currentCount + 1);
    setPendingLocationWarning(null);
    setPendingTimeGapWarning(null);
  }

  function resetDemoDay() {
    setVisitsByUser((currentVisitsByUser) => ({
      ...currentVisitsByUser,
      [user.id]: []
    }));
    setShowForm(false);
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

      <div className="metric-grid">
        <MetricCard label="Visits" value={String(visits.length)} detail={`${doneVisits.length} done · ${activeVisit ? '1 active' : '0 active'}`} />
        <MetricCard label="On-site" value={formatMinutes(totalVisitMinutes)} detail="Travel excluded" tone="success" />
        <MetricCard label="Pending sync" value={String(pendingCount)} detail="Sync on app open" tone="warn" />
        <MetricCard label="Travel" value="Paid" detail="Non-productive, separate" tone="indigo" />
      </div>

      {user.locationConsentGivenAt ? (
        <>
          {pendingLocationWarning ? (
            <LocationWarning
              actionLabel={pendingLocationWarning.type === 'start' ? 'Start Visit' : 'End Visit'}
              result={pendingLocationWarning.result}
              onCancel={() => setPendingLocationWarning(null)}
              onConfirm={() =>
                pendingLocationWarning.type === 'start'
                  ? void completeStartVisit(pendingLocationWarning.result, true)
                  : void completeEndVisit(
                      pendingLocationWarning.visitId ?? '',
                      pendingLocationWarning.result,
                      true
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
                  : void endVisitAfterTimeConfirmation(pendingTimeGapWarning.visitId ?? '')
              }
            />
          ) : null}
          <article className="status-panel">
            <div>
              <span className="eyebrow">Roving rule</span>
              <strong>{activeVisit ? 'Visit in progress' : 'Ready for next visit'}</strong>
              <p>{activeVisit ? 'Close your current visit before starting a new one.' : 'Travel gaps are paid but reported separately.'}</p>
            </div>
            <button className="text-button" onClick={resetDemoDay}>Reset demo</button>
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
                <button onClick={() => void startVisit()} disabled={Boolean(activeVisit)}>Start Visit</button>
                <button className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </article>
          ) : (
            <button className="action-button full" onClick={() => setShowForm(true)} disabled={Boolean(activeVisit)}>
              <Icon name="plus" />
              Add Visit
            </button>
          )}
        </>
      ) : (
        <ConsentGate />
      )}

      <div className="visit-list">
        {visits.length === 0 ? (
          <div className="empty-state">
            <strong>No visits yet</strong>
            <p>Add Visit starts a location session. Later phases will enforce this again through the API and database constraints.</p>
          </div>
        ) : null}
        {visits.map((visit) => (
          <article className="visit-card" key={visit.id}>
            <div>
              <div className="visit-card-top">
                <h2>{visit.locationName}</h2>
                <Pill tone={visit.validationStatus === 'flagged' ? 'flag' : visit.status === 'active' ? 'warn' : visit.status === 'done' ? 'success' : 'neutral'}>
                  {visit.validationStatus === 'flagged' ? 'flagged' : visit.status}
                </Pill>
              </div>
              <p>{visit.purpose}</p>
            </div>
            <div className="visit-meta">
              <span>{visit.timeIn ?? '--'} → {visit.timeOut ?? '--'}</span>
              <strong>{visit.duration}</strong>
              <small>{visit.distanceMeters ? `${visit.distanceMeters}m from selected location` : visit.travelFromPrevious}</small>
            </div>
            {visit.status === 'active' ? (
              <button className="action-button full" onClick={() => void endVisit(visit.id)}>
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

function getStorageKey(userId: string) {
  return `roving-visits:${userId}`;
}

function readStoredVisits(userId: string): Visit[] {
  const rawValue = window.localStorage.getItem(getStorageKey(userId));
  if (!rawValue) {
    return [];
  }

  try {
    return JSON.parse(rawValue) as Visit[];
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

function getTravelGapLabel(visits: Visit[]) {
  const lastDoneVisit = visits.find((visit) => visit.status === 'done' && visit.timeOut);
  if (!lastDoneVisit?.timeOut) {
    return 'First visit';
  }

  return `${getDurationLabel(lastDoneVisit.timeOut, formatLocalTime(new Date().toISOString()))} travel gap`;
}

function getDurationLabel(startTime: string | undefined, endTime: string | undefined) {
  if (!startTime || !endTime) {
    return 'In progress';
  }

  const minutes = Math.max(0, Math.floor((todayAt(endTime).getTime() - todayAt(startTime).getTime()) / 60000));
  return formatMinutes(minutes);
}

function getVisitMinutes(visit: Visit) {
  if (!visit.timeIn || !visit.timeOut) {
    return 0;
  }

  return Math.max(0, Math.floor((todayAt(visit.timeOut).getTime() - todayAt(visit.timeIn).getTime()) / 60000));
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function todayAt(timeLabel: string) {
  const [hour = '0', minute = '0'] = timeLabel.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date;
}

function getEndVisitTimeGapWarning(visit: Visit | undefined) {
  if (!visit?.timeIn) {
    return null;
  }

  const gapMinutes = getMinutesSince(visit.timeIn);
  if (gapMinutes >= shortAttendanceGapConfirmationMinutes) {
    return null;
  }

  return {
    previousActionLabel: 'Start Visit',
    gapMinutes
  };
}

function getMinutesSince(timeLabel: string) {
  return Math.max(0, Math.floor((new Date().getTime() - todayAt(timeLabel).getTime()) / 60000));
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
