import type { MockUser } from '../auth/types';

export const mockUsers: MockUser[] = [
  {
    id: 'user-stationary',
    name: 'Maria Santos',
    role: 'user',
    attendanceModel: 'stationary',
    expectedLocation: 'SM Megamall',
    shift: '08:00-17:00',
    locationConsentGivenAt: null
  },
  {
    id: 'user-roving',
    name: 'Jonas Reyes',
    role: 'user',
    attendanceModel: 'roving',
    expectedLocation: 'Field Route 04',
    shift: 'Flexible visits',
    locationConsentGivenAt: '2026-05-01T08:00:00.000Z'
  },
  {
    id: 'manager',
    name: 'Lea Cruz',
    role: 'manager',
    attendanceModel: 'roving',
    expectedLocation: 'Field Route 02',
    shift: 'Flexible visits',
    locationConsentGivenAt: '2026-05-01T08:00:00.000Z'
  },
  {
    id: 'admin',
    name: 'Admin User',
    role: 'admin',
    attendanceModel: 'stationary',
    expectedLocation: 'Head Office',
    shift: 'Operations',
    locationConsentGivenAt: '2026-05-01T08:00:00.000Z'
  }
];
