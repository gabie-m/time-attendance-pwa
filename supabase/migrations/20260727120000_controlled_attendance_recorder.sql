-- Create the first controlled attendance write boundary. Authenticated clients
-- may call this function, but may not write sessions, events, or flags directly.

CREATE OR REPLACE FUNCTION public.restrict_attendance_session_user_updates()
RETURNS TRIGGER AS $$
BEGIN
  IF public.current_user_role() = 'admin' THEN
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
    OR NEW.status NOT IN ('closed', 'needs_review')
  THEN
    RAISE EXCEPTION 'Users may only complete an open attendance session.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_attendance_event(
  p_client_event_id uuid,
  p_event_type public.event_type,
  p_captured_at_local timestamptz,
  p_location_id uuid,
  p_session_id uuid DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_gps_accuracy_meters numeric DEFAULT NULL,
  p_offline_declared boolean DEFAULT false,
  p_offline_evidence jsonb DEFAULT '{}'::jsonb,
  p_photo_path text DEFAULT NULL,
  p_photo_metadata jsonb DEFAULT '{}'::jsonb,
  p_photo_captured_at timestamptz DEFAULT NULL,
  p_gps_warning_acknowledged boolean DEFAULT false,
  p_missing_photo_acknowledged boolean DEFAULT false,
  p_short_gap_acknowledged boolean DEFAULT false
)
RETURNS TABLE (
  recorded_event_id uuid,
  recorded_session_id uuid,
  recorded_event_type public.event_type,
  recorded_session_type public.session_type,
  recorded_work_date date,
  recorded_session_status public.session_status,
  recorded_validation_status public.validation_status,
  recorded_flag_types public.flag_type[],
  recorded_received_at_server timestamptz,
  idempotent_replay boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_account public.users%ROWTYPE;
  v_profile public.staff_profiles%ROWTYPE;
  v_location public.locations%ROWTYPE;
  v_session public.attendance_sessions%ROWTYPE;
  v_existing_event public.attendance_events%ROWTYPE;
  v_event public.attendance_events%ROWTYPE;
  v_expected_event_type public.event_type;
  v_previous_event public.attendance_events%ROWTYPE;
  v_work_date date;
  v_session_type public.session_type;
  v_session_status public.session_status;
  v_validation_status public.validation_status := 'normal'::public.validation_status;
  v_flag_types public.flag_type[] := ARRAY[]::public.flag_type[];
  v_offline_evidence jsonb := COALESCE(p_offline_evidence, '{}'::jsonb);
  v_photo_metadata jsonb := COALESCE(p_photo_metadata, '{}'::jsonb);
  v_photo_path text := NULLIF(btrim(p_photo_path), '');
  v_photo_path_rejected boolean := false;
  v_expected_photo_path text;
  v_purpose text := NULLIF(btrim(p_purpose), '');
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_gps_accuracy_meters numeric(10, 2);
  v_confirmations jsonb;
  v_validation_evidence jsonb;
  v_distance_meters numeric;
  v_gps_issue text;
  v_gps_threshold numeric;
  v_clock_threshold_minutes numeric;
  v_photo_threshold_minutes numeric;
  v_short_gap_threshold_minutes numeric;
  v_gap_seconds numeric;
  v_clock_delta_seconds numeric;
  v_photo_delta_seconds numeric;
  v_is_short_gap boolean := false;
  v_is_required_photo boolean;
  v_is_deactivated_record boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to record attendance.';
  END IF;

  IF p_client_event_id IS NULL
    OR p_event_type IS NULL
    OR p_captured_at_local IS NULL
    OR NOT isfinite(p_captured_at_local)
    OR p_location_id IS NULL
  THEN
    RAISE EXCEPTION 'Attendance payload is missing required information.';
  END IF;

  IF jsonb_typeof(v_offline_evidence) <> 'object'
    OR jsonb_typeof(v_photo_metadata) <> 'object'
  THEN
    RAISE EXCEPTION 'Attendance evidence must use object values.';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR p_latitude::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_longitude::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_gps_accuracy_meters::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_latitude NOT BETWEEN -90 AND 90
    OR p_longitude NOT BETWEEN -180 AND 180
    OR p_gps_accuracy_meters < 0
    OR p_gps_accuracy_meters > 99999999.99
    OR (p_gps_accuracy_meters IS NOT NULL AND p_latitude IS NULL)
    OR (p_latitude IS NOT NULL AND p_gps_accuracy_meters IS NULL)
  THEN
    RAISE EXCEPTION 'GPS evidence is malformed.';
  END IF;

  v_latitude := p_latitude;
  v_longitude := p_longitude;
  v_gps_accuracy_meters := p_gps_accuracy_meters;

  IF v_photo_path IS NOT NULL AND v_photo_path ~* '^https?://' THEN
    v_photo_metadata := v_photo_metadata || jsonb_build_object(
      'rejected_photo_path_reason', 'public_url'
    );
    v_photo_path := NULL;
    v_photo_path_rejected := true;
  END IF;

  IF p_photo_captured_at IS NOT NULL THEN
    IF NOT isfinite(p_photo_captured_at) THEN
      RAISE EXCEPTION 'Photo capture evidence is malformed.';
    END IF;
  END IF;

  v_confirmations := jsonb_build_object(
    'gps_warning_acknowledged', COALESCE(p_gps_warning_acknowledged, false),
    'missing_photo_acknowledged', COALESCE(p_missing_photo_acknowledged, false),
    'short_gap_acknowledged', COALESCE(p_short_gap_acknowledged, false)
  );

  -- Serialize attendance state transitions per user, including idempotent
  -- retries and duplicate-session checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT events.*
  INTO v_existing_event
  FROM public.attendance_events AS events
  WHERE events.user_id = v_user_id
    AND events.client_event_id = p_client_event_id;

  IF FOUND THEN
    SELECT sessions.*
    INTO v_session
    FROM public.attendance_sessions AS sessions
    WHERE sessions.id = v_existing_event.session_id;

    v_expected_photo_path := format(
      'users/%s/%s/%s/%s.jpg',
      v_user_id,
      v_session.work_date,
      v_session.id,
      p_client_event_id
    );

    IF v_photo_path IS NOT NULL
      AND v_photo_path IS DISTINCT FROM v_expected_photo_path
    THEN
      v_photo_metadata := v_photo_metadata || jsonb_build_object(
        'rejected_photo_path_reason', 'non_canonical_or_wrong_owner'
      );
      v_photo_path := NULL;
      v_photo_path_rejected := true;
    END IF;

    IF p_photo_captured_at IS NOT NULL THEN
      IF v_photo_path IS NULL THEN
        IF v_photo_path_rejected THEN
          v_photo_metadata := v_photo_metadata || jsonb_build_object(
            'rejected_photo_captured_at', p_photo_captured_at
          );
        ELSE
          RAISE EXCEPTION 'Photo capture evidence is malformed.';
        END IF;
      ELSE
        v_photo_metadata := v_photo_metadata || jsonb_build_object(
          'captured_at', p_photo_captured_at
        );
      END IF;
    END IF;

    IF v_existing_event.event_type IS DISTINCT FROM p_event_type
      OR v_existing_event.captured_at_local IS DISTINCT FROM p_captured_at_local
      OR v_existing_event.location_id IS DISTINCT FROM p_location_id
      OR v_existing_event.latitude IS DISTINCT FROM v_latitude
      OR v_existing_event.longitude IS DISTINCT FROM v_longitude
      OR v_existing_event.gps_accuracy_meters IS DISTINCT FROM v_gps_accuracy_meters
      OR v_existing_event.offline_declared IS DISTINCT FROM COALESCE(p_offline_declared, false)
      OR v_existing_event.offline_evidence IS DISTINCT FROM v_offline_evidence
      OR v_existing_event.photo_path IS DISTINCT FROM v_photo_path
      OR v_existing_event.photo_metadata IS DISTINCT FROM v_photo_metadata
      OR v_existing_event.validation_evidence -> 'confirmations' IS DISTINCT FROM v_confirmations
      OR (
        p_event_type IN ('time_in', 'visit_in')
        AND p_session_id IS NOT NULL
        AND v_existing_event.session_id IS DISTINCT FROM p_session_id
      )
      OR (
        p_event_type NOT IN ('time_in', 'visit_in')
        AND v_existing_event.session_id IS DISTINCT FROM p_session_id
      )
      OR (
        p_event_type IN ('time_in', 'visit_in')
        AND v_session.purpose IS DISTINCT FROM
          CASE
            WHEN p_event_type = 'visit_in' THEN v_purpose
            ELSE v_session.purpose
          END
      )
    THEN
      RAISE EXCEPTION 'This attendance action conflicts with a previously submitted record.';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_event.id,
      v_session.id,
      v_existing_event.event_type,
      v_session.session_type,
      v_session.work_date,
      v_session.status,
      v_existing_event.validation_status,
      COALESCE(
        (
          SELECT array_agg(
            flags.flag_type
            ORDER BY
              CASE flags.flag_type
                WHEN 'outside_radius' THEN 1
                WHEN 'gps_low_accuracy' THEN 2
                WHEN 'offline_submission' THEN 3
                WHEN 'late_sync' THEN 4
                WHEN 'clock_discrepancy' THEN 5
                WHEN 'missing_photo' THEN 6
                WHEN 'photo_time_mismatch' THEN 7
                WHEN 'location_conflict' THEN 8
                WHEN 'deactivated_user_record' THEN 9
                ELSE 10
              END,
              flags.flag_type
          )
          FROM public.attendance_flags AS flags
          WHERE flags.attendance_event_id = v_existing_event.id
        ),
        ARRAY[]::public.flag_type[]
      ),
      v_existing_event.received_at_server,
      true;
    RETURN;
  END IF;

  SELECT accounts.*
  INTO v_account
  FROM public.users AS accounts
  WHERE accounts.id = v_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your attendance account is unavailable.';
  END IF;

  IF v_account.location_consent_given_at IS NULL THEN
    RAISE EXCEPTION 'Please accept location consent before recording attendance.';
  END IF;

  IF v_account.active = false THEN
    IF v_account.deactivated_at IS NULL
      OR p_captured_at_local > v_account.deactivated_at
    THEN
      RAISE EXCEPTION 'This attendance action was captured after your account was deactivated.';
    END IF;

    v_is_deactivated_record := true;
  END IF;

  SELECT profiles.*
  INTO v_profile
  FROM public.staff_profiles AS profiles
  WHERE profiles.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your staff profile is incomplete. Ask an administrator to finish setup.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = v_profile.timezone
  ) THEN
    RAISE EXCEPTION 'Your staff profile timezone is invalid. Ask an administrator to correct it.';
  END IF;

  IF p_event_type = 'gps_ping' THEN
    RAISE EXCEPTION 'GPS ping recording is not available yet.';
  ELSIF p_event_type IN ('time_in', 'lunch_out', 'lunch_in', 'time_out') THEN
    v_session_type := 'stationary_day';
    IF v_profile.default_attendance_model <> 'stationary' THEN
      RAISE EXCEPTION 'Your staff profile is not authorized for stationary attendance.';
    END IF;
  ELSE
    v_session_type := 'field_visit';
    IF v_profile.default_attendance_model <> 'roving' THEN
      RAISE EXCEPTION 'Your staff profile is not authorized for roving attendance.';
    END IF;
  END IF;

  IF p_event_type IN ('time_in', 'visit_in') THEN
    IF p_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.attendance_sessions AS sessions
        WHERE sessions.id = p_session_id
      )
    THEN
      RAISE EXCEPTION 'A new attendance session cannot reuse an existing session id.';
    END IF;

    v_work_date := (p_captured_at_local AT TIME ZONE v_profile.timezone)::date;

    IF p_event_type = 'time_in' THEN
      SELECT sessions.*
      INTO v_session
      FROM public.attendance_sessions AS sessions
      WHERE sessions.user_id = v_user_id
        AND sessions.session_type = 'stationary_day'
        AND sessions.work_date = v_work_date
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'A session for this date already exists.';
      END IF;
    ELSE
      IF v_purpose IS NULL THEN
        RAISE EXCEPTION 'Select a visit purpose before starting attendance.';
      END IF;

      SELECT sessions.*
      INTO v_session
      FROM public.attendance_sessions AS sessions
      WHERE sessions.user_id = v_user_id
        AND sessions.session_type = 'field_visit'
        AND sessions.status = 'open'
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'Close your current visit before starting a new one.';
      END IF;
    END IF;
  ELSE
    IF p_session_id IS NULL THEN
      IF p_event_type = 'visit_out' THEN
        RAISE EXCEPTION 'Select the open visit before recording Visit Out.';
      END IF;

      RAISE EXCEPTION 'Select the attendance session before recording this action.';
    END IF;

    SELECT sessions.*
    INTO v_session
    FROM public.attendance_sessions AS sessions
    WHERE sessions.id = p_session_id
      AND sessions.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected attendance session is unavailable.';
    END IF;

    IF v_session.session_type <> v_session_type THEN
      RAISE EXCEPTION 'This attendance action does not match the selected session.';
    END IF;

    IF v_session.status <> 'open' THEN
      RAISE EXCEPTION 'This attendance session is already closed.';
    END IF;

    IF p_event_type = 'visit_out'
      AND v_session.selected_location_id IS DISTINCT FROM p_location_id
    THEN
      RAISE EXCEPTION 'Visit Out must use the location selected for the open visit.';
    END IF;

    v_work_date := v_session.work_date;
  END IF;

  SELECT locations.*
  INTO v_location
  FROM public.locations AS locations
  WHERE locations.id = p_location_id
    AND locations.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected attendance location is unavailable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_location_assignments AS assignments
    WHERE assignments.user_id = v_user_id
      AND assignments.location_id = p_location_id
      AND assignments.effective_from <= v_work_date
      AND (
        assignments.effective_to IS NULL
        OR assignments.effective_to >= v_work_date
      )
  ) THEN
    RAISE EXCEPTION 'This location is not assigned to you for this attendance date.';
  END IF;

  IF p_event_type IN ('time_in', 'visit_in') THEN
    INSERT INTO public.attendance_sessions (
      id,
      user_id,
      session_type,
      work_date,
      selected_location_id,
      purpose,
      status
    ) VALUES (
      COALESCE(p_session_id, gen_random_uuid()),
      v_user_id,
      v_session_type,
      v_work_date,
      p_location_id,
      CASE
        WHEN p_event_type = 'visit_in' THEN v_purpose
        ELSE v_profile.attendance_purpose::text
      END,
      'open'
    )
    RETURNING * INTO v_session;
  END IF;

  v_expected_photo_path := format(
    'users/%s/%s/%s/%s.jpg',
    v_user_id,
    v_work_date,
    v_session.id,
    p_client_event_id
  );

  IF v_photo_path IS NOT NULL
    AND v_photo_path IS DISTINCT FROM v_expected_photo_path
  THEN
    v_photo_metadata := v_photo_metadata || jsonb_build_object(
      'rejected_photo_path_reason', 'non_canonical_or_wrong_owner'
    );
    v_photo_path := NULL;
    v_photo_path_rejected := true;
  END IF;

  IF p_photo_captured_at IS NOT NULL THEN
    IF v_photo_path IS NULL THEN
      IF v_photo_path_rejected THEN
        v_photo_metadata := v_photo_metadata || jsonb_build_object(
          'rejected_photo_captured_at', p_photo_captured_at
        );
      ELSE
        RAISE EXCEPTION 'Photo capture evidence is malformed.';
      END IF;
    ELSE
      v_photo_metadata := v_photo_metadata || jsonb_build_object(
        'captured_at', p_photo_captured_at
      );
    END IF;
  END IF;

  IF p_event_type NOT IN ('time_in', 'visit_in') THEN
    v_expected_event_type := CASE p_event_type
      WHEN 'lunch_out' THEN 'time_in'::public.event_type
      WHEN 'lunch_in' THEN 'lunch_out'::public.event_type
      WHEN 'time_out' THEN 'lunch_in'::public.event_type
      WHEN 'visit_out' THEN 'visit_in'::public.event_type
    END;

    IF (
      p_event_type = 'lunch_out'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type = 'time_in'
        )
        OR EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type IN ('lunch_out', 'lunch_in', 'time_out')
        )
      )
    ) OR (
      p_event_type = 'lunch_in'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type IN ('time_in', 'lunch_out')
          GROUP BY session_id
          HAVING count(DISTINCT event_type) = 2
        )
        OR EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type IN ('lunch_in', 'time_out')
        )
      )
    ) OR (
      p_event_type = 'time_out'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type IN ('time_in', 'lunch_out', 'lunch_in')
          GROUP BY session_id
          HAVING count(DISTINCT event_type) = 3
        )
        OR EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type = 'time_out'
        )
      )
    ) OR (
      p_event_type = 'visit_out'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type = 'visit_in'
        )
        OR EXISTS (
          SELECT 1
          FROM public.attendance_events
          WHERE session_id = v_session.id
            AND event_type = 'visit_out'
        )
      )
    ) THEN
      RAISE EXCEPTION 'This attendance action is out of order. Refresh and try again.';
    END IF;

    SELECT events.*
    INTO v_previous_event
    FROM public.attendance_events AS events
    WHERE events.session_id = v_session.id
      AND events.event_type = v_expected_event_type
    ORDER BY events.captured_at_local DESC, events.created_at DESC, events.id DESC
    LIMIT 1;

    v_gap_seconds := EXTRACT(EPOCH FROM p_captured_at_local - v_previous_event.captured_at_local);

    IF v_gap_seconds < 0 THEN
      RAISE EXCEPTION 'Attendance capture time cannot be earlier than the previous action.';
    END IF;

    SELECT (rules.rule_value #>> '{}')::numeric
    INTO v_short_gap_threshold_minutes
    FROM public.attendance_rules AS rules
    WHERE rules.rule_key = 'short_attendance_gap_confirmation_minutes'
      AND rules.effective_from <= v_work_date
      AND (rules.effective_to IS NULL OR rules.effective_to >= v_work_date)
    ORDER BY rules.effective_from DESC
    LIMIT 1;

    IF v_short_gap_threshold_minutes IS NULL
      OR v_short_gap_threshold_minutes < 0
    THEN
      RAISE EXCEPTION 'Attendance validation rules are unavailable.';
    END IF;

    v_is_short_gap := v_gap_seconds < v_short_gap_threshold_minutes * 60;

    IF v_is_short_gap AND NOT COALESCE(p_short_gap_acknowledged, false) THEN
      RAISE EXCEPTION 'Confirm the short time gap before submitting attendance.';
    END IF;
  END IF;

  IF v_latitude IS NULL THEN
    v_gps_issue := 'gps_unavailable';
  ELSE
    v_distance_meters := round(
      (
        6371000 * acos(
          LEAST(
            1.0,
            GREATEST(
              -1.0,
              sin(radians(v_latitude::double precision))
                * sin(radians(v_location.latitude::double precision))
              + cos(radians(v_latitude::double precision))
                * cos(radians(v_location.latitude::double precision))
                * cos(
                  radians(
                    v_longitude::double precision
                    - v_location.longitude::double precision
                  )
                )
            )
          )
        )
      )::numeric,
      2
    );

    IF v_distance_meters > v_location.allowed_radius_meters THEN
      v_gps_issue := 'outside_radius';
    END IF;
  END IF;

  IF v_gps_issue IS NOT NULL
    AND NOT COALESCE(p_gps_warning_acknowledged, false)
  THEN
    IF v_gps_issue = 'gps_unavailable' THEN
      RAISE EXCEPTION 'Confirm that GPS is unavailable before submitting attendance.';
    END IF;

    RAISE EXCEPTION 'Confirm that you are outside the allowed location radius before submitting attendance.';
  END IF;

  v_is_required_photo := p_event_type IN (
    'time_in',
    'time_out',
    'visit_in',
    'visit_out'
  );

  IF v_is_required_photo
    AND v_photo_path IS NULL
    AND NOT COALESCE(p_missing_photo_acknowledged, false)
  THEN
    RAISE EXCEPTION 'Confirm that no attendance photo is available before submitting.';
  END IF;

  SELECT (rules.rule_value #>> '{}')::numeric
  INTO v_gps_threshold
  FROM public.attendance_rules AS rules
  WHERE rules.rule_key = 'gps_low_accuracy_threshold_meters'
    AND rules.effective_from <= v_work_date
    AND (rules.effective_to IS NULL OR rules.effective_to >= v_work_date)
  ORDER BY rules.effective_from DESC
  LIMIT 1;

  IF v_gps_threshold IS NULL OR v_gps_threshold < 0 THEN
    RAISE EXCEPTION 'Attendance validation rules are unavailable.';
  END IF;

  IF NOT COALESCE(p_offline_declared, false) THEN
    SELECT (rules.rule_value #>> '{}')::numeric
    INTO v_clock_threshold_minutes
    FROM public.attendance_rules AS rules
    WHERE rules.rule_key = 'clock_discrepancy_threshold_minutes'
      AND rules.effective_from <= v_work_date
      AND (rules.effective_to IS NULL OR rules.effective_to >= v_work_date)
    ORDER BY rules.effective_from DESC
    LIMIT 1;

    IF v_clock_threshold_minutes IS NULL OR v_clock_threshold_minutes < 0 THEN
      RAISE EXCEPTION 'Attendance validation rules are unavailable.';
    END IF;
  END IF;

  IF p_photo_captured_at IS NOT NULL
    AND v_photo_path IS NOT NULL
  THEN
    SELECT (rules.rule_value #>> '{}')::numeric
    INTO v_photo_threshold_minutes
    FROM public.attendance_rules AS rules
    WHERE rules.rule_key = 'photo_time_mismatch_threshold_minutes'
      AND rules.effective_from <= v_work_date
      AND (rules.effective_to IS NULL OR rules.effective_to >= v_work_date)
    ORDER BY rules.effective_from DESC
    LIMIT 1;

    IF v_photo_threshold_minutes IS NULL OR v_photo_threshold_minutes < 0 THEN
      RAISE EXCEPTION 'Attendance validation rules are unavailable.';
    END IF;
  END IF;

  IF v_gps_issue IS NOT NULL THEN
    v_flag_types := array_append(v_flag_types, 'outside_radius');
  END IF;

  IF v_gps_accuracy_meters IS NOT NULL
    AND v_gps_accuracy_meters > v_gps_threshold
  THEN
    v_flag_types := array_append(v_flag_types, 'gps_low_accuracy');
  END IF;

  IF COALESCE(p_offline_declared, false) THEN
    v_flag_types := array_append(v_flag_types, 'offline_submission');
    IF now() - p_captured_at_local > interval '24 hours' THEN
      v_flag_types := array_append(v_flag_types, 'late_sync');
    END IF;
  ELSE
    v_clock_delta_seconds := abs(EXTRACT(EPOCH FROM now() - p_captured_at_local));
    IF v_clock_delta_seconds > v_clock_threshold_minutes * 60 THEN
      v_flag_types := array_append(v_flag_types, 'clock_discrepancy');
    END IF;
  END IF;

  IF v_is_required_photo AND v_photo_path IS NULL THEN
    v_flag_types := array_append(v_flag_types, 'missing_photo');
  END IF;

  IF p_photo_captured_at IS NOT NULL
    AND v_photo_path IS NOT NULL
  THEN
    v_photo_delta_seconds := abs(
      EXTRACT(EPOCH FROM p_photo_captured_at - p_captured_at_local)
    );
    IF v_photo_delta_seconds > v_photo_threshold_minutes * 60 THEN
      v_flag_types := array_append(v_flag_types, 'photo_time_mismatch');
    END IF;
  END IF;

  IF v_session.expected_location_id IS NOT NULL
    AND v_session.expected_location_id IS DISTINCT FROM p_location_id
  THEN
    v_flag_types := array_append(v_flag_types, 'location_conflict');
  END IF;

  IF v_is_deactivated_record THEN
    v_flag_types := array_append(v_flag_types, 'deactivated_user_record');
  END IF;

  IF cardinality(v_flag_types) > 0 THEN
    v_validation_status := 'flagged';
  ELSIF v_is_short_gap THEN
    v_validation_status := 'warning';
  END IF;

  v_validation_evidence := jsonb_build_object(
    'confirmations', v_confirmations,
    'gps_status', COALESCE(v_gps_issue, 'available'),
    'distance_meters', v_distance_meters,
    'allowed_radius_meters', v_location.allowed_radius_meters,
    'short_gap',
      CASE
        WHEN v_previous_event.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'gap_seconds', v_gap_seconds,
          'threshold_minutes', v_short_gap_threshold_minutes,
          'confirmation_required', v_is_short_gap
        )
      END
  );

  INSERT INTO public.attendance_events (
    session_id,
    user_id,
    client_event_id,
    event_type,
    captured_at_local,
    location_id,
    latitude,
    longitude,
    gps_accuracy_meters,
    gps_expires_at,
    offline_declared,
    offline_evidence,
    photo_path,
    photo_metadata,
    validation_status,
    validation_evidence
  ) VALUES (
    v_session.id,
    v_user_id,
    p_client_event_id,
    p_event_type,
    p_captured_at_local,
    p_location_id,
    v_latitude,
    v_longitude,
    v_gps_accuracy_meters,
    p_captured_at_local + interval '12 months',
    COALESCE(p_offline_declared, false),
    v_offline_evidence,
    v_photo_path,
    v_photo_metadata,
    v_validation_status,
    v_validation_evidence
  )
  RETURNING * INTO v_event;

  IF v_gps_issue IS NOT NULL THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'outside_radius',
      'warning',
      jsonb_build_object(
        'reason', v_gps_issue,
        'distance_meters', v_distance_meters,
        'allowed_radius_meters', v_location.allowed_radius_meters,
        'location_id', p_location_id
      ),
      'manager_review_admin_observe',
      v_work_date
    );
  END IF;

  IF v_gps_accuracy_meters IS NOT NULL
    AND v_gps_accuracy_meters > v_gps_threshold
  THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'gps_low_accuracy',
      'warning',
      jsonb_build_object(
        'gps_accuracy_meters', v_gps_accuracy_meters,
        'threshold_meters', v_gps_threshold
      ),
      'manager_review_admin_observe',
      v_work_date
    );
  END IF;

  IF COALESCE(p_offline_declared, false) THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'offline_submission',
      'warning',
      v_offline_evidence || jsonb_build_object(
        'captured_at_local', p_captured_at_local,
        'received_at_server', v_event.received_at_server
      ),
      'manager_review_admin_observe',
      v_work_date
    );
    IF v_event.received_at_server - p_captured_at_local > interval '24 hours' THEN
      INSERT INTO public.attendance_flags (
        session_id,
        attendance_event_id,
        user_id,
        flag_type,
        severity,
        evidence,
        workflow_mode,
        workflow_effective_from
      ) VALUES (
        v_session.id,
        v_event.id,
        v_user_id,
        'late_sync',
        'warning',
        jsonb_build_object(
          'delay_seconds',
            EXTRACT(EPOCH FROM v_event.received_at_server - p_captured_at_local),
          'captured_at_local', p_captured_at_local,
          'received_at_server', v_event.received_at_server
        ),
        'manager_review_admin_observe',
        v_work_date
      );
    END IF;
  ELSE
    IF v_clock_delta_seconds > v_clock_threshold_minutes * 60 THEN
      INSERT INTO public.attendance_flags (
        session_id,
        attendance_event_id,
        user_id,
        flag_type,
        severity,
        evidence,
        workflow_mode,
        workflow_effective_from
      ) VALUES (
        v_session.id,
        v_event.id,
        v_user_id,
        'clock_discrepancy',
        'high',
        jsonb_build_object(
          'delta_seconds', v_clock_delta_seconds,
          'threshold_minutes', v_clock_threshold_minutes,
          'captured_at_local', p_captured_at_local,
          'received_at_server', v_event.received_at_server
        ),
        'manager_review_admin_observe',
        v_work_date
      );
    END IF;
  END IF;

  IF v_is_required_photo AND v_photo_path IS NULL THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'missing_photo',
      'warning',
      jsonb_build_object('event_type', p_event_type),
      'manager_review_admin_observe',
      v_work_date
    );
  END IF;

  IF p_photo_captured_at IS NOT NULL
    AND v_photo_path IS NOT NULL
  THEN
    IF v_photo_delta_seconds > v_photo_threshold_minutes * 60 THEN
      INSERT INTO public.attendance_flags (
        session_id,
        attendance_event_id,
        user_id,
        flag_type,
        severity,
        evidence,
        workflow_mode,
        workflow_effective_from
      ) VALUES (
        v_session.id,
        v_event.id,
        v_user_id,
        'photo_time_mismatch',
        'warning',
        jsonb_build_object(
          'delta_seconds', v_photo_delta_seconds,
          'threshold_minutes', v_photo_threshold_minutes,
          'photo_captured_at', p_photo_captured_at,
          'attendance_captured_at', p_captured_at_local
        ),
        'manager_review_admin_observe',
        v_work_date
      );
    END IF;
  END IF;

  IF v_session.expected_location_id IS NOT NULL
    AND v_session.expected_location_id IS DISTINCT FROM p_location_id
  THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'location_conflict',
      'warning',
      jsonb_build_object(
        'expected_location_id', v_session.expected_location_id,
        'selected_location_id', p_location_id
      ),
      'manager_review_admin_observe',
      v_work_date
    );
  END IF;

  IF v_is_deactivated_record THEN
    INSERT INTO public.attendance_flags (
      session_id,
      attendance_event_id,
      user_id,
      flag_type,
      severity,
      evidence,
      workflow_mode,
      workflow_effective_from
    ) VALUES (
      v_session.id,
      v_event.id,
      v_user_id,
      'deactivated_user_record',
      'high',
      jsonb_build_object(
        'deactivated_at', v_account.deactivated_at,
        'captured_at_local', p_captured_at_local
      ),
      'manager_review_admin_observe',
      v_work_date
    );
  END IF;

  IF p_event_type IN ('time_out', 'visit_out') THEN
    UPDATE public.attendance_sessions
    SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.attendance_flags AS flags
        WHERE flags.session_id = v_session.id
      )
      THEN 'needs_review'::public.session_status
      ELSE 'closed'::public.session_status
    END
    WHERE id = v_session.id;

    SELECT sessions.status
    INTO v_session_status
    FROM public.attendance_sessions AS sessions
    WHERE sessions.id = v_session.id;
  ELSE
    v_session_status := v_session.status;
  END IF;

  RETURN QUERY
  SELECT
    v_event.id,
    v_session.id,
    v_event.event_type,
    v_session.session_type,
    v_session.work_date,
    v_session_status,
    v_validation_status,
    v_flag_types,
    v_event.received_at_server,
    false;
END;
$$;

COMMENT ON FUNCTION public.record_attendance_event(
  uuid,
  public.event_type,
  timestamptz,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  boolean,
  jsonb,
  text,
  jsonb,
  timestamptz,
  boolean,
  boolean,
  boolean
) IS
  'Authenticated transactional recorder for validated attendance sessions, immutable events, and workflow-snapshotted flags.';

COMMENT ON FUNCTION public.restrict_attendance_session_user_updates() IS
  'Restricts user-scoped session updates to completing an open session as closed or needs_review.';

REVOKE ALL PRIVILEGES ON TABLE public.attendance_sessions
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.attendance_events
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.attendance_flags
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.attendance_sessions TO authenticated;
GRANT SELECT ON TABLE public.attendance_events TO authenticated;
GRANT SELECT ON TABLE public.attendance_flags TO authenticated;
GRANT SELECT ON TABLE public.manager_staff_assignments TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.record_attendance_event(
  uuid,
  public.event_type,
  timestamptz,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  boolean,
  jsonb,
  text,
  jsonb,
  timestamptz,
  boolean,
  boolean,
  boolean
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.restrict_attendance_session_user_updates()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_attendance_event(
  uuid,
  public.event_type,
  timestamptz,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  boolean,
  jsonb,
  text,
  jsonb,
  timestamptz,
  boolean,
  boolean,
  boolean
) TO authenticated;
