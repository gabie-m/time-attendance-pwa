import type { EventFlagType, FlagSeverity, FlagStatus } from './mockAttendanceDetailData';

export type FlagReviewPriority = 'urgent' | 'standard';
export type FlagReviewWorkflowMode =
  | 'manager_review_admin_observe'
  | 'manager_preapprove_admin_final'
  | 'manager_view_admin_approve';
export type FlagReviewerDecisionStatus = 'not_required' | 'pending' | 'approved' | 'pre_approved' | 'rejected';

export type FlagReviewWorkflowOption = {
  id: FlagReviewWorkflowMode;
  label: string;
  description: string;
};

export type FlagReviewWorkflowSetting = {
  flagType: EventFlagType;
  workflowMode: FlagReviewWorkflowMode;
};

export type FlagReviewerDecision = {
  status: FlagReviewerDecisionStatus;
  reviewerName?: string;
  reviewedAt?: string;
  remarks?: string;
};

export type FlagReviewActorRole = 'manager' | 'admin';

export type FlagReviewActionHistoryItem = {
  id: string;
  actorRole: FlagReviewActorRole;
  actorName: string;
  actionLabel: string;
  decisionStatus: FlagReviewerDecisionStatus;
  remarks: string;
  createdAt: string;
};

export type FlagReviewRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  role: 'user' | 'manager';
  staffType: 'stationary' | 'roving';
  managerName: string;
  workDate: string;
  submittedAt: string;
  locationName: string;
  expectedLocation: string;
  flagType: EventFlagType;
  severity: FlagSeverity;
  status: FlagStatus;
  priority: FlagReviewPriority;
  eventLabel: string;
  eventTimestamp: string;
  gpsCoordinates: string;
  gpsAccuracyMeters: number;
  distanceMeters?: number;
  offline: boolean;
  summary: string;
  evidence: string[];
  managerDecisionStatus: FlagReviewerDecisionStatus;
  managerDecision?: FlagReviewerDecision;
  adminDecisionStatus: FlagReviewerDecisionStatus;
  adminDecision?: FlagReviewerDecision;
  actionHistory?: FlagReviewActionHistoryItem[];
};

export const defaultFlagReviewWorkflowMode: FlagReviewWorkflowMode = 'manager_preapprove_admin_final';

export const defaultFlagReviewWorkflowSettings: FlagReviewWorkflowSetting[] = [
  {
    flagType: 'outside_radius',
    workflowMode: 'manager_preapprove_admin_final'
  },
  {
    flagType: 'gps_low_accuracy',
    workflowMode: 'manager_review_admin_observe'
  },
  {
    flagType: 'offline_submission',
    workflowMode: 'manager_view_admin_approve'
  },
  {
    flagType: 'location_conflict',
    workflowMode: 'manager_preapprove_admin_final'
  },
  {
    flagType: 'missing_punch',
    workflowMode: 'manager_review_admin_observe'
  }
];

export const flagReviewWorkflowOptions: FlagReviewWorkflowOption[] = [
  {
    id: 'manager_review_admin_observe',
    label: 'Manager review and approve',
    description: 'Manager reviews and approves the flag. Admin can see the flag and review the manager decision.'
  },
  {
    id: 'manager_preapprove_admin_final',
    label: 'Manager pre-approval, Admin final approval',
    description: 'Manager pre-approves the flag. Admin reviews the pre-approval and gives the final approval.'
  },
  {
    id: 'manager_view_admin_approve',
    label: 'Manager visibility, Admin approval',
    description: 'Manager can see the flag for awareness only. Admin is the only approver.'
  }
];

export const flagReviewRecords: FlagReviewRecord[] = [
  {
    id: 'flag-review-001',
    employeeId: 'employee-lea',
    employeeName: 'Lea Cruz',
    employeeCode: 'MGR-001',
    role: 'manager',
    staffType: 'roving',
    managerName: 'Admin User',
    workDate: '2026-05-12',
    submittedAt: '2026-05-12T10:14:00.000+08:00',
    locationName: 'SM Megamall',
    expectedLocation: 'SM Megamall',
    flagType: 'outside_radius',
    severity: 'high',
    status: 'open',
    priority: 'urgent',
    eventLabel: 'Visit In',
    eventTimestamp: '2026-05-12T08:47:00.000+08:00',
    gpsCoordinates: '14.5988, 121.0642',
    gpsAccuracyMeters: 32,
    distanceMeters: 1640,
    offline: false,
    summary: 'Visit was captured outside the configured radius for SM Megamall.',
    evidence: ['Allowed radius: 250m', 'Measured distance: 1,640m', 'GPS accuracy: 32m'],
    managerDecisionStatus: 'pending',
    managerDecision: {
      status: 'pending'
    },
    adminDecisionStatus: 'pending'
  },
  {
    id: 'flag-review-002',
    employeeId: 'employee-jonas',
    employeeName: 'Jonas Reyes',
    employeeCode: 'EMP-002',
    role: 'user',
    staffType: 'roving',
    managerName: 'Lea Cruz',
    workDate: '2026-05-12',
    submittedAt: '2026-05-12T11:09:00.000+08:00',
    locationName: 'Robinsons Galleria',
    expectedLocation: 'Robinsons Galleria',
    flagType: 'offline_submission',
    severity: 'warning',
    status: 'open',
    priority: 'standard',
    eventLabel: 'Visit Out',
    eventTimestamp: '2026-05-12T11:02:00.000+08:00',
    gpsCoordinates: '14.5914, 121.0598',
    gpsAccuracyMeters: 39,
    offline: true,
    summary: 'Attendance was captured offline and synced after the visit ended.',
    evidence: ['Captured offline: yes', 'Sync delay: 7 minutes', 'Device record retained for audit'],
    managerDecisionStatus: 'pre_approved',
    managerDecision: {
      status: 'pre_approved',
      reviewerName: 'Lea Cruz',
      reviewedAt: '2026-05-12T11:18:00.000+08:00',
      remarks: 'Verified store visit with Robinsons Galleria supervisor. Offline capture was due to mall network outage.'
    },
    adminDecisionStatus: 'pending'
  },
  {
    id: 'flag-review-003',
    employeeId: 'employee-ana',
    employeeName: 'Ana Dela Cruz',
    employeeCode: 'EMP-014',
    role: 'user',
    staffType: 'stationary',
    managerName: 'Lea Cruz',
    workDate: '2026-05-12',
    submittedAt: '2026-05-12T09:04:00.000+08:00',
    locationName: 'Ayala Malls Manila Bay',
    expectedLocation: 'Ayala Malls Manila Bay',
    flagType: 'gps_low_accuracy',
    severity: 'warning',
    status: 'open',
    priority: 'standard',
    eventLabel: 'Time In',
    eventTimestamp: '2026-05-12T09:01:00.000+08:00',
    gpsCoordinates: '14.5321, 120.9822',
    gpsAccuracyMeters: 96,
    offline: false,
    summary: 'GPS accuracy was lower than the configured confidence threshold.',
    evidence: ['GPS accuracy: 96m', 'Recommended review threshold: 75m', 'Attendance accepted and flagged'],
    managerDecisionStatus: 'pending',
    managerDecision: {
      status: 'pending'
    },
    adminDecisionStatus: 'pending'
  },
  {
    id: 'flag-review-004',
    employeeId: 'employee-paolo',
    employeeName: 'Paolo Garcia',
    employeeCode: 'EMP-018',
    role: 'user',
    staffType: 'stationary',
    managerName: 'Lea Cruz',
    workDate: '2026-05-11',
    submittedAt: '2026-05-11T08:05:00.000+08:00',
    locationName: 'Robinsons Galleria',
    expectedLocation: 'SM Megamall',
    flagType: 'location_conflict',
    severity: 'high',
    status: 'reviewed',
    priority: 'urgent',
    eventLabel: 'Time In',
    eventTimestamp: '2026-05-11T08:01:00.000+08:00',
    gpsCoordinates: '14.5915, 121.0599',
    gpsAccuracyMeters: 21,
    distanceMeters: 870,
    offline: false,
    summary: 'Employee worked from an approved location that did not match the expected schedule.',
    evidence: ['Expected: SM Megamall', 'Actual: Robinsons Galleria', 'Status: reviewed by admin'],
    managerDecisionStatus: 'approved',
    managerDecision: {
      status: 'approved',
      reviewerName: 'Lea Cruz',
      reviewedAt: '2026-05-11T10:24:00.000+08:00',
      remarks: 'Approved as alternate branch coverage. Staff was reassigned due to same-day staffing gap.'
    },
    adminDecisionStatus: 'approved',
    adminDecision: {
      status: 'approved',
      reviewerName: 'Admin User',
      reviewedAt: '2026-05-11T11:02:00.000+08:00',
      remarks: 'Final approval based on manager review and assignment note.'
    }
  },
  {
    id: 'flag-review-005',
    employeeId: 'employee-carlo',
    employeeName: 'Carlo Mendoza',
    employeeCode: 'EMP-099',
    role: 'user',
    staffType: 'stationary',
    managerName: 'Lea Cruz',
    workDate: '2026-04-13',
    submittedAt: '2026-04-13T18:35:00.000+08:00',
    locationName: 'Main Warehouse',
    expectedLocation: 'Main Warehouse',
    flagType: 'missing_punch',
    severity: 'high',
    status: 'resolved',
    priority: 'urgent',
    eventLabel: 'Time Out',
    eventTimestamp: '2026-04-13T18:31:00.000+08:00',
    gpsCoordinates: '14.5764, 121.0851',
    gpsAccuracyMeters: 34,
    offline: false,
    summary: 'Historical day had a missing punch before user deactivation.',
    evidence: ['Manual edit approved', 'Original record preserved', 'User deactivated after record date'],
    managerDecisionStatus: 'approved',
    managerDecision: {
      status: 'approved',
      reviewerName: 'Lea Cruz',
      reviewedAt: '2026-04-13T19:10:00.000+08:00',
      remarks: 'Approved based on warehouse shift log and manual edit request.'
    },
    adminDecisionStatus: 'approved',
    adminDecision: {
      status: 'approved',
      reviewerName: 'Admin User',
      reviewedAt: '2026-04-14T09:00:00.000+08:00',
      remarks: 'Historical flag resolved before user deactivation.'
    }
  }
];
