import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceRecorderInput, AttendanceRecorderResult } from '../domain/types';
import {
  acknowledgeAttendanceEvent,
  clearMockAttendanceRecords,
  offlineDb,
  queueAttendanceEvent
} from '../offline/offlineQueue';
import { getMyAttendanceHistory } from './attendanceHistoryService';

beforeEach(async () => {
  vi.stubEnv('VITE_USE_MOCK_AUTH', 'true');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'attendance-history-test' }
  });
  await offlineDb.delete();
  await offlineDb.open();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await offlineDb.delete();
});

describe('getMyAttendanceHistory', () => {
  it('maps the existing mock employee history into employee-safe records', async () => {
    const result = await getMyAttendanceHistory({}, 'user-roving');

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.range.days).toBe(30);
    expect(result.data.days[0]?.workDate).toBe('2026-05-13');
    expect(result.data.days[0]?.sessions[0]?.events[0]).toMatchObject({
      type: 'visit_in',
      offlineDeclared: false
    });
    expect(result.data.days[1]?.sessions[0]?.flags[0]).toMatchObject({
      type: 'offline_submission',
      outcome: 'needs_review'
    });
    expect(result.data.days[1]?.sessions[0]?.flags[0]).not.toHaveProperty('evidence');
  });

  it('uses the requested number of mock history days', async () => {
    const result = await getMyAttendanceHistory({ days: 2 }, 'user-roving');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.range.days).toBe(2);
      expect(result.data.days).toHaveLength(2);
    }
  });

  it('links each repeated mock flag type to its affected attendance events', async () => {
    const result = await getMyAttendanceHistory({}, 'user-roving');

    expect(result.success).toBe(true);
    if (!result.success) return;

    const flaggedDay = result.data.days.find((day) => day.workDate === '2026-05-12');
    expect(flaggedDay?.sessions[0]?.flags).toEqual([
      expect.objectContaining({ attendanceEventId: 'jonas-flag-1', type: 'offline_submission' }),
      expect.objectContaining({ attendanceEventId: 'jonas-flag-2', type: 'offline_submission' })
    ]);
  });

  it('hides seeded mock history after the user resets the demo', async () => {
    await clearMockAttendanceRecords('user-roving');

    const result = await getMyAttendanceHistory({}, 'user-roving');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toEqual([]);
    }
  });

  it('includes the signed-in mock user’s locally captured attendance actions', async () => {
    const input = makeInput('00000000-0000-0000-0000-000000000011');
    await queueAttendanceEvent('user-stationary', input);
    await acknowledgeAttendanceEvent('user-stationary', input.clientEventId, makeResult(input.clientEventId));

    const result = await getMyAttendanceHistory({}, 'user-stationary');

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.days).toHaveLength(1);
    expect(result.data.days[0]).toMatchObject({
      workDate: '2026-08-20',
      outcome: 'recorded'
    });
    expect(result.data.days[0]?.sessions[0]?.events).toContainEqual({
      id: '00000000-0000-0000-0000-000000000012',
      type: 'time_in',
      capturedAtLocal: input.capturedAtLocal,
      offlineDeclared: false
    });
  });

  it('rejects invalid history windows', async () => {
    const result = await getMyAttendanceHistory({ days: 0 }, 'user-roving');

    expect(result).toEqual({
      success: false,
      data: null,
      error: 'Attendance history is unavailable.'
    });
  });
});

function makeInput(clientEventId: string): AttendanceRecorderInput {
  return {
    clientEventId,
    eventType: 'time_in',
    capturedAtLocal: '2026-08-20T08:00:00.000+08:00',
    locationId: '00000000-0000-0000-0000-000000000201',
    sessionId: '00000000-0000-0000-0000-000000000301',
    gpsWarningAcknowledged: true,
    missingPhotoAcknowledged: true
  };
}

function makeResult(clientEventId: string): AttendanceRecorderResult {
  return {
    clientEventId,
    eventId: '00000000-0000-0000-0000-000000000012',
    sessionId: '00000000-0000-0000-0000-000000000301',
    eventType: 'time_in',
    sessionType: 'stationary_day',
    workDate: '2026-08-20',
    sessionStatus: 'open',
    validationStatus: 'normal',
    flagTypes: [],
    receivedAtServer: '2026-08-20T08:00:01.000+08:00',
    idempotentReplay: false,
    source: 'mock'
  };
}
