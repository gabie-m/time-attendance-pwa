BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);

INSERT INTO auth.users (id, email, role, aud, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000901', 'queue-manager@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000902', 'queue-hr@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000903', 'queue-staff-a@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000904', 'queue-staff-b@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000905', 'queue-admin@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000906', 'queue-covering-manager@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000000907', 'queue-former-manager@example.com', 'authenticated', 'authenticated', now(), now());
INSERT INTO public.users (id, name, email, role, active, location_consent_given_at) VALUES
  ('00000000-0000-0000-0000-000000000901', 'Queue Manager', 'queue-manager@example.com', 'manager', true, now()),
  ('00000000-0000-0000-0000-000000000902', 'Queue HR', 'queue-hr@example.com', 'hr', true, now()),
  ('00000000-0000-0000-0000-000000000903', 'Queue Staff A', 'queue-staff-a@example.com', 'employee', true, now()),
  ('00000000-0000-0000-0000-000000000904', 'Queue Staff B', 'queue-staff-b@example.com', 'employee', true, now()),
  ('00000000-0000-0000-0000-000000000905', 'Queue Admin', 'queue-admin@example.com', 'admin', true, now()),
  ('00000000-0000-0000-0000-000000000906', 'Queue Covering Manager', 'queue-covering-manager@example.com', 'manager', true, now()),
  ('00000000-0000-0000-0000-000000000907', 'Queue Former Manager', 'queue-former-manager@example.com', 'manager', true, now());
INSERT INTO public.staff_profiles (user_id, employee_code, staff_type, default_attendance_model, attendance_purpose, location_access, timezone) VALUES
  ('00000000-0000-0000-0000-000000000903', 'QUEUE-A', 'stationary', 'stationary', 'payroll', 'restricted', 'Asia/Manila'),
  ('00000000-0000-0000-0000-000000000904', 'QUEUE-B', 'stationary', 'stationary', 'payroll', 'restricted', 'Asia/Manila');
INSERT INTO public.attendance_sessions (id, user_id, session_type, work_date, status) VALUES
  ('00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000903', 'stationary_day', CURRENT_DATE, 'needs_review'),
  ('00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000904', 'stationary_day', CURRENT_DATE, 'needs_review');
INSERT INTO public.attendance_events (id, session_id, user_id, client_event_id, event_type, captured_at_local, gps_expires_at) VALUES
  ('00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-000000000931', 'time_in', now(), now() + interval '12 months'),
  ('00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000932', 'time_in', now(), now() + interval '12 months');
INSERT INTO public.attendance_flags (id, session_id, attendance_event_id, user_id, flag_type, severity, workflow_mode, workflow_effective_from) VALUES
  ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000903', 'missing_photo', 'warning', 'manager_review_admin_observe', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000000942', '00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000904', 'missing_photo', 'warning', 'manager_review_admin_observe', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000000943', '00000000-0000-0000-0000-000000000911', NULL, '00000000-0000-0000-0000-000000000903', 'missing_punch', 'high', 'manager_review_admin_observe', CURRENT_DATE);
INSERT INTO public.manager_staff_assignments (manager_id, staff_user_id, effective_from, effective_to) VALUES
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000903', CURRENT_DATE, NULL),
  ('00000000-0000-0000-0000-000000000907', '00000000-0000-0000-0000-000000000903', CURRENT_DATE - 30, CURRENT_DATE - 1);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', true);
INSERT INTO public.manager_delegations (
  id,
  original_manager_id,
  covering_manager_id,
  effective_from,
  effective_to,
  reason,
  created_by_admin_id
) VALUES (
  '00000000-0000-0000-0000-000000000951',
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000906',
  CURRENT_DATE - 1,
  CURRENT_DATE + 1,
  'Reviewer queue regression coverage',
  '00000000-0000-0000-0000-000000000905'
);
INSERT INTO public.manager_delegation_capabilities (manager_delegation_id, capability) VALUES
  ('00000000-0000-0000-0000-000000000951', 'review_flags');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 2, 'manager sees all flags for current direct staff, including session-level flags');
SELECT is((public.get_reviewer_flag_queue() -> 0 ->> 'eventType'), NULL, 'session-level flags have no event type');
SELECT ok(NOT (public.get_reviewer_flag_queue() -> 0 ?| ARRAY['latitude','longitude','evidence','photoPath','remarks','locationId']), 'manager queue excludes sensitive evidence');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000902', true);
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 3, 'HR sees organization-wide queue');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', true);
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 3, 'admin sees organization-wide queue');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000906', true);
SELECT ok(public.has_active_manager_delegation_for_staff('00000000-0000-0000-0000-000000000903', 'review_flags'), 'covering manager has delegated flag-review access for the original manager staff member');
SELECT ok(NOT public.has_active_manager_delegation_for_staff('00000000-0000-0000-0000-000000000904', 'review_flags'), 'covering manager has no delegated access outside the original manager current team');
SELECT ok(NOT public.has_active_manager_delegation_for_assignment('00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000901', 'review_flags'), 'covering manager cannot use delegated assignment authority outside the original manager current team');
SELECT ok(POSITION('CURRENT_DATE' IN pg_get_functiondef('public.has_active_manager_delegation_for_staff(uuid, manager_delegation_capability)'::regprocedure)) = 0, 'staff delegation helper does not use database-session CURRENT_DATE');
SELECT ok(POSITION('CURRENT_DATE' IN pg_get_functiondef('public.has_active_manager_delegation_for_assignment(uuid, uuid, manager_delegation_capability)'::regprocedure)) = 0, 'assignment delegation helper does not use database-session CURRENT_DATE');
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 2, 'covering manager sees the original manager current team only while delegated');
RESET ROLE;
UPDATE public.manager_delegations
SET effective_to = (now() AT TIME ZONE 'Asia/Manila')::date - 1
WHERE id = '00000000-0000-0000-0000-000000000951';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000906', true);
SELECT ok(NOT public.has_active_manager_delegation_for_staff('00000000-0000-0000-0000-000000000903', 'review_flags'), 'delegated reviewer access expires on the prior Manila calendar date');
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 0, 'expired covering delegation cannot return a review queue');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000907', true);
SELECT is(jsonb_array_length(public.get_reviewer_flag_queue()), 0, 'former manager cannot see a former team member');
RESET ROLE;
UPDATE public.users
SET active = false
WHERE id = '00000000-0000-0000-0000-000000000901';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
SELECT throws_like($$ SELECT public.get_reviewer_flag_queue() $$, '%Reviewer access is required%', 'inactive manager cannot call reviewer queue');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000903', true);
SELECT throws_like($$ SELECT public.get_reviewer_flag_queue() $$, '%Reviewer access is required%', 'employee cannot call reviewer queue');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000905', true);
SELECT throws_like($$ SELECT public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE - 1) $$, '%Review date range must be between 1 and 366 days%', 'invalid review date range is rejected');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.get_reviewer_flag_queue(date,date)', 'EXECUTE'), 'anonymous callers cannot execute reviewer queue');
SELECT * FROM finish();
ROLLBACK;
