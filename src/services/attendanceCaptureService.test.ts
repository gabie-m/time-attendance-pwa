import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceRecorderInput } from '../domain/types';
import { offlineDb } from '../offline/offlineQueue';
import { captureAttendanceEvent } from './attendanceCaptureService';

const userId = 'capture-lock-test-user';

beforeEach(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false, userAgent: 'capture-lock-test' }
  });
  await offlineDb.delete();
  await offlineDb.open();
});

afterEach(async () => {
  await offlineDb.delete();
});

describe('captureAttendanceEvent', () => {
  it('rejects a rapid duplicate submission while the first action is being saved', async () => {
    const first = captureAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000021'));
    const second = await captureAttendanceEvent(userId, makeInput('00000000-0000-0000-0000-000000000022'));

    expect(second).toEqual({
      success: false,
      data: null,
      error: 'An attendance action is already being saved. Please wait for it to finish.'
    });
    await expect(first).resolves.toMatchObject({ success: true });
  });
});

function makeInput(clientEventId: string): AttendanceRecorderInput {
  return {
    clientEventId,
    eventType: 'time_in',
    capturedAtLocal: '2026-08-20T08:00:00.000+08:00',
    locationId: '00000000-0000-0000-0000-000000000201',
    gpsWarningAcknowledged: true,
    missingPhotoAcknowledged: true
  };
}
