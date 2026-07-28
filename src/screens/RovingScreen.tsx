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
import type { Location, Visit } from '../domain/types';
import { useAttendanceLocations } from '../hooks/useAttendanceLocations';
import { useAttendanceRules } from '../hooks/useAttendanceRules';
import { getAttendanceRuleValue } from '../services/attendanceRulesService';
import { recordAttendanceEvent } from '../services/attendanceRecorderService';
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
  const [visitsByUser, setVisitsByUser] = useState<Record<string, Visit[]>>({});
  const visits = useMemo(() => visitsByUser[user.id] ?? readStoredVisits(user.id), [user.id, visitsByUser]);
  const activeVisit = visits.find((visit) => visit.status === 'active');
  const doneVisits = visits.filter((visit) => visit.status === 'done');
  const totalVisitMinutes = doneVisits.reduce((sum, visit) => sum + getVisitMinutes(visit), 0);
  const shortGapConfirmationMinutes = attendanceRules
    ? getAttendanceRuleValue(attendanceRules, 'short_attendance_gap_confirmation_minutes')
    : null;
  const hasAvailableRules = Boolean(attendanceRules) && !hasRulesError;
  const hasAvailableLocations = Boolean(locations?.length) && !hasLocationsError;
  const hasNoPermittedLocations = locations?.length === 0 && !hasLocationsError;
  const hasAvailableCaptureSetup = hasAvailableRules && hasAvailableLocations;

  useEffect(() => {
    window.localStorage.setItem(getStorageKey(user.id), JSON.stringify(visits));
  }, [user.id, visits]);

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
    const result = await recordAttendanceEvent({
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
      id: result.data.sessionId,
      sessionId: result.data.sessionId,
      capturedAtLocal,
      status: 'active',
      locationName: geoCheck.location.name,
      purpose: selectedPurpose,
      timeIn: localTime,
      duration: 'In progress',
      travelFromPrevious: getTravelGapLabel(visits),
      distanceMeters: geoCheck.status === 'gps_unavailable' ? undefined : geoCheck.distanceMeters,
      validationStatus: result.data.validationStatus
    };

    setVisitsByUser((currentVisitsByUser) => {
      const currentVisits = currentVisitsByUser[user.id] ?? readStoredVisits(user.id);
      return {
        ...currentVisitsByUser,
        [user.id]: [nextVisit, ...currentVisits]
      };
    });
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
    const result = await recordAttendanceEvent({
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
            timeOutCapturedAtLocal: capturedAtLocal,
            duration: getDurationLabel(visit.capturedAtLocal, capturedAtLocal),
            distanceMeters: geoCheck.status === 'gps_unavailable' ? visit.distanceMeters : geoCheck.distanceMeters,
            validationStatus: result.data.validationStatus
          };
        })
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
        <MetricCard label="Visits" value={String(visits.length)} detail={`${doneVisits.length} done · ${activeVisit ? '1 active' : '0 active'}`} />
        <MetricCard label="On-site" value={formatMinutes(totalVisitMinutes)} detail="Travel excluded" tone="success" />
        <MetricCard label="Recorded" value={String(visits.length)} detail="Submitted through attendance recorder" tone="success" />
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
            {isMockAuthMode() ? <button className="text-button" onClick={resetDemoDay}>Reset demo</button> : null}
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
              <button className="action-button full" onClick={() => void endVisit(visit.id)} disabled={isRecording}>
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
    const visits = JSON.parse(rawValue) as Visit[];
    return visits.every((visit) => Boolean(visit.sessionId && visit.capturedAtLocal)) ? visits : [];
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
