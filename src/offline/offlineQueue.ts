import Dexie, { type Table } from 'dexie';
import type {
  AttendanceEvent,
  AttendanceModel,
  AttendanceRecorderInput,
  AttendanceRecorderResult,
  Location,
  Role,
  Visit
} from '../domain/types';
import type { AttendanceRules } from '../services/attendanceRulesService';

export type OfflineSyncStatus = 'pending' | 'syncing' | 'failed';

export type PendingAttendanceEvent = AttendanceRecorderInput & {
  userId: string;
  offlineEvidence: Record<string, unknown>;
  outboxSequence: number;
  deviceUserAgent: string;
  queuedAtLocal: string;
  syncStatus: OfflineSyncStatus;
  syncAttempts: number;
  lastSyncError?: string;
  lastDeliveryAttemptAtLocal?: string;
};

export type OfflineQueueSummary = {
  pendingCount: number;
  failedCount: number;
  syncingCount: number;
};

export type OfflineQueueState = OfflineQueueSummary & {
  queuedEventIds: string[];
  failedEventIds: string[];
  legacyRecordCount: number;
};

type AttendanceSetupCacheRecord = {
  id: string;
  value: AttendanceRules | Location[];
  verifiedAtLocal: string;
};

type OutboxMetadataRecord = {
  id: 'sequence';
  nextSequence: number;
};

export type RecordedAttendanceAcknowledgement = {
  clientEventId: string;
  userId: string;
  input: AttendanceRecorderInput;
  result: AttendanceRecorderResult;
  acknowledgedAtLocal: string;
};

type AttendancePresentationRecord = {
  userId: string;
  stationaryEvents: AttendanceEvent[];
  rovingVisits: Visit[];
  updatedAtLocal: string;
};

export type OfflineAuthenticatedProfile = {
  id: string;
  name: string;
  role: Role;
  attendanceModel: AttendanceModel;
  expectedLocation: string;
  shift: string;
  locationConsentGivenAt: string | null;
};

type AuthProfileCacheRecord = {
  userId: string;
  profile: OfflineAuthenticatedProfile;
  verifiedAtLocal: string;
};

type AuthMetadataRecord = {
  id: 'last-authenticated-user';
  userId: string;
};

class AttendanceOfflineDb extends Dexie {
  pendingEvents!: Table<PendingAttendanceEvent, string>;
  attendanceSetup!: Table<AttendanceSetupCacheRecord, string>;
  outboxMetadata!: Table<OutboxMetadataRecord, 'sequence'>;
  recordedAcknowledgements!: Table<RecordedAttendanceAcknowledgement, string>;
  attendancePresentation!: Table<AttendancePresentationRecord, string>;
  authProfiles!: Table<AuthProfileCacheRecord, string>;
  authMetadata!: Table<AuthMetadataRecord, 'last-authenticated-user'>;

  constructor() {
    super('attendance_offline_queue');
    this.version(1).stores({
      pendingEvents: '&clientEventId, syncStatus, capturedAtLocal'
    });
    this.version(2).stores({
      pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], capturedAtLocal, sessionId'
    });
    this.version(3).stores({
      pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], capturedAtLocal, sessionId',
      attendanceSetup: '&id, verifiedAtLocal'
    });
    this.version(4)
      .stores({
        pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], capturedAtLocal, sessionId',
        attendanceSetup: '&id, verifiedAtLocal'
      })
      .upgrade((transaction) => {
        return transaction.table('pendingEvents').toCollection().modify((event: Partial<PendingAttendanceEvent>) => {
          if (!event.userId) {
            event.userId = '__legacy__';
            event.syncStatus = 'failed';
            event.syncAttempts = event.syncAttempts ?? 0;
            event.lastSyncError = 'This record was created by an earlier offline queue and needs support-assisted recovery.';
          }
        });
      });
    this.version(5)
      .stores({
        pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], outboxSequence, [userId+outboxSequence], capturedAtLocal, sessionId',
        attendanceSetup: '&id, verifiedAtLocal',
        outboxMetadata: '&id',
        recordedAcknowledgements: '&clientEventId, userId, acknowledgedAtLocal'
      })
      .upgrade((transaction) => {
        return transaction.table('pendingEvents').toCollection().modify((event: Partial<PendingAttendanceEvent>) => {
          if (event.outboxSequence === undefined) {
            event.syncStatus = 'failed';
            event.lastSyncError = 'This record was created before ordered offline replay and needs support-assisted recovery.';
          }
        });
      });
    this.version(6).stores({
      pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], outboxSequence, [userId+outboxSequence], capturedAtLocal, sessionId',
      attendanceSetup: '&id, verifiedAtLocal',
      outboxMetadata: '&id',
      recordedAcknowledgements: '&clientEventId, userId, acknowledgedAtLocal',
      attendancePresentation: '&userId, updatedAtLocal'
    });
    this.version(7).stores({
      pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], outboxSequence, [userId+outboxSequence], capturedAtLocal, sessionId',
      attendanceSetup: '&id, verifiedAtLocal',
      outboxMetadata: '&id',
      recordedAcknowledgements: '&clientEventId, userId, acknowledgedAtLocal',
      attendancePresentation: '&userId, updatedAtLocal',
      authProfiles: '&userId, verifiedAtLocal'
    });
    this.version(8).stores({
      pendingEvents: '&clientEventId, userId, syncStatus, [userId+syncStatus], outboxSequence, [userId+outboxSequence], capturedAtLocal, sessionId',
      attendanceSetup: '&id, verifiedAtLocal',
      outboxMetadata: '&id',
      recordedAcknowledgements: '&clientEventId, userId, acknowledgedAtLocal',
      attendancePresentation: '&userId, updatedAtLocal',
      authProfiles: '&userId, verifiedAtLocal',
      authMetadata: '&id'
    });
  }
}

const offlineQueueEvents = new EventTarget();

export const offlineDb = new AttendanceOfflineDb();

export async function queueAttendanceEvent(
  userId: string,
  input: AttendanceRecorderInput
): Promise<PendingAttendanceEvent> {
  void requestPersistentOfflineStorage();
  const queuedAtLocal = new Date().toISOString();
  let pendingEvent!: PendingAttendanceEvent;
  await offlineDb.transaction('rw', offlineDb.pendingEvents, offlineDb.outboxMetadata, async () => {
    const metadata = await offlineDb.outboxMetadata.get('sequence');
    const outboxSequence = (metadata?.nextSequence ?? 0) + 1;
    pendingEvent = {
      ...input,
      userId,
      offlineDeclared: input.offlineDeclared ?? false,
      offlineEvidence: {
        ...input.offlineEvidence,
        device_user_agent: navigator.userAgent,
        outbox_saved_at_local: queuedAtLocal
      },
      outboxSequence,
      deviceUserAgent: navigator.userAgent,
      queuedAtLocal,
      syncStatus: 'pending',
      syncAttempts: 0
    };
    await offlineDb.outboxMetadata.put({ id: 'sequence', nextSequence: outboxSequence });
    await offlineDb.pendingEvents.add(pendingEvent);
  });
  notifyOfflineQueueChanged();
  return pendingEvent;
}

export async function getPendingAttendanceEvents(userId: string) {
  return (await offlineDb.pendingEvents.where('userId').equals(userId).toArray())
    .filter((event) => event.outboxSequence !== undefined)
    .sort((left, right) => left.outboxSequence - right.outboxSequence);
}

export async function getQueuedAttendanceEvent(userId: string, clientEventId: string) {
  const event = await offlineDb.pendingEvents.get(clientEventId);
  return event?.userId === userId ? event : null;
}

export async function getQueuedAttendanceEventsForPresentation(userId: string) {
  return (await offlineDb.pendingEvents.where('userId').equals(userId).toArray())
    .sort((left, right) => (left.outboxSequence ?? Number.MAX_SAFE_INTEGER) - (right.outboxSequence ?? Number.MAX_SAFE_INTEGER));
}

export async function getOfflineQueueSummary(userId: string): Promise<OfflineQueueSummary> {
  const events = await offlineDb.pendingEvents.where('userId').equals(userId).toArray();

  return events.reduce<OfflineQueueSummary>(
    (summary, event) => {
      if (event.syncStatus === 'failed') {
        summary.failedCount += 1;
      } else if (event.syncStatus === 'syncing') {
        summary.syncingCount += 1;
      } else {
        summary.pendingCount += 1;
      }

      return summary;
    },
    { pendingCount: 0, failedCount: 0, syncingCount: 0 }
  );
}

export async function getOfflineQueueState(userId: string): Promise<OfflineQueueState> {
  const events = await offlineDb.pendingEvents.where('userId').equals(userId).toArray();
  const summary = await getOfflineQueueSummary(userId);
  return {
    ...summary,
    queuedEventIds: events.map((event) => event.clientEventId),
    failedEventIds: events.filter((event) => event.syncStatus === 'failed').map((event) => event.clientEventId),
    legacyRecordCount: await offlineDb.pendingEvents.where('userId').equals('__legacy__').count()
  };
}

export async function markAttendanceEventSyncing(clientEventId: string) {
  await offlineDb.pendingEvents.update(clientEventId, {
    syncStatus: 'syncing',
    lastSyncError: undefined
  });
  notifyOfflineQueueChanged();
}

export async function markAttendanceEventSyncFailed(clientEventId: string, error: string) {
  const event = await offlineDb.pendingEvents.get(clientEventId);
  if (!event) {
    return;
  }

  await offlineDb.pendingEvents.update(clientEventId, {
    syncStatus: 'failed',
    syncAttempts: event.syncAttempts + 1,
    lastSyncError: error
  });
  notifyOfflineQueueChanged();
}

export async function markAttendanceEventDeliveryDeferred(clientEventId: string, error: string) {
  const event = await offlineDb.pendingEvents.get(clientEventId);
  if (!event) {
    return;
  }

  await offlineDb.pendingEvents.update(clientEventId, {
    syncStatus: 'pending',
    lastSyncError: error,
    lastDeliveryAttemptAtLocal: new Date().toISOString()
  });
  notifyOfflineQueueChanged();
}

export async function acknowledgeAttendanceEvent(
  userId: string,
  clientEventId: string,
  result: AttendanceRecorderResult
) {
  if (result.clientEventId !== clientEventId) {
    throw new Error('Attendance acknowledgement does not match the saved record.');
  }

  await offlineDb.transaction('rw', offlineDb.pendingEvents, offlineDb.recordedAcknowledgements, async () => {
    const event = await offlineDb.pendingEvents.get(clientEventId);
    if (!event || event.userId !== userId) {
      throw new Error('Attendance acknowledgement does not match the saved record.');
    }

    await offlineDb.recordedAcknowledgements.put({
      clientEventId,
      userId,
      input: toAttendanceRecorderInput(event),
      result,
      acknowledgedAtLocal: new Date().toISOString()
    });
    await offlineDb.pendingEvents.delete(clientEventId);
  });
  notifyOfflineQueueChanged();
}

export async function getAttendanceAcknowledgement(userId: string, clientEventId: string) {
  const acknowledgement = await offlineDb.recordedAcknowledgements.get(clientEventId);
  return acknowledgement?.userId === userId ? acknowledgement.result : null;
}

export async function getAttendanceAcknowledgements(userId: string) {
  return (await offlineDb.recordedAcknowledgements.where('userId').equals(userId).toArray())
    .sort((left, right) => left.acknowledgedAtLocal.localeCompare(right.acknowledgedAtLocal));
}

export async function getStationaryAttendancePresentation(userId: string) {
  const presentation = await offlineDb.attendancePresentation.get(userId);
  return presentation ? presentation.stationaryEvents : null;
}

export async function saveStationaryAttendancePresentation(userId: string, stationaryEvents: AttendanceEvent[]) {
  await offlineDb.transaction('rw', offlineDb.attendancePresentation, async () => {
    const current = await offlineDb.attendancePresentation.get(userId);
    await offlineDb.attendancePresentation.put({
      userId,
      stationaryEvents,
      rovingVisits: current?.rovingVisits ?? [],
      updatedAtLocal: new Date().toISOString()
    });
  });
}

export async function getRovingAttendancePresentation(userId: string) {
  const presentation = await offlineDb.attendancePresentation.get(userId);
  return presentation ? presentation.rovingVisits : null;
}

export async function saveRovingAttendancePresentation(userId: string, rovingVisits: Visit[]) {
  await offlineDb.transaction('rw', offlineDb.attendancePresentation, async () => {
    const current = await offlineDb.attendancePresentation.get(userId);
    await offlineDb.attendancePresentation.put({
      userId,
      stationaryEvents: current?.stationaryEvents ?? [],
      rovingVisits,
      updatedAtLocal: new Date().toISOString()
    });
  });
}

export async function cacheAuthenticatedProfile(profile: OfflineAuthenticatedProfile) {
  await offlineDb.transaction('rw', offlineDb.authProfiles, offlineDb.authMetadata, async () => {
    await offlineDb.authProfiles.put({
      userId: profile.id,
      profile,
      verifiedAtLocal: new Date().toISOString()
    });
    await offlineDb.authMetadata.put({ id: 'last-authenticated-user', userId: profile.id });
  });
}

export async function getCachedAuthenticatedProfile(userId: string) {
  return (await offlineDb.authProfiles.get(userId))?.profile ?? null;
}

export async function removeCachedAuthenticatedProfile(userId: string) {
  await offlineDb.transaction('rw', offlineDb.authProfiles, offlineDb.authMetadata, async () => {
    await offlineDb.authProfiles.delete(userId);
    const metadata = await offlineDb.authMetadata.get('last-authenticated-user');
    if (metadata?.userId === userId) {
      await offlineDb.authMetadata.delete('last-authenticated-user');
    }
  });
}

export async function getLastCachedAuthenticatedProfile() {
  const metadata = await offlineDb.authMetadata.get('last-authenticated-user');
  return metadata ? getCachedAuthenticatedProfile(metadata.userId) : null;
}

export async function recoverInterruptedAttendanceSyncs(userId: string) {
  await offlineDb.pendingEvents
    .where('[userId+syncStatus]')
    .equals([userId, 'syncing'])
    .modify({ syncStatus: 'pending' });
  notifyOfflineQueueChanged();
}

export async function cacheAttendanceRules(rules: AttendanceRules) {
  await offlineDb.attendanceSetup.put({
    id: 'rules',
    value: rules,
    verifiedAtLocal: new Date().toISOString()
  });
}

export async function getCachedAttendanceRules(): Promise<AttendanceRules | null> {
  const record = await offlineDb.attendanceSetup.get('rules');
  return record?.value && !Array.isArray(record.value) ? (record.value as AttendanceRules) : null;
}

export async function cacheAttendanceLocations(userId: string, locations: Location[]) {
  await offlineDb.attendanceSetup.put({
    id: getLocationsCacheId(userId),
    value: locations,
    verifiedAtLocal: new Date().toISOString()
  });
}

export async function getCachedAttendanceLocations(userId: string): Promise<Location[] | null> {
  const record = await offlineDb.attendanceSetup.get(getLocationsCacheId(userId));
  return Array.isArray(record?.value) ? (record.value as Location[]) : null;
}

export function subscribeToOfflineQueue(listener: () => void) {
  offlineQueueEvents.addEventListener('changed', listener);
  return () => offlineQueueEvents.removeEventListener('changed', listener);
}

function notifyOfflineQueueChanged() {
  offlineQueueEvents.dispatchEvent(new Event('changed'));
}

function getLocationsCacheId(userId: string) {
  return `locations:${userId}`;
}

async function requestPersistentOfflineStorage() {
  if (!navigator.storage?.persist || !navigator.storage.persisted) {
    return;
  }

  try {
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Browser storage persistence is best-effort; the queue remains functional without it.
  }
}

function toAttendanceRecorderInput(event: PendingAttendanceEvent): AttendanceRecorderInput {
  return {
    clientEventId: event.clientEventId,
    eventType: event.eventType,
    capturedAtLocal: event.capturedAtLocal,
    locationId: event.locationId,
    sessionId: event.sessionId,
    purpose: event.purpose,
    latitude: event.latitude,
    longitude: event.longitude,
    gpsAccuracyMeters: event.gpsAccuracyMeters,
    offlineDeclared: event.offlineDeclared,
    offlineEvidence: event.offlineEvidence,
    photoPath: event.photoPath,
    photoMetadata: event.photoMetadata,
    photoCapturedAt: event.photoCapturedAt,
    gpsWarningAcknowledged: event.gpsWarningAcknowledged,
    missingPhotoAcknowledged: event.missingPhotoAcknowledged,
    shortGapAcknowledged: event.shortGapAcknowledged
  };
}
