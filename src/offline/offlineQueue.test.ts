import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceRecorderInput, AttendanceRecorderResult } from '../domain/types';
import { isConfirmedTransportError } from '../services/attendanceRecorderService';
import {
  acknowledgeAttendanceEvent,
  canResetMockAttendanceRecords,
  clearMockAttendanceRecords,
  createAttendancePresentationLoadGuard,
  getAttendanceAcknowledgement,
  getAttendanceAcknowledgements,
  getPendingAttendanceEvents,
  markAttendanceEventDeliveryDeferred,
  markAttendanceEventSyncing,
  hasMockAttendanceReset,
  offlineDb,
  queueAttendanceEvent,
  recoverInterruptedAttendanceSyncs
} from './offlineQueue';

const userId = 'test-user';
const locationId = '00000000-0000-0000-0000-000000000201';

beforeEach(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'offline-queue-test' }
  });
  await offlineDb.delete();
  await offlineDb.open();
});

afterEach(async () => {
  await offlineDb.delete();
});

describe('offline attendance outbox', () => {
  it('keeps the canonical evidence unchanged after a delivery acknowledgement is lost', async () => {
    const queued = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000001'));
    const originalEvidence = structuredClone(queued.offlineEvidence);

    await markAttendanceEventDeliveryDeferred(queued.clientEventId, 'Network response was lost.');

    const [replay] = await getPendingAttendanceEvents(userId);
    expect(replay.offlineEvidence).toEqual(originalEvidence);
    expect(replay.lastDeliveryAttemptAtLocal).toBeTruthy();
  });

  it('replays in durable enqueue order rather than device capture time', async () => {
    const first = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000002', '2026-07-30T10:00:00.000+08:00'));
    const second = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000003', '2026-07-30T08:00:00.000+08:00'));

    const pending = await getPendingAttendanceEvents(userId);
    expect(pending.map((event) => event.clientEventId)).toEqual([first.clientEventId, second.clientEventId]);
  });

  it('retains a record until the recorder acknowledges its exact client event id', async () => {
    const queued = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000004'));

    await expect(
      acknowledgeAttendanceEvent(userId, queued.clientEventId, makeResult('00000000-0000-0000-0000-000000000099'))
    ).rejects.toThrow('does not match');
    expect(await getPendingAttendanceEvents(userId)).toHaveLength(1);

    const acknowledged = makeResult(queued.clientEventId);
    await acknowledgeAttendanceEvent(userId, queued.clientEventId, acknowledged);
    expect(await getPendingAttendanceEvents(userId)).toHaveLength(0);
    expect(await getAttendanceAcknowledgement(userId, queued.clientEventId)).toEqual(acknowledged);
  });

  it('returns interrupted sync records to pending before the next replay', async () => {
    const queued = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000005'));
    await markAttendanceEventSyncing(queued.clientEventId);

    await recoverInterruptedAttendanceSyncs(userId);

    const [recovered] = await getPendingAttendanceEvents(userId);
    expect(recovered.syncStatus).toBe('pending');
  });

  it('clears a mock user’s queued and acknowledged attendance records for demo reset', async () => {
    const queued = await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000006'));
    await acknowledgeAttendanceEvent(userId, queued.clientEventId, makeResult(queued.clientEventId));
    await queueAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000007'));

    await clearMockAttendanceRecords(userId);

    expect(await getAttendanceAcknowledgements(userId)).toEqual([]);
    expect(await getPendingAttendanceEvents(userId)).toEqual([]);
    await expect(hasMockAttendanceReset(userId)).resolves.toBe(true);
  });

  it('only enables demo reset when no capture or sync is in progress', () => {
    expect(canResetMockAttendanceRecords({
      isRecording: false,
      isResetting: false,
      isSyncing: false,
      syncingCount: 0
    })).toBe(true);
    expect(canResetMockAttendanceRecords({
      isRecording: true,
      isResetting: false,
      isSyncing: false,
      syncingCount: 0
    })).toBe(false);
    expect(canResetMockAttendanceRecords({
      isRecording: false,
      isResetting: false,
      isSyncing: true,
      syncingCount: 0
    })).toBe(false);
    expect(canResetMockAttendanceRecords({
      isRecording: false,
      isResetting: false,
      isSyncing: false,
      syncingCount: 1
    })).toBe(false);
  });

  it('ignores a presentation load that completes after reset invalidates it', () => {
    const guard = createAttendancePresentationLoadGuard();
    const preResetLoad = guard.startLoad();

    guard.invalidate();

    expect(guard.isCurrent(preResetLoad)).toBe(false);
    expect(guard.isCurrent(guard.startLoad())).toBe(true);
  });

  it('retries only confirmed transport errors', () => {
    const fetchError = new Error('Network request failed');
    fetchError.name = 'FetchError';
    expect(isConfirmedTransportError(fetchError)).toBe(true);
    expect(isConfirmedTransportError(new Error('connection policy rejected'))).toBe(false);
    expect(isConfirmedTransportError('FetchError: network request failed')).toBe(false);
    expect(isConfirmedTransportError({ code: '', details: 'FetchError: network request failed' })).toBe(true);
    expect(isConfirmedTransportError({ code: '', details: 'TypeError: fetch failed' })).toBe(true);
    expect(isConfirmedTransportError({ code: 'P0001', details: 'FetchError: database rule rejected' })).toBe(false);
  });
});

function makeInput(clientEventId: string, capturedAtLocal = '2026-07-30T09:00:00.000+08:00'): AttendanceRecorderInput {
  return {
    clientEventId,
    eventType: 'time_in',
    capturedAtLocal,
    locationId,
    sessionId: '00000000-0000-0000-0000-000000000301',
    offlineEvidence: { capture_source: 'test' },
    missingPhotoAcknowledged: true,
    gpsWarningAcknowledged: true
  };
}

function makeResult(clientEventId: string): AttendanceRecorderResult {
  return {
    clientEventId,
    eventId: '00000000-0000-0000-0000-000000000401',
    sessionId: '00000000-0000-0000-0000-000000000301',
    eventType: 'time_in',
    sessionType: 'stationary_day',
    workDate: '2026-07-30',
    sessionStatus: 'open',
    validationStatus: 'normal',
    flagTypes: [],
    receivedAtServer: '2026-07-30T09:00:01.000+08:00',
    idempotentReplay: false,
    source: 'mock'
  };
}
