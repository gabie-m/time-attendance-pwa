import type { AttendanceModel, Role } from '../domain/types';
import {
  seedLocationAssignments,
  seedManagerAssignments,
  seedStaffProfiles,
  seedUsers
} from '../mocks/mockStaffData';

export type UserRole = Role;
export type StaffType = AttendanceModel;
export type LocationAssignmentType = 'primary' | 'allowed' | 'temporary';

export interface ServiceResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffProfile {
  user_id: string;
  employee_code: string | null;
  staff_type: StaffType;
  default_attendance_model: StaffType;
  timezone: string;
  shift_label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManagerStaffAssignment {
  id: string;
  manager_id: string;
  staff_user_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserLocationAssignment {
  id: string;
  user_id: string;
  location_id: string;
  assignment_type: LocationAssignmentType;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffSetupView {
  user: User;
  staff_profile: StaffProfile | null;
  manager_assignment: ManagerStaffAssignment | null;
  location_assignments: UserLocationAssignment[];
}

export type UpdateUserInput = {
  user_id: string;
  name?: string;
  email?: string;
  role?: UserRole;
  active?: boolean;
};

export type UpdateStaffProfileInput = {
  user_id: string;
  employee_code?: string | null;
  staff_type?: StaffType;
  default_attendance_model?: StaffType;
  timezone?: string;
  shift_label?: string | null;
  active?: boolean;
};

export type CreateStaffSetupInput = {
  name: string;
  email: string;
  role: UserRole;
  employee_code: string;
  staff_type: StaffType;
  default_attendance_model: StaffType;
  timezone: string;
  shift_label: string;
};

export type AssignManagerInput = {
  manager_id: string;
  staff_user_id: string;
  effective_from: string;
  effective_to?: string | null;
};

export type AssignUserLocationInput = {
  user_id: string;
  location_id: string;
  assignment_type: LocationAssignmentType;
  effective_from: string;
  effective_to?: string | null;
};

export type DeactivateUserInput = {
  user_id: string;
};

export type ReactivateUserInput = {
  user_id: string;
};

const usersStorageKey = 'staff-service-users';
const staffProfilesStorageKey = 'staff-service-staff-profiles';
const managerAssignmentsStorageKey = 'staff-service-manager-assignments';
const locationAssignmentsStorageKey = 'staff-service-location-assignments';
const listeners = new Set<() => void>();

export function listUsers() {
  return readJson<User[]>(usersStorageKey, seedUsers);
}

export function listStaffProfiles() {
  return readJson<StaffProfile[]>(staffProfilesStorageKey, seedStaffProfiles);
}

export function listManagerStaffAssignments() {
  return readJson<ManagerStaffAssignment[]>(managerAssignmentsStorageKey, seedManagerAssignments);
}

export function listUserLocationAssignments() {
  return readJson<UserLocationAssignment[]>(locationAssignmentsStorageKey, seedLocationAssignments);
}

export function listStaffSetupRecords(): StaffSetupView[] {
  const users = listUsers();
  return users.map((user) => buildStaffSetupView(user));
}

export function getStaffSetupRecord(userId: string): StaffSetupView | null {
  const user = listUsers().find((item) => item.id === userId);
  return user ? buildStaffSetupView(user) : null;
}

export function createStaffSetup(input: CreateStaffSetupInput): ServiceResult<StaffSetupView> {
  const validationError = getCreateStaffSetupValidationError(input);
  if (validationError) {
    return failure(validationError);
  }

  const users = listUsers();
  const profiles = listStaffProfiles();
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const nextUser: User = {
    id: userId,
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    active: true,
    deactivated_at: null,
    created_at: now,
    updated_at: now
  };
  const nextProfile: StaffProfile = {
    user_id: userId,
    employee_code: input.employee_code.trim(),
    staff_type: input.staff_type,
    default_attendance_model: input.default_attendance_model,
    timezone: input.timezone.trim(),
    shift_label: input.shift_label.trim(),
    active: true,
    created_at: now,
    updated_at: now
  };

  writeUsers([nextUser, ...users]);
  writeStaffProfiles([nextProfile, ...profiles]);

  return success({
    user: nextUser,
    staff_profile: nextProfile,
    manager_assignment: null,
    location_assignments: []
  });
}

export function updateUser(input: UpdateUserInput): ServiceResult<User> {
  const users = listUsers();
  const existingUser = users.find((user) => user.id === input.user_id);
  if (!existingUser) {
    return failure('User not found.');
  }

  const now = new Date().toISOString();
  const nextUser: User = {
    ...existingUser,
    name: input.name ?? existingUser.name,
    email: input.email ?? existingUser.email,
    role: input.role ?? existingUser.role,
    active: input.active ?? existingUser.active,
    updated_at: now
  };

  writeUsers(users.map((user) => (user.id === input.user_id ? nextUser : user)));
  return success(nextUser);
}

export function updateStaffProfile(input: UpdateStaffProfileInput): ServiceResult<StaffProfile> {
  const users = listUsers();
  if (!users.some((user) => user.id === input.user_id)) {
    return failure('User not found.');
  }

  const profiles = listStaffProfiles();
  const existingProfile = profiles.find((profile) => profile.user_id === input.user_id);
  if (input.employee_code && isDuplicateEmployeeCode(input.employee_code, input.user_id, profiles)) {
    return failure('Employee ID already exists.');
  }

  const now = new Date().toISOString();
  const nextProfile: StaffProfile = {
    user_id: input.user_id,
    employee_code: input.employee_code !== undefined ? input.employee_code : existingProfile?.employee_code ?? null,
    staff_type: input.staff_type ?? existingProfile?.staff_type ?? 'stationary',
    default_attendance_model:
      input.default_attendance_model ?? existingProfile?.default_attendance_model ?? input.staff_type ?? 'stationary',
    timezone: input.timezone ?? existingProfile?.timezone ?? 'Asia/Manila',
    shift_label: input.shift_label !== undefined ? input.shift_label : existingProfile?.shift_label ?? null,
    active: input.active ?? existingProfile?.active ?? true,
    created_at: existingProfile?.created_at ?? now,
    updated_at: now
  };

  const nextProfiles = existingProfile
    ? profiles.map((profile) => (profile.user_id === input.user_id ? nextProfile : profile))
    : [nextProfile, ...profiles];

  writeStaffProfiles(nextProfiles);
  return success(nextProfile);
}

export function assignManager(input: AssignManagerInput): ServiceResult<ManagerStaffAssignment> {
  const users = listUsers();
  const manager = users.find((user) => user.id === input.manager_id);
  const staff = users.find((user) => user.id === input.staff_user_id);

  if (!manager) {
    return failure('Manager not found.');
  }

  if (manager.role !== 'manager') {
    return failure('Selected user must have manager role.');
  }

  if (!staff) {
    return failure('Staff user not found.');
  }

  const now = new Date().toISOString();
  const assignments = listManagerStaffAssignments();
  const closedAssignments = assignments.map((assignment) => {
    if (assignment.staff_user_id !== input.staff_user_id || assignment.effective_to !== null) {
      return assignment;
    }

    return {
      ...assignment,
      effective_to: input.effective_from,
      updated_at: now
    };
  });

  if (
    closedAssignments.some((assignment) => {
      return assignment.staff_user_id === input.staff_user_id && assignmentsOverlap(
        {
          effective_from: input.effective_from,
          effective_to: input.effective_to ?? null
        },
        assignment
      );
    })
  ) {
    return failure('Manager assignment overlaps an existing active assignment.');
  }

  const nextAssignment: ManagerStaffAssignment = {
    id: crypto.randomUUID(),
    manager_id: input.manager_id,
    staff_user_id: input.staff_user_id,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    created_at: now,
    updated_at: now
  };

  writeManagerAssignments([nextAssignment, ...closedAssignments]);
  return success(nextAssignment);
}

export function assignUserLocation(input: AssignUserLocationInput): ServiceResult<UserLocationAssignment> {
  if (!listUsers().some((user) => user.id === input.user_id)) {
    return failure('User not found.');
  }

  const now = new Date().toISOString();
  const assignments = listUserLocationAssignments();
  const closedAssignments =
    input.assignment_type === 'primary'
      ? assignments.map((assignment) => {
          if (
            assignment.user_id !== input.user_id ||
            assignment.assignment_type !== 'primary' ||
            assignment.effective_to !== null
          ) {
            return assignment;
          }

          return {
            ...assignment,
            effective_to: input.effective_from,
            updated_at: now
          };
        })
      : assignments;
  const nextAssignment: UserLocationAssignment = {
    id: crypto.randomUUID(),
    user_id: input.user_id,
    location_id: input.location_id,
    assignment_type: input.assignment_type,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    created_at: now,
    updated_at: now
  };

  writeLocationAssignments([nextAssignment, ...closedAssignments]);
  return success(nextAssignment);
}

export function deactivateUser(input: DeactivateUserInput): ServiceResult<User> {
  const users = listUsers();
  const existingUser = users.find((user) => user.id === input.user_id);
  if (!existingUser) {
    return failure('User not found.');
  }

  const now = new Date().toISOString();
  const nextUser: User = {
    ...existingUser,
    active: false,
    deactivated_at: now,
    updated_at: now
  };

  writeUsers(users.map((user) => (user.id === input.user_id ? nextUser : user)));
  return success(nextUser);
}

export function reactivateUser(input: ReactivateUserInput): ServiceResult<User> {
  const users = listUsers();
  const existingUser = users.find((user) => user.id === input.user_id);
  if (!existingUser) {
    return failure('User not found.');
  }

  const now = new Date().toISOString();
  const nextUser: User = {
    ...existingUser,
    active: true,
    deactivated_at: null,
    updated_at: now
  };

  writeUsers(users.map((user) => (user.id === input.user_id ? nextUser : user)));
  return success(nextUser);
}

function getCreateStaffSetupValidationError(input: CreateStaffSetupInput) {
  if (!input.name.trim()) {
    return 'Full name is required.';
  }

  if (!input.email.trim()) {
    return 'Email is required.';
  }

  if (!input.employee_code.trim()) {
    return 'Employee ID is required.';
  }

  if (!input.timezone.trim()) {
    return 'Timezone is required.';
  }

  if (!input.shift_label.trim()) {
    return 'Shift label is required.';
  }

  if (isDuplicateEmployeeCode(input.employee_code)) {
    return 'Employee ID already exists.';
  }

  return null;
}

function isDuplicateEmployeeCode(employeeCode: string, currentUserId?: string, profiles = listStaffProfiles()) {
  const normalizedCode = employeeCode.trim().toLowerCase();
  return profiles.some((profile) => {
    return profile.user_id !== currentUserId && profile.employee_code?.trim().toLowerCase() === normalizedCode;
  });
}

function assignmentsOverlap(
  nextAssignment: Pick<ManagerStaffAssignment, 'effective_from' | 'effective_to'>,
  existingAssignment: Pick<ManagerStaffAssignment, 'effective_from' | 'effective_to'>
) {
  return (
    dateToComparableValue(nextAssignment.effective_from) < dateToComparableValue(existingAssignment.effective_to) &&
    dateToComparableValue(existingAssignment.effective_from) < dateToComparableValue(nextAssignment.effective_to)
  );
}

function dateToComparableValue(dateValue: string | null) {
  return dateValue ? new Date(`${dateValue}T00:00:00.000+08:00`).getTime() : Number.POSITIVE_INFINITY;
}

function buildStaffSetupView(user: User): StaffSetupView {
  const staffProfile = listStaffProfiles().find((profile) => profile.user_id === user.id) ?? null;
  const managerAssignment =
    listManagerStaffAssignments().find((assignment) => {
      return assignment.staff_user_id === user.id && assignment.effective_to === null;
    }) ?? null;
  const locationAssignments = listUserLocationAssignments().filter((assignment) => {
    return assignment.user_id === user.id && assignment.effective_to === null;
  });

  return {
    user,
    staff_profile: staffProfile,
    manager_assignment: managerAssignment,
    location_assignments: locationAssignments
  };
}

export function subscribeStaffService(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function writeUsers(users: User[]) {
  window.localStorage.setItem(usersStorageKey, JSON.stringify(users));
  emitChange();
}

function writeStaffProfiles(profiles: StaffProfile[]) {
  window.localStorage.setItem(staffProfilesStorageKey, JSON.stringify(profiles));
  emitChange();
}

function writeManagerAssignments(assignments: ManagerStaffAssignment[]) {
  window.localStorage.setItem(managerAssignmentsStorageKey, JSON.stringify(assignments));
  emitChange();
}

function writeLocationAssignments(assignments: UserLocationAssignment[]) {
  window.localStorage.setItem(locationAssignmentsStorageKey, JSON.stringify(assignments));
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

function success<T>(data: T): ServiceResult<T> {
  return {
    success: true,
    data,
    error: null
  };
}

function failure<T>(error: string): ServiceResult<T> {
  return {
    success: false,
    data: null,
    error
  };
}
