-- Make append-only flag review history deterministic without opening direct client writes.

CREATE UNIQUE INDEX attendance_flag_reviews_one_manager_stage_per_flag_idx
ON attendance_flag_reviews (attendance_flag_id)
WHERE stage = 'manager';

CREATE UNIQUE INDEX attendance_flag_reviews_one_admin_stage_per_flag_idx
ON attendance_flag_reviews (attendance_flag_id)
WHERE stage = 'admin';

CREATE OR REPLACE FUNCTION validate_attendance_flag_review_insert()
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
  admin_review_count integer;
  manager_recommendation public.flag_review_decision;
BEGIN
  -- Serialize review transitions for one flag. The partial unique indexes below
  -- remain the concurrency-safe final guard for same-stage inserts.
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
  INTO manager_review_count, admin_review_count
  FROM public.attendance_flag_reviews
  WHERE attendance_flag_id = flag_record.id;

  IF NEW.stage = 'manager' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.manager_staff_assignments AS assignment
      WHERE assignment.manager_id = NEW.actor_user_id
        AND assignment.staff_user_id = flag_record.user_id
        AND assignment.effective_from <= CURRENT_DATE
        AND (
          assignment.effective_to IS NULL
          OR assignment.effective_to >= CURRENT_DATE
        )
      UNION ALL
      SELECT 1
      FROM public.manager_delegations AS delegation
      JOIN public.manager_delegation_capabilities AS capability
        ON capability.manager_delegation_id = delegation.id
       AND capability.capability = 'review_flags'
      JOIN public.manager_staff_assignments AS assignment
        ON assignment.manager_id = delegation.original_manager_id
       AND assignment.staff_user_id = flag_record.user_id
      WHERE delegation.covering_manager_id = NEW.actor_user_id
        AND delegation.revoked_at IS NULL
        AND delegation.effective_from <= CURRENT_DATE
        AND delegation.effective_to >= CURRENT_DATE
        AND assignment.effective_from <= CURRENT_DATE
        AND (
          assignment.effective_to IS NULL
          OR assignment.effective_to >= CURRENT_DATE
        )
    ) INTO has_manager_access;

    IF actor_role <> 'manager' OR NOT has_manager_access THEN
      RAISE EXCEPTION 'Manager flag review requires active review access to the affected staff member.';
    END IF;
  ELSIF actor_role <> 'admin' THEN
    RAISE EXCEPTION 'Admin flag review requires an active admin.';
  END IF;

  CASE flag_record.workflow_mode
    WHEN 'manager_review_admin_observe' THEN
      IF NEW.stage <> 'manager'
        OR NEW.decision NOT IN ('approved', 'rejected', 'resolved')
        OR manager_review_count <> 0
        OR admin_review_count <> 0
      THEN
        RAISE EXCEPTION 'This workflow permits exactly one terminal manager decision and no admin review row.';
      END IF;

    WHEN 'manager_preapprove_admin_final' THEN
      IF NEW.stage = 'manager' THEN
        IF NEW.decision NOT IN ('pre_approved', 'rejected')
          OR manager_review_count <> 0
          OR admin_review_count <> 0
        THEN
          RAISE EXCEPTION 'This workflow requires exactly one manager recommendation before any admin decision.';
        END IF;
      ELSE
        IF NEW.decision NOT IN ('approved', 'rejected', 'resolved')
          OR manager_review_count <> 1
          OR admin_review_count <> 0
        THEN
          RAISE EXCEPTION 'This workflow permits exactly one admin final decision after one manager recommendation.';
        END IF;

        SELECT decision
        INTO manager_recommendation
        FROM public.attendance_flag_reviews
        WHERE attendance_flag_id = flag_record.id
          AND stage = 'manager';

        IF manager_recommendation NOT IN ('pre_approved', 'rejected') THEN
          RAISE EXCEPTION 'Admin final review requires a manager pre-approval or rejection recommendation.';
        END IF;
      END IF;

    WHEN 'manager_view_admin_approve' THEN
      IF NEW.stage <> 'admin'
        OR NEW.decision NOT IN ('approved', 'rejected', 'resolved')
        OR manager_review_count <> 0
        OR admin_review_count <> 0
      THEN
        RAISE EXCEPTION 'This workflow permits exactly one terminal admin decision and no manager review row.';
      END IF;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION validate_attendance_flag_review_insert()
FROM PUBLIC, anon, authenticated;
