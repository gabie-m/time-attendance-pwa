-- Harden account state, consent, session writes, schedule requests, and delegation visibility.

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT role
  FROM public.users
  WHERE id = auth.uid()
    AND active = true
$$;

CREATE OR REPLACE FUNCTION record_location_consent()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  consented_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to record location consent.';
  END IF;

  UPDATE public.users
  SET
    location_consent_given_at = COALESCE(location_consent_given_at, now()),
    updated_at = CASE
      WHEN location_consent_given_at IS NULL THEN now()
      ELSE updated_at
    END
  WHERE id = auth.uid()
    AND active = true
  RETURNING location_consent_given_at INTO consented_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active accounts can record location consent.';
  END IF;

  RETURN consented_at;
END;
$$;

CREATE OR REPLACE FUNCTION validate_schedule_change_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  schedule_day jsonb;
  payload_key text;
  requested_day_of_week integer;
  expected_location uuid;
  seen_days integer[] := ARRAY[]::integer[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL
      OR NEW.requesting_manager_id IS DISTINCT FROM auth.uid()
    THEN
      RAISE EXCEPTION 'Schedule change requester must match the current user.';
    END IF;

    IF current_user_role() IS DISTINCT FROM 'manager' THEN
      RAISE EXCEPTION 'Only active managers can submit schedule change requests.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.users
      WHERE id = NEW.requesting_manager_id
        AND role = 'manager'
        AND active = true
    ) THEN
      RAISE EXCEPTION 'Schedule change requester must be an active manager.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.users
      WHERE id = NEW.affected_user_id
        AND active = true
    ) THEN
      RAISE EXCEPTION 'Schedule change affected user must be active.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.manager_staff_assignments AS assignment
      WHERE assignment.manager_id = NEW.requesting_manager_id
        AND assignment.staff_user_id = NEW.affected_user_id
        AND assignment.effective_from <= NEW.requested_effective_from
        AND (
          assignment.effective_to IS NULL
          OR assignment.effective_to >= NEW.requested_effective_to
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.manager_delegations AS delegation
      JOIN public.manager_delegation_capabilities AS capability
        ON capability.manager_delegation_id = delegation.id
       AND capability.capability = 'manage_schedules'
      JOIN public.manager_staff_assignments AS assignment
        ON assignment.manager_id = delegation.original_manager_id
       AND assignment.staff_user_id = NEW.affected_user_id
      WHERE delegation.covering_manager_id = NEW.requesting_manager_id
        AND delegation.revoked_at IS NULL
        AND delegation.effective_from <= NEW.requested_effective_from
        AND delegation.effective_to >= NEW.requested_effective_to
        AND assignment.effective_from <= NEW.requested_effective_from
        AND (
          assignment.effective_to IS NULL
          OR assignment.effective_to >= NEW.requested_effective_to
        )
    ) THEN
      RAISE EXCEPTION 'Schedule change requester is not authorized for the affected user and effective dates.';
    END IF;

    IF NEW.status IS DISTINCT FROM 'pending'
      OR NEW.reviewed_by_admin_id IS NOT NULL
      OR NEW.reviewed_at IS NOT NULL
      OR NEW.reviewer_remarks IS NOT NULL
    THEN
      RAISE EXCEPTION 'Schedule change requests must be submitted as pending without review fields.';
    END IF;
  END IF;

  IF jsonb_typeof(NEW.proposed_schedule_days) <> 'array'
    OR jsonb_array_length(NEW.proposed_schedule_days) = 0
  THEN
    RAISE EXCEPTION 'Schedule change requests require at least one schedule day.';
  END IF;

  FOR schedule_day IN
    SELECT value
    FROM jsonb_array_elements(NEW.proposed_schedule_days)
  LOOP
    IF jsonb_typeof(schedule_day) <> 'object' THEN
      RAISE EXCEPTION 'Each proposed schedule day must be an object.';
    END IF;

    FOR payload_key IN
      SELECT jsonb_object_keys(schedule_day)
    LOOP
      IF payload_key NOT IN (
        'day_of_week',
        'expected_location_id',
        'shift_start',
        'shift_end',
        'lunch_minutes',
        'day_mode'
      ) THEN
        RAISE EXCEPTION 'Proposed schedule day contains unsupported field: %.', payload_key;
      END IF;
    END LOOP;

    IF jsonb_typeof(schedule_day -> 'day_of_week') <> 'number'
      OR schedule_day ->> 'day_of_week' !~ '^[1-7]$'
    THEN
      RAISE EXCEPTION 'Proposed schedule day_of_week must be an integer from 1 through 7.';
    END IF;

    requested_day_of_week := (schedule_day ->> 'day_of_week')::integer;
    IF requested_day_of_week = ANY (seen_days) THEN
      RAISE EXCEPTION 'Proposed schedule days cannot contain duplicate weekdays.';
    END IF;
    seen_days := array_append(seen_days, requested_day_of_week);

    IF schedule_day ? 'lunch_minutes'
      AND (
        jsonb_typeof(schedule_day -> 'lunch_minutes') <> 'number'
        OR schedule_day ->> 'lunch_minutes' !~ '^[0-9]+$'
      )
    THEN
      RAISE EXCEPTION 'Proposed lunch_minutes must be a non-negative integer.';
    END IF;

    IF schedule_day ? 'day_mode'
      AND (
        jsonb_typeof(schedule_day -> 'day_mode') <> 'string'
        OR schedule_day ->> 'day_mode' NOT IN ('office', 'field', 'off')
      )
    THEN
      RAISE EXCEPTION 'Proposed day_mode must be office, field, or off.';
    END IF;

    IF schedule_day ? 'shift_start'
      AND (
        jsonb_typeof(schedule_day -> 'shift_start') <> 'string'
        OR schedule_day ->> 'shift_start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]+)?)?$'
      )
    THEN
      RAISE EXCEPTION 'Proposed shift_start must be a valid time.';
    END IF;

    IF schedule_day ? 'shift_end'
      AND (
        jsonb_typeof(schedule_day -> 'shift_end') <> 'string'
        OR schedule_day ->> 'shift_end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]+)?)?$'
      )
    THEN
      RAISE EXCEPTION 'Proposed shift_end must be a valid time.';
    END IF;

    IF schedule_day ? 'expected_location_id'
      AND schedule_day -> 'expected_location_id' <> 'null'::jsonb
    THEN
      IF jsonb_typeof(schedule_day -> 'expected_location_id') <> 'string'
        OR schedule_day ->> 'expected_location_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        RAISE EXCEPTION 'Proposed expected_location_id must be a UUID or null.';
      END IF;

      expected_location := (schedule_day ->> 'expected_location_id')::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM public.locations
        WHERE id = expected_location
          AND active = true
      ) THEN
        RAISE EXCEPTION 'Proposed expected location must be active.';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM generate_series(
          NEW.requested_effective_from,
          NEW.requested_effective_to,
          interval '1 day'
        ) AS effective_date
        WHERE EXTRACT(ISODOW FROM effective_date)::integer = requested_day_of_week
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_location_assignments AS assignment
            JOIN public.locations AS location
              ON location.id = assignment.location_id
             AND location.active = true
            WHERE assignment.user_id = NEW.affected_user_id
              AND assignment.location_id = expected_location
              AND assignment.effective_from <= effective_date::date
              AND (
                assignment.effective_to IS NULL
                OR assignment.effective_to >= effective_date::date
              )
          )
      ) THEN
        RAISE EXCEPTION 'Proposed expected location must be actively assigned to the affected user on every relevant schedule date.';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_active_consented_attendance_session_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = NEW.user_id
      AND active = true
      AND location_consent_given_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Attendance sessions require an active user with recorded location consent.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_sessions_require_active_consented_user
BEFORE INSERT ON public.attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION require_active_consented_attendance_session_user();

DROP POLICY "Users can insert own attendance sessions" ON public.attendance_sessions;
DROP POLICY "Admins can insert attendance sessions" ON public.attendance_sessions;
DROP POLICY "Users can update own attendance session status" ON public.attendance_sessions;
DROP POLICY "Admins can update attendance sessions" ON public.attendance_sessions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.attendance_sessions FROM anon, authenticated;

DROP POLICY "Managers can select own manager delegation capabilities"
ON public.manager_delegation_capabilities;

CREATE POLICY "Covering managers can select active delegation capabilities"
ON public.manager_delegation_capabilities
FOR SELECT
TO authenticated
USING (
  current_user_role() = 'manager'
  AND EXISTS (
    SELECT 1
    FROM public.manager_delegations
    WHERE manager_delegations.id = manager_delegation_capabilities.manager_delegation_id
      AND manager_delegations.covering_manager_id = auth.uid()
      AND manager_delegations.revoked_at IS NULL
      AND manager_delegations.effective_from <= CURRENT_DATE
      AND manager_delegations.effective_to >= CURRENT_DATE
  )
);

REVOKE EXECUTE ON FUNCTION current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated;

REVOKE EXECUTE ON FUNCTION record_location_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_location_consent() TO authenticated;

REVOKE EXECUTE ON FUNCTION validate_schedule_change_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION require_active_consented_attendance_session_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION has_active_location_assignment(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_active_location_assignment(uuid, uuid, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION has_active_manager_delegation_for_staff(uuid, manager_delegation_capability) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_active_manager_delegation_for_staff(uuid, manager_delegation_capability) TO authenticated;

REVOKE EXECUTE ON FUNCTION has_active_manager_delegation_for_assignment(uuid, uuid, manager_delegation_capability) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_active_manager_delegation_for_assignment(uuid, uuid, manager_delegation_capability) TO authenticated;

REVOKE EXECUTE ON FUNCTION apply_schedule_correction(uuid, schedule_type, date, date, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_schedule_correction(uuid, schedule_type, date, date, jsonb, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION approve_schedule_change_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_schedule_change_request(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_schedule_change_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_schedule_change_request(uuid, text) TO authenticated;
