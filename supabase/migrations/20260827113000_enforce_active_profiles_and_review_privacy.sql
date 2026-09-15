-- Keep attendance capture tied to an active staff profile, and do not expose
-- precise attendance-event evidence to managers through direct table reads.

CREATE OR REPLACE FUNCTION public.require_active_staff_profile_for_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_profiles
    WHERE user_id = NEW.user_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Your attendance profile is inactive or incomplete. Contact an administrator.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_sessions_require_active_staff_profile
BEFORE INSERT ON public.attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION public.require_active_staff_profile_for_attendance();

CREATE TRIGGER attendance_events_require_active_staff_profile
BEFORE INSERT ON public.attendance_events
FOR EACH ROW
EXECUTE FUNCTION public.require_active_staff_profile_for_attendance();

REVOKE EXECUTE ON FUNCTION public.require_active_staff_profile_for_attendance()
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Users can select own attendance events"
ON public.attendance_events;

DROP POLICY IF EXISTS "Managers can select direct or delegated team attendance events"
ON public.attendance_events;

DROP POLICY IF EXISTS "Users can select own attendance sessions"
ON public.attendance_sessions;

DROP POLICY IF EXISTS "Managers can select assigned staff attendance sessions"
ON public.attendance_sessions;

DROP POLICY IF EXISTS "Users can select own attendance flags"
ON public.attendance_flags;

DROP POLICY IF EXISTS "Managers can select direct or delegated team attendance flags"
ON public.attendance_flags;

DROP POLICY IF EXISTS "Users can select reviews for own attendance flags"
ON public.attendance_flag_reviews;

DROP POLICY IF EXISTS "Managers can select reviews for direct or delegated team flags"
ON public.attendance_flag_reviews;

COMMENT ON TABLE public.attendance_events IS
  'Immutable attendance evidence. Admins read full evidence. Employee, manager, and HR reads must use restricted approved RPCs, never direct event-table access.';

COMMENT ON TABLE public.attendance_flags IS
  'Flag records may contain sensitive review evidence. Admins read raw rows. Employee, manager, and HR reads must use restricted approved RPCs.';
