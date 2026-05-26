CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('user', 'manager', 'admin');
CREATE TYPE staff_type AS ENUM ('stationary', 'roving');
CREATE TYPE attendance_model AS ENUM ('stationary', 'roving');
CREATE TYPE attendance_purpose AS ENUM ('payroll', 'monitoring');
CREATE TYPE location_access AS ENUM ('restricted', 'open');
CREATE TYPE day_mode AS ENUM ('office', 'field', 'off');
CREATE TYPE schedule_type AS ENUM ('fixed', 'weekly_pattern', 'flexible');
CREATE TYPE location_assignment_type AS ENUM ('primary', 'allowed', 'temporary');
CREATE TYPE session_type AS ENUM ('stationary_day', 'field_visit');
CREATE TYPE session_status AS ENUM ('open', 'closed', 'needs_review');
CREATE TYPE attendance_rule_key AS ENUM (
  'late_grace_minutes',
  'overtime_threshold_minutes',
  'lunch_deduction_minutes',
  'photo_time_mismatch_threshold_minutes',
  'clock_discrepancy_threshold_minutes'
);

CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  name text NOT NULL,
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
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
  employee_code text,
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

CREATE POLICY "Managers can select assigned staff user records"
ON users
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
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
);

CREATE POLICY "Managers can select assigned staff profiles"
ON staff_profiles
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
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
);

CREATE TABLE attendance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key attendance_rule_key NOT NULL,
  rule_value integer NOT NULL,
  description text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_rules_rule_key_unique UNIQUE (rule_key),
  CONSTRAINT attendance_rules_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

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
  description,
  effective_from,
  created_by
)
VALUES
  (
    'late_grace_minutes',
    0,
    'Number of minutes after scheduled shift start before an attendance event is considered late.',
    CURRENT_DATE,
    NULL
  ),
  (
    'overtime_threshold_minutes',
    480,
    'Number of worked minutes in a day before time is considered overtime.',
    CURRENT_DATE,
    NULL
  ),
  (
    'lunch_deduction_minutes',
    60,
    'Default lunch deduction in minutes applied to daily attendance calculations.',
    CURRENT_DATE,
    NULL
  ),
  (
    'photo_time_mismatch_threshold_minutes',
    5,
    'Maximum allowed difference in minutes between photo capture time and attendance punch time.',
    CURRENT_DATE,
    NULL
  ),
  (
    'clock_discrepancy_threshold_minutes',
    5,
    'Maximum allowed difference in minutes between trusted server time and device time before flagging a clock discrepancy.',
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

CREATE POLICY "Users can select active locations"
ON locations
FOR SELECT
TO authenticated
USING (active = true);

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
  AND EXISTS (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id),

  CONSTRAINT schedules_effective_range_valid CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
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
  AND EXISTS (
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
);

CREATE POLICY "Admins can select all schedules"
ON schedules
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert schedules"
ON schedules
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update schedules"
ON schedules
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

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
    JOIN manager_staff_assignments
      ON manager_staff_assignments.staff_user_id = schedules.user_id
    WHERE schedules.id = schedule_days.schedule_id
      AND manager_staff_assignments.manager_id = auth.uid()
      AND manager_staff_assignments.effective_from <= CURRENT_DATE
      AND (
        manager_staff_assignments.effective_to IS NULL
        OR manager_staff_assignments.effective_to >= CURRENT_DATE
      )
  )
);

CREATE POLICY "Admins can select all schedule days"
ON schedule_days
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE POLICY "Admins can insert schedule days"
ON schedule_days
FOR INSERT
TO authenticated
WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins can update schedule days"
ON schedule_days
FOR UPDATE
TO authenticated
USING (current_user_role() = 'admin')
WITH CHECK (current_user_role() = 'admin');

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

CREATE UNIQUE INDEX attendance_sessions_one_open_stationary_day_per_user_date_idx
ON attendance_sessions (user_id, work_date)
WHERE session_type = 'stationary_day'
  AND status = 'open';

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
  THEN
    RAISE EXCEPTION 'Users may only update attendance session status.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
  AND EXISTS (
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
WITH CHECK (user_id = auth.uid());

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
