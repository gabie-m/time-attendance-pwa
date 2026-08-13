import type {
  AttendanceFlagType,
  AttendanceRecorderInput,
  AttendanceRecorderResult,
  AttendanceSessionStatus,
  AttendanceSessionType,
  ValidationStatus
} from '../domain/types';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

type RecorderRpcRow = {
  recorded_client_event_id: string;
  recorded_event_id: string;
  recorded_session_id: string;
  recorded_event_type: AttendanceRecorderResult['eventType'];
  recorded_session_type: AttendanceSessionType;
  recorded_work_date: string;
  recorded_session_status: AttendanceSessionStatus;
  recorded_validation_status: ValidationStatus;
  recorded_flag_types: AttendanceFlagType[];
  recorded_received_at_server: string;
  idempotent_replay: boolean;
};

export type AttendanceRecorderServiceResult = ServiceResult<AttendanceRecorderResult> & {
  retryable: boolean;
};

const knownRecorderRejections = [
  'You must be signed in to record attendance.',
  'Attendance payload is missing required information.',
  'Attendance evidence must use object values.',
  'GPS evidence is malformed.',
  'Attendance photos must use a private storage path.',
  'Photo capture evidence is malformed.',
  'This attendance action conflicts with a previously submitted record.',
  'Your attendance account is unavailable.',
  'Please accept location consent before recording attendance.',
  'This attendance action was captured after your account was deactivated.',
  'Your staff profile is incomplete. Ask an administrator to finish setup.',
  'Your staff profile timezone is invalid. Ask an administrator to correct it.',
  'GPS ping recording is not available yet.',
  'Your staff profile is not authorized for stationary attendance.',
  'Your staff profile is not authorized for roving attendance.',
  'A new attendance session cannot reuse an existing session id.',
  'A session for this date already exists.',
  'Select a visit purpose before starting attendance.',
  'Close your current visit before starting a new one.',
  'Select the open visit before recording Visit Out.',
  'Select the attendance session before recording this action.',
  'The selected attendance session is unavailable.',
  'This attendance action does not match the selected session.',
  'This attendance session is already closed.',
  'Visit Out must use the location selected for the open visit.',
  'The selected attendance location is unavailable.',
  'This location is not assigned to you for this attendance date.',
  'This attendance action is out of order. Refresh and try again.',
  'Attendance capture time cannot be earlier than the previous action.',
  'Attendance validation rules are unavailable.',
  'Confirm the short time gap before submitting attendance.',
  'Confirm that GPS is unavailable before submitting attendance.',
  'Confirm that you are outside the allowed location radius before submitting attendance.',
  'Confirm that no attendance photo is available before submitting.'
] as const;

const validValidationStatuses = ['normal', 'warning', 'flagged', 'needs_review', 'overtime_candidate'] as const;
const validFlagTypes = [
  'outside_radius',
  'gps_low_accuracy',
  'offline_submission',
  'location_conflict',
  'missing_punch',
  'deactivated_user_record',
  'late_sync',
  'clock_discrepancy',
  'early_lunch_return',
  'photo_time_mismatch',
  'missing_photo'
] as const;

export async function recordAttendanceEvent(
  input: AttendanceRecorderInput
): Promise<AttendanceRecorderServiceResult> {
  const inputError = getInputError(input);
  if (inputError) {
    return recorderFailure(inputError);
  }

  if (isMockAuthMode()) {
    return recorderSuccess(createMockResult(input));
  }

  if (!hasSupabaseConfig || !supabase) {
    return recorderFailure('Supabase environment variables are not configured.');
  }

  const { data, error } = await supabase.rpc('record_attendance_event_acknowledged', {
    p_client_event_id: input.clientEventId,
    p_event_type: input.eventType,
    p_captured_at_local: input.capturedAtLocal,
    p_location_id: input.locationId,
    p_session_id: input.sessionId ?? null,
    p_purpose: input.purpose ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_gps_accuracy_meters: input.gpsAccuracyMeters ?? null,
    p_offline_declared: input.offlineDeclared ?? false,
    p_offline_evidence: input.offlineEvidence ?? {},
    p_photo_path: input.photoPath ?? null,
    p_photo_metadata: input.photoMetadata ?? {},
    p_photo_captured_at: input.photoCapturedAt ?? null,
    p_gps_warning_acknowledged: input.gpsWarningAcknowledged ?? false,
    p_missing_photo_acknowledged: input.missingPhotoAcknowledged ?? false,
    p_short_gap_acknowledged: input.shortGapAcknowledged ?? false
  });

  if (error) {
    return recorderFailure(getRecorderErrorMessage(error.message), isConfirmedTransportError(error));
  }

  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isValidRecorderRpcRow(row, input)) {
    return recorderFailure('Attendance recorder returned an invalid acknowledgement and needs attention before another action can be recorded.');
  }

  return recorderSuccess(mapRpcResult(row));
}

function getInputError(input: AttendanceRecorderInput) {
  const photoPath = getUsablePhotoPath(input);

  if (
    !isUuid(input.clientEventId) ||
    !isUuid(input.locationId) ||
    !input.capturedAtLocal ||
    !Number.isFinite(Date.parse(input.capturedAtLocal))
  ) {
    return 'Attendance payload is missing required information.';
  }

  if (input.sessionId !== undefined && !isUuid(input.sessionId)) {
    return 'The selected attendance session is unavailable.';
  }

  if (
    input.eventType !== 'time_in' &&
    input.eventType !== 'visit_in' &&
    !input.sessionId
  ) {
    if (input.eventType === 'visit_out') {
      return 'Select the open visit before recording Visit Out.';
    }

    return 'Select the attendance session before recording this action.';
  }

  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    return 'GPS evidence is malformed.';
  }

  if (
    input.latitude !== undefined &&
    (!Number.isFinite(input.latitude) ||
      !Number.isFinite(input.longitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      input.longitude! < -180 ||
      input.longitude! > 180)
  ) {
    return 'GPS evidence is malformed.';
  }

  if (
    (input.latitude !== undefined && input.gpsAccuracyMeters === undefined) ||
    (input.gpsAccuracyMeters !== undefined &&
      (!Number.isFinite(input.gpsAccuracyMeters) ||
        input.gpsAccuracyMeters < 0 ||
        input.gpsAccuracyMeters > 99999999.99 ||
        input.latitude === undefined))
  ) {
    return 'GPS evidence is malformed.';
  }

  if (input.photoCapturedAt && !Number.isFinite(Date.parse(input.photoCapturedAt))) {
    return 'Photo capture evidence is malformed.';
  }

  if (input.eventType === 'gps_ping') {
    return 'GPS ping recording is not available yet.';
  }

  if (input.eventType === 'visit_in' && !input.purpose?.trim()) {
    return 'Select a visit purpose before starting attendance.';
  }

  if (input.latitude === undefined && !input.gpsWarningAcknowledged) {
    return 'Confirm that GPS is unavailable before submitting attendance.';
  }

  if (
    isPhotoRequired(input.eventType) &&
    !photoPath &&
    !input.missingPhotoAcknowledged
  ) {
    return 'Confirm that no attendance photo is available before submitting.';
  }

  return null;
}

function createMockResult(input: AttendanceRecorderInput): AttendanceRecorderResult {
  const photoPath = getUsablePhotoPath(input);
  const sessionType: AttendanceSessionType =
    input.eventType === 'visit_in' || input.eventType === 'visit_out'
      ? 'field_visit'
      : 'stationary_day';
  const sessionId = input.sessionId ?? crypto.randomUUID();
  const flagTypes: AttendanceFlagType[] = [];

  if (input.latitude === undefined) {
    flagTypes.push('outside_radius');
  }

  if (input.offlineDeclared) {
    flagTypes.push('offline_submission');
    if (Date.now() - new Date(input.capturedAtLocal).getTime() > 24 * 60 * 60 * 1000) {
      flagTypes.push('late_sync');
    }
  }

  if (isPhotoRequired(input.eventType) && !photoPath) {
    flagTypes.push('missing_photo');
  }

  const isClosingAction = input.eventType === 'time_out' || input.eventType === 'visit_out';

  return {
    clientEventId: input.clientEventId,
    eventId: input.clientEventId,
    sessionId,
    eventType: input.eventType,
    sessionType,
    workDate: getLocalDate(input.capturedAtLocal),
    sessionStatus: isClosingAction ? (flagTypes.length > 0 ? 'needs_review' : 'closed') : 'open',
    validationStatus: flagTypes.length > 0 ? 'flagged' : 'normal',
    flagTypes,
    receivedAtServer: new Date().toISOString(),
    idempotentReplay: false,
    source: 'mock'
  };
}

function mapRpcResult(row: RecorderRpcRow): AttendanceRecorderResult {
  return {
    clientEventId: row.recorded_client_event_id,
    eventId: row.recorded_event_id,
    sessionId: row.recorded_session_id,
    eventType: row.recorded_event_type,
    sessionType: row.recorded_session_type,
    workDate: row.recorded_work_date,
    sessionStatus: row.recorded_session_status,
    validationStatus: row.recorded_validation_status,
    flagTypes: row.recorded_flag_types ?? [],
    receivedAtServer: row.recorded_received_at_server,
    idempotentReplay: row.idempotent_replay,
    source: 'supabase'
  };
}

function getRecorderErrorMessage(errorMessage: string) {
  return (
    knownRecorderRejections.find((message) => errorMessage.includes(message)) ??
    'Attendance could not be recorded and needs attention before another action can be recorded.'
  );
}

export function isConfirmedTransportError(error: unknown) {
  if (error instanceof Error) {
    return error.name === 'FetchError' || error.name === 'AbortError';
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; details?: unknown };
  return candidate.code === ''
    && typeof candidate.details === 'string'
    && /^(FetchError|AbortError|TypeError: fetch failed)/.test(candidate.details);
}

function recorderSuccess(data: AttendanceRecorderResult): AttendanceRecorderServiceResult {
  return { ...success(data), retryable: false };
}

function recorderFailure(error: string, retryable = false): AttendanceRecorderServiceResult {
  return { ...failure<AttendanceRecorderResult>(error), retryable };
}

function isValidRecorderRpcRow(row: unknown, input: AttendanceRecorderInput): row is RecorderRpcRow {
  if (!row || typeof row !== 'object') {
    return false;
  }

  const candidate = row as Partial<RecorderRpcRow>;
  const expectedSessionType = input.eventType === 'visit_in' || input.eventType === 'visit_out'
    ? 'field_visit'
    : 'stationary_day';
  return candidate.recorded_client_event_id === input.clientEventId
    && isUuid(candidate.recorded_event_id ?? '')
    && isUuid(candidate.recorded_session_id ?? '')
    && candidate.recorded_session_id === input.sessionId
    && candidate.recorded_event_type === input.eventType
    && candidate.recorded_session_type === expectedSessionType
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.recorded_work_date ?? '')
    && (candidate.recorded_session_status === 'open' || candidate.recorded_session_status === 'closed' || candidate.recorded_session_status === 'needs_review')
    && validValidationStatuses.some((status) => status === candidate.recorded_validation_status)
    && Array.isArray(candidate.recorded_flag_types)
    && candidate.recorded_flag_types.every((flagType) => validFlagTypes.some((validFlagType) => validFlagType === flagType))
    && typeof candidate.recorded_received_at_server === 'string'
    && Number.isFinite(Date.parse(candidate.recorded_received_at_server))
    && typeof candidate.idempotent_replay === 'boolean';
}

function getLocalDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila'
  }).format(new Date(timestamp));
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}

function isPhotoRequired(eventType: AttendanceRecorderInput['eventType']) {
  return (
    eventType === 'time_in' ||
    eventType === 'time_out' ||
    eventType === 'visit_in' ||
    eventType === 'visit_out'
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getUsablePhotoPath(input: AttendanceRecorderInput) {
  const trimmedPhotoPath = input.photoPath?.trim();

  if (!trimmedPhotoPath) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedPhotoPath)) {
    return null;
  }

  const pathMatch = trimmedPhotoPath.match(
    /^users\/([0-9a-f-]+)\/(\d{4}-\d{2}-\d{2})\/([0-9a-f-]+)\/([0-9a-f-]+)\.jpg$/i
  );

  if (!pathMatch) {
    return null;
  }

  const [, userId, , sessionId, clientEventId] = pathMatch;

  if (!isUuid(userId) || !isUuid(sessionId) || !isUuid(clientEventId)) {
    return null;
  }

  if (sessionId.toLowerCase() !== input.sessionId?.toLowerCase()) {
    return null;
  }

  if (clientEventId.toLowerCase() !== input.clientEventId.toLowerCase()) {
    return null;
  }

  return trimmedPhotoPath;
}
