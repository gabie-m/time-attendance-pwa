-- Establish the fixed MVP access roles. A later authorization milestone may
-- replace these with configurable role and permission assignments.

ALTER TYPE public.user_role RENAME VALUE 'user' TO 'employee';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hr' BEFORE 'admin';

ALTER TABLE public.users
  ALTER COLUMN role SET DEFAULT 'employee';

COMMENT ON TYPE public.user_role IS
  'Fixed MVP roles: employee captures own attendance; manager reviews direct-team work; HR performs organization-wide review workflows; admin manages the system and retains HR overrides.';

COMMENT ON COLUMN public.users.role IS
  'Primary MVP access role. Managers, HR, and admins may have an optional staff profile when they also need to capture their own attendance.';
