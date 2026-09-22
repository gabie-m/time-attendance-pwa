-- Controlled, append-only flag review actions for Manager, HR, and Admin.

-- Require an actual visible remark, not merely spaces, tabs, or line breaks.
ALTER TABLE public.attendance_flag_reviews
  DROP CONSTRAINT attendance_flag_reviews_remarks_required;

ALTER TABLE public.attendance_flag_reviews
  ADD CONSTRAINT attendance_flag_reviews_remarks_required
  CHECK (remarks ~ '[[:graph:]]');

CREATE OR REPLACE FUNCTION public.validate_attendance_flag_review_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  flag_record public.attendance_flags%ROWTYPE;
  actor_role public.user_role;
  has_manager_access boolean;
  manager_review_count integer;
  final_review_count integer;
  manager_recommendation public.flag_review_decision;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  SELECT *
  INTO flag_record
  FROM public.attendance_flags
  WHERE id = NEW.attendance_flag_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance flag review requires an existing attendance flag.';
  END IF;

  SELECT role
  INTO actor_role
  FROM public.users
  WHERE id = NEW.actor_user_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance flag reviewer must be an active user.';
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.actor_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Attendance flag reviewer must match the current user.';
  END IF;

  SELECT count(*) FILTER (WHERE stage = 'manager'),
         count(*) FILTER (WHERE stage = 'admin')
  INTO manager_review_count, final_review_count
  FROM public.attendance_flag_reviews
  WHERE attendance_flag_id = flag_record.id;

  IF NEW.stage = 'manager' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.manager_staff_assignments AS assignment
      WHERE assignment.manager_id = NEW.actor_user_id
        AND assignment.staff_user_id = flag_record.user_id
        AND assignment.effective_from <= v_today
        AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_today)
    )
    OR public.has_active_manager_delegation_for_staff(flag_record.user_id, 'review_flags')
    INTO has_manager_access;

    IF actor_role <> 'manager' OR NOT has_manager_access THEN
      RAISE EXCEPTION 'Manager flag review requires active review access to the affected staff member.';
    END IF;
  ELSIF NEW.stage = 'admin' THEN
    IF actor_role NOT IN ('hr', 'admin') THEN
      RAISE EXCEPTION 'Final flag review requires an active HR or Admin user.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Attendance flag review stage is invalid.';
  END IF;

  CASE flag_record.workflow_mode
    WHEN 'manager_review_admin_observe' THEN
      IF NEW.stage <> 'manager'
        OR NEW.decision NOT IN ('approved', 'rejected', 'resolved')
        OR manager_review_count <> 0
        OR final_review_count <> 0
      THEN
        RAISE EXCEPTION 'This workflow permits exactly one terminal manager decision and no final review row.';
      END IF;

    WHEN 'manager_preapprove_admin_final' THEN
      IF NEW.stage = 'manager' THEN
        IF NEW.decision NOT IN ('pre_approved', 'rejected')
          OR manager_review_count <> 0
          OR final_review_count <> 0
        THEN
          RAISE EXCEPTION 'This workflow requires exactly one manager recommendation before any final decision.';
        END IF;
      ELSE
        IF NEW.decision NOT IN ('approved', 'rejected', 'resolved')
          OR manager_review_count <> 1
          OR final_review_count <> 0
        THEN
          RAISE EXCEPTION 'This workflow permits exactly one final decision after one manager recommendation.';
        END IF;

        SELECT decision
        INTO manager_recommendation
        FROM public.attendance_flag_reviews
        WHERE attendance_flag_id = flag_record.id
          AND stage = 'manager';

        IF manager_recommendation NOT IN ('pre_approved', 'rejected') THEN
          RAISE EXCEPTION 'Final review requires a manager pre-approval or rejection recommendation.';
        END IF;
      END IF;

    WHEN 'manager_view_admin_approve' THEN
      IF NEW.stage <> 'admin'
        OR NEW.decision NOT IN ('approved', 'rejected', 'resolved')
        OR manager_review_count <> 0
        OR final_review_count <> 0
      THEN
        RAISE EXCEPTION 'This workflow permits exactly one final HR or Admin decision and no manager review row.';
      END IF;
  END CASE;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_attendance_flag_review(
  p_attendance_flag_id uuid,
  p_decision public.flag_review_decision,
  p_remarks text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_stage public.flag_review_stage;
  v_review public.attendance_flag_reviews%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_actor_role IS NULL THEN
    RAISE EXCEPTION 'An active reviewer account is required.';
  END IF;

  IF p_attendance_flag_id IS NULL
    OR p_decision IS NULL
    OR COALESCE(p_remarks, '') !~ '[[:graph:]]'
  THEN
    RAISE EXCEPTION 'Flag review requires a flag, decision, and remarks.';
  END IF;

  IF v_actor_role = 'manager' THEN
    v_stage := 'manager';
  ELSIF v_actor_role IN ('hr', 'admin') THEN
    v_stage := 'admin';
  ELSE
    RAISE EXCEPTION 'Reviewer access is required.';
  END IF;

  INSERT INTO public.attendance_flag_reviews (
    attendance_flag_id,
    actor_user_id,
    stage,
    decision,
    remarks
  ) VALUES (
    p_attendance_flag_id,
    v_actor_id,
    v_stage,
    p_decision,
    btrim(p_remarks)
  )
  RETURNING * INTO v_review;

  RETURN jsonb_build_object(
    'reviewId', v_review.id,
    'flagId', v_review.attendance_flag_id,
    'stage', v_review.stage,
    'decision', v_review.decision,
    'reviewedAt', v_review.created_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_attendance_flag_review(uuid, public.flag_review_decision, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_attendance_flag_review(uuid, public.flag_review_decision, text)
TO authenticated;

COMMENT ON FUNCTION public.submit_attendance_flag_review(uuid, public.flag_review_decision, text) IS
  'Controlled append-only review action. Managers act on current direct/delegated team flags; HR and Admin act at the final workflow stage. Raw flag evidence remains unavailable through this RPC.';

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
        (
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
            'reviewState', CASE
              WHEN latest_review.stage = 'manager' AND v_role = 'manager' THEN 'manager_reviewed'
              WHEN latest_review.stage = 'manager' THEN 'manager_' || latest_review.decision::text
              ELSE COALESCE(latest_review.decision::text, 'needs_review')
            END,
            'reviewedAt', CASE
              WHEN latest_review.stage = 'manager' AND v_role = 'manager' THEN NULL
              ELSE latest_review.created_at
            END
          )
          || CASE
            WHEN v_role IN ('hr', 'admin')
              AND flags.workflow_mode = 'manager_preapprove_admin_final'
              AND manager_review.decision IS NOT NULL
            THEN jsonb_build_object(
              'managerReview',
              jsonb_build_object(
                'reviewerName', manager_review.reviewer_name,
                'decision', manager_review.decision,
                'remarks', manager_review.remarks,
                'reviewedAt', manager_review.created_at
              )
            )
            ELSE '{}'::jsonb
          END
        ) AS payload
      FROM public.attendance_flags AS flags
      JOIN public.attendance_sessions AS sessions ON sessions.id = flags.session_id
      LEFT JOIN public.attendance_events AS events ON events.id = flags.attendance_event_id
      JOIN public.users AS accounts ON accounts.id = flags.user_id
      LEFT JOIN LATERAL (
        SELECT decision, stage, created_at
        FROM public.attendance_flag_reviews
        WHERE attendance_flag_id = flags.id
        ORDER BY CASE WHEN stage = 'admin' THEN 0 ELSE 1 END,
                 created_at DESC,
                 id DESC
        LIMIT 1
      ) AS latest_review ON true
      LEFT JOIN LATERAL (
        SELECT reviews.decision,
               reviews.remarks,
               reviews.created_at,
               reviewers.name AS reviewer_name
        FROM public.attendance_flag_reviews AS reviews
        JOIN public.users AS reviewers ON reviewers.id = reviews.actor_user_id
        WHERE reviews.attendance_flag_id = flags.id
          AND reviews.stage = 'manager'
        ORDER BY reviews.created_at DESC, reviews.id DESC
        LIMIT 1
      ) AS manager_review ON true
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

COMMENT ON FUNCTION public.get_reviewer_flag_queue(date, date) IS
  'Safe Manager/HR/Admin reviewer queue. It excludes raw attendance evidence. For manager-preapproval workflows, only HR/Admin receive the prior manager name, recommendation, remarks, and timestamp needed for final review.';
