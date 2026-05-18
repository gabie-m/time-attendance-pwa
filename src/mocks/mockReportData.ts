export type ReportTab =
  | 'attendance-summary'
  | 'late-undertime'
  | 'absences'
  | 'overtime'
  | 'flagged-records'
  | 'manual-edit-requests';

export const reportTabs: Array<{ id: ReportTab; label: string }> = [
  { id: 'attendance-summary', label: 'Attendance Summary' },
  { id: 'late-undertime', label: 'Late & Undertime' },
  { id: 'absences', label: 'Absences' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'flagged-records', label: 'Flagged Records' },
  { id: 'manual-edit-requests', label: 'Manual Edit Requests' }
];

export const attendanceSummaryRows = [
  ['Maria Santos', '2026-05-11', '08:03 AM', '05:12 PM', '8h 09m', '0', '0', '9'],
  ['Jonas Reyes', '2026-05-11', '09:18 AM', '06:02 PM', '7h 44m', '13', '16', '0'],
  ['Lea Cruz', '2026-05-11', '08:47 AM', '06:30 PM', '8h 43m', '42', '0', '43'],
  ['Paolo Garcia', '2026-05-11', '08:00 AM', '04:36 PM', '7h 36m', '0', '24', '0']
];

export const lateUndertimeRows = [
  ['Jonas Reyes', '2026-05-11', 'Robinsons Galleria', '13', '16'],
  ['Lea Cruz', '2026-05-11', 'SM Megamall', '42', '0'],
  ['Carlo Mendoza', '2026-05-10', 'Main Warehouse', '8', '32'],
  ['Ana Dela Cruz', '2026-05-09', 'Ayala Malls Manila Bay', '19', '0']
];

export const absenceRows = [
  ['Bianca Ramos', '2026-05-11', 'SM North EDSA', '09:00 AM - 06:00 PM'],
  ['Marco Lim', '2026-05-10', 'Main Warehouse', '08:00 AM - 05:00 PM'],
  ['Nina Villanueva', '2026-05-09', 'Robinsons Magnolia', '10:00 AM - 07:00 PM']
];

export const overtimeRows = [
  ['Maria Santos', '2026-05-11', 'SM Megamall', '9'],
  ['Lea Cruz', '2026-05-11', 'SM Megamall', '43'],
  ['Rafael Cruz', '2026-05-10', 'BGC High Street', '76'],
  ['Celine Navarro', '2026-05-09', 'Main Warehouse', '31']
];

export const flaggedRows = [
  ['employee-jonas', 'Jonas Reyes', '2026-05-11', 'offline submission', 'warning', 'needs review'],
  ['employee-lea', 'Lea Cruz', '2026-05-11', 'GPS outside radius', 'high', 'open'],
  ['employee-ana', 'Ana Dela Cruz', '2026-05-10', 'low GPS accuracy', 'warning', 'open'],
  ['employee-paolo', 'Paolo Garcia', '2026-05-09', 'location conflict', 'high', 'reviewed']
];

export const manualEditRows = [
  ['Maria Santos', 'missed_punch', 'Forgot to tap Lunch In after break', '2026-05-11 06:18 PM', 'pending'],
  ['Jonas Reyes', 'incorrect_time', 'Visit out should be 02:30 PM based on client log', '2026-05-11 07:04 PM', 'pending'],
  ['Lea Cruz', 'missed_visit', 'BGC store coaching visit was not captured', '2026-05-10 08:15 PM', 'approved'],
  ['Ana Dela Cruz', 'sync_issue', 'Offline punches did not upload during mall outage', '2026-05-09 09:42 PM', 'rejected']
];

export const managerRows = [
  ['Ana Dela Cruz', 'Timed in', 'SM Megamall', 'Normal'],
  ['Jonas Reyes', 'Field visit', 'SM North EDSA', 'Flagged'],
  ['Lea Cruz', 'Late', 'Robinsons Galleria', 'Needs review'],
  ['Marco Lim', 'Timed out', 'Main Warehouse', 'Normal']
];

// Legacy attendanceEvents, visits, and approvals from src/data/mockData.ts used older screen-only shapes.
// They were unused by current screens, so this cleanup flags them here instead of silently reshaping them.
