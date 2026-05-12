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

export type ValidationStatus =
  | 'normal'
  | 'warning'
  | 'flagged'
  | 'needs_review'
  | 'overtime_candidate';

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
  status: 'done' | 'active' | 'planned';
  locationName: string;
  purpose: string;
  timeIn?: string;
  timeOut?: string;
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
