import type {
  ManagerStaffAssignment,
  StaffProfile,
  User,
  UserLocationAssignment
} from '../services/mockStaffService';

const seedCreatedAt = '2026-05-01T00:00:00.000Z';

export const seedUsers: User[] = [
  {
    id: 'user-stationary',
    name: 'Maria Santos',
    email: 'maria@example.com',
    role: 'user',
    active: true,
    deactivated_at: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'user-roving',
    name: 'Jonas Reyes',
    email: 'jonas@example.com',
    role: 'user',
    active: true,
    deactivated_at: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'manager',
    name: 'Lea Cruz',
    email: 'lea@example.com',
    role: 'manager',
    active: true,
    deactivated_at: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'admin',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    active: true,
    deactivated_at: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'user-deactivated',
    name: 'Carlo Mendoza',
    email: 'carlo@example.com',
    role: 'user',
    active: false,
    deactivated_at: '2026-04-15T00:00:00.000Z',
    created_at: seedCreatedAt,
    updated_at: '2026-04-15T00:00:00.000Z'
  }
];

export const seedStaffProfiles: StaffProfile[] = [
  {
    user_id: 'user-stationary',
    employee_code: 'EMP-001',
    staff_type: 'stationary',
    default_attendance_model: 'stationary',
    timezone: 'Asia/Manila',
    shift_label: '08:00-17:00',
    active: true,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    user_id: 'user-roving',
    employee_code: 'EMP-002',
    staff_type: 'roving',
    default_attendance_model: 'roving',
    timezone: 'Asia/Manila',
    shift_label: 'Flexible visits',
    active: true,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    user_id: 'manager',
    employee_code: 'MGR-001',
    staff_type: 'roving',
    default_attendance_model: 'roving',
    timezone: 'Asia/Manila',
    shift_label: 'Flexible visits',
    active: true,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    user_id: 'admin',
    employee_code: 'ADM-001',
    staff_type: 'stationary',
    default_attendance_model: 'stationary',
    timezone: 'Asia/Manila',
    shift_label: 'Operations',
    active: true,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    user_id: 'user-deactivated',
    employee_code: 'EMP-099',
    staff_type: 'stationary',
    default_attendance_model: 'stationary',
    timezone: 'Asia/Manila',
    shift_label: '08:00-17:00',
    active: false,
    created_at: seedCreatedAt,
    updated_at: '2026-04-15T00:00:00.000Z'
  }
];

export const seedManagerAssignments: ManagerStaffAssignment[] = [
  {
    id: 'mgr-assign-1',
    manager_id: 'manager',
    staff_user_id: 'user-stationary',
    effective_from: '2026-05-01',
    effective_to: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'mgr-assign-2',
    manager_id: 'manager',
    staff_user_id: 'user-roving',
    effective_from: '2026-05-01',
    effective_to: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  }
];

export const seedLocationAssignments: UserLocationAssignment[] = [
  {
    id: 'loc-assign-1',
    user_id: 'user-stationary',
    location_id: 'loc-megamall',
    assignment_type: 'primary',
    effective_from: '2026-05-01',
    effective_to: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'loc-assign-2',
    user_id: 'user-roving',
    location_id: 'loc-galleria',
    assignment_type: 'allowed',
    effective_from: '2026-05-01',
    effective_to: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  },
  {
    id: 'loc-assign-3',
    user_id: 'manager',
    location_id: 'loc-megamall',
    assignment_type: 'allowed',
    effective_from: '2026-05-01',
    effective_to: null,
    created_at: seedCreatedAt,
    updated_at: seedCreatedAt
  }
];
