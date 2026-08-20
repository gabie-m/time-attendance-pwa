import type {
  AttendanceEventType,
  AttendanceFlagType,
  AttendanceRecorderInput,
  AttendanceRecorderResult,
  AttendanceSessionStatus,
  AttendanceSessionType
} from '../domain/types';
import { supabase } from '../lib/supabaseClient';
import {
  getAttendanceAcknowledgements,
  getPendingAttendanceEvents,
  hasMockAttendanceReset,
  type PendingAttendanceEvent
} from '../offline/offlineQueue';
import {
  mockAttendanceDetailData,
  type AttendanceDayDetail,
  type AttendanceEventDetail,
  type AttendanceFlagDetail
} from '../mocks/mockAttendanceDetailData';
import { mockUsers } from '../mocks/mockUsers';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

const defaultHistoryDays = 30;
const maximumHistoryDays = 365;

const attendanceEventTypes = new Set<AttendanceEventType>([
  'time_in',
  'lunch_out',
  'lunch_in',
  'time_out',
  'visit_in',
  'visit_out',
  'gps_ping'
]);
const attendanceSessionTypes = new Set<AttendanceSessionType>(['stationary_day', 'field_visit']);
const attendanceSessionStatuses = new Set<AttendanceSessionStatus>(['open', 'closed', 'needs_review']);
const attendanceFlagTypes = new Set<AttendanceFlagType>([
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
]);

export type AttendanceHistoryOptions = {
  days?: number;
};

export type AttendanceHistory = {
  userId: string;
  range: { from: string; to: string; days: number };
  days: AttendanceHistoryDay[];
};

export type AttendanceHistoryDay = {
  workDate: string;
  requiresReview: boolean;
  outcome: AttendanceHistoryOutcome;
  sessions: AttendanceHistorySession[];
};

export type AttendanceHistoryOutcome =
  | 'recorded'
  | 'needs_review'
  | 'resolved'
  | 'valid_for_reporting'
  | 'rejected';

export type AttendanceHistorySession = {
  id: string;
  type: AttendanceSessionType;
  status: AttendanceSessionStatus;
  events: AttendanceHistoryEvent[];
  flags: AttendanceHistoryFlag[];
};

export type AttendanceHistoryEvent = {
  id: string;
  type: AttendanceEventType;
  capturedAtLocal: string;
  offlineDeclared: boolean;
};

export type AttendanceHistoryFlag = {
  id: string;
  attendanceEventId: string | null;
  type: AttendanceFlagType;
  outcome: Exclude<AttendanceHistoryOutcome, 'recorded'>;
  reviewedAt: string | null;
};

/**
 * Reads the signed-in user's employee-safe attendance history. In Supabase mode
 * the database derives the user from auth.uid(); mockUserId is used only by mock mode.
 */
export async function getMyAttendanceHistory(
  options: AttendanceHistoryOptions = {},
  mockUserId?: string
): Promise<ServiceResult<AttendanceHistory>> {
  const daysResult = normalizeRequestedDays(options.days);
  if (!daysResult.success) return daysResult;

  if (isMockAuthMode()) {
    if (!isNonEmptyString(mockUserId)) return failure('Attendance history is unavailable.');
    return getMockAttendanceHistory(mockUserId, daysResult.data);
  }

  if (!supabase) return failure('Attendance history is unavailable.');

  const { data, error } = await supabase.rpc('get_my_attendance_history', { p_days: daysResult.data });
  if (error || !isAttendanceHistory(data)) return failure('Attendance history is unavailable.');

  return success(data);
}

async function getMockAttendanceHistory(userId: string, requestedDays: number): Promise<ServiceResult<AttendanceHistory>> {
  const mockUser = mockUsers.find((user) => user.id === userId);
  const employee = mockAttendanceDetailData.find((detail) => detail.employeeName === mockUser?.name);
  const [wasReset, capturedDays] = await Promise.all([
    hasMockAttendanceReset(userId),
    getCapturedMockDays(userId)
  ]);
  const seededDays = wasReset ? [] : employee?.days.map(mapMockDay) ?? [];
  const allDays = mergeHistoryDays(seededDays, capturedDays);
  const latestWorkDate = allDays.reduce<string | null>(
    (latest, day) => (!latest || day.workDate > latest ? day.workDate : latest),
    null
  );
  const range = latestWorkDate
    ? { from: subtractCalendarDays(latestWorkDate, requestedDays - 1), to: latestWorkDate, days: requestedDays }
    : getCurrentHistoryRange(requestedDays);

  return success({
    userId,
    range,
    days: allDays
      .filter((day) => day.workDate >= range.from && day.workDate <= range.to)
      .sort((left, right) => right.workDate.localeCompare(left.workDate))
  });
}

async function getCapturedMockDays(userId: string): Promise<AttendanceHistoryDay[]> {
  if (typeof indexedDB === 'undefined') return [];

  try {
    const [acknowledgements, pendingEvents] = await Promise.all([
      getAttendanceAcknowledgements(userId),
      getPendingAttendanceEvents(userId)
    ]);
    const acknowledgedClientEventIds = new Set(acknowledgements.map((item) => item.input.clientEventId));
    const records = [
      ...acknowledgements.map(({ input, result }) => ({ input, result })),
      ...pendingEvents
        .filter((event) => !acknowledgedClientEventIds.has(event.clientEventId))
        .map((input) => ({ input, result: null }))
    ];
    return buildCapturedHistoryDays(records);
  } catch {
    return [];
  }
}

function buildCapturedHistoryDays(
  records: Array<{ input: AttendanceRecorderInput | PendingAttendanceEvent; result: AttendanceRecorderResult | null }>
): AttendanceHistoryDay[] {
  const sessions = new Map<string, { workDate: string; session: AttendanceHistorySession }>();

  for (const { input, result } of records) {
    const sessionId = result?.sessionId ?? input.sessionId ?? input.clientEventId;
    const workDate = result?.workDate ?? getWorkDate(input.capturedAtLocal);
    const current = sessions.get(sessionId) ?? {
      workDate,
      session: {
        id: sessionId,
        type: result?.sessionType ?? getSessionType(input.eventType),
        status: result?.sessionStatus ?? 'open',
        events: [] as AttendanceHistoryEvent[],
        flags: [] as AttendanceHistoryFlag[]
      }
    };
    const eventId = result?.eventId ?? input.clientEventId;

    if (!current.session.events.some((event) => event.id === eventId)) {
      current.session.events.push({
        id: eventId,
        type: input.eventType,
        capturedAtLocal: input.capturedAtLocal,
        offlineDeclared: input.offlineDeclared ?? false
      });
    }

    for (const flagType of getCapturedFlagTypes(input, result)) {
      const flagId = `${eventId}:${flagType}`;
      if (!current.session.flags.some((flag) => flag.id === flagId)) {
        current.session.flags.push({
          id: flagId,
          attendanceEventId: eventId,
          type: flagType,
          outcome: 'needs_review' as const,
          reviewedAt: null
        });
      }
    }

    current.session.status = getCapturedSessionStatus(current.session, result);
    sessions.set(sessionId, current);
  }

  const byDate = new Map<string, AttendanceHistorySession[]>();
  for (const { workDate, session } of sessions.values()) {
    session.events.sort((left, right) => left.capturedAtLocal.localeCompare(right.capturedAtLocal));
    byDate.set(workDate, [...(byDate.get(workDate) ?? []), session]);
  }

  return Array.from(byDate, ([workDate, daySessions]) => {
    const outcome = getDayOutcome(daySessions);
    return { workDate, requiresReview: outcome === 'needs_review', outcome, sessions: daySessions };
  });
}

function mergeHistoryDays(
  seededDays: AttendanceHistoryDay[],
  capturedDays: AttendanceHistoryDay[]
): AttendanceHistoryDay[] {
  const daysByDate = new Map(seededDays.map((day) => [day.workDate, day]));

  for (const capturedDay of capturedDays) {
    const seededDay = daysByDate.get(capturedDay.workDate);
    if (!seededDay) {
      daysByDate.set(capturedDay.workDate, capturedDay);
      continue;
    }

    const sessions = [...seededDay.sessions, ...capturedDay.sessions];
    const outcome = getDayOutcome(sessions);
    daysByDate.set(capturedDay.workDate, {
      workDate: capturedDay.workDate,
      requiresReview: outcome === 'needs_review',
      outcome,
      sessions
    });
  }

  return Array.from(daysByDate.values());
}

function getCapturedFlagTypes(
  input: AttendanceRecorderInput | PendingAttendanceEvent,
  result: AttendanceRecorderResult | null
) {
  if (result) return result.flagTypes;

  const flagTypes: AttendanceFlagType[] = [];
  if (input.offlineDeclared) flagTypes.push('offline_submission');
  if (isPhotoRequired(input.eventType) && !input.photoPath?.trim()) flagTypes.push('missing_photo');
  return flagTypes;
}

function getCapturedSessionStatus(
  session: AttendanceHistorySession,
  result: AttendanceRecorderResult | null
): AttendanceSessionStatus {
  if (result?.sessionStatus === 'needs_review') return 'needs_review';
  if (session.events.some((event) => event.type === 'time_out' || event.type === 'visit_out')) {
    return session.flags.length > 0 ? 'needs_review' : 'closed';
  }
  return 'open';
}

function getDayOutcome(sessions: AttendanceHistorySession[]): AttendanceHistoryOutcome {
  const flags = sessions.flatMap((session) => session.flags);
  if (flags.some((flag) => flag.outcome === 'needs_review')) return 'needs_review';
  if (flags.some((flag) => flag.outcome === 'rejected')) return 'rejected';
  if (flags.some((flag) => flag.outcome === 'resolved')) return 'resolved';
  if (flags.some((flag) => flag.outcome === 'valid_for_reporting')) return 'valid_for_reporting';
  if (sessions.some((session) => session.status === 'needs_review')) return 'needs_review';
  return 'recorded';
}

function mapMockDay(day: AttendanceDayDetail): AttendanceHistoryDay {
  const events = day.events.map(mapMockEvent);
  const flags = day.flags.flatMap((flag) => {
    const affectedEvents = day.events.filter((event) => event.flag === flag.flagType);
    return affectedEvents.length > 0
      ? affectedEvents.map((event) => mapMockFlag(flag, event.id))
      : [mapMockFlag(flag)];
  });
  const outcome = getMockDayOutcome(day.status, flags);
  return {
    workDate: day.workDate,
    requiresReview: outcome === 'needs_review',
    outcome,
    sessions: [{
      id: `mock-session-${day.workDate}`,
      type: day.events.some((event) => event.eventType.startsWith('Visit')) ? 'field_visit' : 'stationary_day',
      status: day.status === 'Needs Review' ? 'needs_review' : 'closed',
      events,
      flags
    }]
  };
}

function mapMockEvent(event: AttendanceEventDetail): AttendanceHistoryEvent {
  return {
    id: event.id,
    type: toAttendanceEventType(event.eventType),
    capturedAtLocal: event.timestamp,
    offlineDeclared: event.offline ?? false
  };
}

function mapMockFlag(flag: AttendanceFlagDetail, attendanceEventId: string | null = null): AttendanceHistoryFlag {
  return {
    id: attendanceEventId ? `${flag.id}:${attendanceEventId}` : flag.id,
    attendanceEventId,
    type: flag.flagType,
    outcome: flag.status === 'open' ? 'needs_review' : 'resolved',
    reviewedAt: null
  };
}

function getMockDayOutcome(
  status: AttendanceDayDetail['status'],
  flags: AttendanceHistoryFlag[]
): AttendanceHistoryOutcome {
  if (flags.some((flag) => flag.outcome === 'needs_review')) return 'needs_review';
  if (flags.some((flag) => flag.outcome === 'rejected')) return 'rejected';
  if (flags.some((flag) => flag.outcome === 'resolved')) return 'resolved';
  if (flags.some((flag) => flag.outcome === 'valid_for_reporting')) return 'valid_for_reporting';
  if (status === 'Needs Review') return 'needs_review';
  return 'recorded';
}

function getSessionType(eventType: AttendanceEventType): AttendanceSessionType {
  return eventType === 'visit_in' || eventType === 'visit_out' ? 'field_visit' : 'stationary_day';
}

function isPhotoRequired(eventType: AttendanceEventType) {
  return eventType === 'time_in' || eventType === 'time_out' || eventType === 'visit_in' || eventType === 'visit_out';
}

function toAttendanceEventType(eventType: AttendanceEventDetail['eventType']): AttendanceEventType {
  const eventTypeMap: Record<AttendanceEventDetail['eventType'], AttendanceEventType> = {
    'Time In': 'time_in',
    'Lunch Out': 'lunch_out',
    'Lunch In': 'lunch_in',
    'Time Out': 'time_out',
    'Visit In': 'visit_in',
    'Visit Out': 'visit_out'
  };
  return eventTypeMap[eventType];
}

function normalizeRequestedDays(days: number | undefined): ServiceResult<number> {
  const normalizedDays = days ?? defaultHistoryDays;
  if (!Number.isInteger(normalizedDays) || normalizedDays < 1 || normalizedDays > maximumHistoryDays) {
    return failure('Attendance history is unavailable.');
  }
  return success(normalizedDays);
}

function isAttendanceHistory(value: unknown): value is AttendanceHistory {
  if (!isRecord(value) || !isUuid(value.userId) || !isRecord(value.range) || !Array.isArray(value.days)) return false;
  return (
    isDateString(value.range.from) &&
    isDateString(value.range.to) &&
    typeof value.range.days === 'number' &&
    Number.isInteger(value.range.days) &&
    value.range.days >= 1 &&
    value.days.every(isAttendanceHistoryDay)
  );
}

function isAttendanceHistoryDay(value: unknown): value is AttendanceHistoryDay {
  return isRecord(value) && isDateString(value.workDate) && typeof value.requiresReview === 'boolean' &&
    isAttendanceHistoryOutcome(value.outcome) &&
    Array.isArray(value.sessions) && value.sessions.every(isAttendanceHistorySession);
}

function isAttendanceHistorySession(value: unknown): value is AttendanceHistorySession {
  return isRecord(value) && isUuid(value.id) && attendanceSessionTypes.has(value.type as AttendanceSessionType) &&
    attendanceSessionStatuses.has(value.status as AttendanceSessionStatus) && Array.isArray(value.events) &&
    value.events.every(isAttendanceHistoryEvent) && Array.isArray(value.flags) && value.flags.every(isAttendanceHistoryFlag);
}

function isAttendanceHistoryEvent(value: unknown): value is AttendanceHistoryEvent {
  return isRecord(value) && isUuid(value.id) && attendanceEventTypes.has(value.type as AttendanceEventType) &&
    isIsoTimestamp(value.capturedAtLocal) && typeof value.offlineDeclared === 'boolean';
}

function isAttendanceHistoryFlag(value: unknown): value is AttendanceHistoryFlag {
  return isRecord(value) && isUuid(value.id) && (value.attendanceEventId === null || isUuid(value.attendanceEventId)) &&
    attendanceFlagTypes.has(value.type as AttendanceFlagType) &&
    value.outcome !== 'recorded' && isAttendanceHistoryOutcome(value.outcome) &&
    (value.reviewedAt === null || isIsoTimestamp(value.reviewedAt));
}

function isAttendanceHistoryOutcome(value: unknown): value is AttendanceHistoryOutcome {
  return value === 'recorded' || value === 'needs_review' || value === 'resolved' ||
    value === 'valid_for_reporting' || value === 'rejected';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function getCurrentHistoryRange(days: number): AttendanceHistory['range'] {
  const to = getManilaDateString();
  return { from: subtractCalendarDays(to, days - 1), to, days };
}

function getWorkDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(timestamp));
}

function subtractCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function getManilaDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}
