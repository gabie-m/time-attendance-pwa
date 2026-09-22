BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

INSERT INTO auth.users (id, email, role, aud, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000001001', 'review-manager@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000001002', 'review-hr@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000001003', 'review-admin@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000001004', 'review-staff-a@example.com', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-000000001005', 'review-staff-b@example.com', 'authenticated', 'authenticated', now(), now());
INSERT INTO public.users (id, name, email, role, active, location_consent_given_at) VALUES
  ('00000000-0000-0000-0000-000000001001', 'Review Manager', 'review-manager@example.com', 'manager', true, now()),
  ('00000000-0000-0000-0000-000000001002', 'Review HR', 'review-hr@example.com', 'hr', true, now()),
  ('00000000-0000-0000-0000-000000001003', 'Review Admin', 'review-admin@example.com', 'admin', true, now()),
  ('00000000-0000-0000-0000-000000001004', 'Review Staff A', 'review-staff-a@example.com', 'employee', true, now()),
  ('00000000-0000-0000-0000-000000001005', 'Review Staff B', 'review-staff-b@example.com', 'employee', true, now());
INSERT INTO public.staff_profiles (user_id, employee_code, staff_type, default_attendance_model, attendance_purpose, location_access, timezone) VALUES
  ('00000000-0000-0000-0000-000000001004', 'REVIEW-A', 'stationary', 'stationary', 'payroll', 'restricted', 'Asia/Manila'),
  ('00000000-0000-0000-0000-000000001005', 'REVIEW-B', 'stationary', 'stationary', 'payroll', 'restricted', 'Asia/Manila');
INSERT INTO public.attendance_sessions (id, user_id, session_type, work_date, status) VALUES
  ('00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001004', 'stationary_day', CURRENT_DATE, 'needs_review'),
  ('00000000-0000-0000-0000-000000001012', '00000000-0000-0000-0000-000000001005', 'stationary_day', CURRENT_DATE, 'needs_review');
INSERT INTO public.attendance_flags (id, session_id, user_id, flag_type, severity, workflow_mode, workflow_effective_from) VALUES
  ('00000000-0000-0000-0000-000000001021', '00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001004', 'gps_low_accuracy', 'warning', 'manager_review_admin_observe', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000001022', '00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001004', 'outside_radius', 'high', 'manager_preapprove_admin_final', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000001023', '00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001004', 'offline_submission', 'warning', 'manager_view_admin_approve', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000001024', '00000000-0000-0000-0000-000000001012', '00000000-0000-0000-0000-000000001005', 'gps_low_accuracy', 'warning', 'manager_review_admin_observe', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000001025', '00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001004', 'outside_radius', 'high', 'manager_preapprove_admin_final', CURRENT_DATE);
INSERT INTO public.manager_staff_assignments (manager_id, staff_user_id, effective_from) VALUES
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001004', (now() AT TIME ZONE 'Asia/Manila')::date);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001001', true);
SELECT is((public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001021', 'approved', 'Confirmed through store call.') ->> 'stage'), 'manager', 'manager can make a terminal decision for a current-team flag at the manager stage');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001023', 'approved', 'Attempted visibility-only review.') $$, '%final HR or Admin decision%', 'manager cannot decide a visibility-only flag');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', 'Attempted out-of-team review.') $$, '%active review access%', 'manager cannot decide an out-of-team flag');
SELECT lives_ok($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001022', 'pre_approved', 'Manager recommendation.') $$, 'manager can make the configured pre-approval');
SELECT ok((SELECT entry ->> 'reviewState' = 'manager_reviewed' AND entry -> 'reviewedAt' = 'null'::jsonb AND NOT (entry ? 'managerReview') FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001022'), 'manager queue omits the restricted recommendation decision, timestamp, identity, and remarks');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
SELECT is((SELECT entry ->> 'reviewState' FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001022'), 'manager_pre_approved', 'HR sees a stage-aware manager recommendation rather than a final decision');
SELECT is((SELECT (entry -> 'managerReview') - 'reviewedAt' FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001022'), jsonb_build_object('reviewerName', 'Review Manager', 'decision', 'pre_approved', 'remarks', 'Manager recommendation.'), 'HR receives the manager identity and remarks needed for final review');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001001', true);
SELECT lives_ok($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001025', 'rejected', 'Manager recommends rejection.') $$, 'manager can recommend rejection for a final-review workflow');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
SELECT is((SELECT entry ->> 'reviewState' FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001025'), 'manager_rejected', 'HR can distinguish a manager rejection recommendation from a final rejection');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001003', true);
SELECT is((SELECT (entry -> 'managerReview') - 'reviewedAt' FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001025'), jsonb_build_object('reviewerName', 'Review Manager', 'decision', 'rejected', 'remarks', 'Manager recommends rejection.'), 'Admin receives the manager context needed for final review');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
SELECT lives_ok($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001022', 'approved', 'HR final approval.') $$, 'HR can make final decision after manager recommendation');
SELECT is((SELECT entry ->> 'reviewState' FROM jsonb_array_elements(public.get_reviewer_flag_queue(CURRENT_DATE, CURRENT_DATE)) AS entry WHERE entry ->> 'flagId' = '00000000-0000-0000-0000-000000001022'), 'approved', 'final HR decision takes precedence over a manager recommendation in the queue');
RESET ROLE;
SELECT is((SELECT actor_user_id FROM public.attendance_flag_reviews WHERE attendance_flag_id = '00000000-0000-0000-0000-000000001022' AND stage = 'admin'), '00000000-0000-0000-0000-000000001002'::uuid, 'HR identity is retained on final review');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001002', true);
SELECT lives_ok($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001023', 'resolved', 'HR resolved direct-final workflow.') $$, 'HR can resolve a direct final-review flag');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001021', 'approved', 'Attempted duplicate terminal review.') $$, '%terminal manager decision%', 'HR cannot override a manager-terminal workflow');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001003', true);
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001023', 'approved', 'Attempted duplicate final review.') $$, '%final HR or Admin decision%', 'Admin cannot duplicate an HR final decision');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', '   ') $$, '%requires a flag, decision, and remarks%', 'remarks are required');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', E'\t\n') $$, '%requires a flag, decision, and remarks%', 'tab and newline-only remarks are required');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', U&'\200B') $$, '%requires a flag, decision, and remarks%', 'zero-width-space-only remarks are required');
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', U&'\FEFF') $$, '%requires a flag, decision, and remarks%', 'byte-order-mark-only remarks are required');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001004', true);
SELECT throws_like($$ SELECT public.submit_attendance_flag_review('00000000-0000-0000-0000-000000001024', 'approved', 'Employee attempt.') $$, '%Reviewer access is required%', 'employee cannot submit a review');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.submit_attendance_flag_review(uuid, flag_review_decision, text)', 'EXECUTE'), 'anonymous callers cannot execute review action');
SELECT ok(NOT has_function_privilege('service_role', 'public.submit_attendance_flag_review(uuid, flag_review_decision, text)', 'EXECUTE'), 'service role cannot execute review action');
SELECT * FROM finish();
ROLLBACK;
