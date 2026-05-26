CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('user', 'manager', 'admin');
CREATE TYPE staff_type AS ENUM ('stationary', 'roving');
CREATE TYPE attendance_model AS ENUM ('stationary', 'roving');
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
  default_staff_type
)
VALUES
  ('Merchandiser', 'stationary'),
  ('Account Officer', 'roving'),
  ('Coordinator', 'roving'),
  ('Liaison Staff', 'roving'),
  ('Inventory Staff', 'stationary');

CREATE TABLE staff_profiles (
  user_id uuid PRIMARY KEY,
  staff_category_id uuid,
  staff_type staff_type NOT NULL,
  default_attendance_model attendance_model NOT NULL,
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
