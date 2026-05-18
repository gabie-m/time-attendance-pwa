import type { ManualEditRequest, MockAttendanceSession } from '../services/mockManualEditService';

export function getMockAttendanceSessions(): MockAttendanceSession[] {
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

export function seedManualEditRequests(): ManualEditRequest[] {
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

function toDateInputValue(date: Date) {
  return new Intl.DateTimeFormat('en-CA').format(date);
}
