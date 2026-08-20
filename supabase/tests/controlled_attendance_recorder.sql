BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(56);

UPDATE public.attendance_rules
SET effective_from = CURRENT_DATE - 30;

INSERT INTO auth.users (
  id,
  email,
  role,
  aud,
  created_at,
  updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'stationary-recorder-test@example.com',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'roving-recorder-test@example.com',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    'no-consent-recorder-test@example.com',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000104',
    'no-profile-recorder-test@example.com',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000105',
    'history-review-manager-test@example.com',
    'authenticated',
    'authenticated',
    now(),
    now()
  );

INSERT INTO public.users (
  id,
  name,
  email,
  role,
  active,
  location_consent_given_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'Stationary Recorder Test',
    'stationary-recorder-test@example.com',
    'user',
    true,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'Roving Recorder Test',
    'roving-recorder-test@example.com',
    'user',
    true,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    'No Consent Recorder Test',
    'no-consent-recorder-test@example.com',
    'user',
    true,
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000000104',
    'No Profile Recorder Test',
    'no-profile-recorder-test@example.com',
    'user',
    true,
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000105',
    'History Review Manager Test',
    'history-review-manager-test@example.com',
    'manager',
    true,
    now()
  );

INSERT INTO public.staff_profiles (
  user_id,
  staff_type,
  default_attendance_model,
  attendance_purpose,
  location_access,
  employee_code,
  timezone
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'stationary',
    'stationary',
    'payroll',
    'restricted',
    'RECORDER-STATIONARY',
    'Asia/Manila'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'roving',
    'roving',
    'monitoring',
    'restricted',
    'RECORDER-ROVING',
    'Asia/Manila'
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    'stationary',
    'stationary',
    'payroll',
    'restricted',
    'RECORDER-NO-CONSENT',
    'Asia/Manila'
  );

INSERT INTO public.locations (
  id,
  name,
  address,
  latitude,
  longitude,
  allowed_radius_meters,
  active
) VALUES
  (
    '00000000-0000-0000-0000-000000000201',
    'Recorder Expected Location',
    'Expected address',
    14.000000,
    121.000000,
    150,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    'Recorder Alternate Location',
    'Alternate address',
    14.100000,
    121.100000,
    150,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000203',
    'Recorder Unassigned Location',
    'Unassigned address',
    14.200000,
    121.200000,
    150,
    true
  );

INSERT INTO public.user_location_assignments (
  user_id,
  location_id,
  assignment_type,
  effective_from
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000201',
    'primary',
    CURRENT_DATE - 30
  ),
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000202',
    'allowed',
    CURRENT_DATE - 30
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000201',
    'primary',
    CURRENT_DATE - 30
  );

INSERT INTO public.schedules (
  id,
  user_id,
  schedule_type,
  effective_from,
  active
) VALUES (
  '00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000101',
  'fixed',
  CURRENT_DATE - 30,
  true
);

INSERT INTO public.schedule_days (
  schedule_id,
  day_of_week,
  expected_location_id,
  shift_start,
  shift_end,
  lunch_minutes,
  day_mode
) VALUES (
  '00000000-0000-0000-0000-000000000211',
  EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Manila')::date)::integer,
  '00000000-0000-0000-0000-000000000201',
  '09:00',
  '18:00',
  60,
  'office'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.record_attendance_event(uuid,event_type,timestamptz,uuid,uuid,text,numeric,numeric,numeric,boolean,jsonb,text,jsonb,timestamptz,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated can execute only the controlled recorder write boundary'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.record_attendance_event(uuid,event_type,timestamptz,uuid,uuid,text,numeric,numeric,numeric,boolean,jsonb,text,jsonb,timestamptz,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the attendance recorder'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.record_attendance_event(uuid,event_type,timestamptz,uuid,uuid,text,numeric,numeric,numeric,boolean,jsonb,text,jsonb,timestamptz,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'service role has no direct grant on the user-scoped recorder'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.attendance_sessions', 'INSERT'),
  'authenticated cannot insert attendance sessions directly'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.attendance_events', 'INSERT'),
  'authenticated cannot insert attendance events directly'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.attendance_flags', 'INSERT'),
  'authenticated cannot insert attendance flags directly'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.attendance_sessions', 'SELECT'),
  'authenticated can select attendance sessions through RLS policies'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.manager_staff_assignments', 'SELECT'),
  'authenticated can evaluate manager assignment-backed RLS policies'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT has_table_privilege(role_name, table_name, privilege_name)
    )
    FROM (
      VALUES ('anon'), ('authenticated'), ('service_role')
    ) AS roles(role_name)
    CROSS JOIN (
      VALUES
        ('public.attendance_sessions'),
        ('public.attendance_events'),
        ('public.attendance_flags')
    ) AS tables(table_name)
    CROSS JOIN (
      VALUES
        ('INSERT'),
        ('UPDATE'),
        ('DELETE'),
        ('TRUNCATE'),
        ('REFERENCES'),
        ('TRIGGER'),
        ('MAINTAIN')
    ) AS privileges(privilege_name)
  ),
  'client roles retain no direct write, destructive, reference, trigger, or maintenance privileges on recorder-owned tables'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);

-- Employee direct SELECT is intentionally removed. The remaining recorder
-- assertions inspect immutable raw evidence as the test owner.
RESET ROLE;

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000290',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => NULL
    )
  $$,
  '%Attendance payload is missing required information.%',
  'missing required recorder payload is rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000291',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_latitude => 14.000000
    )
  $$,
  '%GPS evidence is malformed.%',
  'malformed GPS evidence is rejected'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103',
  true
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000292',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201'
    )
  $$,
  '%Please accept location consent before recording attendance.%',
  'missing location consent is rejected'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000104',
  true
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000293',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201'
    )
  $$,
  '%Your staff profile is incomplete.%',
  'missing staff profile is rejected'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000294',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000203'
    )
  $$,
  '%This location is not assigned to you for this attendance date.%',
  'an active but unauthorized location is rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000295',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_missing_photo_acknowledged => true
    )
  $$,
  '%Confirm that GPS is unavailable before submitting attendance.%',
  'missing GPS requires explicit user confirmation'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000296',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_latitude => 14.100000,
      p_longitude => 121.100000
    )
  $$,
  '%GPS evidence is malformed.%',
  'GPS coordinates without accuracy evidence are rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000297',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_latitude => 14.100000,
      p_longitude => 121.100000,
      p_gps_accuracy_meters => 20
    )
  $$,
  '%Confirm that no attendance photo is available before submitting.%',
  'missing required photo requires explicit user confirmation'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000301',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_gps_warning_acknowledged => true,
      p_missing_photo_acknowledged => true
    )
  $$,
  'stationary Time In accepts confirmed missing GPS and photo evidence'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.attendance_sessions
    WHERE user_id = auth.uid()
      AND session_type = 'stationary_day'
  ),
  1,
  'stationary Time In creates one day session'
);

SELECT is(
  (
    SELECT validation_status::text
    FROM public.attendance_events
    WHERE user_id = auth.uid()
      AND client_event_id = '00000000-0000-0000-0000-000000000301'
  ),
  'flagged',
  'the immutable event snapshots its final flagged validation status'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND attendance_event_id = (
        SELECT id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      )
  ),
  3,
  'missing GPS, missing photo, and alternate expected location create flags'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND (workflow_mode IS NULL OR workflow_effective_from IS NULL)
  ),
  'all recorder flags receive workflow snapshots'
);

SELECT is(
  public.get_my_attendance_history(30) ->> 'userId',
  auth.uid()::text,
  'employee history is always scoped to the authenticated user'
);

SELECT ok(
  NOT (
    public.get_my_attendance_history(30) #> '{days,0,sessions,0,events,0}'
    ?| ARRAY['latitude', 'longitude', 'photo_path', 'photoPath', 'validation_evidence', 'validationEvidence']
  ),
  'employee history omits precise GPS, photo paths, and validation evidence'
);

SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT count(*)
    FROM public.attendance_events
    WHERE user_id = auth.uid()
  ),
  0::bigint,
  'employees cannot directly select their raw attendance events'
);
RESET ROLE;

INSERT INTO public.attendance_sessions (
  id,
  user_id,
  session_type,
  work_date,
  status
) VALUES (
  '00000000-0000-0000-0000-000000000601',
  '00000000-0000-0000-0000-000000000104',
  'field_visit',
  CURRENT_DATE,
  'needs_review'
);

INSERT INTO public.manager_staff_assignments (
  manager_id,
  staff_user_id,
  effective_from
) VALUES (
  '00000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000104',
  CURRENT_DATE - 1
);

INSERT INTO public.attendance_flags (
  id,
  session_id,
  user_id,
  flag_type,
  severity
) VALUES (
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000601',
  '00000000-0000-0000-0000-000000000104',
  'missing_photo',
  'warning'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000105',
  true
);

INSERT INTO public.attendance_flag_reviews (
  attendance_flag_id,
  actor_user_id,
  stage,
  decision,
  remarks
) VALUES (
  '00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000105',
  'manager',
  'resolved',
  'Resolved for employee-history status test.'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000104',
  true
);

SELECT is(
  public.get_my_attendance_history(30) #>> '{days,0,outcome}',
  'resolved',
  'a final resolved flag changes the current day outcome without rewriting the session'
);

SELECT ok(
  NOT (public.get_my_attendance_history(30) #>> '{days,0,requiresReview}')::boolean,
  'a resolved-only day is not shown as awaiting review'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);

SELECT ok(
  (
    SELECT idempotent_replay
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000301',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_gps_warning_acknowledged => true,
      p_missing_photo_acknowledged => true
    )
  ),
  'an identical client event retry is idempotent'
);

SELECT is(
  (
    SELECT recorded_client_event_id
    FROM public.record_attendance_event_acknowledged(
      p_client_event_id => '00000000-0000-0000-0000-000000000301',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_gps_warning_acknowledged => true,
      p_missing_photo_acknowledged => true
    )
  ),
  '00000000-0000-0000-0000-000000000301'::uuid,
  'the acknowledgement wrapper echoes the exact client event id'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000301',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000202',
      p_gps_warning_acknowledged => true,
      p_missing_photo_acknowledged => false
    )
  $$,
  '%conflicts with a previously submitted record%',
  'reusing a client event id with different evidence is rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000302',
      p_event_type => 'time_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => 'users/101/time-in.jpg'
    )
  $$,
  '%A session for this date already exists.%',
  'a second stationary session on the same work date is rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000306',
      p_event_type => 'lunch_in',
      p_captured_at_local => now() + interval '1 minute',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_short_gap_acknowledged => true
    )
  $$,
  '%This attendance action is out of order.%',
  'out-of-order stationary action is rejected'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000307',
      p_event_type => 'lunch_out',
      p_captured_at_local => now() + interval '1 minute',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20
    )
  $$,
  '%Confirm the short time gap before submitting attendance.%',
  'short attendance gap requires explicit user confirmation'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000303',
      p_event_type => 'lunch_out',
      p_captured_at_local => now() + interval '1 minute',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_short_gap_acknowledged => true
    )
  $$,
  'Lunch Out accepts an acknowledged short gap'
);

SELECT is(
  (
    SELECT validation_status::text
    FROM public.attendance_events
    WHERE user_id = auth.uid()
      AND client_event_id = '00000000-0000-0000-0000-000000000303'
  ),
  'warning',
  'a confirmed short gap is preserved as warning evidence without inventing a flag type'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000304',
      p_event_type => 'lunch_in',
      p_captured_at_local => now() + interval '2 minutes',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_short_gap_acknowledged => true
    )
  $$,
  'Lunch In follows Lunch Out'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000305',
      p_event_type => 'time_out',
      p_captured_at_local => now() + interval '3 minutes',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000301'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => (
        SELECT format(
          'users/%s/%s/%s/%s.jpg',
          auth.uid(),
          sessions.work_date,
          sessions.id,
          '00000000-0000-0000-0000-000000000305'::uuid
        )
        FROM public.attendance_sessions AS sessions
        WHERE sessions.id = (
          SELECT session_id
          FROM public.attendance_events
          WHERE user_id = auth.uid()
            AND client_event_id = '00000000-0000-0000-0000-000000000301'
        )
      ),
      p_short_gap_acknowledged => true
    )
  $$,
  'Time Out follows Lunch In'
);

SELECT is(
  (
    SELECT status::text
    FROM public.attendance_sessions
    WHERE user_id = auth.uid()
      AND session_type = 'stationary_day'
  ),
  'needs_review',
  'Time Out marks a flagged completed stationary session as needing review'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102',
  true
);
RESET ROLE;

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000401',
      p_event_type => 'visit_out',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201'
    )
  $$,
  '%Select the open visit before recording Visit Out.%',
  'Visit Out requires a session id'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000402',
      p_event_type => 'visit_in',
      p_captured_at_local => now() - interval '10 minutes',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => '00000000-0000-0000-0000-000000000501',
      p_purpose => 'Recorder field test',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 150,
      p_photo_path => format(
        'users/%s/%s/%s/%s.jpg',
        auth.uid(),
        ((now() - interval '10 minutes') AT TIME ZONE 'Asia/Manila')::date,
        '00000000-0000-0000-0000-000000000501'::uuid,
        '00000000-0000-0000-0000-000000000402'::uuid
      ),
      p_photo_captured_at => now()
    )
  $$,
  'roving Visit In creates an open field visit'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND flag_type = 'clock_discrepancy'
  ),
  'online device time discrepancy creates a high-severity flag'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND flag_type = 'photo_time_mismatch'
  ),
  'photo capture time mismatch creates a flag'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND flag_type = 'gps_low_accuracy'
  ),
  'GPS accuracy beyond the configured threshold creates a flag'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000403',
      p_event_type => 'visit_in',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_purpose => 'Duplicate open visit',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => 'users/102/duplicate-visit.jpg'
    )
  $$,
  '%Close your current visit before starting a new one.%',
  'a second open field visit is rejected'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000404',
      p_event_type => 'visit_out',
      p_captured_at_local => now(),
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000402'
      ),
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => (
        SELECT format(
          'users/%s/%s/%s/%s.jpg',
          auth.uid(),
          sessions.work_date,
          sessions.id,
          '00000000-0000-0000-0000-000000000404'::uuid
        )
        FROM public.attendance_sessions AS sessions
        WHERE sessions.id = (
          SELECT session_id
          FROM public.attendance_events
          WHERE user_id = auth.uid()
            AND client_event_id = '00000000-0000-0000-0000-000000000402'
        )
      ),
      p_short_gap_acknowledged => true
    )
  $$,
  'Visit Out closes its selected field visit'
);

SELECT is(
  (
    SELECT status::text
    FROM public.attendance_sessions
    WHERE user_id = auth.uid()
      AND id = (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000402'
      )
  ),
  'needs_review',
  'the flagged roving field visit is marked as needing review'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000400',
      p_event_type => 'visit_in',
      p_captured_at_local => now() + interval '1 minute',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => '00000000-0000-0000-0000-000000000500',
      p_purpose => 'Recorder field test',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => 'users/102/wrong-owner.jpg'
    )
  $$,
  '%Confirm that no attendance photo is available before submitting.%',
  'non-canonical photo paths are treated as missing photo evidence'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000408',
      p_event_type => 'visit_in',
      p_captured_at_local => now() + interval '2 minutes',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => '00000000-0000-0000-0000-000000000508',
      p_purpose => 'Invalid photo evidence field test',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => 'https://example.com/not-private.jpg',
      p_photo_captured_at => now() + interval '20 minutes',
      p_missing_photo_acknowledged => true
    )
  $$,
  'invalid photo paths with timestamps follow the confirmed missing-photo evidence path'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_events AS events
    JOIN public.attendance_flags AS flags
      ON flags.attendance_event_id = events.id
    WHERE events.user_id = auth.uid()
      AND events.client_event_id = '00000000-0000-0000-0000-000000000408'
      AND events.photo_path IS NULL
      AND events.photo_metadata ->> 'rejected_photo_path_reason' = 'public_url'
      AND flags.flag_type = 'missing_photo'
      AND NOT EXISTS (
        SELECT 1
        FROM public.attendance_flags AS mismatch_flags
        WHERE mismatch_flags.attendance_event_id = events.id
          AND mismatch_flags.flag_type = 'photo_time_mismatch'
      )
  ),
  'invalid photo evidence is quarantined and creates only a missing-photo flag'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000409',
      p_event_type => 'visit_out',
      p_captured_at_local => now() + interval '3 minutes',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => '00000000-0000-0000-0000-000000000508',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_photo_path => format(
        'users/%s/%s/%s/%s.jpg',
        auth.uid(),
        ((now() + interval '2 minutes') AT TIME ZONE 'Asia/Manila')::date,
        '00000000-0000-0000-0000-000000000508'::uuid,
        '00000000-0000-0000-0000-000000000409'::uuid
      ),
      p_short_gap_acknowledged => true
    )
  $$,
  'invalid-photo regression visit is closed before the next recorder scenario'
);

RESET ROLE;
UPDATE public.users
SET active = false,
    deactivated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000102';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102',
  true
);
RESET ROLE;

SELECT lives_ok(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000405',
      p_event_type => 'visit_in',
      p_captured_at_local => now() - interval '25 hours',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_purpose => 'Offline pre-deactivation visit',
      p_latitude => 14.000000,
      p_longitude => 121.000000,
      p_gps_accuracy_meters => 20,
      p_session_id => '00000000-0000-0000-0000-000000000502',
      p_photo_path => format(
        'users/%s/%s/%s/%s.jpg',
        auth.uid(),
        ((now() - interval '25 hours') AT TIME ZONE 'Asia/Manila')::date,
        '00000000-0000-0000-0000-000000000502'::uuid,
        '00000000-0000-0000-0000-000000000405'::uuid
      ),
      p_offline_declared => true,
      p_offline_evidence => '{"queue": "dexie"}'::jsonb
    )
  $$,
  'an offline event captured before deactivation is accepted'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND attendance_event_id = (
        SELECT id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000405'
      )
      AND flag_type = 'offline_submission'
  ),
  'offline submission creates an audit flag'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND attendance_event_id = (
        SELECT id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000405'
      )
      AND flag_type = 'late_sync'
  ),
  'offline delay over 24 hours creates a late sync flag'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND attendance_event_id = (
        SELECT id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000405'
      )
      AND flag_type = 'deactivated_user_record'
  ),
  'accepted pre-deactivation evidence creates a deactivated-user flag'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.attendance_flags
    WHERE user_id = auth.uid()
      AND attendance_event_id = (
        SELECT id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000405'
      )
      AND flag_type = 'clock_discrepancy'
  ),
  'offline queue delay does not create a clock discrepancy flag'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.record_attendance_event(
      p_client_event_id => '00000000-0000-0000-0000-000000000406',
      p_event_type => 'visit_out',
      p_captured_at_local => now() + interval '1 second',
      p_location_id => '00000000-0000-0000-0000-000000000201',
      p_session_id => (
        SELECT session_id
        FROM public.attendance_events
        WHERE user_id = auth.uid()
          AND client_event_id = '00000000-0000-0000-0000-000000000405'
      )
    )
  $$,
  '%captured after your account was deactivated%',
  'attendance captured after deactivation is rejected'
);

SELECT * FROM finish();

ROLLBACK;
