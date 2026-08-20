-- Employee self-service history is a deliberately narrow projection. Raw
-- attendance evidence remains available only through manager/admin workflows.

DROP POLICY IF EXISTS "Users can select own attendance sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Users can select own attendance events" ON public.attendance_events;
DROP POLICY IF EXISTS "Users can select own attendance flags" ON public.attendance_flags;
DROP POLICY IF EXISTS "Users can select reviews for own attendance flags" ON public.attendance_flag_reviews;

CREATE OR REPLACE FUNCTION public.get_my_attendance_history(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_to date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_from date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required.';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'History window must be between 1 and 365 days.';
  END IF;

  v_from := v_to - (p_days - 1);

  RETURN (
    WITH scoped_sessions AS (
      SELECT
        sessions.id,
        sessions.work_date,
        sessions.session_type,
        sessions.status,
        sessions.created_at
      FROM public.attendance_sessions AS sessions
      WHERE sessions.user_id = v_user_id
        AND sessions.work_date BETWEEN v_from AND v_to
    ),
    flag_payloads AS (
      SELECT
        flags.session_id,
        flags.created_at,
        CASE
          WHEN latest_review.decision IS NULL THEN 'needs_review'
          WHEN flags.workflow_mode = 'manager_preapprove_admin_final'
            AND latest_review.stage <> 'admin' THEN 'needs_review'
          WHEN latest_review.decision = 'approved' THEN 'valid_for_reporting'
          WHEN latest_review.decision = 'rejected' THEN 'rejected'
          WHEN latest_review.decision = 'resolved' THEN 'resolved'
          ELSE 'needs_review'
        END AS outcome,
        CASE
          WHEN latest_review.decision IS NULL THEN NULL
          WHEN flags.workflow_mode = 'manager_preapprove_admin_final'
            AND latest_review.stage <> 'admin' THEN NULL
          ELSE latest_review.created_at
        END AS reviewed_at,
        jsonb_build_object(
          'id', flags.id,
          'attendanceEventId', flags.attendance_event_id,
          'type', flags.flag_type,
          'outcome', CASE
            WHEN latest_review.decision IS NULL THEN 'needs_review'
            WHEN flags.workflow_mode = 'manager_preapprove_admin_final'
              AND latest_review.stage <> 'admin' THEN 'needs_review'
            WHEN latest_review.decision = 'approved' THEN 'valid_for_reporting'
            WHEN latest_review.decision = 'rejected' THEN 'rejected'
            WHEN latest_review.decision = 'resolved' THEN 'resolved'
            ELSE 'needs_review'
          END,
          'reviewedAt', CASE
            WHEN latest_review.decision IS NULL THEN NULL
            WHEN flags.workflow_mode = 'manager_preapprove_admin_final'
              AND latest_review.stage <> 'admin' THEN NULL
            ELSE latest_review.created_at
          END
        ) AS payload
      FROM public.attendance_flags AS flags
      JOIN scoped_sessions ON scoped_sessions.id = flags.session_id
      LEFT JOIN LATERAL (
        SELECT reviews.stage, reviews.decision, reviews.created_at
        FROM public.attendance_flag_reviews AS reviews
        WHERE reviews.attendance_flag_id = flags.id
        ORDER BY reviews.created_at DESC, reviews.id DESC
        LIMIT 1
      ) AS latest_review ON true
    ),
    session_payloads AS (
      SELECT
        sessions.work_date,
        sessions.created_at,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM flag_payloads
            WHERE flag_payloads.session_id = sessions.id
              AND flag_payloads.outcome = 'needs_review'
          ) OR (
            sessions.status = 'needs_review'
            AND NOT EXISTS (
              SELECT 1
              FROM flag_payloads
              WHERE flag_payloads.session_id = sessions.id
            )
          ) THEN 'needs_review'
          WHEN EXISTS (
            SELECT 1
            FROM flag_payloads
            WHERE flag_payloads.session_id = sessions.id
              AND flag_payloads.outcome = 'rejected'
          ) THEN 'rejected'
          WHEN EXISTS (
            SELECT 1
            FROM flag_payloads
            WHERE flag_payloads.session_id = sessions.id
              AND flag_payloads.outcome = 'resolved'
          ) THEN 'resolved'
          WHEN EXISTS (
            SELECT 1
            FROM flag_payloads
            WHERE flag_payloads.session_id = sessions.id
              AND flag_payloads.outcome = 'valid_for_reporting'
          ) THEN 'valid_for_reporting'
          ELSE 'recorded'
        END AS outcome,
        jsonb_build_object(
          'id', sessions.id,
          'type', sessions.session_type,
          'status', sessions.status,
          'events', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', events.id,
                'type', events.event_type,
                'capturedAtLocal', events.captured_at_local,
                'offlineDeclared', events.offline_declared
              )
              ORDER BY events.captured_at_local, events.created_at
            )
            FROM public.attendance_events AS events
            WHERE events.session_id = sessions.id
          ), '[]'::jsonb),
          'flags', COALESCE((
            SELECT jsonb_agg(flag_payloads.payload ORDER BY flag_payloads.created_at DESC)
            FROM flag_payloads
            WHERE flag_payloads.session_id = sessions.id
          ), '[]'::jsonb)
        ) AS payload
      FROM scoped_sessions AS sessions
    ),
    day_payloads AS (
      SELECT
        session_payloads.work_date,
        jsonb_build_object(
          'workDate', session_payloads.work_date,
          'requiresReview', bool_or(session_payloads.outcome = 'needs_review'),
          'outcome', CASE
            WHEN bool_or(session_payloads.outcome = 'needs_review') THEN 'needs_review'
            WHEN bool_or(session_payloads.outcome = 'rejected') THEN 'rejected'
            WHEN bool_or(session_payloads.outcome = 'resolved') THEN 'resolved'
            WHEN bool_or(session_payloads.outcome = 'valid_for_reporting') THEN 'valid_for_reporting'
            ELSE 'recorded'
          END,
          'sessions', jsonb_agg(session_payloads.payload ORDER BY session_payloads.created_at DESC)
        ) AS payload
      FROM session_payloads
      GROUP BY session_payloads.work_date
    )
    SELECT jsonb_build_object(
      'userId', v_user_id,
      'range', jsonb_build_object('from', v_from, 'to', v_to, 'days', p_days),
      'days', COALESCE((
        SELECT jsonb_agg(day_payloads.payload ORDER BY day_payloads.work_date DESC)
        FROM day_payloads
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_my_attendance_history(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_attendance_history(integer) TO authenticated;

COMMENT ON FUNCTION public.get_my_attendance_history(integer) IS
  'Returns only the authenticated employee''s safe attendance history. It intentionally excludes precise GPS, photo paths and metadata, raw evidence, internal validation details, locations, reviewer identities, and remarks.';
