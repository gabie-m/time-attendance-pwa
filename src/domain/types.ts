export type Role = 'user' | 'manager' | 'admin';

export type AttendanceModel = 'stationary' | 'roving';

export type AttendanceEventType =
  | 'time_in'
  | 'lunch_out'
  | 'lunch_in'
  | 'time_out'
  | 'visit_in'
  | 'visit_out'
  | 'gps_ping';

export type AttendanceSessionType = 'stationary_day' | 'field_visit';

export type AttendanceSessionStatus = 'open' | 'closed' | 'needs_review';

export type ValidationStatus =
  | 'normal'
  | 'warning'
  | 'flagged'
  | 'needs_review'
  | 'overtime_candidate';

export type AttendanceFlagType =
  | 'outside_radius'
  | 'gps_low_accuracy'
  | 'offline_submission'
  | 'location_conflict'
  | 'missing_punch'
  | 'deactivated_user_record'
  | 'late_sync'
  | 'clock_discrepancy'
  | 'early_lunch_return'
  | 'photo_time_mismatch'
  | 'missing_photo';

export type AttendanceRecorderInput = {
  clientEventId: string;
  eventType: AttendanceEventType;
  capturedAtLocal: string;
  locationId: string;
  sessionId?: string;
  purpose?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
  offlineDeclared?: boolean;
  offlineEvidence?: Record<string, unknown>;
  photoPath?: string;
  photoMetadata?: Record<string, unknown>;
  photoCapturedAt?: string;
  gpsWarningAcknowledged?: boolean;
  missingPhotoAcknowledged?: boolean;
  shortGapAcknowledged?: boolean;
};

export type AttendanceRecorderResult = {
  eventId: string;
  sessionId: string;
  eventType: AttendanceEventType;
  sessionType: AttendanceSessionType;
  workDate: string;
  sessionStatus: AttendanceSessionStatus;
  validationStatus: ValidationStatus;
  flagTypes: AttendanceFlagType[];
  receivedAtServer: string;
  idempotentReplay: boolean;
  source: 'mock' | 'supabase';
};

export type Location = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active: boolean;
};

export type AttendanceEvent = {
  id: string;
  sessionId: string;
  capturedAtLocal: string;
  type: AttendanceEventType;
  label: string;
  localTime: string;
  serverStatus: 'synced' | 'pending';
  locationName: string;
  distanceMeters?: number;
  validationStatus: ValidationStatus;
  detail: string;
};

export type Visit = {
  id: string;
  sessionId: string;
  capturedAtLocal: string;
  status: 'done' | 'active' | 'planned';
  locationName: string;
  purpose: string;
  timeIn?: string;
  timeOut?: string;
  timeOutCapturedAtLocal?: string;
  duration: string;
  travelFromPrevious: string;
  distanceMeters?: number;
  validationStatus: ValidationStatus;
};

export type ApprovalItem = {
  id: string;
  staffName: string;
  requestType: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
};
