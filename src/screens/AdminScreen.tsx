import { useMemo, useState } from 'react';
import { GooglePlaceSearch } from '../components/GooglePlaceSearch';
import { MetricCard } from '../components/MetricCard';
import { Pill } from '../components/Pill';
import { useStaffSetupRecords } from '../hooks/useStaffSetupRecords';
import { useFlagReviewWorkflowSettings } from '../hooks/useFlagReviewWorkflowSettings';
import { flagReviewWorkflowOptions, type FlagReviewWorkflowMode } from '../mocks/mockFlagReviewData';
import { updateFlagReviewWorkflowSetting } from '../services/mockFlagReviewSettingsService';
import {
  saveLocation,
  toggleLocationActive,
  useMockLocations,
  type LocationFormInput
} from '../services/mockLocationService';
import {
  assignManager,
  assignUserLocation,
  createStaffSetup,
  deactivateUser,
  reactivateUser,
  updateStaffProfile,
  updateUser,
  type LocationAssignmentType,
  type StaffSetupView,
  type StaffType,
  type UserRole
} from '../services/mockStaffService';
import type { Location } from '../domain/types';

const emptyLocationForm: LocationFormInput = {
  name: '',
  address: '',
  latitude: 14.5995,
  longitude: 120.9842,
  radiusMeters: 150,
  active: true
};

type StaffFormState = {
  name: string;
  email: string;
  role: UserRole;
  employee_code: string;
  staff_type: StaffType;
  default_attendance_model: StaffType;
  timezone: string;
  shift_label: string;
  profile_active: boolean;
};

type AddUserFormState = {
  name: string;
  email: string;
  role: UserRole;
  employee_code: string;
  staff_type: StaffType;
  default_attendance_model: StaffType;
  timezone: string;
  shift_label: string;
};

const emptyAddUserForm: AddUserFormState = {
  name: '',
  email: '',
  role: 'user',
  employee_code: '',
  staff_type: 'stationary',
  default_attendance_model: 'stationary',
  timezone: 'Asia/Manila',
  shift_label: ''
};

const today = new Date().toISOString().slice(0, 10);

export function AdminScreen() {
  const locations = useMockLocations();
  const staffRecords = useStaffSetupRecords();
  const flagReviewWorkflowSettings = useFlagReviewWorkflowSettings();
  const activeLocations = locations.filter((location) => location.active);
  const activeUsers = staffRecords.filter((record) => record.user.active);
  const managers = staffRecords.filter((record) => record.user.role === 'manager' && record.user.active);
  const [form, setForm] = useState<LocationFormInput>(emptyLocationForm);
  const [message, setMessage] = useState('');
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const selectedRecord = staffRecords.find((record) => record.user.id === selectedUserId) ?? null;
  const [staffForm, setStaffForm] = useState<StaffFormState>(() => getStaffFormState(selectedRecord));
  const [staffMessage, setStaffMessage] = useState('');
  const [addUserForm, setAddUserForm] = useState<AddUserFormState>(emptyAddUserForm);
  const [addUserMessage, setAddUserMessage] = useState('');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [managerId, setManagerId] = useState(selectedRecord?.manager_assignment?.manager_id ?? '');
  const [locationAssignment, setLocationAssignment] = useState({
    location_id: activeLocations[0]?.id ?? '',
    assignment_type: 'allowed' as LocationAssignmentType,
    effective_from: today
  });
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const userById = useMemo(
    () => new Map(staffRecords.map((record) => [record.user.id, record.user])),
    [staffRecords]
  );

  function handleEdit(location: Location) {
    setForm(location);
    setMessage('');
    setIsLocationModalOpen(true);
  }

  function handleSubmit() {
    const result = saveLocation(form);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setForm(emptyLocationForm);
    setMessage(form.id ? 'Location updated.' : 'Location added.');
    setIsLocationModalOpen(false);
  }

  function handleOpenAddLocation() {
    setForm(emptyLocationForm);
    setMessage('');
    setIsLocationModalOpen(true);
  }

  function handleCancelLocation() {
    setForm(emptyLocationForm);
    setMessage('');
    setIsLocationModalOpen(false);
  }

  function handleSelectStaff(record: StaffSetupView) {
    setSelectedUserId(record.user.id);
    setStaffForm(getStaffFormState(record));
    setManagerId(record.manager_assignment?.manager_id ?? '');
    setStaffMessage('');
    setIsEditUserModalOpen(true);
  }

  function handleSaveStaff() {
    if (!selectedRecord) {
      return;
    }

    const userResult = updateUser({
      user_id: selectedRecord.user.id,
      name: staffForm.name,
      email: staffForm.email,
      role: staffForm.role
    });

    if (!userResult.success) {
      setStaffMessage(userResult.error ?? 'User could not be updated.');
      return;
    }

    const profileResult = updateStaffProfile({
      user_id: selectedRecord.user.id,
      employee_code: staffForm.employee_code.trim() || null,
      staff_type: staffForm.staff_type,
      default_attendance_model: staffForm.default_attendance_model,
      timezone: staffForm.timezone,
      shift_label: staffForm.shift_label.trim() || null,
      active: staffForm.profile_active
    });

    if (!profileResult.success) {
      setStaffMessage(profileResult.error ?? 'Profile could not be updated.');
      return;
    }

    setStaffMessage('');
    setIsEditUserModalOpen(false);
  }

  function handleAddUser() {
    const result = createStaffSetup(addUserForm);
    if (!result.success || !result.data) {
      setAddUserMessage(result.error ?? 'User could not be added.');
      return;
    }

    setAddUserForm(emptyAddUserForm);
    setAddUserMessage('');
    setIsAddUserModalOpen(false);
    setSelectedUserId(result.data.user.id);
    setStaffForm(getStaffFormState(result.data));
    setManagerId(result.data.manager_assignment?.manager_id ?? '');
    setStaffMessage('User added. Assign their manager and locations next.');
  }

  function handleOpenAddUser() {
    setAddUserForm(emptyAddUserForm);
    setAddUserMessage('');
    setIsAddUserModalOpen(true);
  }

  function handleCancelAddUser() {
    setAddUserForm(emptyAddUserForm);
    setAddUserMessage('');
    setIsAddUserModalOpen(false);
  }

  function handleCancelEditUser() {
    setStaffMessage('');
    setIsEditUserModalOpen(false);
  }

  function handleUserActivation() {
    if (!selectedRecord) {
      return;
    }

    const result = selectedRecord.user.active
      ? deactivateUser({ user_id: selectedRecord.user.id })
      : reactivateUser({ user_id: selectedRecord.user.id });

    setStaffMessage(result.success ? (result.data?.active ? 'User reactivated.' : 'User deactivated.') : result.error ?? 'User status could not be changed.');
  }

  function handleAssignManager() {
    if (!selectedRecord || !managerId) {
      setStaffMessage('Select a manager before assigning.');
      return;
    }

    const result = assignManager({
      manager_id: managerId,
      staff_user_id: selectedRecord.user.id,
      effective_from: today
    });

    setStaffMessage(result.success ? 'Manager assignment updated.' : result.error ?? 'Manager assignment failed.');
  }

  function handleAssignLocation() {
    const selectedLocationId = locationAssignment.location_id || activeLocations[0]?.id;

    if (!selectedRecord || !selectedLocationId) {
      setStaffMessage('Select a location before assigning.');
      return;
    }

    const result = assignUserLocation({
      user_id: selectedRecord.user.id,
      location_id: selectedLocationId,
      assignment_type: locationAssignment.assignment_type,
      effective_from: locationAssignment.effective_from
    });

    setStaffMessage(result.success ? 'Location assignment added.' : result.error ?? 'Location assignment failed.');
  }

  return (
    <section className="screen desktop-grid">
      <header className="screen-header desktop-span">
        <div>
          <span className="eyebrow">Admin Controls</span>
          <h1>System Setup</h1>
          <p>Foundation screen for users, locations, schedules, and attendance rules.</p>
        </div>
        <Pill tone="info">Phase 1 shell</Pill>
      </header>

      <div className="metric-grid desktop-span">
        <MetricCard label="Users" value={String(activeUsers.length)} detail="Active people" />
        <MetricCard label="Managers" value={String(managers.length)} detail="Reporting owners" tone="success" />
        <MetricCard label="Locations" value={String(locations.length)} detail="Approved sites" tone="warn" />
        <MetricCard label="Active Sites" value={String(activeLocations.length)} detail="Available for attendance" tone="flag" />
      </div>

      <article className="panel wide-panel desktop-span">
        <div className="panel-title">
          <h2>Users & Assignments</h2>
          <Pill tone="info">Mock service layer</Pill>
        </div>
        <p className="queue-disclaimer">
          Staff setup uses separate user, staff profile, manager assignment, and location assignment records.
        </p>
        <div className="user-list-header">
          <div>
            <span className="eyebrow">User Directory</span>
            <h3>Staff records</h3>
          </div>
          <button onClick={handleOpenAddUser}>Add user</button>
        </div>
        <div className="staff-setup-layout">
          <div className="table-list">
            {staffRecords.map((record) => (
              <div
                className="staff-row"
                key={record.user.id}
              >
                <span>
                  <strong>{record.user.name}</strong>
                  <small>{record.user.email}</small>
                </span>
                <Pill tone={record.user.active ? 'success' : 'danger'}>
                  {record.user.active ? 'Active' : 'Deactivated'}
                </Pill>
                <Pill tone="neutral">{record.user.role}</Pill>
                <span>{record.staff_profile?.default_attendance_model ?? 'No profile'}</span>
                <div className="staff-row-actions">
                  <button className="secondary" onClick={() => handleSelectStaff(record)}>Edit</button>
                </div>
              </div>
            ))}
            <div className="user-list-footer">
              <button onClick={handleOpenAddUser}>Add user</button>
            </div>
          </div>
        </div>
      </article>

      {isAddUserModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
            <div className="panel-title">
              <div>
                <h2 id="add-user-title">Add User</h2>
                <p>Create a new user and staff profile. Assign manager and locations after creation.</p>
              </div>
              <Pill tone="flag">All fields required</Pill>
            </div>
            <div className="manual-edit-form compact-form">
              <label>
                Full name
                <input
                  required
                  value={addUserForm.name}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={addUserForm.email}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label>
                Role
                <select
                  required
                  value={addUserForm.role}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, role: event.target.value as UserRole }))}
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                Employee ID
                <input
                  required
                  value={addUserForm.employee_code}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, employee_code: event.target.value }))}
                />
              </label>
              <label>
                Staff type
                <select
                  required
                  value={addUserForm.staff_type}
                  onChange={(event) => {
                    const nextType = event.target.value as StaffType;
                    setAddUserForm((current) => ({
                      ...current,
                      staff_type: nextType,
                      default_attendance_model: nextType
                    }));
                  }}
                >
                  <option value="stationary">Stationary</option>
                  <option value="roving">Roving</option>
                </select>
              </label>
              <label>
                Default attendance model
                <select
                  required
                  value={addUserForm.default_attendance_model}
                  onChange={(event) =>
                    setAddUserForm((current) => ({
                      ...current,
                      default_attendance_model: event.target.value as StaffType
                    }))
                  }
                >
                  <option value="stationary">Stationary</option>
                  <option value="roving">Roving</option>
                </select>
              </label>
              <label>
                Timezone
                <input
                  required
                  value={addUserForm.timezone}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, timezone: event.target.value }))}
                />
              </label>
              <label>
                Shift label
                <input
                  required
                  value={addUserForm.shift_label}
                  onChange={(event) => setAddUserForm((current) => ({ ...current, shift_label: event.target.value }))}
                />
              </label>
            </div>
            {addUserMessage ? <p className="form-message">{addUserMessage}</p> : null}
            <div className="modal-actions">
              <button className="secondary" onClick={handleCancelAddUser}>Cancel</button>
              <button onClick={handleAddUser}>Confirm add user</button>
            </div>
          </section>
        </div>
      ) : null}

      {isEditUserModalOpen && selectedRecord ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
            <div className="selected-staff-header">
              <div>
                <span className="eyebrow">User Setup</span>
                <h2 id="edit-user-title">{selectedRecord.user.name}</h2>
                <p>Edit user details, manager assignment, and location assignments.</p>
              </div>
              <Pill tone={selectedRecord.user.active ? 'success' : 'danger'}>
                {selectedRecord.user.active ? 'Active' : 'Deactivated'}
              </Pill>
            </div>
            <div className="manual-edit-form compact-form">
              <label>
                Full name
                <input
                  value={staffForm.name}
                  onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  value={staffForm.email}
                  onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label>
                Role
                <select
                  value={staffForm.role}
                  onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as UserRole }))}
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                Employee code
                <input
                  value={staffForm.employee_code}
                  onChange={(event) => setStaffForm((current) => ({ ...current, employee_code: event.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                Staff type
                <select
                  value={staffForm.staff_type}
                  onChange={(event) => {
                    const nextType = event.target.value as StaffType;
                    setStaffForm((current) => ({
                      ...current,
                      staff_type: nextType,
                      default_attendance_model: nextType
                    }));
                  }}
                >
                  <option value="stationary">Stationary</option>
                  <option value="roving">Roving</option>
                </select>
              </label>
              <label>
                Default attendance model
                <select
                  value={staffForm.default_attendance_model}
                  onChange={(event) =>
                    setStaffForm((current) => ({
                      ...current,
                      default_attendance_model: event.target.value as StaffType
                    }))
                  }
                >
                  <option value="stationary">Stationary</option>
                  <option value="roving">Roving</option>
                </select>
              </label>
              <label>
                Shift label
                <input
                  value={staffForm.shift_label}
                  onChange={(event) => setStaffForm((current) => ({ ...current, shift_label: event.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                Timezone
                <input
                  value={staffForm.timezone}
                  onChange={(event) => setStaffForm((current) => ({ ...current, timezone: event.target.value }))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={staffForm.profile_active}
                  onChange={(event) => setStaffForm((current) => ({ ...current, profile_active: event.target.checked }))}
                />
                Active staff profile
              </label>
            </div>

            <div className="assignment-grid">
              <div className="assignment-box">
                <h3>Manager</h3>
                <p>
                  Current:{' '}
                  <strong>
                    {selectedRecord.manager_assignment
                      ? userById.get(selectedRecord.manager_assignment.manager_id)?.name ?? 'Unknown manager'
                      : 'None assigned'}
                  </strong>
                </p>
                <div className="inline-field">
                  <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
                    <option value="">Select manager</option>
                    {managers.map((manager) => (
                      <option key={manager.user.id} value={manager.user.id}>
                        {manager.user.name}
                      </option>
                    ))}
                  </select>
                  <button className="secondary" onClick={handleAssignManager}>Assign</button>
                </div>
              </div>

              <div className="assignment-box">
                <h3>Locations</h3>
                <div className="assignment-list">
                  {selectedRecord.location_assignments.length > 0 ? (
                    selectedRecord.location_assignments.map((assignment) => (
                      <span key={assignment.id}>
                        <Pill tone={assignment.assignment_type === 'primary' ? 'success' : 'neutral'}>
                          {assignment.assignment_type}
                        </Pill>
                        {locationById.get(assignment.location_id)?.name ?? 'Unknown location'}
                      </span>
                    ))
                  ) : (
                    <span>No active location assignments</span>
                  )}
                </div>
                <div className="inline-field location-assignment-controls">
                  <select
                    value={locationAssignment.location_id}
                    onChange={(event) =>
                      setLocationAssignment((current) => ({ ...current, location_id: event.target.value }))
                    }
                  >
                    <option value="">Select location</option>
                    {activeLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={locationAssignment.assignment_type}
                    onChange={(event) =>
                      setLocationAssignment((current) => ({
                        ...current,
                        assignment_type: event.target.value as LocationAssignmentType
                      }))
                    }
                  >
                    <option value="primary">Primary</option>
                    <option value="allowed">Allowed</option>
                    <option value="temporary">Temporary</option>
                  </select>
                  <button className="secondary" onClick={handleAssignLocation}>Add</button>
                </div>
              </div>
            </div>

            {staffMessage ? <p className="form-message">{staffMessage}</p> : null}
            <div className="modal-actions">
              <button className="secondary" onClick={handleCancelEditUser}>Cancel</button>
              <button className="secondary" onClick={handleUserActivation}>
                {selectedRecord.user.active ? 'Deactivate user' : 'Reactivate user'}
              </button>
              <button onClick={handleSaveStaff}>Save changes</button>
            </div>
          </section>
        </div>
      ) : null}

      <article className="panel wide-panel desktop-span">
        <div className="panel-title">
          <h2>Attendance Rule Settings</h2>
          <Pill tone="info">Flag workflow</Pill>
        </div>
        <p className="queue-disclaimer">
          Configure the review route for each flag type. Flag Review uses these settings automatically.
        </p>
        <div className="flag-workflow-setting-list admin-rule-setting-list">
          {flagReviewWorkflowSettings.map((setting) => (
            <label key={setting.flagType}>
              {formatFlagType(setting.flagType)}
              <select
                value={setting.workflowMode}
                onChange={(event) =>
                  updateFlagReviewWorkflowSetting({
                    flagType: setting.flagType,
                    workflowMode: event.target.value as FlagReviewWorkflowMode
                  })
                }
              >
                {flagReviewWorkflowOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>{getWorkflowDescription(setting.workflowMode)}</small>
            </label>
          ))}
        </div>
      </article>

      <article className="panel wide-panel desktop-span">
        <div className="panel-title">
          <h2>Locations Management</h2>
          <Pill tone="success">Attendance always accepted</Pill>
        </div>
        <p className="queue-disclaimer">Locations define the GPS radius used by stationary and roving attendance validation.</p>
        <div className="user-list-header">
          <div>
            <span className="eyebrow">Location Directory</span>
            <h3>Approved sites</h3>
          </div>
          <button onClick={handleOpenAddLocation}>Add location</button>
        </div>
        <div className="table-list">
          {locations.map((location) => (
            <div className="table-row location-table-row" key={location.id}>
              <strong>{location.name}</strong>
              <span>{location.address}</span>
              <span>{location.radiusMeters}m radius</span>
              <Pill tone={location.active ? 'success' : 'neutral'}>{location.active ? 'Active' : 'Inactive'}</Pill>
              <div className="inline-actions">
                <button className="secondary" onClick={() => handleEdit(location)}>Edit</button>
                <button className="secondary" onClick={() => toggleLocationActive(location.id)}>
                  {location.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
          <div className="user-list-footer">
            <button onClick={handleOpenAddLocation}>Add location</button>
          </div>
        </div>
      </article>

      {isLocationModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="location-form-title">
            <div className="panel-title">
              <div>
                <h2 id="location-form-title">{form.id ? 'Edit Location' : 'Add Location'}</h2>
                <p>Set the approved site, GPS coordinates, and attendance radius.</p>
              </div>
              <Pill tone="flag">Admin setup</Pill>
            </div>
            <div className="manual-edit-form compact-form">
              <div className="compact-form-span">
                <GooglePlaceSearch
                  onPlaceSelected={(values) =>
                    setForm((current) => ({
                      ...current,
                      ...values
                    }))
                  }
                />
              </div>
              <label>
                Location name
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g., SM Megamall"
                />
              </label>
              <label>
                Address
                <input
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder="City / branch address"
                />
              </label>
              <label>
                Latitude
                <input
                  type="number"
                  step="0.000001"
                  value={form.latitude}
                  onChange={(event) => setForm((current) => ({ ...current, latitude: Number(event.target.value) }))}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="0.000001"
                  value={form.longitude}
                  onChange={(event) => setForm((current) => ({ ...current, longitude: Number(event.target.value) }))}
                />
              </label>
              <label>
                Allowed radius, meters
                <input
                  type="number"
                  min="1"
                  value={form.radiusMeters}
                  onChange={(event) => setForm((current) => ({ ...current, radiusMeters: Number(event.target.value) }))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                />
                Active location
              </label>
            </div>
            {message ? <p className="form-message">{message}</p> : null}
            <div className="modal-actions">
              <button className="secondary" onClick={handleCancelLocation}>Cancel</button>
              <button onClick={handleSubmit}>{form.id ? 'Save changes' : 'Confirm add location'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function getStaffFormState(record: StaffSetupView | null): StaffFormState {
  return {
    name: record?.user.name ?? '',
    email: record?.user.email ?? '',
    role: record?.user.role ?? 'user',
    employee_code: record?.staff_profile?.employee_code ?? '',
    staff_type: record?.staff_profile?.staff_type ?? 'stationary',
    default_attendance_model: record?.staff_profile?.default_attendance_model ?? 'stationary',
    timezone: record?.staff_profile?.timezone ?? 'Asia/Manila',
    shift_label: record?.staff_profile?.shift_label ?? '',
    profile_active: record?.staff_profile?.active ?? true
  };
}

function formatFlagType(flagType: string) {
  return flagType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getWorkflowDescription(workflowMode: FlagReviewWorkflowMode) {
  return flagReviewWorkflowOptions.find((option) => option.id === workflowMode)?.description ?? '';
}
