-- Restricted reviewer queue. Raw attendance evidence remains Admin-only.

-- Use positional parameters so delegation checks cannot accidentally compare a
-- table column to itself when a parameter shares the same name.
CREATE OR REPLACE FUNCTION public.has_active_manager_delegation_for_staff(
  staff_user_id uuid,
  required_capability public.manager_delegation_capability
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.manager_delegations
    JOIN public.manager_delegation_capabilities
      ON manager_delegation_capabilities.manager_delegation_id = manager_delegations.id
    JOIN public.manager_staff_assignments
      ON manager_staff_assignments.manager_id = manager_delegations.original_manager_id
    WHERE manager_delegations.covering_manager_id = auth.uid()
      AND manager_delegation_capabilities.capability = $2
      AND manager_delegations.revoked_at IS NULL
      AND manager_delegations.effective_from <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND manager_delegations.effective_to >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND manager_staff_assignments.staff_user_id = $1
      AND manager_staff_assignments.effective_from <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND (
        manager_staff_assignments.effective_to IS NULL
        OR manager_staff_assignments.effective_to >= (now() AT TIME ZONE 'Asia/Manila')::date
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_manager_delegation_for_assignment(
  staff_user_id uuid,
  target_manager_id uuid,
  required_capability public.manager_delegation_capability
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.manager_delegations
    JOIN public.manager_delegation_capabilities
      ON manager_delegation_capabilities.manager_delegation_id = manager_delegations.id
    JOIN public.manager_staff_assignments
      ON manager_staff_assignments.manager_id = manager_delegations.original_manager_id
    WHERE manager_delegations.covering_manager_id = auth.uid()
      AND manager_delegations.original_manager_id = $2
      AND manager_delegation_capabilities.capability = $3
      AND manager_delegations.revoked_at IS NULL
      AND manager_delegations.effective_from <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND manager_delegations.effective_to >= (now() AT TIME ZONE 'Asia/Manila')::date
      AND manager_staff_assignments.staff_user_id = $1
      AND manager_staff_assignments.effective_from <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND (
        manager_staff_assignments.effective_to IS NULL
        OR manager_staff_assignments.effective_to >= (now() AT TIME ZONE 'Asia/Manila')::date
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_reviewer_flag_queue(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_from date := COALESCE(p_from, v_today - 29);
  v_to date := COALESCE(p_to, v_today);
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR v_role NOT IN ('manager', 'hr', 'admin') THEN
    RAISE EXCEPTION 'Reviewer access is required.';
  END IF;
  IF v_from > v_to OR v_to - v_from > 365 THEN
    RAISE EXCEPTION 'Review date range must be between 1 and 366 days.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(payload ORDER BY work_date DESC, captured_at DESC, flag_id)
    FROM (
      SELECT
        sessions.work_date,
        events.captured_at_local AS captured_at,
        flags.id AS flag_id,
        jsonb_build_object(
          'flagId', flags.id,
          'sessionId', sessions.id,
          'employeeId', accounts.id,
          'employeeName', accounts.name,
          'workDate', sessions.work_date,
          'sessionType', sessions.session_type,
          'eventType', events.event_type,
          'capturedAtLocal', events.captured_at_local,
          'offlineDeclared', events.offline_declared,
          'validationStatus', events.validation_status,
          'flagType', flags.flag_type,
          'severity', flags.severity,
          'workflowMode', flags.workflow_mode,
          'reviewState', COALESCE(latest_review.decision::text, 'needs_review'),
          'reviewedAt', latest_review.created_at
        ) AS payload
      FROM public.attendance_flags AS flags
      JOIN public.attendance_sessions AS sessions ON sessions.id = flags.session_id
      LEFT JOIN public.attendance_events AS events ON events.id = flags.attendance_event_id
      JOIN public.users AS accounts ON accounts.id = flags.user_id
      LEFT JOIN LATERAL (
        SELECT decision, created_at
        FROM public.attendance_flag_reviews
        WHERE attendance_flag_id = flags.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) AS latest_review ON true
      WHERE sessions.work_date BETWEEN v_from AND v_to
        AND (
          v_role IN ('hr', 'admin')
          OR (
            v_role = 'manager'
            AND (
              EXISTS (
                SELECT 1 FROM public.manager_staff_assignments AS assignment
                WHERE assignment.manager_id = auth.uid()
                  AND assignment.staff_user_id = flags.user_id
                  AND assignment.effective_from <= v_today
                  AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_today)
              )
              OR public.has_active_manager_delegation_for_staff(flags.user_id, 'review_flags')
            )
          )
        )
    ) AS queue
  ), '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_reviewer_flag_queue(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reviewer_flag_queue(date, date) TO authenticated;

COMMENT ON FUNCTION public.get_reviewer_flag_queue(date, date) IS
  'Safe Manager/HR/Admin reviewer queue. Defaults to the last 30 Asia/Manila calendar days. It deliberately excludes coordinates, location identifiers, raw flag evidence, photo paths/metadata, and reviewer remarks.';
