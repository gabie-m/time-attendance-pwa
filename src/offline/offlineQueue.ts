import Dexie, { type Table } from 'dexie';
import type { AttendanceEventType } from '../domain/types';

export type PendingAttendanceEvent = {
  clientEventId: string;
  eventType: AttendanceEventType;
  capturedAtLocal: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
  distanceMeters?: number;
  outsideAllowedRadius?: boolean;
  warningAcknowledged?: boolean;
  deviceUserAgent: string;
  syncStatus: 'pending' | 'syncing' | 'failed';
};

class AttendanceOfflineDb extends Dexie {
  pendingEvents!: Table<PendingAttendanceEvent, string>;

  constructor() {
    super('attendance_offline_queue');
    this.version(1).stores({
      pendingEvents: '&clientEventId, syncStatus, capturedAtLocal'
    });
  }
}

export const offlineDb = new AttendanceOfflineDb();

type QueueAttendanceEventOptions = {
  locationName?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
  distanceMeters?: number;
  outsideAllowedRadius?: boolean;
  warningAcknowledged?: boolean;
};

export async function queueAttendanceEvent(eventType: AttendanceEventType, options: QueueAttendanceEventOptions = {}) {
  const pendingEvent: PendingAttendanceEvent = {
    clientEventId: crypto.randomUUID(),
    eventType,
    capturedAtLocal: new Date().toISOString(),
    ...options,
    deviceUserAgent: navigator.userAgent,
    syncStatus: 'pending'
  };

  await offlineDb.pendingEvents.add(pendingEvent);
  return pendingEvent;
}
