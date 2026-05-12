import { useEffect, useState } from 'react';

export type RequestType =
  | 'missed_punch'
  | 'incorrect_time'
  | 'missed_visit'
  | 'sync_issue'
  | 'other';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionPayload {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface ManualEditRequest {
  id: string;
  user_id: string;
  attendance_session_id: string;
  request_type: RequestType;
  requested_payload: CorrectionPayload[];
  reason: string;
  notes?: string;
  status: RequestStatus;
  manager_id?: string;
  manager_remarks?: string;
  created_at: string;
  updated_at: string;
}

export interface ManualAdjustment {
  id: string;
  manual_edit_request_id: string;
  attendance_session_id: string;
  adjusted_payload: CorrectionPayload[];
  approved_by: string;
  created_at: string;
}

export type MockAttendanceSession = {
  id: string;
  user_id: string;
  work_date: string;
  label: string;
  session_type: 'stationary_day' | 'field_visit';
  status: 'open' | 'closed';
};

export type ManualEditFormInput = {
  user_id: string;
  attendance_session_id: string;
  request_type: RequestType;
  requested_payload: CorrectionPayload[];
  reason: string;
  notes?: string;
};

export type ManualEditReviewInput = {
  request_id: string;
  decision: RequestStatus;
  manager_id: string;
  manager_remarks: string;
};

const requestStorageKey = 'manual-edit-requests';
const adjustmentStorageKey = 'manual-adjustments';
const maxEditRequestDaysBack = 30;
const listeners = new Set<() => void>();

export const requestTypeLabels: Record<RequestType, string> = {
  missed_punch: 'Missed punch',
  incorrect_time: 'Incorrect time recorded',
  missed_visit: 'Missed visit or session',
  sync_issue: 'Records did not sync',
  other: 'Other correction'
};

export function useManualEditRequests() {
  const [requests, setRequests] = useState(() => listManualEditRequests());

  useEffect(() => {
    return subscribeManualEditRequests(() => {
      setRequests(listManualEditRequests());
    });
  }, []);

  return requests;
}

export function listManualEditRequests() {
  return readJson<ManualEditRequest[]>(requestStorageKey, seedManualEditRequests());
}

export function listManualAdjustments() {
  return readJson<ManualAdjustment[]>(adjustmentStorageKey, []);
}

export function listManualEditRequestsForUser(userId: string) {
  return listManualEditRequests().filter((request) => request.user_id === userId);
}

export function listPendingManualEditRequests() {
  return listManualEditRequests().filter((request) => request.status === 'pending');
}

export function listSessionsForUserOnDate(userId: string, workDate: string) {
  return getMockAttendanceSessions().filter((session) => {
    return session.user_id === userId && session.work_date === workDate;
  });
}

export function listRequestableDates(userId: string) {
  return Array.from(
    new Set(
      getMockAttendanceSessions()
        .filter((session) => session.user_id === userId)
        .map((session) => session.work_date)
    )
  ).sort((a, b) => b.localeCompare(a));
}

export function getSessionById(sessionId: string) {
  return getMockAttendanceSessions().find((session) => session.id === sessionId);
}

export function getManualEditValidationError(input: ManualEditFormInput) {
  const session = getSessionById(input.attendance_session_id);

  if (!input.attendance_session_id || !session) {
    return 'Select an attendance session for the selected date.';
  }

  if (session.status !== 'closed') {
    return "You can submit a correction after today's attendance is complete.";
  }

  if (!isWithinLookbackWindow(session.work_date)) {
    return `Correction requests are limited to the last ${maxEditRequestDaysBack} days.`;
  }

  if (!input.request_type) {
    return 'Select a request type.';
  }

  if (!input.requested_payload[0]?.field || !String(input.requested_payload[0]?.new_value ?? '').trim()) {
    return 'Enter what needs to be corrected and what it should be changed to.';
  }

  if (!input.reason.trim()) {
    return 'Enter a reason for this correction request.';
  }

  const hasDuplicatePendingRequest = listManualEditRequests().some((request) => {
    return (
      request.user_id === input.user_id &&
      request.attendance_session_id === input.attendance_session_id &&
      request.request_type === input.request_type &&
      request.status === 'pending'
    );
  });

  if (hasDuplicatePendingRequest) {
    return 'You already have a pending correction request for this session.';
  }

  return null;
}

export function submitManualEditRequest(input: ManualEditFormInput) {
  const validationError = getManualEditValidationError(input);
  if (validationError) {
    return { ok: false as const, error: validationError };
  }

  const now = new Date().toISOString();
  const nextRequest: ManualEditRequest = {
    id: crypto.randomUUID(),
    user_id: input.user_id,
    attendance_session_id: input.attendance_session_id,
    request_type: input.request_type,
    requested_payload: input.requested_payload,
    reason: input.reason.trim(),
    notes: input.notes?.trim() || undefined,
    status: 'pending',
    created_at: now,
    updated_at: now
  };

  writeRequests([nextRequest, ...listManualEditRequests()]);
  return { ok: true as const, request: nextRequest };
}

export function cancelManualEditRequest(requestId: string, userId: string) {
  const requests = listManualEditRequests();
  const request = requests.find((item) => item.id === requestId);

  if (!request || request.user_id !== userId || request.status !== 'pending') {
    return { ok: false as const, error: 'Only pending requests can be cancelled by the requester.' };
  }

  writeRequests(requests.filter((item) => item.id !== requestId));
  return { ok: true as const };
}

export function reviewManualEditRequest(input: ManualEditReviewInput) {
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    return { ok: false as const, error: 'Select approve or reject.' };
  }

  if (!input.manager_remarks.trim()) {
    return { ok: false as const, error: 'Manager remarks are required.' };
  }

  const requests = listManualEditRequests();
  const request = requests.find((item) => item.id === input.request_id);

  if (!request || request.status !== 'pending') {
    return { ok: false as const, error: 'Only pending requests can be reviewed.' };
  }

  const now = new Date().toISOString();
  const nextRequests = requests.map((item) => {
    if (item.id !== input.request_id) {
      return item;
    }

    return {
      ...item,
      status: input.decision,
      manager_id: input.manager_id,
      manager_remarks: input.manager_remarks.trim(),
      updated_at: now
    };
  });

  writeRequests(nextRequests);

  if (input.decision === 'approved') {
    const adjustment: ManualAdjustment = {
      id: crypto.randomUUID(),
      manual_edit_request_id: request.id,
      attendance_session_id: request.attendance_session_id,
      adjusted_payload: request.requested_payload,
      approved_by: input.manager_id,
      created_at: now
    };
    writeAdjustments([adjustment, ...listManualAdjustments()]);
  }

  return { ok: true as const };
}

function subscribeManualEditRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function writeRequests(requests: ManualEditRequest[]) {
  window.localStorage.setItem(requestStorageKey, JSON.stringify(requests));
  emitChange();
}

function writeAdjustments(adjustments: ManualAdjustment[]) {
  window.localStorage.setItem(adjustmentStorageKey, JSON.stringify(adjustments));
  emitChange();
}

function readJson<T>(key: string, fallback: T) {
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function isWithinLookbackWindow(workDate: string) {
  const today = startOfDay(new Date());
  const date = startOfDay(new Date(`${workDate}T00:00:00`));
  const diffDays = Math.floor((today.getTime() - date.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= maxEditRequestDaysBack;
}

function getMockAttendanceSessions(): MockAttendanceSession[] {
  const today = toDateInputValue(new Date());
  const yesterday = toDateInputValue(addDays(new Date(), -1));
  const twoDaysAgo = toDateInputValue(addDays(new Date(), -2));

  return [
    {
      id: `stationary-${today}`,
      user_id: 'user-stationary',
      work_date: today,
      label: 'Stationary day - SM Megamall - Open',
      session_type: 'stationary_day',
      status: 'open'
    },
    {
      id: `stationary-${yesterday}`,
      user_id: 'user-stationary',
      work_date: yesterday,
      label: 'Stationary day - SM Megamall - Closed',
      session_type: 'stationary_day',
      status: 'closed'
    },
    {
      id: `manager-${yesterday}`,
      user_id: 'manager',
      work_date: yesterday,
      label: 'Stationary day - Robinsons Galleria - Closed',
      session_type: 'stationary_day',
      status: 'closed'
    },
    {
      id: `roving-${today}-open`,
      user_id: 'user-roving',
      work_date: today,
      label: 'Field visit - SM Megamall - Open',
      session_type: 'field_visit',
      status: 'open'
    },
    {
      id: `roving-${yesterday}-a`,
      user_id: 'user-roving',
      work_date: yesterday,
      label: 'Field visit - Robinsons Galleria - Closed',
      session_type: 'field_visit',
      status: 'closed'
    },
    {
      id: `roving-${yesterday}-b`,
      user_id: 'user-roving',
      work_date: yesterday,
      label: 'Field visit - SM Megamall - Closed',
      session_type: 'field_visit',
      status: 'closed'
    },
    {
      id: `roving-${twoDaysAgo}-sync`,
      user_id: 'user-roving',
      work_date: twoDaysAgo,
      label: 'Field visit - Main Warehouse - Closed',
      session_type: 'field_visit',
      status: 'closed'
    }
  ];
}

function seedManualEditRequests(): ManualEditRequest[] {
  const yesterday = toDateInputValue(addDays(new Date(), -1));
  const now = new Date().toISOString();

  return [
    {
      id: 'manual-seed-1',
      user_id: 'user-roving',
      attendance_session_id: `roving-${yesterday}-a`,
      request_type: 'missed_visit',
      requested_payload: [
        {
          field: 'visit_time_out',
          old_value: 'Missing',
          new_value: '10:45'
        }
      ],
      reason: 'Forgot to end the visit after the store audit.',
      notes: 'Store supervisor can verify.',
      status: 'pending',
      created_at: now,
      updated_at: now
    }
  ];
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function toDateInputValue(date: Date) {
  return new Intl.DateTimeFormat('en-CA').format(date);
}
