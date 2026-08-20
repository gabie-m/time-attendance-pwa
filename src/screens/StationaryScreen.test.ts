import { describe, expect, it } from 'vitest';
import type { AttendanceEvent } from '../domain/types';
import { mergeStationaryEvents } from '../services/stationaryPresentationService';

describe('mergeStationaryEvents', () => {
  it('keeps one event when a local pending record receives its synced acknowledgement', () => {
    const pending = makeEvent('pending');
    const synced = makeEvent('synced');

    const events = mergeStationaryEvents([pending], [synced]);

    expect(events).toEqual([synced]);
  });
});

function makeEvent(serverStatus: AttendanceEvent['serverStatus']): AttendanceEvent {
  return {
    id: 'client-event-1',
    sessionId: 'session-1',
    type: 'time_in',
    label: 'Time In',
    capturedAtLocal: '2026-08-20T08:00:00.000+08:00',
    localTime: '8:00 AM',
    workDate: '2026-08-20',
    serverStatus,
    locationName: 'Test Outlet',
    validationStatus: 'normal',
    flagTypes: [],
    detail: serverStatus === 'synced' ? 'Synced.' : 'Pending.'
  };
}
