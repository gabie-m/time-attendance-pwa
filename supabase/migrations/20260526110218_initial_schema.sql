CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('user', 'manager', 'admin');
CREATE TYPE staff_type AS ENUM ('stationary', 'roving');
CREATE TYPE attendance_model AS ENUM ('stationary', 'roving');
CREATE TYPE attendance_purpose AS ENUM ('payroll', 'monitoring');
CREATE TYPE location_access AS ENUM ('restricted', 'open');
CREATE TYPE day_mode AS ENUM ('office', 'field', 'off');
CREATE TYPE schedule_type AS ENUM ('fixed', 'weekly_pattern', 'flexible');
CREATE TYPE schedule_change_request_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);
CREATE TYPE location_assignment_type AS ENUM ('primary', 'allowed', 'temporary');
CREATE TYPE session_type AS ENUM ('stationary_day', 'field_visit');
CREATE TYPE session_status AS ENUM ('open', 'closed', 'needs_review');
CREATE TYPE attendance_rule_value_type AS ENUM (
  'integer',
  'decimal',
  'text',
  'boolean',
  'json'
);
CREATE TYPE flag_type AS ENUM (
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
);
CREATE TYPE manager_delegation_capability AS ENUM (
  'view_attendance',
  'review_flags',
  'approve_correction_requests',
  'manage_schedules',
  'manage_staff_assignments'
);

COMMENT ON TYPE flag_type IS
  'Attendance flags never block capture or deny access. They mark records that need verification; review outcomes determine reporting validity without mutating immutable attendance events. Schedule mismatch is not a flag_type and is derived for reporting from session snapshots and attendance event timestamps.';

CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  name text NOT NULL,
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  location_consent_given_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role
  FROM users
  WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own user record"
ON users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Admins can select all user records"
ON users
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert user records"
ON users
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update user records"
ON users
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip_address inet,
  user_agent text,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX audit_logs_actor_user_id_idx
ON audit_logs (actor_user_id);

CREATE INDEX audit_logs_entity_idx
ON audit_logs (entity_type, entity_id);

CREATE INDEX audit_logs_created_at_idx
ON audit_logs (created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select all audit logs"
ON audit_logs
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE TABLE staff_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_staff_type staff_type NOT NULL,
  default_attendance_purpose attendance_purpose NOT NULL DEFAULT 'payroll',
  default_location_access location_access NOT NULL DEFAULT 'restricted',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_categories_name_unique UNIQUE (name)
);

ALTER TABLE staff_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select active staff categories"
ON staff_categories
FOR SELECT
TO authenticated
USING (active = true);

CREATE POLICY "Admins can select all staff categories"
ON staff_categories
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert staff categories"
ON staff_categories
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update staff categories"
ON staff_categories
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

INSERT INTO staff_categories (
  name,
  default_staff_type,
  default_attendance_purpose,
  default_location_access
)
VALUES
  ('Merchandiser', 'stationary', 'payroll', 'restricted'),
  ('Account Officer', 'roving', 'monitoring', 'restricted'),
  ('Coordinator', 'roving', 'monitoring', 'restricted'),
  ('Liaison Staff', 'roving', 'monitoring', 'restricted'),
  ('Inventory Staff', 'stationary', 'monitoring', 'restricted');

CREATE TABLE staff_profiles (
  user_id uuid PRIMARY KEY,
  staff_category_id uuid,
  staff_type staff_type NOT NULL,
  default_attendance_model attendance_model NOT NULL,
  attendance_purpose attendance_purpose NOT NULL DEFAULT 'payroll',
  location_access location_access NOT NULL DEFAULT 'restricted',
  employee_code text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  shift_label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),

  CONSTRAINT staff_profiles_staff_category_id_fkey
    FOREIGN KEY (staff_category_id) REFERENCES staff_categories(id)
    ON UPDATE CASCADE,

  CONSTRAINT staff_profiles_employee_code_unique UNIQUE (employee_code)
);

CREATE INDEX staff_profiles_staff_category_id_idx
ON staff_profiles (staff_category_id);

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own staff profile"
ON staff_profiles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can select all staff profiles"
ON staff_profiles
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert staff profiles"
ON staff_profiles
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update staff profiles"
ON staff_profiles
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE TABLE manager_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manager_staff_assignments_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES users(id),

  CONSTRAINT manager_staff_assignments_staff_user_id_fkey
    FOREIGN KEY (staff_user_id) REFERENCES users(id),

  CONSTRAINT manager_staff_assignments_distinct_users CHECK (manager_id <> staff_user_id),

  CONSTRAINT manager_staff_assignments_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

-- manager_id role validation must be enforced at the application layer because
-- PostgreSQL CHECK constraints cannot reference the users table role safely.
-- Overlapping active manager assignments for the same staff member are a known
-- MVP gap to validate in the assignManager service function.

CREATE INDEX manager_staff_assignments_manager_id_idx
ON manager_staff_assignments (manager_id);

CREATE INDEX manager_staff_assignments_staff_user_id_idx
ON manager_staff_assignments (staff_user_id);

ALTER TABLE manager_staff_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own manager assignments"
ON manager_staff_assignments
FOR SELECT
TO authenticated
USING (staff_user_id = auth.uid());

CREATE POLICY "Managers can select own staff assignments"
ON manager_staff_assignments
FOR SELECT
TO authenticated
USING (
  manager_id = auth.uid()
  AND current_user_role() = 'manager'
);

CREATE POLICY "Admins can select all manager staff assignments"
ON manager_staff_assignments
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert manager staff assignments"
ON manager_staff_assignments
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update manager staff assignments"
ON manager_staff_assignments
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE TABLE manager_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_manager_id uuid NOT NULL,
  covering_manager_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date NOT NULL,
  revoked_at timestamptz,
  revoked_by_admin_id uuid,
  reason text NOT NULL,
  created_by_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manager_delegations_original_manager_id_fkey
    FOREIGN KEY (original_manager_id) REFERENCES users(id),

  CONSTRAINT manager_delegations_covering_manager_id_fkey
    FOREIGN KEY (covering_manager_id) REFERENCES users(id),

  CONSTRAINT manager_delegations_revoked_by_admin_id_fkey
    FOREIGN KEY (revoked_by_admin_id) REFERENCES users(id),

  CONSTRAINT manager_delegations_created_by_admin_id_fkey
    FOREIGN KEY (created_by_admin_id) REFERENCES users(id),

  CONSTRAINT manager_delegations_distinct_managers CHECK (original_manager_id <> covering_manager_id),
  CONSTRAINT manager_delegations_effective_range_valid CHECK (effective_to >= effective_from),
  CONSTRAINT manager_delegations_revocation_admin_required CHECK (
    (revoked_at IS NULL AND revoked_by_admin_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_admin_id IS NOT NULL)
  )
);

CREATE INDEX manager_delegations_original_manager_id_idx
ON manager_delegations (original_manager_id);

CREATE INDEX manager_delegations_covering_manager_id_idx
ON manager_delegations (covering_manager_id);

CREATE INDEX manager_delegations_active_window_idx
ON manager_delegations (effective_from, effective_to)
WHERE revoked_at IS NULL;

CREATE TABLE manager_delegation_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_delegation_id uuid NOT NULL,
  capability manager_delegation_capability NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manager_delegation_capabilities_delegation_id_fkey
    FOREIGN KEY (manager_delegation_id) REFERENCES manager_delegations(id),

  CONSTRAINT manager_delegation_capabilities_unique UNIQUE (manager_delegation_id, capability)
);

CREATE INDEX manager_delegation_capabilities_delegation_id_idx
ON manager_delegation_capabilities (manager_delegation_id);

CREATE INDEX manager_delegation_capabilities_capability_idx
ON manager_delegation_capabilities (capability);

CREATE OR REPLACE FUNCTION validate_manager_delegation_roles()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND NEW.created_by_admin_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'Manager delegation creator must match the current admin.';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.created_by_admin_id IS DISTINCT FROM OLD.created_by_admin_id
  THEN
    RAISE EXCEPTION 'Manager delegation creator cannot be changed.';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.revoked_at IS NOT NULL
    AND (
      NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_by_admin_id IS DISTINCT FROM OLD.revoked_by_admin_id
    )
  THEN
    RAISE EXCEPTION 'Manager delegation revocation audit fields cannot be changed once set.';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.revoked_at IS NULL
    AND NEW.revoked_at IS NOT NULL
    AND NEW.revoked_by_admin_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'Manager delegation revoker must match the current admin.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = NEW.original_manager_id
      AND users.role = 'manager'
  ) THEN
    RAISE EXCEPTION 'Original manager must have manager role.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = NEW.covering_manager_id
      AND users.role = 'manager'
  ) THEN
    RAISE EXCEPTION 'Covering manager must have manager role.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = NEW.created_by_admin_id
      AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Manager delegation creator must have admin role.';
  END IF;

  IF NEW.revoked_by_admin_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.revoked_by_admin_id
        AND users.role = 'admin'
    )
  THEN
    RAISE EXCEPTION 'Manager delegation revoker must have admin role.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER manager_delegations_validate_roles
BEFORE INSERT OR UPDATE ON manager_delegations
FOR EACH ROW
EXECUTE FUNCTION validate_manager_delegation_roles();

ALTER TABLE manager_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_delegation_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select all manager delegations"
ON manager_delegations
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Managers can select own manager delegations"
ON manager_delegations
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    original_manager_id = auth.uid()
    OR covering_manager_id = auth.uid()
  )
);

CREATE POLICY "Admins can insert manager delegations"
ON manager_delegations
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update manager delegations"
ON manager_delegations
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can select all manager delegation capabilities"
ON manager_delegation_capabilities
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Managers can select own manager delegation capabilities"
ON manager_delegation_capabilities
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
    SELECT 1
    FROM manager_delegations
    WHERE manager_delegations.id = manager_delegation_capabilities.manager_delegation_id
      AND (
        manager_delegations.original_manager_id = auth.uid()
        OR manager_delegations.covering_manager_id = auth.uid()
      )
  )
);

CREATE POLICY "Admins can insert manager delegation capabilities"
ON manager_delegation_capabilities
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update manager delegation capabilities"
ON manager_delegation_capabilities
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION has_active_manager_delegation_for_staff(
  staff_user_id uuid,
  required_capability manager_delegation_capability
)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM manager_delegations
    JOIN manager_delegation_capabilities
      ON manager_delegation_capabilities.manager_delegation_id = manager_delegations.id
    JOIN manager_staff_assignments
      ON manager_staff_assignments.manager_id = manager_delegations.original_manager_id
    WHERE manager_delegations.covering_manager_id = auth.uid()
      AND manager_delegation_capabilities.capability = required_capability
      AND manager_delegations.revoked_at IS NULL
      AND manager_delegations.effective_from <= CURRENT_DATE
      AND manager_delegations.effective_to >= CURRENT_DATE
      AND manager_staff_assignments.staff_user_id = staff_user_id
      AND manager_staff_assignments.effective_from <= CURRENT_DATE
      AND (
        manager_staff_assignments.effective_to IS NULL
        OR manager_staff_assignments.effective_to >= CURRENT_DATE
      )
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_active_manager_delegation_for_assignment(
  staff_user_id uuid,
  target_manager_id uuid,
  required_capability manager_delegation_capability
)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM manager_delegations
    JOIN manager_delegation_capabilities
      ON manager_delegation_capabilities.manager_delegation_id = manager_delegations.id
    JOIN manager_staff_assignments
      ON manager_staff_assignments.manager_id = manager_delegations.original_manager_id
    WHERE manager_delegations.covering_manager_id = auth.uid()
      AND manager_delegations.original_manager_id = target_manager_id
      AND manager_delegation_capabilities.capability = required_capability
      AND manager_delegations.revoked_at IS NULL
      AND manager_delegations.effective_from <= CURRENT_DATE
      AND manager_delegations.effective_to >= CURRENT_DATE
      AND manager_staff_assignments.staff_user_id = staff_user_id
      AND manager_staff_assignments.effective_from <= CURRENT_DATE
      AND (
        manager_staff_assignments.effective_to IS NULL
        OR manager_staff_assignments.effective_to >= CURRENT_DATE
      )
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE POLICY "Managers can select assigned staff user records"
ON users
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = users.id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      users.id,
      'view_attendance'
    )
    OR has_active_manager_delegation_for_staff(
      users.id,
      'manage_staff_assignments'
    )
  )
);

CREATE POLICY "Delegated managers can select delegated staff manager assignments"
ON manager_staff_assignments
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_staff(
    manager_staff_assignments.staff_user_id,
    'manage_staff_assignments'
  )
);

CREATE POLICY "Delegated managers can update delegated staff manager assignments"
ON manager_staff_assignments
FOR UPDATE
TO authenticated
USING (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_assignment(
    manager_staff_assignments.staff_user_id,
    manager_staff_assignments.manager_id,
    'manage_staff_assignments'
  )
)
WITH CHECK (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_assignment(
    manager_staff_assignments.staff_user_id,
    manager_staff_assignments.manager_id,
    'manage_staff_assignments'
  )
);

CREATE POLICY "Delegated managers can insert delegated staff manager assignments"
ON manager_staff_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_assignment(
    manager_staff_assignments.staff_user_id,
    manager_staff_assignments.manager_id,
    'manage_staff_assignments'
  )
);

CREATE POLICY "Managers can select assigned staff profiles"
ON staff_profiles
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = staff_profiles.user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
      )
    OR has_active_manager_delegation_for_staff(
      staff_profiles.user_id,
      'view_attendance'
    )
    OR has_active_manager_delegation_for_staff(
      staff_profiles.user_id,
      'manage_staff_assignments'
    )
  )
);

CREATE POLICY "Delegated managers can update delegated staff profiles"
ON staff_profiles
FOR UPDATE
TO authenticated
USING (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_staff(
    staff_profiles.user_id,
    'manage_staff_assignments'
  )
)
WITH CHECK (
  current_user_role() = 'manager'
  AND has_active_manager_delegation_for_staff(
    staff_profiles.user_id,
    'manage_staff_assignments'
  )
);

CREATE TABLE attendance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  rule_value jsonb NOT NULL,
  value_type attendance_rule_value_type NOT NULL,
  description text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_rules_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT attendance_rules_value_type_valid CHECK (
    (
      value_type = 'integer'
      AND jsonb_typeof(rule_value) = 'number'
      AND rule_value::text ~ '^-?[0-9]+$'
    )
    OR (value_type = 'decimal' AND jsonb_typeof(rule_value) = 'number')
    OR (value_type = 'text' AND jsonb_typeof(rule_value) = 'string')
    OR (value_type = 'boolean' AND jsonb_typeof(rule_value) = 'boolean')
    OR (value_type = 'json' AND jsonb_typeof(rule_value) IN ('object', 'array'))
  ),
  CONSTRAINT attendance_rules_no_overlapping_versions EXCLUDE USING gist (
    rule_key WITH =,
    (daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')) WITH &&
  )
);

COMMENT ON TABLE attendance_rules IS
  'Effective-dated configurable attendance rules. Flag review rules verify attendance for reporting; flags do not block capture, deny access, or mutate attendance events.';

ALTER TABLE attendance_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select attendance rules"
ON attendance_rules
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert attendance rules"
ON attendance_rules
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update attendance rules"
ON attendance_rules
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

INSERT INTO attendance_rules (
  rule_key,
  rule_value,
  value_type,
  description,
  effective_from,
  created_by
)
VALUES
  (
    'late_grace_minutes',
    '0'::jsonb,
    'integer',
    'Minutes after scheduled start before a late flag is created. Flags do not block capture.',
    CURRENT_DATE,
    NULL
  ),
  (
    'clock_discrepancy_threshold_minutes',
    '5'::jsonb,
    'integer',
    'Maximum allowed difference between device capture time and trusted server time before a clock discrepancy flag is created.',
    CURRENT_DATE,
    NULL
  ),
  (
    'photo_time_mismatch_threshold_minutes',
    '5'::jsonb,
    'integer',
    'Maximum allowed difference between photo metadata time and attendance capture time before a mismatch flag is created.',
    CURRENT_DATE,
    NULL
  ),
  (
    'lunch_deduction_minutes',
    '60'::jsonb,
    'integer',
    'Default unpaid lunch deduction applied to working-time calculations.',
    CURRENT_DATE,
    NULL
  ),
  (
    'overtime_threshold_minutes',
    '480'::jsonb,
    'integer',
    'Working minutes above this threshold become overtime candidates or overtime totals depending on approval state.',
    CURRENT_DATE,
    NULL
  ),
  (
    'late_handling_mode',
    '"flag_only"'::jsonb,
    'text',
    'Controls whether lateness is flag-only or deducted during payroll export logic.',
    CURRENT_DATE,
    NULL
  ),
  (
    'early_lunch_return_threshold_minutes',
    '30'::jsonb,
    'integer',
    'Minutes remaining from scheduled lunch window before early lunch return becomes an overtime candidate flag.',
    CURRENT_DATE,
    NULL
  ),
  (
    'short_attendance_gap_confirmation_minutes',
    '30'::jsonb,
    'integer',
    'Sequential attendance actions closer than this threshold require user confirmation.',
    CURRENT_DATE,
    NULL
  ),
  (
    'travel_time_reporting_mode',
    '"paid_non_productive_separate"'::jsonb,
    'text',
    'Controls how travel gaps are reported.',
    CURRENT_DATE,
    NULL
  ),
  (
    'max_edit_request_days_back',
    '30'::jsonb,
    'integer',
    'Maximum days back a user can submit a correction request.',
    CURRENT_DATE,
    NULL
  ),
  (
    'flag_review_workflow_mode_by_flag_type',
    '{
      "outside_radius": "manager_preapprove_admin_final",
      "gps_low_accuracy": "manager_review_admin_observe",
      "offline_submission": "manager_view_admin_approve",
      "location_conflict": "manager_preapprove_admin_final",
      "missing_punch": "manager_review_admin_observe",
      "deactivated_user_record": "manager_review_admin_observe",
      "late_sync": "manager_review_admin_observe",
      "clock_discrepancy": "manager_review_admin_observe",
      "early_lunch_return": "manager_review_admin_observe",
      "photo_time_mismatch": "manager_review_admin_observe",
      "missing_photo": "manager_review_admin_observe"
    }'::jsonb,
    'json',
    'Maps each official attendance flag type to its review workflow mode. Schedule mismatch is intentionally excluded because it is a derived schedule-compliance reporting metric, not a flag-review workflow item.',
    CURRENT_DATE,
    NULL
  );

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  latitude numeric(9, 6) NOT NULL,
  longitude numeric(9, 6) NOT NULL,
  allowed_radius_meters integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT locations_name_unique UNIQUE (name),
  CONSTRAINT locations_allowed_radius_positive CHECK (allowed_radius_meters > 0),
  CONSTRAINT locations_latitude_valid CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT locations_longitude_valid CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX locations_active_idx
ON locations (active);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select all locations"
ON locations
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert locations"
ON locations
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update locations"
ON locations
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE TABLE user_location_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  assignment_type location_assignment_type NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_location_assignments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),

  CONSTRAINT user_location_assignments_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations(id),

  CONSTRAINT user_location_assignments_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX user_location_assignments_user_id_idx
ON user_location_assignments (user_id);

CREATE INDEX user_location_assignments_location_id_idx
ON user_location_assignments (location_id);

CREATE INDEX user_location_assignments_assignment_type_idx
ON user_location_assignments (assignment_type);

CREATE OR REPLACE FUNCTION has_active_location_assignment(
  p_user_id uuid,
  p_location_id uuid,
  p_on_date date
)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_location_assignments
    JOIN locations
      ON locations.id = user_location_assignments.location_id
    WHERE user_location_assignments.user_id = p_user_id
      AND user_location_assignments.location_id = p_location_id
      AND user_location_assignments.effective_from <= p_on_date
      AND (
        user_location_assignments.effective_to IS NULL
        OR user_location_assignments.effective_to >= p_on_date
      )
      AND locations.active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE user_location_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own location assignments"
ON user_location_assignments
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Managers can select assigned staff location assignments"
ON user_location_assignments
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = user_location_assignments.user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      user_location_assignments.user_id,
      'view_attendance'
    )
    OR has_active_manager_delegation_for_staff(
      user_location_assignments.user_id,
      'manage_staff_assignments'
    )
    OR has_active_manager_delegation_for_staff(
      user_location_assignments.user_id,
      'manage_schedules'
    )
  )
);

CREATE POLICY "Users can select assigned active locations"
ON locations
FOR SELECT
TO authenticated
USING (
  has_active_location_assignment(
    auth.uid(),
    locations.id,
    CURRENT_DATE
  )
);

CREATE POLICY "Managers can select direct or delegated team locations"
ON locations
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
    SELECT 1
    FROM user_location_assignments
    WHERE user_location_assignments.location_id = locations.id
      AND user_location_assignments.effective_from <= CURRENT_DATE
      AND (
        user_location_assignments.effective_to IS NULL
        OR user_location_assignments.effective_to >= CURRENT_DATE
      )
      AND (
        EXISTS (
          SELECT 1
          FROM manager_staff_assignments
          WHERE manager_staff_assignments.manager_id = auth.uid()
            AND manager_staff_assignments.staff_user_id = user_location_assignments.user_id
            AND manager_staff_assignments.effective_from <= CURRENT_DATE
            AND (
              manager_staff_assignments.effective_to IS NULL
              OR manager_staff_assignments.effective_to >= CURRENT_DATE
            )
        )
        OR has_active_manager_delegation_for_staff(
          user_location_assignments.user_id,
          'view_attendance'
        )
        OR has_active_manager_delegation_for_staff(
          user_location_assignments.user_id,
          'manage_schedules'
        )
        OR has_active_manager_delegation_for_staff(
          user_location_assignments.user_id,
          'manage_staff_assignments'
        )
      )
  )
);

CREATE POLICY "Admins can select all location assignments"
ON user_location_assignments
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert location assignments"
ON user_location_assignments
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update location assignments"
ON user_location_assignments
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  schedule_type schedule_type NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),

  CONSTRAINT schedules_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT schedules_no_overlapping_effective_ranges EXCLUDE USING gist (
    user_id WITH =,
    (daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')) WITH &&
  )
  WHERE (active)
);

CREATE INDEX schedules_user_id_idx
ON schedules (user_id);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own schedules"
ON schedules
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Managers can select assigned staff schedules"
ON schedules
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = schedules.user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      schedules.user_id,
      'manage_schedules'
    )
    OR has_active_manager_delegation_for_staff(
      schedules.user_id,
      'view_attendance'
    )
  )
);

CREATE POLICY "Admins can select all schedules"
ON schedules
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE TABLE schedule_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  expected_location_id uuid,
  shift_start time,
  shift_end time,
  lunch_minutes integer NOT NULL DEFAULT 60,
  day_mode day_mode NOT NULL DEFAULT 'office',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedule_days_schedule_id_fkey
    FOREIGN KEY (schedule_id) REFERENCES schedules(id),

  CONSTRAINT schedule_days_expected_location_id_fkey
    FOREIGN KEY (expected_location_id) REFERENCES locations(id),

  CONSTRAINT schedule_days_day_of_week_valid CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT schedule_days_lunch_minutes_non_negative CHECK (lunch_minutes >= 0),
  CONSTRAINT schedule_days_schedule_id_day_of_week_unique UNIQUE (schedule_id, day_of_week)
);

CREATE INDEX schedule_days_schedule_id_idx
ON schedule_days (schedule_id);

CREATE INDEX schedule_days_expected_location_id_idx
ON schedule_days (expected_location_id);

ALTER TABLE schedule_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own schedule days"
ON schedule_days
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM schedules
    WHERE schedules.id = schedule_days.schedule_id
      AND schedules.user_id = auth.uid()
  )
);

CREATE POLICY "Managers can select assigned staff schedule days"
ON schedule_days
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
    SELECT 1
    FROM schedules
    WHERE schedules.id = schedule_days.schedule_id
      AND (
        EXISTS (
          SELECT 1
          FROM manager_staff_assignments
          WHERE manager_staff_assignments.manager_id = auth.uid()
            AND manager_staff_assignments.staff_user_id = schedules.user_id
            AND manager_staff_assignments.effective_from <= CURRENT_DATE
            AND (
              manager_staff_assignments.effective_to IS NULL
              OR manager_staff_assignments.effective_to >= CURRENT_DATE
            )
        )
        OR has_active_manager_delegation_for_staff(
          schedules.user_id,
          'manage_schedules'
        )
        OR has_active_manager_delegation_for_staff(
          schedules.user_id,
          'view_attendance'
        )
      )
  )
);

CREATE POLICY "Admins can select all schedule days"
ON schedule_days
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE TABLE schedule_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_manager_id uuid NOT NULL,
  affected_user_id uuid NOT NULL,
  requested_effective_from date NOT NULL,
  requested_effective_to date NOT NULL,
  proposed_schedule_type schedule_type NOT NULL,
  proposed_schedule_days jsonb NOT NULL,
  reason text NOT NULL,
  status schedule_change_request_status NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id uuid,
  reviewed_at timestamptz,
  reviewer_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedule_change_requests_requesting_manager_id_fkey
    FOREIGN KEY (requesting_manager_id) REFERENCES users(id),

  CONSTRAINT schedule_change_requests_affected_user_id_fkey
    FOREIGN KEY (affected_user_id) REFERENCES users(id),

  CONSTRAINT schedule_change_requests_reviewed_by_admin_id_fkey
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id),

  CONSTRAINT schedule_change_requests_effective_range_valid CHECK (
    requested_effective_to >= requested_effective_from
  ),
  CONSTRAINT schedule_change_requests_payload_array CHECK (
    jsonb_typeof(proposed_schedule_days) = 'array'
    AND jsonb_array_length(proposed_schedule_days) > 0
  ),
  CONSTRAINT schedule_change_requests_review_fields_valid CHECK (
    (
      status = 'pending'
      AND reviewed_by_admin_id IS NULL
      AND reviewed_at IS NULL
      AND reviewer_remarks IS NULL
    )
    OR (
      status IN ('approved', 'rejected', 'cancelled')
      AND reviewed_by_admin_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX schedule_change_requests_requesting_manager_id_idx
ON schedule_change_requests (requesting_manager_id);

CREATE INDEX schedule_change_requests_affected_user_id_idx
ON schedule_change_requests (affected_user_id);

CREATE INDEX schedule_change_requests_status_idx
ON schedule_change_requests (status);

CREATE OR REPLACE FUNCTION validate_schedule_change_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = NEW.requesting_manager_id
      AND users.role = 'manager'
  ) THEN
    RAISE EXCEPTION 'Schedule change requester must have manager role.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = NEW.affected_user_id
  ) THEN
    RAISE EXCEPTION 'Schedule change affected user must exist.';
  END IF;

  IF TG_OP = 'INSERT'
    AND current_user_role() <> 'admin'
    AND NEW.requesting_manager_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'Schedule change requester must match the current user.';
  END IF;

  IF TG_OP = 'INSERT'
    AND (
      NEW.status IS DISTINCT FROM 'pending'
      OR NEW.reviewed_by_admin_id IS NOT NULL
      OR NEW.reviewed_at IS NOT NULL
      OR NEW.reviewer_remarks IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Schedule change requests must be submitted as pending without review fields.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER schedule_change_requests_validate
BEFORE INSERT OR UPDATE ON schedule_change_requests
FOR EACH ROW
EXECUTE FUNCTION validate_schedule_change_request();

ALTER TABLE schedule_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can select relevant schedule change requests"
ON schedule_change_requests
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    requesting_manager_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = schedule_change_requests.affected_user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      schedule_change_requests.affected_user_id,
      'manage_schedules'
    )
  )
);

CREATE POLICY "Admins can select all schedule change requests"
ON schedule_change_requests
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Managers can create relevant schedule change requests"
ON schedule_change_requests
FOR INSERT
TO authenticated
WITH CHECK (
  current_user_role() = 'manager'
  AND requesting_manager_id = auth.uid()
  AND status = 'pending'
  AND reviewed_by_admin_id IS NULL
  AND reviewed_at IS NULL
  AND reviewer_remarks IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = schedule_change_requests.affected_user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      schedule_change_requests.affected_user_id,
      'manage_schedules'
    )
  )
);

CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_type session_type NOT NULL,
  work_date date NOT NULL,
  selected_location_id uuid,
  expected_location_id uuid,
  expected_shift_start time,
  expected_shift_end time,
  expected_lunch_minutes integer,
  purpose text,
  status session_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),

  CONSTRAINT attendance_sessions_selected_location_id_fkey
    FOREIGN KEY (selected_location_id) REFERENCES locations(id),

  CONSTRAINT attendance_sessions_expected_location_id_fkey
    FOREIGN KEY (expected_location_id) REFERENCES locations(id),

  CONSTRAINT attendance_sessions_expected_lunch_minutes_non_negative CHECK (
    expected_lunch_minutes IS NULL OR expected_lunch_minutes >= 0
  )
);

CREATE INDEX attendance_sessions_user_id_idx
ON attendance_sessions (user_id);

CREATE INDEX attendance_sessions_work_date_idx
ON attendance_sessions (work_date);

CREATE UNIQUE INDEX attendance_sessions_one_stationary_day_per_user_date_idx
ON attendance_sessions (user_id, work_date)
WHERE session_type = 'stationary_day';

CREATE UNIQUE INDEX attendance_sessions_one_open_field_visit_per_user_idx
ON attendance_sessions (user_id)
WHERE session_type = 'field_visit'
  AND status = 'open';

CREATE OR REPLACE FUNCTION get_schedule_day_snapshot(
  p_user_id uuid,
  p_work_date date
)
RETURNS TABLE (
  expected_location_id uuid,
  expected_shift_start time,
  expected_shift_end time,
  expected_lunch_minutes integer
) AS $$
  SELECT
    schedule_days.expected_location_id,
    schedule_days.shift_start,
    schedule_days.shift_end,
    schedule_days.lunch_minutes
  FROM schedules
  JOIN schedule_days
    ON schedule_days.schedule_id = schedules.id
  WHERE schedules.user_id = p_user_id
    AND schedules.active = true
    AND schedules.effective_from <= p_work_date
    AND (
      schedules.effective_to IS NULL
      OR schedules.effective_to >= p_work_date
    )
    AND schedule_days.day_of_week = EXTRACT(ISODOW FROM p_work_date)::integer
  ORDER BY schedules.effective_from DESC, schedules.created_at DESC
  LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION populate_attendance_session_expected_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  schedule_day_snapshot RECORD;
BEGIN
  SELECT *
  INTO schedule_day_snapshot
  FROM get_schedule_day_snapshot(NEW.user_id, NEW.work_date);

  IF FOUND THEN
    NEW.expected_location_id = schedule_day_snapshot.expected_location_id;
    NEW.expected_shift_start = schedule_day_snapshot.expected_shift_start;
    NEW.expected_shift_end = schedule_day_snapshot.expected_shift_end;
    NEW.expected_lunch_minutes = schedule_day_snapshot.expected_lunch_minutes;
  ELSE
    NEW.expected_location_id = NULL;
    NEW.expected_shift_start = NULL;
    NEW.expected_shift_end = NULL;
    NEW.expected_lunch_minutes = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER attendance_sessions_populate_expected_snapshot
BEFORE INSERT ON attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION populate_attendance_session_expected_snapshot();

CREATE OR REPLACE FUNCTION recalculate_attendance_session_expected_snapshots(
  p_user_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_reason text,
  p_write_audit boolean DEFAULT true
)
RETURNS integer AS $$
DECLARE
  before_snapshot jsonb;
  after_snapshot jsonb;
  affected_count integer;
BEGIN
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can recalculate attendance session schedule snapshots.';
  END IF;

  IF p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'Recalculation effective_to must be on or after effective_from.';
  END IF;

  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when recalculating attendance session schedule snapshots.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', attendance_sessions.id,
        'work_date', attendance_sessions.work_date,
        'expected_location_id', attendance_sessions.expected_location_id,
        'expected_shift_start', attendance_sessions.expected_shift_start,
        'expected_shift_end', attendance_sessions.expected_shift_end,
        'expected_lunch_minutes', attendance_sessions.expected_lunch_minutes
      )
      ORDER BY attendance_sessions.work_date, attendance_sessions.created_at, attendance_sessions.id
    ),
    '[]'::jsonb
  )
  INTO before_snapshot
  FROM attendance_sessions
  WHERE attendance_sessions.user_id = p_user_id
    AND attendance_sessions.work_date BETWEEN p_effective_from AND p_effective_to;

  WITH recalculated AS (
    SELECT
      attendance_sessions.id AS attendance_session_id,
      snapshot.expected_location_id,
      snapshot.expected_shift_start,
      snapshot.expected_shift_end,
      snapshot.expected_lunch_minutes
    FROM attendance_sessions
    LEFT JOIN LATERAL get_schedule_day_snapshot(
      attendance_sessions.user_id,
      attendance_sessions.work_date
    ) AS snapshot ON true
    WHERE attendance_sessions.user_id = p_user_id
      AND attendance_sessions.work_date BETWEEN p_effective_from AND p_effective_to
  ),
  updated AS (
    UPDATE attendance_sessions
    SET
      expected_location_id = recalculated.expected_location_id,
      expected_shift_start = recalculated.expected_shift_start,
      expected_shift_end = recalculated.expected_shift_end,
      expected_lunch_minutes = recalculated.expected_lunch_minutes,
      updated_at = now()
    FROM recalculated
    WHERE attendance_sessions.id = recalculated.attendance_session_id
      AND (
        attendance_sessions.expected_location_id IS DISTINCT FROM recalculated.expected_location_id
        OR attendance_sessions.expected_shift_start IS DISTINCT FROM recalculated.expected_shift_start
        OR attendance_sessions.expected_shift_end IS DISTINCT FROM recalculated.expected_shift_end
        OR attendance_sessions.expected_lunch_minutes IS DISTINCT FROM recalculated.expected_lunch_minutes
      )
    RETURNING attendance_sessions.id
  )
  SELECT COUNT(*)
  INTO affected_count
  FROM updated;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', attendance_sessions.id,
        'work_date', attendance_sessions.work_date,
        'expected_location_id', attendance_sessions.expected_location_id,
        'expected_shift_start', attendance_sessions.expected_shift_start,
        'expected_shift_end', attendance_sessions.expected_shift_end,
        'expected_lunch_minutes', attendance_sessions.expected_lunch_minutes
      )
      ORDER BY attendance_sessions.work_date, attendance_sessions.created_at, attendance_sessions.id
    ),
    '[]'::jsonb
  )
  INTO after_snapshot
  FROM attendance_sessions
  WHERE attendance_sessions.user_id = p_user_id
    AND attendance_sessions.work_date BETWEEN p_effective_from AND p_effective_to;

  IF p_write_audit THEN
    INSERT INTO audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_json,
      after_json
    )
    VALUES (
      auth.uid(),
      'attendance_session_schedule_snapshots_recalculated',
      'attendance_sessions',
      NULL,
      jsonb_build_object(
        'reason', p_reason,
        'user_id', p_user_id,
        'effective_from', p_effective_from,
        'effective_to', p_effective_to,
        'sessions', before_snapshot
      ),
      jsonb_build_object(
        'affected_count', affected_count,
        'user_id', p_user_id,
        'effective_from', p_effective_from,
        'effective_to', p_effective_to,
        'sessions', after_snapshot
      )
    );
  END IF;

  RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION apply_schedule_correction(
  p_user_id uuid,
  p_schedule_type schedule_type,
  p_effective_from date,
  p_effective_to date,
  p_schedule_days jsonb,
  p_reason text,
  p_schedule_change_request_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  overlapping_schedule RECORD;
  before_snapshot jsonb;
  after_snapshot jsonb;
  replacement_schedule_id uuid;
  tail_schedule_id uuid;
  old_effective_to date;
  affected_session_count integer;
BEGIN
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can apply schedule corrections.';
  END IF;

  IF p_effective_to IS NULL THEN
    RAISE EXCEPTION 'Schedule correction effective_to is required.';
  END IF;

  IF p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'Schedule correction effective_to must be on or after effective_from.';
  END IF;

  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when applying a schedule correction.';
  END IF;

  IF jsonb_typeof(p_schedule_days) <> 'array'
    OR jsonb_array_length(p_schedule_days) = 0
  THEN
    RAISE EXCEPTION 'Schedule correction requires at least one schedule day.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schedule', to_jsonb(schedules),
        'days', COALESCE(schedule_days_snapshot.days, '[]'::jsonb)
      )
      ORDER BY schedules.effective_from, schedules.created_at, schedules.id
    ),
    '[]'::jsonb
  )
  INTO before_snapshot
  FROM schedules
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(schedule_days) ORDER BY schedule_days.day_of_week) AS days
    FROM schedule_days
    WHERE schedule_days.schedule_id = schedules.id
  ) AS schedule_days_snapshot ON true
  WHERE schedules.user_id = p_user_id
    AND schedules.active = true
    AND daterange(schedules.effective_from, COALESCE(schedules.effective_to, 'infinity'::date), '[]')
      && daterange(p_effective_from, p_effective_to, '[]');

  FOR overlapping_schedule IN
    SELECT *
    FROM schedules
    WHERE schedules.user_id = p_user_id
      AND schedules.active = true
      AND daterange(schedules.effective_from, COALESCE(schedules.effective_to, 'infinity'::date), '[]')
        && daterange(p_effective_from, p_effective_to, '[]')
    ORDER BY schedules.effective_from, schedules.created_at, schedules.id
    FOR UPDATE
  LOOP
    old_effective_to := overlapping_schedule.effective_to;

    IF overlapping_schedule.effective_from < p_effective_from
      AND (
        overlapping_schedule.effective_to IS NULL
        OR overlapping_schedule.effective_to > p_effective_to
      )
    THEN
      UPDATE schedules
      SET
        effective_to = p_effective_from - 1,
        updated_at = now()
      WHERE schedules.id = overlapping_schedule.id;

      INSERT INTO schedules (
        user_id,
        schedule_type,
        effective_from,
        effective_to,
        active
      )
      VALUES (
        overlapping_schedule.user_id,
        overlapping_schedule.schedule_type,
        p_effective_to + 1,
        old_effective_to,
        true
      )
      RETURNING id INTO tail_schedule_id;

      INSERT INTO schedule_days (
        schedule_id,
        day_of_week,
        expected_location_id,
        shift_start,
        shift_end,
        lunch_minutes,
        day_mode
      )
      SELECT
        tail_schedule_id,
        schedule_days.day_of_week,
        schedule_days.expected_location_id,
        schedule_days.shift_start,
        schedule_days.shift_end,
        schedule_days.lunch_minutes,
        schedule_days.day_mode
      FROM schedule_days
      WHERE schedule_days.schedule_id = overlapping_schedule.id;
    ELSIF overlapping_schedule.effective_from < p_effective_from THEN
      UPDATE schedules
      SET
        effective_to = p_effective_from - 1,
        updated_at = now()
      WHERE schedules.id = overlapping_schedule.id;
    ELSIF overlapping_schedule.effective_to IS NULL
      OR overlapping_schedule.effective_to > p_effective_to
    THEN
      UPDATE schedules
      SET
        effective_from = p_effective_to + 1,
        updated_at = now()
      WHERE schedules.id = overlapping_schedule.id;
    ELSE
      UPDATE schedules
      SET
        active = false,
        updated_at = now()
      WHERE schedules.id = overlapping_schedule.id;
    END IF;
  END LOOP;

  INSERT INTO schedules (
    user_id,
    schedule_type,
    effective_from,
    effective_to,
    active
  )
  VALUES (
    p_user_id,
    p_schedule_type,
    p_effective_from,
    p_effective_to,
    true
  )
  RETURNING id INTO replacement_schedule_id;

  INSERT INTO schedule_days (
    schedule_id,
    day_of_week,
    expected_location_id,
    shift_start,
    shift_end,
    lunch_minutes,
    day_mode
  )
  SELECT
    replacement_schedule_id,
    schedule_day_input.day_of_week,
    schedule_day_input.expected_location_id,
    schedule_day_input.shift_start,
    schedule_day_input.shift_end,
    COALESCE(schedule_day_input.lunch_minutes, 60),
    COALESCE(schedule_day_input.day_mode, 'office'::day_mode)
  FROM jsonb_to_recordset(p_schedule_days) AS schedule_day_input(
    day_of_week integer,
    expected_location_id uuid,
    shift_start time,
    shift_end time,
    lunch_minutes integer,
    day_mode day_mode
  );

  affected_session_count := recalculate_attendance_session_expected_snapshots(
    p_user_id,
    p_effective_from,
    p_effective_to,
    p_reason,
    false
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schedule', to_jsonb(schedules),
        'days', COALESCE(schedule_days_snapshot.days, '[]'::jsonb)
      )
      ORDER BY schedules.effective_from, schedules.created_at, schedules.id
    ),
    '[]'::jsonb
  )
  INTO after_snapshot
  FROM schedules
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(schedule_days) ORDER BY schedule_days.day_of_week) AS days
    FROM schedule_days
    WHERE schedule_days.schedule_id = schedules.id
  ) AS schedule_days_snapshot ON true
  WHERE schedules.user_id = p_user_id
    AND daterange(schedules.effective_from, COALESCE(schedules.effective_to, 'infinity'::date), '[]')
      && daterange(p_effective_from, p_effective_to, '[]');

  INSERT INTO audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_json,
    after_json
  )
  VALUES (
    auth.uid(),
    'schedule_correction_applied',
    'schedules',
    replacement_schedule_id,
    jsonb_build_object(
      'reason', p_reason,
      'user_id', p_user_id,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'schedule_change_request_id', p_schedule_change_request_id,
      'schedules', before_snapshot
    ),
    jsonb_build_object(
      'replacement_schedule_id', replacement_schedule_id,
      'affected_session_count', affected_session_count,
      'user_id', p_user_id,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'schedule_change_request_id', p_schedule_change_request_id,
      'schedules', after_snapshot
    )
  );

  RETURN replacement_schedule_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION approve_schedule_change_request(
  p_request_id uuid,
  p_reviewer_remarks text
)
RETURNS uuid AS $$
DECLARE
  request_row schedule_change_requests%ROWTYPE;
  replacement_schedule_id uuid;
BEGIN
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can approve schedule change requests.';
  END IF;

  IF NULLIF(BTRIM(p_reviewer_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Reviewer remarks are required when approving a schedule change request.';
  END IF;

  SELECT *
  INTO request_row
  FROM schedule_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule change request not found.';
  END IF;

  IF request_row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Only pending schedule change requests can be approved.';
  END IF;

  replacement_schedule_id := apply_schedule_correction(
    request_row.affected_user_id,
    request_row.proposed_schedule_type,
    request_row.requested_effective_from,
    request_row.requested_effective_to,
    request_row.proposed_schedule_days,
    request_row.reason,
    request_row.id
  );

  UPDATE schedule_change_requests
  SET
    status = 'approved',
    reviewed_by_admin_id = auth.uid(),
    reviewed_at = now(),
    reviewer_remarks = p_reviewer_remarks,
    updated_at = now()
  WHERE id = request_row.id;

  RETURN replacement_schedule_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reject_schedule_change_request(
  p_request_id uuid,
  p_reviewer_remarks text
)
RETURNS void AS $$
DECLARE
  request_row schedule_change_requests%ROWTYPE;
BEGIN
  IF current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can reject schedule change requests.';
  END IF;

  IF NULLIF(BTRIM(p_reviewer_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Reviewer remarks are required when rejecting a schedule change request.';
  END IF;

  SELECT *
  INTO request_row
  FROM schedule_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule change request not found.';
  END IF;

  IF request_row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Only pending schedule change requests can be rejected.';
  END IF;

  UPDATE schedule_change_requests
  SET
    status = 'rejected',
    reviewed_by_admin_id = auth.uid(),
    reviewed_at = now(),
    reviewer_remarks = p_reviewer_remarks,
    updated_at = now()
  WHERE id = request_row.id;

  INSERT INTO audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_json,
    after_json
  )
  VALUES (
    auth.uid(),
    'schedule_change_request_rejected',
    'schedule_change_requests',
    request_row.id,
    to_jsonb(request_row),
    jsonb_build_object(
      'status', 'rejected',
      'reviewed_by_admin_id', auth.uid(),
      'reviewed_at', now(),
      'reviewer_remarks', p_reviewer_remarks
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION restrict_attendance_session_user_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Users may only update their own attendance sessions.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.session_type IS DISTINCT FROM OLD.session_type
    OR NEW.work_date IS DISTINCT FROM OLD.work_date
    OR NEW.selected_location_id IS DISTINCT FROM OLD.selected_location_id
    OR NEW.expected_location_id IS DISTINCT FROM OLD.expected_location_id
    OR NEW.expected_shift_start IS DISTINCT FROM OLD.expected_shift_start
    OR NEW.expected_shift_end IS DISTINCT FROM OLD.expected_shift_end
    OR NEW.expected_lunch_minutes IS DISTINCT FROM OLD.expected_lunch_minutes
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
  THEN
    RAISE EXCEPTION 'Users may only update attendance session status.';
  END IF;

  IF OLD.status IS DISTINCT FROM 'open'
    OR NEW.status IS DISTINCT FROM 'closed'
  THEN
    RAISE EXCEPTION 'Users may only close an open attendance session.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION get_schedule_day_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION populate_attendance_session_expected_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION restrict_attendance_session_user_updates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION recalculate_attendance_session_expected_snapshots(uuid, date, date, text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION apply_schedule_correction(uuid, schedule_type, date, date, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_schedule_change_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_schedule_change_request(uuid, text) TO authenticated;

CREATE TRIGGER attendance_sessions_restrict_user_updates
BEFORE UPDATE ON attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION restrict_attendance_session_user_updates();

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own attendance sessions"
ON attendance_sessions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Managers can select assigned staff attendance sessions"
ON attendance_sessions
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND (
    EXISTS (
      SELECT 1
      FROM manager_staff_assignments
      WHERE manager_staff_assignments.manager_id = auth.uid()
        AND manager_staff_assignments.staff_user_id = attendance_sessions.user_id
        AND manager_staff_assignments.effective_from <= CURRENT_DATE
        AND (
          manager_staff_assignments.effective_to IS NULL
          OR manager_staff_assignments.effective_to >= CURRENT_DATE
        )
    )
    OR has_active_manager_delegation_for_staff(
      attendance_sessions.user_id,
      'view_attendance'
    )
    OR has_active_manager_delegation_for_staff(
      attendance_sessions.user_id,
      'manage_schedules'
    )
  )
);

CREATE POLICY "Admins can select all attendance sessions"
ON attendance_sessions
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Users can insert own attendance sessions"
ON attendance_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    selected_location_id IS NULL
    OR has_active_location_assignment(
      user_id,
      selected_location_id,
      work_date
    )
  )
);

CREATE POLICY "Admins can insert attendance sessions"
ON attendance_sessions
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Users can update own attendance session status"
ON attendance_sessions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can update attendance sessions"
ON attendance_sessions
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');
