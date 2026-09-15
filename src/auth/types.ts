import type { AttendanceModel, Role } from '../domain/types';

export type MockUser = {
  id: string;
  name: string;
  role: Role;
  attendanceModel: AttendanceModel | null;
  expectedLocation: string;
  shift: string;
  locationConsentGivenAt: string | null;
};
