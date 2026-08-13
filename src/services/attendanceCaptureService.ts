import type { AttendanceRecorderInput, AttendanceRecorderResult } from '../domain/types';
import {
  acknowledgeAttendanceEvent,
  getAttendanceAcknowledgement,
  getOfflineQueueState,
  getOfflineQueueSummary,
  getPendingAttendanceEvents,
  getQueuedAttendanceEvent,
  markAttendanceEventDeliveryDeferred,
  markAttendanceEventSyncFailed,
  markAttendanceEventSyncing,
  queueAttendanceEvent,
  recoverInterruptedAttendanceSyncs,
  type OfflineQueueSummary,
  type PendingAttendanceEvent
} from '../offline/offlineQueue';
import { getSession, refreshSession } from './authService';
import {
  isConfirmedTransportError,
  recordAttendanceEvent
} from './attendanceRecorderService';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

export type AttendanceCaptureResult = {
  record: AttendanceRecorderResult;
  delivery: 'recorded' | 'queued';
};

export type AttendanceSyncResult = OfflineQueueSummary & {
  syncedCount: number;
  pausedForSignIn: boolean;
};

const syncsInProgress = new Map<string, Promise<ServiceResult<AttendanceSyncResult>>>();

export async function captureAttendanceEvent(
  userId: string,
  input: AttendanceRecorderInput
): Promise<ServiceResult<AttendanceCaptureResult>> {
  const preparedInput = ensureStarterSessionId(input);
  const isOfflineAtCapture = !navigator.onLine;
  let queuedEvent: PendingAttendanceEvent;

  try {
    const queueState = await getOfflineQueueState(userId);
    if (queueState.failedCount > 0 || queueState.legacyRecordCount > 0) {
      return failure('Resolve the attendance record needing attention before recording another action.');
    }
    queuedEvent = await queueAttendanceEvent(userId, {
      ...preparedInput,
      offlineDeclared: isOfflineAtCapture
    });
  } catch {
    return failure('This attendance record could not be saved safely on this device. Keep this screen open and try again.');
  }

  if (isOfflineAtCapture) {
    return success({
      record: createQueuedRecord(toRecorderInput(queuedEvent)),
      delivery: 'queued'
    });
  }

  const replayResult = await syncQueuedAttendanceEvents(userId);
  const acknowledgement = await getAttendanceAcknowledgement(userId, queuedEvent.clientEventId);
  if (acknowledgement) {
    return success({ record: acknowledgement, delivery: 'recorded' });
  }

  const currentEvent = await getQueuedAttendanceEvent(userId, queuedEvent.clientEventId);
  if (currentEvent?.syncStatus === 'failed') {
    return failure(currentEvent.lastSyncError ?? 'This attendance action needs attention before another action can be recorded.');
  }

  if (!replayResult.success) {
    await markAttendanceEventDeliveryDeferred(
      queuedEvent.clientEventId,
      'The attendance record could not reach the server and remains saved on this device.'
    );
  }

  return success({
    record: createQueuedRecord(toRecorderInput(queuedEvent)),
    delivery: 'queued'
  });
}

export function syncQueuedAttendanceEvents(
  userId: string
): Promise<ServiceResult<AttendanceSyncResult>> {
  const existingSync = syncsInProgress.get(userId);
  if (existingSync) {
    return existingSync;
  }

  const sync = syncQueuedAttendanceEventsInternal(userId)
    .catch(() => failure<AttendanceSyncResult>('Offline attendance could not sync. Your saved records remain on this device.'))
    .finally(() => {
      syncsInProgress.delete(userId);
    });
  syncsInProgress.set(userId, sync);
  return sync;
}

async function syncQueuedAttendanceEventsInternal(
  userId: string
): Promise<ServiceResult<AttendanceSyncResult>> {
  await recoverInterruptedAttendanceSyncs(userId);

  if (!navigator.onLine) {
    const summary = await getOfflineQueueSummary(userId);
    return success({ ...summary, syncedCount: 0, pausedForSignIn: false });
  }

  const events = await getPendingAttendanceEvents(userId);
  if (events.length === 0) {
    const summary = await getOfflineQueueSummary(userId);
    return success({ ...summary, syncedCount: 0, pausedForSignIn: false });
  }

  if (!isMockAuthMode()) {
    const sessionResult = await refreshSession();
    if (!sessionResult.success || !sessionResult.data || sessionResult.data.user.id !== userId) {
      const summary = await getOfflineQueueSummary(userId);
      return success({ ...summary, syncedCount: 0, pausedForSignIn: true });
    }
  }

  let syncedCount = 0;

  for (const event of events) {
    if (event.syncStatus === 'failed') {
      // A known server rejection needs human resolution; later events must not overtake it.
      break;
    }

    if (!isMockAuthMode()) {
      const currentSession = await getSession();
      if (!currentSession.success || currentSession.data?.user.id !== userId) {
        const summary = await getOfflineQueueSummary(userId);
        return success({ ...summary, syncedCount, pausedForSignIn: true });
      }
    }

    await markAttendanceEventSyncing(event.clientEventId);

    try {
      const result = await recordAttendanceEvent(toRecorderInput(event));
      if (result.success) {
        await acknowledgeAttendanceEvent(userId, event.clientEventId, result.data);
        syncedCount += 1;
        continue;
      }

      if (result.retryable) {
        await markAttendanceEventDeliveryDeferred(event.clientEventId, result.error);
        break;
      }

      await markAttendanceEventSyncFailed(event.clientEventId, result.error);
      const summary = await getOfflineQueueSummary(userId);
      return success({
        ...summary,
        syncedCount,
        pausedForSignIn: result.error === 'You must be signed in to record attendance.'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Attendance sync encountered an unexpected local error.';
      if (isConfirmedTransportError(error)) {
        await markAttendanceEventDeliveryDeferred(event.clientEventId, message);
        break;
      }

      await markAttendanceEventSyncFailed(event.clientEventId, message);
      const summary = await getOfflineQueueSummary(userId);
      return success({ ...summary, syncedCount, pausedForSignIn: false });
    }
  }

  const summary = await getOfflineQueueSummary(userId);
  return success({ ...summary, syncedCount, pausedForSignIn: false });
}

function ensureStarterSessionId(input: AttendanceRecorderInput): AttendanceRecorderInput {
  if (input.sessionId || (input.eventType !== 'time_in' && input.eventType !== 'visit_in')) {
    return input;
  }

  return { ...input, sessionId: crypto.randomUUID() };
}

function createQueuedRecord(input: AttendanceRecorderInput): AttendanceRecorderResult {
  const isFieldVisit = input.eventType === 'visit_in' || input.eventType === 'visit_out';
  const isClosingAction = input.eventType === 'time_out' || input.eventType === 'visit_out';
  const flagTypes = [] as AttendanceRecorderResult['flagTypes'];

  if (input.offlineDeclared) {
    flagTypes.push('offline_submission');
  }

  if (isPhotoRequired(input.eventType) && !input.photoPath?.trim()) {
    flagTypes.push('missing_photo');
  }

  return {
    clientEventId: input.clientEventId,
    eventId: input.clientEventId,
    sessionId: input.sessionId!,
    eventType: input.eventType,
    sessionType: isFieldVisit ? 'field_visit' : 'stationary_day',
    workDate: getLocalDate(input.capturedAtLocal),
    sessionStatus: isClosingAction ? (flagTypes.length > 0 ? 'needs_review' : 'closed') : 'open',
    validationStatus: flagTypes.length > 0 ? 'flagged' : 'normal',
    flagTypes,
    receivedAtServer: input.capturedAtLocal,
    idempotentReplay: false,
    source: 'offline'
  };
}

function toRecorderInput(event: PendingAttendanceEvent): AttendanceRecorderInput {
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
    offlineDeclared: event.offlineDeclared ?? false,
    offlineEvidence: event.offlineEvidence,
    photoPath: event.photoPath,
    photoMetadata: event.photoMetadata,
    photoCapturedAt: event.photoCapturedAt,
    gpsWarningAcknowledged: event.gpsWarningAcknowledged,
    missingPhotoAcknowledged: event.missingPhotoAcknowledged,
    shortGapAcknowledged: event.shortGapAcknowledged
  };
}

function getLocalDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(timestamp));
}

function isPhotoRequired(eventType: AttendanceRecorderInput['eventType']) {
  return eventType === 'time_in' || eventType === 'time_out' || eventType === 'visit_in' || eventType === 'visit_out';
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}
